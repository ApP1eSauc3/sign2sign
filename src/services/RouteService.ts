import { SignJob } from '../data/SignJob';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';

export type LatLng = { latitude: number; longitude: number };

export type RouteResult = {
  orderedJobs: SignJob[];
  polylineCoords: LatLng[];
  // True when the returned route is the straight-line fallback rather than real
  // optimized road geometry. Callers that draw the polyline should say so —
  // silently showing crow-flies lines as if they were a driving route is the
  // failure mode this flag exists to make visible. `degradedReason` names which
  // branch produced it, for logging and for the map overlay's wording.
  degraded: boolean;
  degradedReason?: 'no-api-key' | 'too-many-waypoints' | 'request-failed' | 'bad-response';
};

// Route optimisation goes through our own Edge Function, never to Google
// directly, and speaks to the Routes API rather than the Directions API.
// Two separate reasons, spelled out in supabase/functions/optimize-route:
//
//   1. Google Maps web service keys cannot be restricted to an iOS bundle ID —
//      only to IP addresses — so a key shipped in this bundle is an
//      unrestricted key on the client's billing account.
//   2. The Directions API went Legacy on 2025-03-01 and cannot be enabled in
//      Cloud projects created after that date. This project's is. So no key,
//      however well restricted, could have called the old endpoint — which is
//      why "the Maps key is a placeholder" was never fixable by pasting in a
//      real one.
//
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is consequently gone. `degradedReason:
// 'no-api-key'` now means the SERVER's GOOGLE_MAPS_API_KEY secret is unset.
const OPTIMIZE_ROUTE_FUNCTION = `${SUPABASE_URL}/functions/v1/optimize-route`;

// The Routes API accepts at most 25 intermediate waypoints per request — the
// same ceiling the legacy Directions API had, with and without optimisation.
// https://developers.google.com/maps/documentation/routes/intermed_waypoints
// (verified 2026-09-03)
//
// origin and destination do not count against it, so `middle` is what we check.
// A route of 28+ jobs therefore cannot be optimized in one request. That is a
// realistic route size, not an edge case — before this check the app sent the
// oversized request anyway, got MAX_WAYPOINTS_EXCEEDED back, and fell through
// to the straight-line path without telling anyone. Now we skip the doomed
// (and billable) call and flag the degradation.
//
// Splitting a long route into ≤25-stop chunks and optimizing each would restore
// most of the benefit, at the cost of one extra billed Directions request per
// chunk and only locally-optimal ordering. Deliberately NOT done here — it
// changes billing, so it is Liam's call, not a silent implementation detail.
const MAX_INTERMEDIATE_WAYPOINTS = 25;

// Requests with 11+ waypoints bill at the higher "advanced" tier. Not enforced,
// just recorded so the cost of a long route is not a surprise.

