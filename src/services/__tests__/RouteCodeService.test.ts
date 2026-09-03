import { RouteCodeService } from '../RouteCodeService';
import { secureStorage } from '../../utils/secureStorage';
import { supabase } from '../supabaseClient';

jest.mock('../../utils/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

// utils/random wraps expo-crypto. It is mocked here for the same reason
// secureStorage is: the native module must not load under ts-jest.
//
// NOTE: this file used to define a fake `crypto` global instead, with the
// comment "Hermes and the Electron renderer both provide these globally."
// The Electron half was true and the Hermes half was not — RN 0.83 installs
// no `crypto` at all — so the suite asserted the assumption that caused the
// bug, and passed on every run while driver login could not work on any
// device. Mock the seam the code actually uses, never a global you believe
// the runtime provides.
jest.mock('../../utils/random', () => ({
  randomUUID: jest.fn(() => 'generated-uuid'),
  getRandomValues: jest.fn((buf: Uint32Array) => { buf[0] = 123456789; return buf; }),
}));

jest.mock('../supabaseClient', () => ({
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-123',
  supabase: { from: jest.fn() },
}));

const mockGetItem = secureStorage.getItem as jest.Mock;
const mockSetItem = secureStorage.setItem as jest.Mock;
const mockFrom = supabase.from as unknown as jest.Mock;

beforeEach(() => {
  global.fetch = jest.fn();
  mockGetItem.mockResolvedValue('stored-client-id');
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const JOB_ROW = {
  id: 'job-1',
  client_name: 'Harcourts',
  agent_name: 'Jane',
  agent_email: 'jane@example.com',
  address: '42 Maple St',
  sign_description: 'Corflute',
  job_type: 'install',
  latitude: -31.95,
  longitude: 115.86,
  sort_order: 1,
  is_complete: false,
  photo_key: null,
  photo_gps_lat: null,
  photo_gps_lng: null,
  photo_timestamp: null,
};

// ─── loadSession ─────────────────────────────────────────────────────────────

describe('loadSession — the Edge Function is the only driver auth path', () => {
  it('posts the code and client id to validate-code with the anon key', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ session: { id: 'r1', code: '123456', driver_slot: 2, jobs: [] } })
    );

    await RouteCodeService.loadSession('123456');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/validate-code');
    expect(init.method).toBe('POST');
    // The function is deployed --no-verify-jwt, but the gateway still needs the
    // anon key to route the call at all.
    expect(init.headers.apikey).toBe('anon-key-123');
    expect(init.headers.Authorization).toBe('Bearer anon-key-123');
    expect(JSON.parse(init.body)).toEqual({ code: '123456', client_id: 'stored-client-id' });
  });

  // Migration 008 revoked anon's execute on validate_route_code, leaving the
  // Edge Function as the only path. A direct .rpc() here would be the old,
  // revoked route and would fail in prod.
  it('never touches the database client directly', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ session: null }));
    await RouteCodeService.loadSession('123456');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('creates and persists a client id when none is stored', async () => {
    mockGetItem.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ session: null }));

    await RouteCodeService.loadSession('123456');

    expect(mockSetItem).toHaveBeenCalledWith('driver_client_id', 'generated-uuid');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.client_id).toBe('generated-uuid');
  });

  it('reuses the stored client id rather than rotating it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ session: null }));
    await RouteCodeService.loadSession('123456');
    // Rotating per call would defeat the RPC's per-client_id throttle.
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('returns null for an invalid or expired code, without throwing', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ session: null }));
    await expect(RouteCodeService.loadSession('000000')).resolves.toBeNull();
  });

  it('surfaces a 429 with the wait-and-retry wording verbatim', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429));
    // The store matches on this prefix to decide whether to show it as-is.
    await expect(RouteCodeService.loadSession('123456')).rejects.toThrow(
      'Too many attempts. Wait a minute and try again.'
    );
  });

  it.each([400, 405, 500])('does not leak internals on a %i', async (status) => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ error: 'pg error detail' }, status));
    await expect(RouteCodeService.loadSession('123456')).rejects.toThrow(
      /Something went wrong validating that code/
    );
  });

  it('reports a network failure as a connection problem', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await expect(RouteCodeService.loadSession('123456')).rejects.toThrow(/Could not reach the server/);
  });

  it('rejects an unparseable body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); },
    });
    await expect(RouteCodeService.loadSession('123456')).rejects.toThrow(/Unexpected response/);
  });

  it.each([
    ['jobs is not an array', { session: { id: 'r', code: '1', driver_slot: 1, jobs: 'nope' } }],
    ['session is a scalar', { session: 42 }],
  ])('rejects a malformed payload (%s)', async (_label, body) => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(body));
    await expect(RouteCodeService.loadSession('123456')).rejects.toThrow(/Unexpected response/);
  });
});

