// Sign2Sign — optimize-route Edge Function
//
// Server-side proxy for the Google Routes API. The driver map sends the day's
// job coordinates and gets back an optimised stop order plus road geometry.
//
//
// ─── Why this is a proxy, and why it is the Routes API ──────────────────────
//
// Two independent reasons, either of which alone would force this change.
//
// 1. THE KEY CANNOT BE SHIPPED. Google Maps Platform web service APIs accept
//    only an IP-address application restriction — never an iOS bundle ID
//    (https://developers.google.com/maps/api-security-best-practices, verified
//    2026-09-03). A driver on cellular has no fixed IP, so a key in the bundle
//    is an unrestricted key on the client's billing account. Google's stated
//    remedy is a proxy; this is it. The key lives in the GOOGLE_MAPS_API_KEY
//    Supabase secret.
//
// 2. THE OLD ENDPOINT CANNOT BE ENABLED. This replaced a call to
//    maps.googleapis.com/maps/api/directions/json — the Directions API, which
//    Google moved to Legacy status on 2025-03-01. Legacy services "are not
//    available in new Cloud projects" (https://developers.google.com/maps/legacy,
//    verified 2026-09-03). Sign2Site's Cloud project postdates that, so no key
//    it issues can ever call the old endpoint, whatever its restrictions. The
//    successor is the Routes API, used below.
//
//    This is worth stating plainly because it means the original bug report —
//    "the Maps key is a placeholder" — could not have been fixed by supplying
//    a real key. The endpoint was unreachable too.
//
//
// ─── Deploy ─────────────────────────────────────────────────────────────────
//
//   supabase secrets set GOOGLE_MAPS_API_KEY=<key>     # run in your own shell
//   supabase functions deploy optimize-route --no-verify-jwt
//
// --no-verify-jwt for the same reason as validate-code: drivers have no
// Supabase Auth account, so there is no JWT to verify. The route code is the
// credential.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';

const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// The field mask is mandatory on computeRoutes — the request fails outright
// without it, rather than returning a default set of fields. These two are
// exactly what the client consumes and nothing more; a wider mask can move the
// request into a higher-priced SKU.
const FIELD_MASK = 'routes.optimizedIntermediateWaypointIndex,routes.polyline.encodedPolyline';

// Same ceiling the legacy Directions API had: 25 intermediate waypoints,
// origin and destination excluded. The client enforces this too and degrades
// to list order rather than sending a doomed (and billable) request; this is
// the server refusing to be the one that finds out.
const MAX_INTERMEDIATE_WAYPOINTS = 25;
const MAX_COORDINATES = MAX_INTERMEDIATE_WAYPOINTS + 2;

// 27 coordinates at ~47 bytes of JSON each, plus a six-digit code. 4 KiB is
// several times the largest honest payload.
const MAX_BODY_BYTES = 4096;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// In-memory per-IP throttle, same shape as validate-code.
//
// The ceiling is deliberately BELOW validate-code's 30/min, and the reason is
// the one real security question this function raises. Verifying the route
// code here makes this endpoint a code-validity oracle: send a guess, and a
// 403 versus a 200 tells you whether it was real. It must therefore never be a
// CHEAPER oracle than the front door.
//
// Two things keep it from being one. First, the rate: 20/min per IP is
// stricter than validate-code's 30/min, so an attacker gains nothing by coming
// here instead. Second — and this is why the check below is a plain SELECT and
// not a call to validate_route_code() — this path writes no code_attempts row,
// so it cannot be used to exhaust a legitimate driver's per-client_id budget
// and lock them out of their own route. Reusing the RPC would have been the
// obvious move and would have created exactly that denial of service, on every
// map load.
//
// A driver opens the map a handful of times a shift. 20/min is far above real
// use and far below anything useful for brute force.
const ipCalls = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function checkIpThrottle(ip: string): boolean {
  const now = Date.now();
  const entry = ipCalls.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    ipCalls.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [ip, entry] of ipCalls) {
    if (entry.windowStart < cutoff) ipCalls.delete(ip);
  }
}, WINDOW_MS).unref?.();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// No CORS handling here, deliberately. The driver flow is native iOS only — it
// never runs in the Electron admin bundle or a browser (the map screen has a
// .web.tsx stub precisely to keep react-native-maps out of the web build), and
// native fetch sends no Origin and is not subject to CORS. Adding an allowlist
// would be inert code implying a browser surface that does not exist.

type Coordinate = { latitude: number; longitude: number };

function isValidCoordinate(value: unknown): value is Coordinate {
  if (typeof value !== 'object' || value === null) return false;
  const { latitude, longitude } = value as Record<string, unknown>;
  return (
    typeof latitude === 'number' && Number.isFinite(latitude) &&
    latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) &&
    longitude >= -180 && longitude <= 180
  );
}