// Google's encoded polyline algorithm — decodes routes[].polyline.encodedPolyline
// from the Routes API. Unchanged by the migration off Directions: both encode
// with the same algorithm, which is why this decoder and its pinned test vector
// survived the move untouched.
function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;

  // Each chunk is a 5-bit group with the continuation bit set while more
  // groups follow. Returns null if the string ends mid-chunk, so a truncated
  // payload yields a short polyline instead of a coordinate built from NaN.
  function readValue(): number | null {
    let b: number, shift = 0, result = 0;
    do {
      if (index >= encoded.length) return null;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    const dLat = readValue();
    if (dLat === null) break;
    const dLng = readValue();
    if (dLng === null) break;
    lat += dLat;
    lng += dLng;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

function sortedByOrder(jobs: SignJob[]): SignJob[] {
  return [...jobs].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function straightLineResult(
  jobs: SignJob[],
  degradedReason: NonNullable<RouteResult['degradedReason']>
): RouteResult {
  const ordered = sortedByOrder(jobs);
  return {
    orderedJobs: ordered,
    polylineCoords: ordered.map(j => ({ latitude: j.latitude, longitude: j.longitude })),
    degraded: true,
    degradedReason,
  };
}

// Google returns waypoint_order as a permutation of the indices of the
// intermediate waypoints we sent. Trusting it blindly is how a malformed or
// truncated response turns into `undefined` entries in orderedJobs, which then
// crash on `job.id` two layers away in the map screen. Verify it really is a
// permutation of 0..n-1 before using it.
function isValidPermutation(order: unknown, length: number): order is number[] {
  if (!Array.isArray(order) || order.length !== length) return false;
  const seen = new Set<number>();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= length || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

export const RouteService = {
  // Computes an optimized driving route between all jobs.
  //
  // Calls the optimize-route Edge Function, which holds the Google key and
  // talks to the Routes API with waypoint optimisation, returning real road
  // geometry for the polyline. Falls back to straight-line connections in
  // sort_order with `degraded: true` whenever that cannot be done, so the
  // caller can say why rather than passing crow-flies lines off as a route.
  //
  // `routeCode` is the driver's six-digit code, passed in by the screen rather
  // than read from a store — services never touch stores, the same rule that
  // makes JobPhotoService take `currentLocation` as a parameter. The function
  // needs it to confirm the caller holds a live route before spending a
  // billable request.
  async computeRoute(jobs: SignJob[], routeCode: string): Promise<RouteResult> {
    if (jobs.length === 0) {
      return { orderedJobs: [], polylineCoords: [], degraded: false };
    }
    if (jobs.length === 1) {
      return {
        orderedJobs: jobs,
        polylineCoords: [{ latitude: jobs[0].latitude, longitude: jobs[0].longitude }],
        degraded: false,
      };
    }

    const sorted = sortedByOrder(jobs);
    const middle = sorted.slice(1, -1);

    // Checked here as well as server-side: an oversized route is a request we
    // already know Google will refuse, and not sending it saves both the
    // latency and the bill.
    if (middle.length > MAX_INTERMEDIATE_WAYPOINTS) {
      return straightLineResult(jobs, 'too-many-waypoints');
    }

    let response: Response;
    try {
      response = await fetch(OPTIMIZE_ROUTE_FUNCTION, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Deployed --no-verify-jwt (drivers have no Supabase Auth account),
          // but the gateway still needs the anon apikey to route the call.
          // Both values are public and already bundled.
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          code: routeCode,
          coordinates: sorted.map(j => ({ latitude: j.latitude, longitude: j.longitude })),
        }),
      });
    } catch {
      // fetch rejects only on network failure — offline mid-route is normal
      // here, so this is a fallback, not an error to surface as a throw.
      return straightLineResult(jobs, 'request-failed');
    }

    let data: {
      error?: string;
      optimizedIndex?: number[];
      encodedPolyline?: string;
    };
    try {
      data = await response.json();
    } catch {
      return straightLineResult(jobs, response.ok ? 'bad-response' : 'request-failed');
    }

    if (!response.ok) {
      // The one server-side failure worth distinguishing: an unset
      // GOOGLE_MAPS_API_KEY secret is a deployment that was never finished,
      // and it keeps the honest "optimisation is off" wording rather than
      // blaming the driver's signal.
      return straightLineResult(
        jobs,
        data.error === 'server_key_missing' ? 'no-api-key' : 'request-failed'
      );
    }

    // A 200 carrying an `error` is the function reporting a route it could not
    // use — no drivable path, or a waypoint order it refused to trust.
    if (data.error) return straightLineResult(jobs, 'bad-response');

    const polylineCoords = typeof data.encodedPolyline === 'string'
      ? decodePolyline(data.encodedPolyline)
      : [];
    if (polylineCoords.length === 0) return straightLineResult(jobs, 'bad-response');

    // optimizedIndex is a permutation of the indices of `middle`. The function
    // validates it too; re-checking here is cheap and keeps a malformed
    // response from putting `undefined` into orderedJobs, which would crash on
    // `job.id` two layers away in the map screen.
    let orderedMiddle: SignJob[];
    if (isValidPermutation(data.optimizedIndex, middle.length)) {
      orderedMiddle = data.optimizedIndex.map(i => middle[i]);
    } else {
      return straightLineResult(jobs, 'bad-response');
    }

    const orderedJobs = [sorted[0], ...orderedMiddle, sorted[sorted.length - 1]];

    return { orderedJobs, polylineCoords, degraded: false };
  },
};

// Exported for tests only — the decoder is pure and worth pinning directly
// rather than exercising it through a mocked fetch. It stays in the production
// bundle (a few hundred bytes, no behaviour, no secrets); the alternative is a
// separate module split that costs more in indirection than it saves.
export const __testing = { decodePolyline, isValidPermutation, MAX_INTERMEDIATE_WAYPOINTS };
