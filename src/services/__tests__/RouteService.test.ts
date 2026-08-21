import { SignJob } from '../../data/SignJob';

// MAPS_API_KEY is read from process.env at module load, so each test group has
// to (re)load the module with the env it wants. Static imports hoist above any
// assignment, hence require() behind jest.resetModules().
function loadService(apiKey?: string) {
  jest.resetModules();
  if (apiKey === undefined) {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  } else {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = apiKey;
  }
  return require('../RouteService') as typeof import('../RouteService');
}

const originalEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
afterAll(() => {
  if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  else process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = originalEnv;
});

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

// Google's own worked example from the encoded polyline algorithm reference:
// (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
// Verified against this decoder on 2026-08-21 before being pinned here.
const GOOGLE_EXAMPLE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const GOOGLE_EXAMPLE_POINTS = [
  { latitude: 38.5, longitude: -120.2 },
  { latitude: 40.7, longitude: -120.95 },
  { latitude: 43.252, longitude: -126.453 },
];

// ─── decodePolyline ──────────────────────────────────────────────────────────

describe('decodePolyline', () => {
  const { __testing } = loadService('test-key');

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
  const { __testing } = loadService('test-key');
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
  const { RouteService } = loadService('test-key');

  it('returns an empty, non-degraded result for no jobs', async () => {
    const fetchMock = mockFetchOnce({});
    const result = await RouteService.computeRoute([]);

    expect(result).toEqual({ orderedJobs: [], polylineCoords: [], degraded: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short-circuits a single job without calling Directions', async () => {
    const fetchMock = mockFetchOnce({});
    const [job] = makeJobs(1);
    const result = await RouteService.computeRoute([job]);

    expect(result.orderedJobs).toEqual([job]);
    expect(result.polylineCoords).toEqual([{ latitude: job.latitude, longitude: job.longitude }]);
    expect(result.degraded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── computeRoute — no API key ───────────────────────────────────────────────

describe('computeRoute — without an API key', () => {
  it('falls back to sort_order and flags the degradation', async () => {
    const { RouteService } = loadService(undefined);
    const fetchMock = mockFetchOnce({});

    const jobs = [makeJob('b', 2), makeJob('a', 1)];
    const result = await RouteService.computeRoute(jobs);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.orderedJobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('no-api-key');
  });

  it('breaks sort_order ties deterministically by id', async () => {
    const { RouteService } = loadService(undefined);
    mockFetchOnce({});

    const jobs = [makeJob('zz', 1), makeJob('aa', 1), makeJob('mm', 1)];
    const result = await RouteService.computeRoute(jobs);

    expect(result.orderedJobs.map((j) => j.id)).toEqual(['aa', 'mm', 'zz']);
  });
});

// ─── computeRoute — the waypoint cap ─────────────────────────────────────────
//
// Google Directions allows at most 25 intermediate waypoints, optimized or not
// (verified against the API reference 2026-08-21). origin and destination do
// not count, so the cap bites at 28 jobs.

describe('computeRoute — waypoint cap', () => {
  const { RouteService, __testing } = loadService('test-key');

  it('pins the documented cap at 25', () => {
    expect(__testing.MAX_INTERMEDIATE_WAYPOINTS).toBe(25);
  });

  it('still calls Directions at exactly the cap (27 jobs = 25 intermediate)', async () => {
    const fetchMock = mockFetchOnce({
      status: 'OK',
      routes: [{
        overview_polyline: { points: GOOGLE_EXAMPLE_POLYLINE },
        waypoint_order: Array.from({ length: 25 }, (_, i) => i),
      }],
    });

    const result = await RouteService.computeRoute(makeJobs(27));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.degraded).toBe(false);
  });

  // The live bug: a 28-job route is an ordinary day's work, and the app used to
  // send the request anyway, get MAX_WAYPOINTS_EXCEEDED, and fall through to
  // straight lines without telling anyone.
  it('skips the doomed billable request one job past the cap', async () => {
    const fetchMock = mockFetchOnce({});

    const jobs = makeJobs(28);
    const result = await RouteService.computeRoute(jobs);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('too-many-waypoints');
    // Still a usable route, just not an optimized one.
    expect(result.orderedJobs.map((j) => j.id)).toEqual(jobs.map((j) => j.id));
    expect(result.polylineCoords).toHaveLength(28);
  });

  it('skips it for a large route too', async () => {
    const fetchMock = mockFetchOnce({});
    const result = await RouteService.computeRoute(makeJobs(120));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.degradedReason).toBe('too-many-waypoints');
  });
});

// ─── computeRoute — happy path ───────────────────────────────────────────────

describe('computeRoute — optimized response', () => {
  const { RouteService } = loadService('test-key');

  it('requests optimization and rebuilds the order Google returned', async () => {
    const fetchMock = mockFetchOnce({
      status: 'OK',
      routes: [{
        overview_polyline: { points: GOOGLE_EXAMPLE_POLYLINE },
        waypoint_order: [2, 0, 1],
      }],
    });

    // 5 jobs: first and last are origin/destination, middle three get reordered.
    const result = await RouteService.computeRoute(makeJobs(5));

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('optimize%3Atrue');

    expect(result.orderedJobs.map((j) => j.id)).toEqual([
      'job-1',            // origin, fixed
      'job-4', 'job-2', 'job-3',  // middle, per waypoint_order [2,0,1]
      'job-5',            // destination, fixed
    ]);
    expect(result.polylineCoords).toEqual(GOOGLE_EXAMPLE_POINTS);
    expect(result.degraded).toBe(false);
  });

  it('handles a two-job route, which has no intermediate waypoints', async () => {
    const fetchMock = mockFetchOnce({
      status: 'OK',
      routes: [{ overview_polyline: { points: GOOGLE_EXAMPLE_POLYLINE } }],
    });

    const result = await RouteService.computeRoute(makeJobs(2));

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain('waypoints');
    expect(result.orderedJobs.map((j) => j.id)).toEqual(['job-1', 'job-2']);
    expect(result.degraded).toBe(false);
  });
});

// ─── computeRoute — failure paths ────────────────────────────────────────────

describe('computeRoute — failure paths all degrade rather than throw', () => {
  const { RouteService } = loadService('test-key');
  const jobs = makeJobs(5);

  it('degrades when fetch rejects (offline mid-route)', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const result = await RouteService.computeRoute(jobs);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('request-failed');
    expect(result.orderedJobs).toHaveLength(5);
  });

  it('degrades on a non-2xx response', async () => {
    mockFetchOnce({}, false, 500);
    const result = await RouteService.computeRoute(jobs);
    expect(result.degradedReason).toBe('request-failed');
  });

  it('degrades on unparseable JSON', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json'); },
    });

    const result = await RouteService.computeRoute(jobs);
    expect(result.degradedReason).toBe('bad-response');
  });

  it('degrades on a non-OK Directions status such as ZERO_RESULTS', async () => {
    mockFetchOnce({ status: 'ZERO_RESULTS', routes: [] });
    const result = await RouteService.computeRoute(jobs);
    expect(result.degradedReason).toBe('bad-response');
  });

  it('degrades when the polyline is missing', async () => {
    mockFetchOnce({ status: 'OK', routes: [{ waypoint_order: [0, 1, 2] }] });
    const result = await RouteService.computeRoute(jobs);
    expect(result.degradedReason).toBe('bad-response');
  });

  // The crash this guard exists to prevent: a short/duplicated waypoint_order
  // put `undefined` into orderedJobs, which then blew up on `job.id` in
  // DriverMapScreen — two layers away from the cause.
  it.each([
    ['too short', [0, 1]],
    ['duplicated index', [0, 0, 1]],
    ['out of range', [0, 1, 9]],
  ] as const)('degrades rather than emitting holes when waypoint_order is %s', async (_label, order) => {
    mockFetchOnce({
      status: 'OK',
      routes: [{ overview_polyline: { points: GOOGLE_EXAMPLE_POLYLINE }, waypoint_order: order }],
    });

    const result = await RouteService.computeRoute(jobs);

    expect(result.degradedReason).toBe('bad-response');
    expect(result.orderedJobs).toHaveLength(5);
    expect(result.orderedJobs.every((j) => j !== undefined)).toBe(true);
  });

  it('degrades when waypoint_order is absent but waypoints were sent', async () => {
    mockFetchOnce({
      status: 'OK',
      routes: [{ overview_polyline: { points: GOOGLE_EXAMPLE_POLYLINE } }],
    });

    const result = await RouteService.computeRoute(jobs);
    expect(result.degradedReason).toBe('bad-response');
  });
});