const waypoint = (c: Coordinate) => ({
  location: { latLng: { latitude: c.latitude, longitude: c.longitude } },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const xff = req.headers.get('x-forwarded-for') ?? '';
  const ip = xff.split(',')[0]?.trim() || 'unknown';
  if (!checkIpThrottle(ip)) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large' }, 413);
  }

  let payload: { code?: unknown; coordinates?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'payload_too_large' }, 413);
    }
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const code = typeof payload.code === 'string' ? payload.code : '';
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ error: 'invalid_code_format' }, 400);
  }

  const coordinates = payload.coordinates;
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.length > MAX_COORDINATES ||
    !coordinates.every(isValidCoordinate)
  ) {
    return jsonResponse({ error: 'invalid_coordinates' }, 400);
  }

  // Side-effect-free check that the code is a live route code.
  //
  // A plain SELECT, NOT validate_route_code() — see the throttle note above.
  // The predicate matches that RPC's strict form (is_active AND not expired)
  // rather than the 24-hour offline-sync grace used by the write paths in 012:
  // a driver replaying a queued upload the morning after has a job to finish,
  // but nobody needs a fresh optimised route for yesterday.
  const { data: routeCode, error: lookupError } = await supabase
    .from('route_codes')
    .select('id')
    .eq('code', code)
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (lookupError) {
    console.error('optimize-route: route_codes lookup failed', lookupError.message);
    return jsonResponse({ error: 'lookup_failed' }, 500);
  }
  if (!routeCode) {
    return jsonResponse({ error: 'invalid_code' }, 403);
  }

  if (!GOOGLE_MAPS_API_KEY) {
    console.error('optimize-route: GOOGLE_MAPS_API_KEY secret is not set');
    return jsonResponse({ error: 'server_key_missing' }, 503);
  }

  const origin = coordinates[0];
  const destination = coordinates[coordinates.length - 1];
  const intermediates = coordinates.slice(1, -1);

  // optimizeWaypointOrder is only meaningful with something to reorder, and
  // sending an empty intermediates array alongside it is a needless way to
  // find out how the API feels about that.
  const body: Record<string, unknown> = {
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: 'DRIVE',
    // TRAFFIC_UNAWARE preserves the behaviour of the legacy Directions call,
    // which sent no departure_time and so was also traffic-unaware. It is
    // additionally the cheapest routing preference, and the one with no
    // compatibility caveats around waypoint optimisation. Routes are computed
    // once when the map opens, for a whole shift — live traffic would be stale
    // within the hour anyway.
    routingPreference: 'TRAFFIC_UNAWARE',
    polylineEncoding: 'ENCODED_POLYLINE',
  };
  if (intermediates.length > 0) {
    body.intermediates = intermediates.map(waypoint);
    body.optimizeWaypointOrder = true;
  }

  let googleResponse: Response;
  try {
    googleResponse = await fetch(ROUTES_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return jsonResponse({ error: 'upstream_unreachable' }, 502);
  }

  if (!googleResponse.ok) {
    // Logged, not forwarded: the Routes API error body echoes request detail,
    // and the client has no use for it beyond "fall back to list order". It is
    // safe to log precisely because the Routes API takes the key in the
    // X-Goog-Api-Key HEADER — nothing Google echoes back can contain it. The
    // Geocoding API takes its key in the query string, which is why the
    // equivalent branch in geocode-address logs only the status code.
    const detail = await googleResponse.text().catch(() => '');
    console.error(`optimize-route: Routes API ${googleResponse.status} ${detail.slice(0, 500)}`);
    return jsonResponse({ error: 'upstream_rejected' }, 502);
  }

  let data: {
    routes?: Array<{
      optimizedIntermediateWaypointIndex?: unknown;
      polyline?: { encodedPolyline?: unknown };
    }>;
  };
  try {
    data = await googleResponse.json();
  } catch {
    return jsonResponse({ error: 'upstream_bad_json' }, 502);
  }

  const route = data.routes?.[0];
  const encodedPolyline = route?.polyline?.encodedPolyline;
  if (!route || typeof encodedPolyline !== 'string' || encodedPolyline.length === 0) {
    // A 200 with no usable route is a real outcome — no drivable path between
    // the stops, for instance. The client degrades to straight lines.
    return jsonResponse({ error: 'no_route' }, 200);
  }

  // Absent index is legitimate only when we asked for no optimisation.
  // Anything else is a response we do not understand, and guessing an order
  // would silently send a driver round the wrong way.
  const rawIndex = route.optimizedIntermediateWaypointIndex;
  let optimizedIndex: number[];
  if (rawIndex === undefined) {
    if (intermediates.length > 0) {
      return jsonResponse({ error: 'no_waypoint_order' }, 200);
    }
    optimizedIndex = [];
  } else if (
    Array.isArray(rawIndex) &&
    rawIndex.length === intermediates.length &&
    rawIndex.every((i) => Number.isInteger(i) && i >= 0 && i < intermediates.length) &&
    new Set(rawIndex).size === rawIndex.length
  ) {
    optimizedIndex = rawIndex as number[];
  } else {
    return jsonResponse({ error: 'bad_waypoint_order' }, 200);
  }

  return jsonResponse({ optimizedIndex, encodedPolyline }, 200);
});
