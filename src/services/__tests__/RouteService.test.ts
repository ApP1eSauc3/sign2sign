import { SignJob } from '../../data/SignJob';

// RouteService no longer reads an API key from process.env — the key lives in
// a Supabase secret and the service calls the optimize-route Edge Function.
// What it needs from the client module is the project URL and the anon key
// (gateway routing), so those are what the mock supplies.
jest.mock('../supabaseClient', () => ({
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
}));

import { RouteService, __testing } from '../RouteService';

const FUNCTION_URL = 'https://test.supabase.co/functions/v1/optimize-route';
const ROUTE_CODE = '123456';

function makeJob(id: string, sortOrder: number, over: Partial<SignJob> = {}): SignJob {
  return {
    id,
    clientName: 'Harcourts',
    agentName: 'Jane',
    agentEmail: '',
    address: `${sortOrder} Maple St`,
    signDescription: 'Corflute',
    jobType: 'install',
    latitude: -31.95 + sortOrder * 0.01,
    longitude: 115.86 + sortOrder * 0.01,
    sortOrder,
    isComplete: false,
    ...over,
  };
}

const makeJobs = (n: number) =>
  Array.from({ length: n }, (_, i) => makeJob(`job-${i + 1}`, i + 1));

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  return fetchMock;
}

// Parse the JSON body the service sent on its first (only) call.
function sentBody(fetchMock: jest.Mock): { code: string; coordinates: unknown[] } {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

// A well-formed optimize-route success response.
function okRoute(optimizedIndex: number[], polyline = GOOGLE_EXAMPLE_POLYLINE) {
  return { optimizedIndex, encodedPolyline: polyline };
}

// Google's own worked example from the encoded polyline algorithm reference:
// (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
// Verified against this decoder on 2026-08-21 before being pinned here.
// The Routes API encodes polylines with the same algorithm as the legacy
// Directions API, so this vector survived the 2026-09-03 migration unchanged.
const GOOGLE_EXAMPLE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const GOOGLE_EXAMPLE_POINTS = [
  { latitude: 38.5, longitude: -120.2 },
  { latitude: 40.7, longitude: -120.95 },
  { latitude: 43.252, longitude: -126.453 },
];

// ─── decodePolyline ──────────────────────────────────────────────────────────

describe('decodePolyline', () => {
  it('decodes Google\'s reference example exactly', () => {
    expect(__testing.decodePolyline(GOOGLE_EXAMPLE_POLYLINE)).toEqual(GOOGLE_EXAMPLE_POINTS);
  });

  it('returns an empty list for an empty string', () => {
    expect(__testing.decodePolyline('')).toEqual([]);
  });

  it('decodes a single point', () => {
    // First point of the reference example on its own.
    expect(__testing.decodePolyline('_p~iF~ps|U')).toEqual([GOOGLE_EXAMPLE_POINTS[0]]);
  });

  it('handles negative deltas — later points move south-west', () => {
    const decoded = __testing.decodePolyline(GOOGLE_EXAMPLE_POLYLINE);
    expect(decoded[2].longitude).toBeLessThan(decoded[1].longitude);
  });

  // A truncated payload used to run charCodeAt past the end, producing NaN and
  // pushing a coordinate of {latitude: NaN, longitude: NaN} onto the polyline.
  it('drops a trailing incomplete chunk instead of emitting NaN coordinates', () => {
    const truncated = GOOGLE_EXAMPLE_POLYLINE.slice(0, -1);
    const decoded = __testing.decodePolyline(truncated);

    expect(decoded.every((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude))).toBe(true);
    // The two complete points survive; the mangled third is dropped.
    expect(decoded.slice(0, 2)).toEqual(GOOGLE_EXAMPLE_POINTS.slice(0, 2));
  });

  it('never emits NaN for a payload cut at any offset', () => {
    for (let i = 1; i < GOOGLE_EXAMPLE_POLYLINE.length; i++) {
      const decoded = __testing.decodePolyline(GOOGLE_EXAMPLE_POLYLINE.slice(0, i));
      expect(decoded.every((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude))).toBe(true);
    }
  });
});

// ─── isValidPermutation ──────────────────────────────────────────────────────

describe('isValidPermutation', () => {
  const isValid = __testing.isValidPermutation;

  it('accepts a genuine permutation in any order', () => {
    expect(isValid([2, 0, 1], 3)).toBe(true);
    expect(isValid([], 0)).toBe(true);
  });

  it.each([
    ['wrong length', [0, 1], 3],
    ['duplicate index', [0, 0, 1], 3],
    ['out of range high', [0, 1, 3], 3],
    ['negative index', [0, 1, -1], 3],
    ['non-integer', [0, 1, 1.5], 3],
    ['not an array', 'nope', 3],
  ] as const)('rejects %s', (_label, order, length) => {
    expect(isValid(order, length)).toBe(false);
  });
});

// ─── computeRoute — trivial inputs ───────────────────────────────────────────

describe('computeRoute — trivial inputs', () => {
  it('returns an empty, non-degraded result for no jobs', async () => {
    const fetchMock = mockFetchOnce({});
    const result = await RouteService.computeRoute([], ROUTE_CODE);

    expect(result).toEqual({ orderedJobs: [], polylineCoords: [], degraded: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short-circuits a single job without calling the route proxy', async () => {
    const fetchMock = mockFetchOnce({});
    const [job] = makeJobs(1);
    const result = await RouteService.computeRoute([job], ROUTE_CODE);

    expect(result.orderedJobs).toEqual([job]);
    expect(result.polylineCoords).toEqual([{ latitude: job.latitude, longitude: job.longitude }]);
    expect(result.degraded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── computeRoute — the request it sends ─────────────────────────────────────

describe('computeRoute — request shape', () => {
  it('posts the route code and the ordered coordinates to the Edge Function', async () => {
    const fetchMock = mockFetchOnce(okRoute([2, 0, 1]));

    await RouteService.computeRoute(makeJobs(5), ROUTE_CODE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(FUNCTION_URL);

    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    // Drivers have no Supabase Auth account — the anon key only routes the
    // call through the gateway; the route code is the actual credential.
    expect(init.headers.apikey).toBe('test-anon-key');
    expect(init.headers.Authorization).toBe('Bearer test-anon-key');

    const body = sentBody(fetchMock);
    expect(body.code).toBe(ROUTE_CODE);
    expect(body.coordinates).toHaveLength(5);
  });

  // The key never leaves the server. If it ever reappears in a request from
  // the client, the whole reason for the proxy has been undone.
  it('never sends an API key of its own', async () => {
    const fetchMock = mockFetchOnce(okRoute([2, 0, 1]));
    await RouteService.computeRoute(makeJobs(5), ROUTE_CODE);

    const serialised = JSON.stringify(fetchMock.mock.calls[0]);
    expect(serialised).not.toMatch(/AIza/);
    expect(serialised.toLowerCase()).not.toContain('x-goog-api-key');
  });

  it('sends coordinates in sort_order, not the order supplied', async () => {
    const fetchMock = mockFetchOnce(okRoute([]));
    const jobs = [makeJob('b', 2), makeJob('a', 1)];

    await RouteService.computeRoute(jobs, ROUTE_CODE);

    const body = sentBody(fetchMock);
    expect(body.coordinates).toEqual([
      { latitude: makeJob('a', 1).latitude, longitude: makeJob('a', 1).longitude },
      { latitude: makeJob('b', 2).latitude, longitude: makeJob('b', 2).longitude },
    ]);
  });
});

// ─── computeRoute — server key missing ───────────────────────────────────────
//
// Before the proxy this branch fired when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY was
// unset in the bundle. The key now lives in a Supabase secret, so the same
// condition is reported by the function as a 503, and must still reach the
// driver as "optimisation is off" rather than "check your signal".

describe('computeRoute — when the server has no key', () => {
  it('falls back to sort_order and flags no-api-key', async () => {
    const fetchMock = mockFetchOnce({ error: 'server_key_missing' }, false, 503);

    const jobs = [makeJob('b', 2), makeJob('a', 1)];
    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.orderedJobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('no-api-key');
  });

  it('breaks sort_order ties deterministically by id', async () => {
    mockFetchOnce({ error: 'server_key_missing' }, false, 503);

    const jobs = [makeJob('zz', 1), makeJob('aa', 1), makeJob('mm', 1)];
    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);

    expect(result.orderedJobs.map((j) => j.id)).toEqual(['aa', 'mm', 'zz']);
  });

  // A rejected code is not a missing key. Conflating them would tell a driver
  // optimisation is switched off when in fact their code expired.
  it('reports a rejected route code as a request failure, not a missing key', async () => {
    mockFetchOnce({ error: 'invalid_code' }, false, 403);

    const result = await RouteService.computeRoute(makeJobs(5), ROUTE_CODE);
    expect(result.degradedReason).toBe('request-failed');
  });
});

// ─── computeRoute — the waypoint cap ─────────────────────────────────────────
//
// The Routes API allows at most 25 intermediate waypoints, the same ceiling
// the legacy Directions API had (verified 2026-09-03). origin and destination
// do not count, so the cap bites at 28 jobs.

describe('computeRoute — waypoint cap', () => {
  it('pins the documented cap at 25', () => {
    expect(__testing.MAX_INTERMEDIATE_WAYPOINTS).toBe(25);
  });

  it('still calls the proxy at exactly the cap (27 jobs = 25 intermediate)', async () => {
    const fetchMock = mockFetchOnce(okRoute(Array.from({ length: 25 }, (_, i) => i)));

    const result = await RouteService.computeRoute(makeJobs(27), ROUTE_CODE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.degraded).toBe(false);
  });

  // The live bug: a 28-job route is an ordinary day's work, and the app used to
  // send the request anyway, get MAX_WAYPOINTS_EXCEEDED, and fall through to
  // straight lines without telling anyone.
  it('skips the doomed billable request one job past the cap', async () => {
    const fetchMock = mockFetchOnce({});

    const jobs = makeJobs(28);
    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('too-many-waypoints');
    // Still a usable route, just not an optimized one.
    expect(result.orderedJobs.map((j) => j.id)).toEqual(jobs.map((j) => j.id));
    expect(result.polylineCoords).toHaveLength(28);
  });

  it('skips it for a large route too', async () => {
    const fetchMock = mockFetchOnce({});
    const result = await RouteService.computeRoute(makeJobs(120), ROUTE_CODE);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.degradedReason).toBe('too-many-waypoints');
  });
});

// ─── computeRoute — happy path ───────────────────────────────────────────────

describe('computeRoute — optimized response', () => {
  it('rebuilds the order the Routes API returned', async () => {
    const fetchMock = mockFetchOnce(okRoute([2, 0, 1]));

    // 5 jobs: first and last are origin/destination, middle three get reordered.
    const result = await RouteService.computeRoute(makeJobs(5), ROUTE_CODE);

    expect(result.orderedJobs.map((j) => j.id)).toEqual([
      'job-1',                    // origin, fixed
      'job-4', 'job-2', 'job-3',  // middle, per optimizedIndex [2,0,1]
      'job-5',                    // destination, fixed
    ]);
    expect(result.polylineCoords).toEqual(GOOGLE_EXAMPLE_POINTS);
    expect(result.degraded).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles a two-job route, which has no intermediate waypoints', async () => {
    const fetchMock = mockFetchOnce(okRoute([]));

    const result = await RouteService.computeRoute(makeJobs(2), ROUTE_CODE);

    expect(sentBody(fetchMock).coordinates).toHaveLength(2);
    expect(result.orderedJobs.map((j) => j.id)).toEqual(['job-1', 'job-2']);
    expect(result.degraded).toBe(false);
  });
});

// ─── computeRoute — failure paths ────────────────────────────────────────────

describe('computeRoute — failure paths all degrade rather than throw', () => {
  const jobs = makeJobs(5);

  it('degrades when fetch rejects (offline mid-route)', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('request-failed');
    expect(result.orderedJobs).toHaveLength(5);
  });

  it('degrades on a non-2xx response', async () => {
    mockFetchOnce({ error: 'upstream_rejected' }, false, 502);
    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degradedReason).toBe('request-failed');
  });

  // An error page from the gateway is not JSON at all. Reading the status
  // first keeps that from being reported as a malformed route.
  it('degrades on unparseable JSON from a failed response', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('bad json'); },
    });

    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degradedReason).toBe('request-failed');
  });

  it('degrades on unparseable JSON from a 200', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json'); },
    });

    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degradedReason).toBe('bad-response');
  });

  // The function answers 200 with an `error` when Google gave it a response it
  // could not use — no drivable path, or an order it refused to trust.
  it.each([
    ['no_route'],
    ['no_waypoint_order'],
    ['bad_waypoint_order'],
  ] as const)('degrades on a 200 carrying error=%s', async (error) => {
    mockFetchOnce({ error });
    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degradedReason).toBe('bad-response');
  });

  it('degrades when the polyline is missing', async () => {
    mockFetchOnce({ optimizedIndex: [0, 1, 2] });
    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degradedReason).toBe('bad-response');
  });

  it('degrades when the polyline decodes to nothing', async () => {
    mockFetchOnce(okRoute([0, 1, 2], ''));
    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degradedReason).toBe('bad-response');
  });

  // The crash this guard exists to prevent: a short/duplicated waypoint order
  // put `undefined` into orderedJobs, which then blew up on `job.id` in
  // DriverMapScreen — two layers away from the cause. The function validates
  // this too now; the client keeps its own check because a hole here is a
  // crash, and the cost of re-checking is three comparisons.
  it.each([
    ['too short', [0, 1]],
    ['duplicated index', [0, 0, 1]],
    ['out of range', [0, 1, 9]],
  ] as const)('degrades rather than emitting holes when optimizedIndex is %s', async (_label, order) => {
    mockFetchOnce(okRoute(order as unknown as number[]));

    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);

    expect(result.degradedReason).toBe('bad-response');
    expect(result.orderedJobs).toHaveLength(5);
    expect(result.orderedJobs.every((j) => j !== undefined)).toBe(true);
  });

  it('degrades when optimizedIndex is absent but waypoints were sent', async () => {
    mockFetchOnce({ encodedPolyline: GOOGLE_EXAMPLE_POLYLINE });

    const result = await RouteService.computeRoute(jobs, ROUTE_CODE);
    expect(result.degradedReason).toBe('bad-response');
  });
});
