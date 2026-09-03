// Sign2Sign — geocode-address Edge Function
//
// Server-side proxy for the Google Geocoding API. The admin's Sheets import
// sends one address per call and gets back coordinates.
//
//
// ─── Why this exists at all ─────────────────────────────────────────────────
//
// Until 2026-09-03 the import called maps.googleapis.com directly with
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY — a key bundled into the shipped client.
// That cannot be secured, and not for want of trying:
//
//   Google Maps Platform *web service* APIs (Geocoding, Routes) do not accept
//   an iOS-bundle-ID or Android application restriction. The only application
//   restriction they take is a list of IP addresses.
//   (https://developers.google.com/maps/api-security-best-practices,
//    verified 2026-09-03)
//
// An IP allowlist is meaningless for an admin on a laptop or a driver on
// cellular, so an embedded key is an *unrestricted* key, extractable from the
// bundle by anyone who installs the app, billed to the client's account.
// Google's own guidance for exactly this case:
//
//   "Using a secure proxy server provides a solid source for interacting with
//    a Google Maps Platform web service endpoint from a client-side
//    application without exposing your API key."
//
// This function is that proxy. The key lives in `GOOGLE_MAPS_API_KEY`, a
// Supabase secret, and never enters the bundle.
//
//
// ─── Deploy ─────────────────────────────────────────────────────────────────
//
//   supabase secrets set GOOGLE_MAPS_API_KEY=<key>     # run in your own shell
//   supabase functions deploy geocode-address
//
// NOTE the absence of --no-verify-jwt: unlike validate-code, this endpoint is
// admin-only and the gateway's JWT check is wanted. See the auth note below
// for why the gateway check alone is not sufficient.
//
//
// ─── Response contract ──────────────────────────────────────────────────────
//
// On success this deliberately returns a TRIMMED COPY OF GOOGLE'S OWN SHAPE:
//
//     { "status": "OK", "results": [ { "geometry": { "location": {...} } } ] }
//
// and mirrors Google's HTTP status for 429 / 5xx. That is not laziness — the
// client's retry machinery (GoogleSheetsService.geocodeAddress) already
// distinguishes OVER_QUERY_LIMIT from ZERO_RESULTS from a 429, and reports a
// failure against the offending sheet row. Keeping the shape means that logic
// survives the move behind the proxy unchanged, instead of being rewritten
// against a new vocabulary and re-tested from scratch.
//
// Proxy-level failures use `{ "error": "<code>" }` instead, which has no
// `status` field — that is how the client tells the two apart.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';

const GEOCODING_API = 'https://maps.googleapis.com/maps/api/geocode/json';

// Anon client used only to resolve the caller's JWT to a user. Never used to
// mutate anything. Mirrors delete-admin-account.
const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mirrors MAX_ADDRESS_CHARS in GoogleSheetsService. The client already refuses
// longer cells with a row-numbered error; this is the server refusing to spend
// a billable request on something the client should never have sent.
const MAX_ADDRESS_CHARS = 300;

// {"address":"<=300 chars"} plus JSON overhead. 1 KiB is room to spare.
const MAX_BODY_BYTES = 1024;

// In-memory per-IP throttle, same shape as validate-code and
// delete-admin-account. The ceiling is set by legitimate use, not by a guess:
// GoogleSheetsService caps an import at MAX_IMPORT_ROWS = 500, geocodes only
// the DISTINCT addresses, and runs 5 concurrently — so the worst honest minute
// is 500 calls from one admin's IP. 600 leaves headroom for a retried import
// without letting a stolen session bill an unbounded amount.
//
// The real gate here is the auth check below; this is the ceiling on what one
// compromised admin session can cost before someone notices.
const ipCalls = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 600;

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

// CORS — allowlist, not wildcard. Pinned from electron/main.js, same two
// origins as delete-admin-account: the packaged desktop renderer and the Metro
// dev server. The import runs in the Electron admin app, so unlike the driver
// endpoints this one genuinely is a browser surface. The native iOS admin
// sends no Origin header and is unaffected.
const ALLOWED_ORIGINS = ['app://bundle', 'http://localhost:8081'];