describe('loadSession — DB row to domain mapping', () => {
  async function loadWith(row: Record<string, unknown>) {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ session: { id: 'r1', code: '654321', driver_slot: 3, jobs: [row] } })
    );
    const session = await RouteCodeService.loadSession('654321');
    return session!.jobs[0];
  }

  it('maps snake_case columns onto the camelCase domain type', async () => {
    const job = await loadWith(JOB_ROW);

    expect(job).toMatchObject({
      id: 'job-1',
      clientName: 'Harcourts',
      agentName: 'Jane',
      agentEmail: 'jane@example.com',
      address: '42 Maple St',
      signDescription: 'Corflute',
      jobType: 'install',
      sortOrder: 1,
      isComplete: false,
    });
  });

  it('carries the route code and driver slot onto the session', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ session: { id: 'r1', code: '654321', driver_slot: 3, jobs: [] } })
    );
    const session = await RouteCodeService.loadSession('654321');
    // routeCode comes from the server payload, not the string the driver typed.
    expect(session).toEqual({ routeCode: '654321', driverSlot: 3, jobs: [] });
  });

  it('turns nullable text columns into empty strings, not null', async () => {
    const job = await loadWith({ ...JOB_ROW, agent_name: null, agent_email: null });
    expect(job.agentName).toBe('');
    expect(job.agentEmail).toBe('');
  });

  it('turns nullable photo columns into undefined, not null', async () => {
    const job = await loadWith(JOB_ROW);
    expect(job.photoKey).toBeUndefined();
    expect(job.photoGPSLat).toBeUndefined();
    expect(job.photoTimestamp).toBeUndefined();
  });

  it('parses photo_timestamp into a Date', async () => {
    const job = await loadWith({ ...JOB_ROW, photo_key: 'jobs/job-1/1.jpg', photo_timestamp: '2026-08-21T02:03:04.000Z' });
    expect(job.photoTimestamp).toBeInstanceOf(Date);
    expect(job.photoTimestamp!.toISOString()).toBe('2026-08-21T02:03:04.000Z');
  });

  // job_type is a free text column with a CHECK constraint; the mapper narrows
  // it rather than trusting the string.
  it.each([
    ['removal', 'removal'],
    ['install', 'install'],
    ['REMOVAL', 'install'],
    ['nonsense', 'install'],
  ])('narrows job_type %s to %s', async (raw, expected) => {
    const job = await loadWith({ ...JOB_ROW, job_type: raw });
    expect(job.jobType).toBe(expected);
  });
});

// ─── generateDailyCodes ──────────────────────────────────────────────────────

type SupabaseStub = {
  updateError?: { message: string } | null;
  insertResults?: Array<{ data?: Record<string, unknown> | null; error?: { code?: string; message?: string } | null }>;
};

