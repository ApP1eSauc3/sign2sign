import { GoogleSheetsService } from '../GoogleSheetsService';
import { secureStorage } from '../../utils/secureStorage';
import { GoogleAuthService } from '../GoogleAuthService';

jest.mock('../../utils/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
// Geocoding now goes through the geocode-address Edge Function, so the service
// needs the project URL, the anon key (gateway routing) and the admin's own
// access token (the function resolves it to an auth.users row).
const mockGetSession = jest.fn();
jest.mock('../supabaseClient', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
}));
jest.mock('../GoogleAuthService', () => ({
  GoogleAuthService: { refreshAccessToken: jest.fn() },
}));

const mockGetItem = secureStorage.getItem as jest.Mock;
const mockRefresh = GoogleAuthService.refreshAccessToken as jest.Mock;

// Column layout (see GoogleSheetsService COL): 0=date serial, 1=client/agency,
// 2=agent, 3=notes, 4=size, 5=printed(skip), 6=address.
type Row = [number | string, string, string, string, string, string, string];

const IMPORT_DATE = new Date(2026, 4, 29); // 29 May 2026 (month is 0-indexed)

// Mirror of serialToLocalDate's inverse — produces a serial that lands on `d`.
function dateToSerial(d: Date): number {
  const base = new Date(1899, 11, 30);
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((local.getTime() - base.getTime()) / 86_400_000);
}

const SERIAL_TODAY = dateToSerial(IMPORT_DATE);
const SERIAL_OTHER = dateToSerial(new Date(2026, 4, 30));

function sheetsResponse(rows: Row[]) {
  return { ok: true, status: 200, json: async () => ({ values: rows }) };
}
function geocodeOk(lat = -31.95, lng = 115.86) {
  return { ok: true, status: 200, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat, lng } } }] }) };
}

// Default fetch mock: sheets URL -> provided rows; geocode URL -> OK coords.
function installFetch(rows: Row[]) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('sheets.googleapis.com')) return Promise.resolve(sheetsResponse(rows));
    if (url.includes('functions/v1/geocode-address')) return Promise.resolve(geocodeOk());
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
  mockGetItem.mockResolvedValue('fake-token');
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'admin-jwt' } } });
});