const BASE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
};

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...BASE_CORS_HEADERS, 'Access-Control-Allow-Origin': origin };
  }
  return BASE_CORS_HEADERS;
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'method_not_allowed' }, 405);
  }

  const xff = req.headers.get('x-forwarded-for') ?? '';
  const ip = xff.split(',')[0]?.trim() || 'unknown';
  if (!checkIpThrottle(ip)) {
    return jsonResponse(req, { error: 'rate_limited' }, 429);
  }

  // Authorization — and note carefully what the gateway does NOT prove.
  //
  // verify_jwt=true makes the gateway reject a request with no bearer token or
  // a token not signed by this project's secret. It does NOT prove the caller
  // is a signed-in admin, because THE ANON KEY IS ITSELF A VALID JWT signed by
  // that same secret — and the anon key is public, bundled into every copy of
  // the app. So the gateway alone would let any driver handset, or anyone who
  // unzipped the bundle, spend the geocoding budget.
  //
  // auth.getUser() is what closes that: it resolves the token to a row in
  // auth.users, which an anon key has none. Same reasoning as
  // delete-admin-account, which re-validates for the same reason.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return jsonResponse(req, { error: 'unauthorized' }, 401);
  }

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse(req, { error: 'unauthorized' }, 401);
  }

  // Two body-size checks, for the reason spelled out in validate-code: a
  // chunked request carries no Content-Length, so the header check alone is
  // trivially bypassed.
  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(req, { error: 'payload_too_large' }, 413);
  }

  let payload: { address?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse(req, { error: 'payload_too_large' }, 413);
    }
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse(req, { error: 'invalid_json' }, 400);
  }

  const address = typeof payload.address === 'string' ? payload.address.trim() : '';
  if (!address || address.length > MAX_ADDRESS_CHARS) {
    return jsonResponse(req, { error: 'invalid_address' }, 400);
  }

  // Checked after validation so a malformed request still gets its 400 on a
  // misconfigured deployment — the error the operator sees should be the one
  // they can act on.
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('geocode-address: GOOGLE_MAPS_API_KEY secret is not set');
    return jsonResponse(req, { error: 'server_key_missing' }, 503);
  }

  // `region=au` is fixed here rather than accepted from the caller. Every
  // Sign2Site job is Australian, and biasing the result is the difference
  // between the right Melbourne street and one in Florida. Hardcoding it also
  // means the caller cannot widen the search to bill queries for someone
  // else's project.
  const url =
    `${GEOCODING_API}?address=${encodeURIComponent(address)}` +
    `&region=au&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  let googleResponse: Response;
  try {
    googleResponse = await fetch(url);
  } catch {
    return jsonResponse(req, { error: 'upstream_unreachable' }, 502);
  }

  // Mirror the statuses the client retries on, so its backoff keeps working
  // through the proxy. The body is deliberately NOT forwarded — a Google error
  // page can echo the request URL, and the request URL contains the key.
  if (googleResponse.status === 429) {
    return jsonResponse(req, { error: 'upstream_rate_limited' }, 429);
  }
  if (googleResponse.status >= 500) {
    return jsonResponse(req, { error: 'upstream_error' }, 502);
  }
  if (!googleResponse.ok) {
    console.error(`geocode-address: geocoding API returned ${googleResponse.status}`);
    return jsonResponse(req, { error: 'upstream_rejected' }, 502);
  }

  let json: {
    status?: unknown;
    results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }>;
  };
  try {
    json = await googleResponse.json();
  } catch {
    return jsonResponse(req, { error: 'upstream_bad_json' }, 502);
  }

  const status = typeof json.status === 'string' ? json.status : 'UNKNOWN_ERROR';

  // REQUEST_DENIED is the shape a bad or unenabled server key takes: HTTP 200
  // with a refusal in the body. Log it — this is the one failure an operator
  // will need to find, and it is invisible in the HTTP status.
  if (status === 'REQUEST_DENIED') {
    console.error('geocode-address: Google returned REQUEST_DENIED — check the key and that the Geocoding API is enabled');
  }

  const location = json.results?.[0]?.geometry?.location;
  const lat = location?.lat;
  const lng = location?.lng;

  // Only forward a result we have actually validated as usable coordinates.
  // jobs.latitude/longitude are NOT NULL and feed the map and the GPS
  // comparison — a NaN reaching them is a corrupt job row, not a bad pin.
  if (
    status !== 'OK' ||
    typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180
  ) {
    // Still a 200 with Google's own status word: ZERO_RESULTS on a typo'd
    // address is a normal outcome the client reports against the sheet row,
    // not a transport failure.
    return jsonResponse(req, { status, results: [] }, 200);
  }

  return jsonResponse(
    req,
    { status: 'OK', results: [{ geometry: { location: { lat, lng } } }] },
    200
  );
});