function installSupabase(stub: SupabaseStub = {}) {
  const calls = { updates: [] as unknown[], inserts: [] as Record<string, unknown>[] };
  let insertCall = 0;

  mockFrom.mockImplementation((table: string) => ({
    update: (patch: unknown) => {
      calls.updates.push(patch);
      const chain = {
        eq: () => chain,
        gt: () => Promise.resolve({ error: stub.updateError ?? null }),
      };
      return chain;
    },
    insert: (record: Record<string, unknown>) => {
      calls.inserts.push(record);
      const result = stub.insertResults?.[insertCall++] ?? {
        data: { id: `id-${insertCall}`, ...record },
        error: null,
      };
      return { select: () => ({ single: () => Promise.resolve(result) }) };
    },
    select: () => {
      const chain = {
        eq: () => chain,
        gt: () => chain,
        order: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
    __table: table,
  }));

  return calls;
}

describe('generateDailyCodes', () => {
  it('deactivates any live code for the slot before inserting a new one', async () => {
    const calls = installSupabase();
    await RouteCodeService.generateDailyCodes([1]);
    expect(calls.updates).toEqual([{ is_active: false }]);
    expect(calls.inserts).toHaveLength(1);
  });

  // A silent failure here leaves the old code live, the INSERT then trips the
  // partial unique index, and the retry loop misreads that as a code collision.
  it('throws if deactivation fails rather than proceeding', async () => {
    installSupabase({ updateError: { message: 'permission denied' } });
    await expect(RouteCodeService.generateDailyCodes([1])).rejects.toThrow(
      /Could not deactivate existing code for Driver 1: permission denied/
    );
  });

  it('generates a six-digit code in range', async () => {
    const calls = installSupabase();
    await RouteCodeService.generateDailyCodes([1]);

    const code = calls.inserts[0].code as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(Number(code)).toBeGreaterThanOrEqual(100000);
    expect(Number(code)).toBeLessThanOrEqual(999999);
  });

  // Regression — the bug found on the first real-device build, 2026-09-03.
  //
  // Both of these fail against the previous implementation, which read
  // `crypto.randomUUID` / `crypto.getRandomValues` off the global. Deleting
  // the global here reproduces Hermes exactly: RN 0.83 installs no `crypto`,
  // and neither does Expo 55's winter runtime.
  it('generates a client id with no crypto global (Hermes)', async () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    mockGetItem.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ session: null }));

    await RouteCodeService.loadSession('123456');

    // Previously threw before fetch was ever called, and the store reported
    // it to the driver as a signal problem.
    expect(global.fetch).toHaveBeenCalled();
    expect(mockSetItem).toHaveBeenCalledWith('driver_client_id', 'generated-uuid');
  });

  it('generates driver codes with no crypto global (Hermes)', async () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    installSupabase();
    // Never reached on the iOS admin build before this fix. It failed safe —
    // refusing rather than falling back to Math.random(), which is biased and
    // predictable and would have made the driver credential guessable.
    await expect(RouteCodeService.generateDailyCodes([1])).resolves.toBeDefined();
  });

  it('retries only on a 23505 code collision', async () => {
    const calls = installSupabase({
      insertResults: [
        { data: null, error: { code: '23505', message: 'duplicate key' } },
        { data: { id: 'id-2', code: '222222', driver_slot: 1, created_date: 'x', expires_at: 'y', is_active: true }, error: null },
      ],
    });

    const result = await RouteCodeService.generateDailyCodes([1]);
    expect(calls.inserts).toHaveLength(2);
    expect(result[0].code).toBe('222222');
  });

  it('propagates a non-collision insert error immediately', async () => {
    const calls = installSupabase({
      insertResults: [{ data: null, error: { code: '42501', message: 'permission denied' } }],
    });
    await expect(RouteCodeService.generateDailyCodes([1])).rejects.toThrow('permission denied');
    expect(calls.inserts).toHaveLength(1);   // no retry
  });

  it('gives up after five collisions with a slot-specific message', async () => {
    const calls = installSupabase({
      insertResults: Array.from({ length: 5 }, () => ({ data: null, error: { code: '23505' } })),
    });
    await expect(RouteCodeService.generateDailyCodes([3])).rejects.toThrow(
      /Could not generate a unique code for Driver 3/
    );
    expect(calls.inserts).toHaveLength(5);
  });

  it('generates one code per requested slot', async () => {
    const calls = installSupabase();
    const result = await RouteCodeService.generateDailyCodes([1, 2, 3]);
    expect(calls.inserts.map((r) => r.driver_slot)).toEqual([1, 2, 3]);
    expect(result).toHaveLength(3);
  });

  // The bug this encodes: toISOString().split('T')[0] is the UTC date, and Perth
  // is UTC+8, so a code generated before 08:00 local was stamped with
  // YESTERDAY's date — it vanished from the dashboard and dodged the
  // regeneration filter, leaving two live codes for one slot.
  it('stamps created_date with the LOCAL calendar date, not the UTC one', async () => {
    jest.useFakeTimers();
    // 23:30 UTC on the 21st === 07:30 Perth on the 22nd.
    jest.setSystemTime(new Date('2026-08-21T23:30:00.000Z'));

    const calls = installSupabase();
    await RouteCodeService.generateDailyCodes([1]);

    expect(calls.inserts[0].created_date).toBe('2026-08-22');
    expect(calls.inserts[0].created_date).not.toBe('2026-08-21');
    jest.useRealTimers();
  });

  it('expires at 06:00 the following morning, not at midnight', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-21T06:00:00.000Z')); // 14:00 Perth, 21st

    const calls = installSupabase();
    await RouteCodeService.generateDailyCodes([1]);

    // Drivers finishing late must not be locked out mid-shift.
    const expires = new Date(calls.inserts[0].expires_at as string);
    expect(expires.getHours()).toBe(6);
    expect(expires.getDate()).toBe(22);
    jest.useRealTimers();
  });

  it('inserts the code as active', async () => {
    const calls = installSupabase();
    await RouteCodeService.generateDailyCodes([1]);
    expect(calls.inserts[0].is_active).toBe(true);
  });
});

