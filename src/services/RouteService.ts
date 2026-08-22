import { SignJob } from '../data/SignJob';

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

const MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// Google Directions accepts at most 25 intermediate waypoints per request —
// the same ceiling with and without `optimize:true`, and the whole URL is
// capped at 16,384 characters.
// https://developers.google.com/maps/documentation/directions/get-directions
// (verified 2026-08-21)
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

// Google's encoded polyline algorithm — decodes overview_polyline.points from Directions API
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
  // With EXPO_PUBLIC_GOOGLE_MAPS_API_KEY set and a route within the waypoint
  // cap: calls Google Directions with waypoint optimization and returns real
  // road geometry for the polyline.
  // Otherwise: falls back to straight-line connections in sort_order, with
  // `degraded: true` so the caller can say why.
  async computeRoute(jobs: SignJob[]): Promise<RouteResult> {
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

    if (!MAPS_API_KEY) return straightLineResult(jobs, 'no-api-key');

    const sorted = sortedByOrder(jobs);
    const middle = sorted.slice(1, -1);

    if (middle.length > MAX_INTERMEDIATE_WAYPOINTS) {
      return straightLineResult(jobs, 'too-many-waypoints');
    }

    const origin = `${sorted[0].latitude},${sorted[0].longitude}`;
    const dest = `${sorted[sorted.length - 1].latitude},${sorted[sorted.length - 1].longitude}`;
    const waypointsParam = middle.length > 0
      ? `optimize:true|${middle.map(j => `${j.latitude},${j.longitude}`).join('|')}`
      : undefined;

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', dest);
    if (waypointsParam) url.searchParams.set('waypoints', waypointsParam);
    url.searchParams.set('key', MAPS_API_KEY);

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch {
      // fetch rejects only on network failure — offline mid-route is normal
      // here, so this is a fallback, not an error to surface as a throw.
      return straightLineResult(jobs, 'request-failed');
    }
    if (!response.ok) return straightLineResult(jobs, 'request-failed');

    let data: {
      status?: string;
      routes?: Array<{
        overview_polyline?: { points?: string };
        waypoint_order?: number[];
      }>;
    };
    try {
      data = await response.json();
    } catch {
      return straightLineResult(jobs, 'bad-response');
    }

    const route = data.status === 'OK' ? data.routes?.[0] : undefined;
    if (!route) return straightLineResult(jobs, 'bad-response');

    const points = route.overview_polyline?.points;
    const polylineCoords = typeof points === 'string' ? decodePolyline(points) : [];
    if (polylineCoords.length === 0) return straightLineResult(jobs, 'bad-response');

    // waypoint_order is indices into `middle` — rebuild full ordered list.
    // Absent is legitimate (no intermediate waypoints); present-but-malformed
    // is not, and falls back rather than producing holes in orderedJobs.
    let orderedMiddle: SignJob[];
    if (route.waypoint_order === undefined) {
      if (middle.length > 0) return straightLineResult(jobs, 'bad-response');
      orderedMiddle = [];
    } else if (isValidPermutation(route.waypoint_order, middle.length)) {
      orderedMiddle = route.waypoint_order.map(i => middle[i]);
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