describe('importJobs — row parsing & column mapping', () => {
  it('maps sheet columns to SignJob fields for a matching-date row', async () => {
    installFetch([[SERIAL_TODAY, 'Harcourts', 'Jane Smith', 'Place at front gate', '6x4', '', '42 Maple St']]);

    const jobs = await GoogleSheetsService.importJobs('sheet-1', 'Orders', IMPORT_DATE);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      clientName: 'Harcourts',
      agentName: 'Jane Smith',
      agentEmail: '',
      address: '42 Maple St',
      jobType: 'install',
      latitude: -31.95,
      longitude: 115.86,
      sortOrder: 1,
    });
    // notes + (size) + row reference (first data row -> Row 2)
    expect(jobs[0].signDescription).toBe('Place at front gate (6x4) — Row 2');
  });

  it('skips rows with a blank address', async () => {
    installFetch([
      [SERIAL_TODAY, 'C1', 'A1', 'notes', '6x4', '', ''],
      [SERIAL_TODAY, 'C2', 'A2', 'notes', '6x4', '', '10 Real St'],
    ]);
    const jobs = await GoogleSheetsService.importJobs('sheet-1', 'Orders', IMPORT_DATE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].address).toBe('10 Real St');
    expect(jobs[0].sortOrder).toBe(1);
  });

  it('skips rows whose date serial does not match importDate', async () => {
    installFetch([
      [SERIAL_OTHER, 'C1', 'A1', 'notes', '6x4', '', '1 Other St'],
      [SERIAL_TODAY, 'C2', 'A2', 'notes', '6x4', '', '2 Today St'],
    ]);
    const jobs = await GoogleSheetsService.importJobs('sheet-1', 'Orders', IMPORT_DATE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].address).toBe('2 Today St');
  });

  it('detects removal jobs from agent/notes text, defaulting to install', async () => {
    installFetch([
      [SERIAL_TODAY, 'C', 'Agent', 'Take down old sign', '', '', '1 St'],
      [SERIAL_TODAY, 'C', 'Agent (collect sign)', 'notes', '', '', '2 St'],
      [SERIAL_TODAY, 'C', 'Agent', 'standard install', '', '', '3 St'],
    ]);
    const jobs = await GoogleSheetsService.importJobs('sheet-1', 'Orders', IMPORT_DATE);
    expect(jobs.map((j) => j.jobType)).toEqual(['removal', 'removal', 'install']);
  });

  it('caches geocoding so a repeated address is only looked up once', async () => {
    installFetch([
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', '5 Same St'],
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', '5 Same St'],
    ]);
    await GoogleSheetsService.importJobs('sheet-1', 'Orders', IMPORT_DATE);
    const geocodeCalls = (global.fetch as jest.Mock).mock.calls.filter(([u]) => String(u).includes('functions/v1/geocode-address'));
    expect(geocodeCalls).toHaveLength(1);
  });

  it('single-quotes and escapes tab names containing spaces/quotes', async () => {
    installFetch([[SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St']]);
    await GoogleSheetsService.importJobs('sheet-1', "John's Orders", IMPORT_DATE);
    const sheetsUrl = (global.fetch as jest.Mock).mock.calls.map(([u]) => String(u)).find((u) => u.includes('sheets.googleapis.com'))!;
    // A1 notation: 'John''s Orders'!A2:G  (single quote doubled), URL-encoded
    expect(decodeURIComponent(sheetsUrl)).toContain("'John''s Orders'!A2:G");
  });
});

describe('importJobs — error paths', () => {
  it('throws when no OAuth token is stored', async () => {
    mockGetItem.mockResolvedValue(null);
    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/No Google OAuth token/i);
  });

  it('throws when there is no admin session to authorise geocoding', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/not signed in/i);
  });

  // The geocode proxy authenticates with the ADMIN's token, not the anon key.
  // The anon key would satisfy the gateway's JWT check — it is itself a valid
  // JWT — but not the function's auth.users lookup. Getting this wrong would
  // hand every driver handset the geocoding budget, so it is pinned here.
  it('sends the admin access token, not the anon key, to the geocode proxy', async () => {
    installFetch([[SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St']]);
    await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);

    const call = (global.fetch as jest.Mock).mock.calls.find(([u]) =>
      String(u).includes('functions/v1/geocode-address')
    )!;
    expect(call[1].headers.Authorization).toBe('Bearer admin-jwt');
    expect(call[1].headers.apikey).toBe('test-anon-key');
    expect(JSON.parse(call[1].body)).toEqual({ address: '1 St' });
  });

  // A missing server secret is an operator error, not a transient fault.
  // Before this was distinguished it burned three rounds of backoff and then
  // reported "Geocoding request failed (503)", which names nothing fixable.
  it('fails fast, and namefully, when the server key secret is unset', async () => {
    let attempts = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('sheets.googleapis.com')) {
        return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St']]));
      }
      if (url.includes('functions/v1/geocode-address')) {
        attempts++;
        return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'server_key_missing' }) });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE))
      .rejects.toThrow(/GOOGLE_MAPS_API_KEY secret is not set/i);
    expect(attempts).toBe(1);
  });

  it('reports an expired admin session from the proxy without retrying', async () => {
    let attempts = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('sheets.googleapis.com')) {
        return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St']]));
      }
      if (url.includes('functions/v1/geocode-address')) {
        attempts++;
        return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE))
      .rejects.toThrow(/session has expired/i);
    expect(attempts).toBe(1);
  });

  it('throws a date-specific message when no rows match', async () => {
    installFetch([[SERIAL_OTHER, 'C', 'A', 'n', '', '', '1 St']]);
    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/No jobs found for 29\/5\/2026 in "Orders"/);
  });

  it('wraps a geocoding failure with the source row number', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('sheets.googleapis.com')) return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', 'Nowhere']]));
      if (url.includes('functions/v1/geocode-address')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) });
      throw new Error('unexpected');
    });
    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/Row 2: Could not geocode "Nowhere"/);
  });

  it('refreshes the token and retries once on a 401 from Sheets', async () => {
    mockRefresh.mockResolvedValue('new-token');
    let sheetsCalls = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string, init?: any) => {
      if (url.includes('sheets.googleapis.com')) {
        sheetsCalls++;
        if (sheetsCalls === 1) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St']]));
      }
      if (url.includes('functions/v1/geocode-address')) return Promise.resolve(geocodeOk());
      throw new Error('unexpected');
    });

    const jobs = await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(sheetsCalls).toBe(2);
    expect(jobs).toHaveLength(1);
  });

  it('throws above the 500-row import cap', async () => {
    const rows: Row[] = Array.from({ length: 501 }, () => [SERIAL_TODAY, 'C', 'A', 'n', '', '', '5 Same St'] as Row);
    installFetch(rows);
    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/More than 500 jobs/);
  });
});