// ─── getActiveCodes / getRouteJobs ───────────────────────────────────────────

describe('getActiveCodes', () => {
  it('filters on liveness rather than created_date, and orders by slot', async () => {
    const chainCalls: string[] = [];
    mockFrom.mockImplementation(() => {
      const chain = {
        select: () => { chainCalls.push('select'); return chain; },
        eq: (col: string, val: unknown) => { chainCalls.push(`eq:${col}=${val}`); return chain; },
        gt: (col: string) => { chainCalls.push(`gt:${col}`); return chain; },
        order: (col: string, opts: { ascending: boolean }) => {
          chainCalls.push(`order:${col}:${opts.ascending}`);
          return Promise.resolve({ data: [], error: null });
        },
      };
      return chain;
    });

    await RouteCodeService.getActiveCodes();

    // A date filter would miss pre-fix rows carrying a UTC-shifted created_date,
    // hiding a code that can still open a driver session.
    expect(chainCalls).toEqual(['select', 'eq:is_active=true', 'gt:expires_at', 'order:driver_slot:true']);
    expect(chainCalls.some((c) => c.includes('created_date'))).toBe(false);
  });

  it('maps rows to the domain shape', async () => {
    mockFrom.mockImplementation(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        order: () => Promise.resolve({
          data: [{ id: 'c1', code: '111111', driver_slot: 2, created_date: '2026-08-21', expires_at: 'T', is_active: true }],
          error: null,
        }),
      };
      return chain;
    });

    const codes = await RouteCodeService.getActiveCodes();
    expect(codes).toEqual([
      { id: 'c1', code: '111111', driverSlot: 2, createdDate: '2026-08-21', expiresAt: 'T', isActive: true },
    ]);
  });

  it('throws on a query error', async () => {
    mockFrom.mockImplementation(() => {
      const chain = {
        select: () => chain, eq: () => chain, gt: () => chain,
        order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      };
      return chain;
    });
    await expect(RouteCodeService.getActiveCodes()).rejects.toThrow('boom');
  });
});

describe('getRouteJobs', () => {
  function installJobsQuery(result: { data: unknown; error: unknown }) {
    const seen: string[] = [];
    mockFrom.mockImplementation(() => {
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { seen.push(`${col}=${val}`); return chain; },
        order: (col: string) => { seen.push(`order:${col}`); return Promise.resolve(result); },
      };
      return chain;
    });
    return seen;
  }

  it('scopes to the route code and orders by sort_order', async () => {
    const seen = installJobsQuery({ data: [JOB_ROW], error: null });
    await RouteCodeService.getRouteJobs('route-1');
    expect(seen).toEqual(['route_code_id=route-1', 'order:sort_order']);
  });

  it('maps rows through the same mapper as the driver path', async () => {
    installJobsQuery({ data: [JOB_ROW], error: null });
    const jobs = await RouteCodeService.getRouteJobs('route-1');
    expect(jobs[0].clientName).toBe('Harcourts');
    expect(jobs[0].jobType).toBe('install');
  });

  it('returns an empty list when data is null', async () => {
    installJobsQuery({ data: null, error: null });
    await expect(RouteCodeService.getRouteJobs('route-1')).resolves.toEqual([]);
  });

  it('throws on a query error', async () => {
    installJobsQuery({ data: null, error: { message: 'denied' } });
    await expect(RouteCodeService.getRouteJobs('route-1')).rejects.toThrow('denied');
  });
});
