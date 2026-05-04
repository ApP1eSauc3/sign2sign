import { SignJob } from '../data/SignJob';

export type LatLng = { latitude: number; longitude: number };

export type RouteResult = {
  orderedJobs: SignJob[];
  polylineCoords: LatLng[];
};

const MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// Google's encoded polyline algorithm — decodes overview_polyline.points from Directions API
function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

function sortedByOrder(jobs: SignJob[]): SignJob[] {
  return [...jobs].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function straightLineResult(jobs: SignJob[]): RouteResult {
  const ordered = sortedByOrder(jobs);
  return {
    orderedJobs: ordered,
    polylineCoords: ordered.map(j => ({ latitude: j.latitude, longitude: j.longitude })),
  };
}

export const RouteService = {
  // Computes an optimized driving route between all jobs.
  // With EXPO_PUBLIC_GOOGLE_MAPS_API_KEY set: calls Google Directions with waypoint
  // optimization and returns real road geometry for the polyline.
  // Without an API key: falls back to straight-line connections in sort_order.
  async computeRoute(jobs: SignJob[]): Promise<RouteResult> {
    if (jobs.length === 0) return { orderedJobs: [], polylineCoords: [] };
    if (jobs.length === 1) {
      return {
        orderedJobs: jobs,
        polylineCoords: [{ latitude: jobs[0].latitude, longitude: jobs[0].longitude }],
      };
    }

    if (!MAPS_API_KEY) return straightLineResult(jobs);

    const sorted = sortedByOrder(jobs);
    const origin = `${sorted[0].latitude},${sorted[0].longitude}`;
    const dest = `${sorted[sorted.length - 1].latitude},${sorted[sorted.length - 1].longitude}`;
    const middle = sorted.slice(1, -1);
    const waypointsParam = middle.length > 0
      ? `optimize:true|${middle.map(j => `${j.latitude},${j.longitude}`).join('|')}`
      : undefined;

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', dest);
    if (waypointsParam) url.searchParams.set('waypoints', waypointsParam);
    url.searchParams.set('key', MAPS_API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) return straightLineResult(jobs);

    const data: {
      status: string;
      routes?: Array<{
        overview_polyline: { points: string };
        waypoint_order: number[];
      }>;
    } = await response.json();

    if (data.status !== 'OK' || !data.routes?.[0]) return straightLineResult(jobs);

    const route = data.routes[0];
    const polylineCoords = decodePolyline(route.overview_polyline.points);

    // waypoint_order is indices into `middle` — rebuild full ordered list
    const orderedMiddle = (route.waypoint_order ?? middle.map((_, i) => i)).map(i => middle[i]);
    const orderedJobs = [sorted[0], ...orderedMiddle, sorted[sorted.length - 1]];

    return { orderedJobs, polylineCoords };
  },
};