// ── saveJobsToRoute — replace-incomplete semantics (migration 011) ──────────

import { supabase } from '../supabaseClient';

type SaveJob = Parameters<typeof GoogleSheetsService.saveJobsToRoute>[0][number];

function makeImportJob(over: Partial<SaveJob> = {}): SaveJob {
  return {
    clientName: 'Harcourts',
    agentName: 'Jane',
    agentEmail: 'jane@example.com',
    address: '42 Maple St',
    signDescription: 'Corflute',
    jobType: 'install',
    latitude: -31.95,
    longitude: 115.86,
    sortOrder: 1,
    ...over,
  };
}

// Minimal PostgREST builder mock. delete().eq().eq() and select().eq() resolve
// like thenable builders; insert() resolves directly.
function installSupabase(opts: {
  survivors?: { address: string; job_type: string }[];
  deleteError?: { message: string } | null;
  insertError?: { message: string; code?: string } | null;
} = {}) {
  const calls = { deleteFilters: [] as unknown[][], inserted: [] as unknown[] };
  (supabase as { from?: unknown }).from = jest.fn(() => ({
    delete: () => ({
      eq: (...a: unknown[]) => ({
        eq: (...b: unknown[]) => {
          calls.deleteFilters.push([...a, ...b]);
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      }),
    }),
    select: () => ({
      eq: () => Promise.resolve({ data: opts.survivors ?? [], error: null }),
    }),
    insert: (records: unknown[]) => {
      calls.inserted.push(...records);
      return Promise.resolve({ error: opts.insertError ?? null });
    },
  }));
  return calls;
}

describe('saveJobsToRoute — replace-incomplete semantics', () => {
  it('deletes only incomplete jobs and inserts the import', async () => {
    const calls = installSupabase();
    const result = await GoogleSheetsService.saveJobsToRoute([makeImportJob()], 'route-1');

    expect(calls.deleteFilters[0]).toEqual(['route_code_id', 'route-1', 'is_complete', false]);
    expect(calls.inserted).toHaveLength(1);
    expect(result).toEqual({ imported: 1, skippedCompleted: 0 });
  });

  it('skips rows matching a surviving completed job (case/whitespace-insensitive)', async () => {
    const calls = installSupabase({
      survivors: [{ address: '42 maple st', job_type: 'install' }],
    });
    const result = await GoogleSheetsService.saveJobsToRoute(
      [
        makeImportJob({ address: '  42 Maple St ' }),                       // duplicate of completed
        makeImportJob({ address: '42 Maple St', jobType: 'removal' }),      // same address, other type — kept
        makeImportJob({ address: '7 Oak Ave', sortOrder: 2 }),              // new — kept
      ],
      'route-1'
    );

    expect(result).toEqual({ imported: 2, skippedCompleted: 1 });
    expect(calls.inserted).toHaveLength(2);
  });

  it('returns counts without inserting when every row is already completed', async () => {
    const calls = installSupabase({ survivors: [{ address: '42 Maple St', job_type: 'install' }] });
    const result = await GoogleSheetsService.saveJobsToRoute([makeImportJob()], 'route-1');

    expect(result).toEqual({ imported: 0, skippedCompleted: 1 });
    expect(calls.inserted).toHaveLength(0);
  });

  it('maps the P0004 duplicate-location trigger to admin language', async () => {
    installSupabase({ insertError: { message: 'duplicate_location: …', code: 'P0004' } });
    await expect(
      GoogleSheetsService.saveJobsToRoute([makeImportJob()], 'route-1')
    ).rejects.toThrow(/already assigned to another driver today/);
  });

  it('propagates a delete failure', async () => {
    installSupabase({ deleteError: { message: 'permission denied' } });
    await expect(
      GoogleSheetsService.saveJobsToRoute([makeImportJob()], 'route-1')
    ).rejects.toThrow(/Could not clear existing jobs: permission denied/);
  });
});

// ── importJobs — geocoding concurrency, retry, and input caps (2026-08-21) ───
//
// The Geocoding API's documented default quota is 25 QPS per project with a
// 3,000/minute ceiling (verified against the usage-and-billing reference
// 2026-08-21), which is why concurrency is bounded and OVER_QUERY_LIMIT is
// retried rather than fatal.

describe('importJobs — geocoding concurrency', () => {
  // Resolve geocode calls only when released, so we can observe how many the
  // service holds in flight at once.
  function installGatedGeocode(rows: Row[]) {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('sheets.googleapis.com')) {
        return Promise.resolve(sheetsResponse(rows));
      }
      if (String(url).includes('functions/v1/geocode-address')) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          release.push(() => {
            inFlight--;
            resolve(geocodeOk());
          });
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    return {
      get maxInFlight() { return maxInFlight; },
      get pending() { return release.length; },
      releaseAll() { while (release.length) release.shift()!(); },
      async drain() {
        // Release in waves until the import settles.
        for (let i = 0; i < 50 && release.length; i++) {
          this.releaseAll();
          await new Promise((r) => setImmediate(r));
        }
      },
    };
  }

  it('geocodes distinct addresses in parallel rather than one at a time', async () => {
    const rows: Row[] = Array.from(
      { length: 12 },
      (_, i) => [SERIAL_TODAY, 'C', 'A', 'n', '', '', `${i + 1} Unique St`] as Row
    );
    const gate = installGatedGeocode(rows);

    const promise = GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);
    // Let the pool saturate before releasing anything.
    await new Promise((r) => setImmediate(r));

    expect(gate.maxInFlight).toBeGreaterThan(1);   // the old code was strictly 1
    expect(gate.maxInFlight).toBeLessThanOrEqual(5); // and stays under the documented QPS budget

    await gate.drain();
    const jobs = await promise;
    expect(jobs).toHaveLength(12);
  });

  it('still geocodes each distinct address exactly once when rows repeat', async () => {
    installFetch([
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', '5 Same St'],
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', '7 Other St'],
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', '5 Same St'],
    ]);

    const jobs = await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);
    const geocodeCalls = (global.fetch as jest.Mock).mock.calls.filter(([u]) =>
      String(u).includes('functions/v1/geocode-address')
    );

    expect(geocodeCalls).toHaveLength(2);
    expect(jobs).toHaveLength(3);
    // sortOrder follows sheet order, not geocode completion order.
    expect(jobs.map((j) => j.sortOrder)).toEqual([1, 2, 3]);
    expect(jobs.map((j) => j.address)).toEqual(['5 Same St', '7 Other St', '5 Same St']);
  });

  // Concurrency must not make the reported row number depend on network timing.
  it('reports the lowest failing row number regardless of which request fails first', async () => {
    const rows: Row[] = [
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', 'Good St'],
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', 'Bad Early St'],   // row 3
      [SERIAL_TODAY, 'C', 'A', 'n', '', '', 'Bad Late St'],    // row 4
    ];

    // Since geocoding moved behind the Edge Function the address travels in the
    // POST body, not the query string — so the per-address branching reads the
    // body rather than the URL. The timing this test depends on is unchanged.
    (global.fetch as jest.Mock).mockImplementation((url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes('sheets.googleapis.com')) return Promise.resolve(sheetsResponse(rows));
      if (u.includes('functions/v1/geocode-address')) {
        const address = JSON.parse(init?.body ?? '{}').address as string;
        const zeroResults = { ok: true, status: 200, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) };
        // The LATER row fails immediately; the earlier one fails after a delay.
        if (address === 'Bad Late St') return Promise.resolve(zeroResults);
        if (address === 'Bad Early St') {
          return new Promise((resolve) => setTimeout(() => resolve(zeroResults), 30));
        }
        return Promise.resolve(geocodeOk());
      }
      throw new Error('unexpected');
    });

    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE))
      .rejects.toThrow(/Row 3: Could not geocode "Bad Early St"/);
  });

  it('enforces the row cap before spending any geocoding quota', async () => {
    const rows: Row[] = Array.from(
      { length: 501 },
      (_, i) => [SERIAL_TODAY, 'C', 'A', 'n', '', '', `${i} Distinct St`] as Row
    );
    installFetch(rows);

    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE))
      .rejects.toThrow(/More than 500 jobs/);

    // The old single-pass loop geocoded 500 addresses before discovering row 501.
    const geocodeCalls = (global.fetch as jest.Mock).mock.calls.filter(([u]) =>
      String(u).includes('functions/v1/geocode-address')
    );
    expect(geocodeCalls).toHaveLength(0);
  });
});

