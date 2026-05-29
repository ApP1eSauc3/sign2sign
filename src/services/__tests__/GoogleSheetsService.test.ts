import { GoogleSheetsService } from '../GoogleSheetsService';
import { secureStorage } from '../../utils/secureStorage';
import { GoogleAuthService } from '../GoogleAuthService';

jest.mock('../../utils/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
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
    if (url.includes('maps/api/geocode')) return Promise.resolve(geocodeOk());
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
  mockGetItem.mockResolvedValue('fake-token');
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-maps-key';
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
    const geocodeCalls = (global.fetch as jest.Mock).mock.calls.filter(([u]) => String(u).includes('maps/api/geocode'));
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

  it('throws when the Maps API key is not configured', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/GOOGLE_MAPS_API_KEY is not set/i);
  });

  it('throws a date-specific message when no rows match', async () => {
    installFetch([[SERIAL_OTHER, 'C', 'A', 'n', '', '', '1 St']]);
    await expect(GoogleSheetsService.importJobs('s', 'Orders', IMPORT_DATE)).rejects.toThrow(/No jobs found for 29\/5\/2026 in "Orders"/);
  });

  it('wraps a geocoding failure with the source row number', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('sheets.googleapis.com')) return Promise.resolve(sheetsResponse([[SERIAL_TODAY, 'C', 'A', 'n', '', '', 'Nowhere']]));
      if (url.includes('maps/api/geocode')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) });
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
      if (url.includes('maps/api/geocode')) return Promise.resolve(geocodeOk());
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