describe('importJobs — geocoding retry', () => {
  it('retries OVER_QUERY_LIMIT and succeeds, instead of failing the whole import', async () => {
    let geocodeAttempts = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('sheets.googleapis.com')) {
        return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St']]));
      }
      if (u.includes('functions/v1/geocode-address')) {
        geocodeAttempts++;
        if (geocodeAttempts === 1) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'OVER_QUERY_LIMIT', results: [] }) });
        }
        return Promise.resolve(geocodeOk());
      }
      throw new Error('unexpected');
    });

    const jobs = await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);
    expect(geocodeAttempts).toBe(2);
    expect(jobs).toHaveLength(1);
  });

  it('retries a 429 from the geocoder', async () => {
    let attempts = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('sheets.googleapis.com')) {
        return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St']]));
      }
      if (u.includes('functions/v1/geocode-address')) {
        attempts++;
        if (attempts === 1) return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
        return Promise.resolve(geocodeOk());
      }
      throw new Error('unexpected');
    });

    await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);
    expect(attempts).toBe(2);
  });

  it('does not retry a permanent status such as ZERO_RESULTS', async () => {
    let attempts = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('sheets.googleapis.com')) {
        return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', 'Nowhere']]));
      }
      if (u.includes('functions/v1/geocode-address')) {
        attempts++;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) });
      }
      throw new Error('unexpected');
    });

    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/ZERO_RESULTS/);
    expect(attempts).toBe(1);  // retrying a permanent failure just burns quota
  });
});

describe('importJobs — input caps on sheet-derived strings', () => {
  it.each([
    ['address', 6, 301, /the address is 301 characters — the limit is 300/],
    ['agency name', 1, 201, /the agency name is 201 characters — the limit is 200/],
    ['agent name', 2, 201, /the agent name is 201 characters — the limit is 200/],
    ['notes cell', 3, 501, /the notes cell is 501 characters — the limit is 500/],
    ['size cell', 4, 101, /the size cell is 101 characters — the limit is 100/],
  ] as const)('rejects an over-long %s on the offending row', async (_label, col, length, message) => {
    const row: Row = [SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St'];
    (row as unknown as unknown[])[col] = 'x'.repeat(length);
    installFetch([row]);

    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE))
      .rejects.toThrow(message);
  });

  it('names the row so the admin can find the offending cell', async () => {
    const good: Row = [SERIAL_TODAY, 'C', 'A', 'n', '', '', '1 St'];
    const bad: Row = [SERIAL_TODAY, 'C', 'A', 'n', '', '', 'x'.repeat(400)];
    installFetch([good, good, bad]);

    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE))
      .rejects.toThrow(/^Row 4: /);
  });

  it('accepts values exactly at the cap', async () => {
    const row: Row = [SERIAL_TODAY, 'C', 'A', 'n', '', '', 'x'.repeat(300)];
    installFetch([row]);

    const jobs = await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);
    expect(jobs[0].address).toHaveLength(300);
  });

  it('collapses embedded newlines and tabs — a multi-line address breaks geocoding', async () => {
    installFetch([[SERIAL_TODAY, 'Harcourts\nPerth', 'A', 'n', '', '', '12 Maple St\n\tPerth  WA']]);

    const jobs = await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);
    expect(jobs[0].address).toBe('12 Maple St Perth WA');
    expect(jobs[0].clientName).toBe('Harcourts Perth');
  });
});

describe('importJobs — readCell behaviour change (2026-08-21)', () => {
  // Pinned deliberately. The old inline reads used `row[col] ? ... : ''`, so a
  // cell holding the NUMBER 0 was falsy and silently became ''. Dropping a
  // cell's contents because it happens to be zero is data loss, so 0 now reads
  // as '0'. If this test fails, that decision is being reversed — do it
  // knowingly.
  it('reads a numeric zero cell as "0" rather than dropping it', async () => {
    installFetch([[SERIAL_TODAY, 0 as unknown as string, 'A', 0 as unknown as string, '', '', '1 St']]);

    const jobs = await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);

    expect(jobs[0].clientName).toBe('0');
    expect(jobs[0].signDescription).toBe('0 — Row 2');
  });

  it('still reads a genuinely empty cell as an empty string', async () => {
    installFetch([[SERIAL_TODAY, '', 'A', '', '', '', '1 St']]);

    const jobs = await GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE);

    expect(jobs[0].clientName).toBe('');
    expect(jobs[0].signDescription).toBe('Row 2');
  });
});
