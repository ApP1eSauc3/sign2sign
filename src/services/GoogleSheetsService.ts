import { secureStorage } from '../utils/secureStorage';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';
import { GoogleAuthService } from './GoogleAuthService';
import { SignJob, JobType } from '../data/SignJob';

const MAX_IMPORT_ROWS = 500;
const GOOGLE_TOKEN_KEY = 'google_oauth_token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Geocoding goes through our own Edge Function, never to Google directly.
//
// Google Maps Platform web service APIs accept only an IP-address application
// restriction — not an iOS bundle ID, not an Android signature
// (https://developers.google.com/maps/api-security-best-practices, verified
// 2026-09-03). An IP allowlist cannot describe an admin laptop, so a key
// shipped in this bundle would be an unrestricted key on the client's billing
// account, extractable by anyone who installs the app. Google's guidance for
// this exact case is to proxy, so the key lives as a Supabase secret and
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY no longer exists.
//
// The function returns Google's own `{ status, results }` shape, so the retry
// logic below is unchanged from when it spoke to Google directly.
const GEOCODE_FUNCTION = `${SUPABASE_URL}/functions/v1/geocode-address`;

// Geocoding runs concurrently, but not unboundedly. The Geocoding API's
// documented default quota is 25 QPS per project with a 3,000/minute ceiling
// (https://developers.google.com/maps/documentation/geocoding/usage-and-billing,
// verified 2026-08-21). Concurrency alone does not bound QPS — throughput is
// limit/latency — so 5 in flight is paired with OVER_QUERY_LIMIT backoff below
// rather than trusted on its own. It turns a 40-address import from ~40
// sequential round trips into ~8 waves.
const GEOCODE_CONCURRENCY = 5;
const GEOCODE_MAX_RETRIES = 3;
const GEOCODE_BACKOFF_BASE_MS = 200;

// Sheets-derived strings go straight into text columns, which impose no bound
// of their own — a single Google Sheets cell holds up to 50,000 characters, so
// 500 rows of pasted junk is a ~25MB insert. These caps are generous against
// real Australian address and agency data and exist to fail loudly, on the
// offending row, rather than silently truncating (a truncated address geocodes
// to the wrong place, which is worse than a refused import).
const MAX_ADDRESS_CHARS = 300;
const MAX_NAME_CHARS = 200;
const MAX_NOTES_CHARS = 500;
const MAX_SIZE_CHARS = 100;

// Sign2Site actual sheet column layout:
// A: Date (serial number with UNFORMATTED_VALUE), B: AGENCY, C: AGENT,
// D: NOTES (install instructions), E: SIZE (sign dimensions), F: Printed (skip), G: ADDRESS
const COL = {
  date: 0,
  clientName: 1,   // B — AGENCY
  agentName: 2,    // C — AGENT (name; sometimes includes job notes like "(ADD WINGS)")
  notes: 3,        // D — NOTES (install placement instructions)
  size: 4,         // E — sign dimensions (6x4, 4x3, 6x2 SS, COR, etc.)
  // index 5 = F (Printed) — not used
  address: 6,      // G — ADDRESS (must be non-empty; used to geocode)
};

// Google Sheets returns date cells as Excel serial numbers when valueRenderOption=UNFORMATTED_VALUE.
// Serial 0 = 1899-12-30; each integer is one calendar day.
function serialToLocalDate(serial: number): Date {
  const base = new Date(1899, 11, 30);
  base.setDate(base.getDate() + Math.floor(serial));
  return base;
}

function serialMatchesDate(serial: unknown, target: Date): boolean {
  if (typeof serial !== 'number') return false;
  const d = serialToLocalDate(serial);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

// Detect removal jobs from agent + notes text. The sheet uses no explicit job_type column;
// "removal" only appears as incidental text in rare cases. Defaults to 'install'.
function detectJobType(agentText: string, notesText: string): JobType {
  const combined = `${agentText} ${notesText}`.toLowerCase();
  if (
    combined.includes('removal') ||
    combined.includes('take down') ||
    combined.includes('collect sign')
  ) {
    return 'removal';
  }
  return 'install';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Proxy-side failures that no amount of backoff will clear. Each maps to a
// message naming the thing an operator can actually go and fix — the whole
// reason for distinguishing them from a transient 5xx.
//
// `server_key_missing` is the one that matters most: it is what a deployment
// with no GOOGLE_MAPS_API_KEY secret looks like from here, and before this
// mapping existed it would have surfaced as "Geocoding request failed (503)"
// after three pointless retries.
const PERMANENT_GEOCODE_ERRORS: Record<string, string> = {
  server_key_missing:
    'Address lookup is not configured on the server — the GOOGLE_MAPS_API_KEY secret is not set. See the Maps key runbook in the handover.',
  unauthorized:
    'Your admin session has expired. Sign out, sign in again, and retry the import.',
  invalid_address:
    'The server rejected an address as empty or too long.',
  payload_too_large:
    'The server rejected an address as too long.',
  method_not_allowed:
    'Address lookup rejected the request. The geocode-address function may be out of date — redeploy it.',
};

// Proxy errors arrive as { "error": "<code>" }. A success carries `status`
// instead, so the two shapes never collide. Never throws: a body that is not
// JSON at all (an HTML error page from the gateway, say) simply means we have
// no code to act on, and the caller falls back to status-based handling.
async function readProxyErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

// Retries only the transient shapes: the API's own OVER_QUERY_LIMIT status (a
// 200 response body, not an HTTP error), HTTP 429, and 5xx. Everything else —
// ZERO_RESULTS, REQUEST_DENIED, a bad key — is permanent, and retrying it just
// spends quota before failing anyway.
//
// Before this, a single transient rate-limit response aborted the entire
// import and the admin had to start over.
async function geocodeAddress(
  address: string,
  accessToken: string
): Promise<{ latitude: number; longitude: number }> {
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < GEOCODE_MAX_RETRIES;

    let response: Response;
    try {
      response = await fetch(GEOCODE_FUNCTION, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The gateway routes on the anon apikey; the bearer token is the
          // admin's own session, which the function resolves to a real
          // auth.users row. The anon key would satisfy the gateway's JWT
          // check but not that lookup — which is the point.
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ address }),
      });
    } catch (err) {
      // fetch rejects only on network failure.
      if (canRetry) {
        await sleep(GEOCODE_BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`Geocoding request failed — check your connection.`);
    }

    if (!response.ok) {
      // A proxy-side refusal that retrying cannot fix must not be spent on
      // three rounds of backoff and then reported as a generic 503. These are
      // operator errors, and the message is the whole value of catching them.
      const proxyError = await readProxyErrorCode(response);
      const permanent = proxyError ? PERMANENT_GEOCODE_ERRORS[proxyError] : undefined;
      if (permanent) throw new Error(permanent);

      if (response.status === 429 || response.status >= 500) {
        if (canRetry) {
          await sleep(GEOCODE_BACKOFF_BASE_MS * 2 ** attempt);
          continue;
        }
        throw new Error(`Geocoding request failed (${response.status})`);
      }

      throw new Error(`Geocoding request failed (${response.status})`);
    }

    const json = await response.json() as {
      status: string;
      results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };

    if (json.status === 'OVER_QUERY_LIMIT' && canRetry) {
      await sleep(GEOCODE_BACKOFF_BASE_MS * 2 ** attempt);
      continue;
    }

    if (json.status !== 'OK' || !json.results[0]) {
      throw new Error(`Could not geocode "${address}" — status: ${json.status}`);
    }

    const { lat, lng } = json.results[0].geometry.location;
    return { latitude: lat, longitude: lng };
  }
}

// Bounded-concurrency map. Workers pull from a shared cursor, so a slow item
// never idles the pool the way a fixed chunk-per-worker split would.
//
// On failure it stops dispatching new work but reports the error belonging to
// the LOWEST index, not whichever rejected first. Import errors name a row
// number, and a row number that changes between identical runs because of
// network timing is a support call waiting to happen.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<{ results: R[]; failure?: { index: number; error: unknown } }> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: { index: number; error: unknown } | undefined;
  // Separate from `failure` so the early-return guard does not narrow it away
  // in the catch block below.
  let aborted = false;

  async function runWorker(): Promise<void> {
    for (;;) {
      if (aborted) return;              // stop starting new work once one has failed
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        aborted = true;
        // Workers can fail concurrently — keep the lowest index, not the first
        // rejection to land.
        if (failure === undefined || index < failure.index) failure = { index, error };
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  );

  return { results, failure };
}

// Sheets cells are unbounded; the destination columns are `text`. Fail on the
// offending row rather than truncating — see the MAX_*_CHARS comment above.
//
// Behaviour note (changed 2026-08-21): the previous inline reads were
// `row[col] ? String(row[col]).trim() : ''`, so a cell holding the NUMBER 0 was
// falsy and became ''. This reads it as '0'. That is deliberate — dropping a
// cell's contents because it happens to be zero is data loss, not tidiness —
// but it is a real difference and is pinned by a test.
function readCell(row: unknown[], col: number, rowNum: number, label: string, max: number): string {
  const raw = row[col];
  if (raw === undefined || raw === null) return '';
  // Collapse embedded newlines/tabs: a multi-line address breaks geocoding and
  // a stray newline in a name is never intentional.
  const value = String(raw).replace(/\s+/g, ' ').trim();
  if (value.length > max) {
    throw new Error(
      `Row ${rowNum}: ${label} is ${value.length} characters — the limit is ${max}. ` +
        `Check that cell in the sheet.`
    );
  }
  return value;
}

export const GoogleSheetsService = {
  async getStoredToken(): Promise<string | null> {
    return secureStorage.getItem(GOOGLE_TOKEN_KEY);
  },

  async storeToken(token: string): Promise<void> {
    await secureStorage.setItem(GOOGLE_TOKEN_KEY, token);
  },

  async clearToken(): Promise<void> {
    await secureStorage.removeItem(GOOGLE_TOKEN_KEY);
  },

  // Fetch rows from a Google Sheet tab, filter by date, geocode each address,
  // and return SignJob objects ready to be saved via saveJobsToRoute().
  async importJobs(
    sheetId: string,
    sheetName: string,
    importDate: Date
  ): Promise<Omit<SignJob, 'id' | 'isComplete'>[]> {
    const token = await GoogleSheetsService.getStoredToken();
    if (!token) throw new Error('No Google OAuth token stored. Authenticate first.');

    // Geocoding runs through the geocode-address Edge Function, which requires
    // the caller's own admin session — not the anon key, which is public and
    // would let any handset spend the geocoding budget. Fetched once here
    // rather than per address so a 40-address import does one session read.
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    if (!accessToken) {
      throw new Error(
        'You are not signed in — sign in as an admin before importing jobs.'
      );
    }

    // Single-quote wrap for tab names that contain spaces or punctuation.
    // Sheets A1 notation escapes embedded single quotes by doubling them
    // (e.g. "John's Sheet" → 'John''s Sheet').
    const needsQuoting = /[^A-Za-z0-9_]/.test(sheetName);
    const sheetRef = needsQuoting ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
    const range = `${sheetRef}!A2:G`;
    // UNFORMATTED_VALUE returns date cells as serial numbers, avoiding locale-dependent
    // date string formats that vary between Australian and US Sheets settings.
    const url = `${SHEETS_API}/${sheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;

    let response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      const newToken = await GoogleAuthService.refreshAccessToken();
      if (!newToken) {
        await GoogleSheetsService.clearToken();
        throw new Error('Google session expired. Please re-authenticate.');
      }
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${newToken}` },
      });
    }

    if (response.status === 401) {
      await GoogleSheetsService.clearToken();
      throw new Error('Google session expired. Please re-authenticate.');
    }

    if (!response.ok) {
      throw new Error(`Google Sheets error: ${response.status}`);
    }

    const json = (await response.json()) as { values?: unknown[][] };
    const allRows: unknown[][] = json.values ?? [];

    // Two phases, deliberately.
    //
    // Phase 1 parses, validates and counts without touching the network, so the
    // row cap and every malformed-cell error are raised before a single
    // billable geocode request goes out. The previous single-pass loop
    // geocoded rows 1..500 and only then discovered row 501 blew the cap.
    //
    // Phase 2 geocodes the DISTINCT addresses concurrently. Sequential awaits
    // inside the loop meant one round trip per unique address end to end —
    // ~40 addresses at 150-300ms each is 6-12 seconds of spinner for work that
    // is entirely independent.
    type Candidate = {
      rowNum: number;
      address: string;
      clientName: string;
      agentText: string;
      notes: string;
      signDescription: string;
    };

    const candidates: Candidate[] = [];

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const rowNum = i + 2; // 1-indexed, offset by skipped header row

      // Skip rows without an address or not matching the target date
      const rawAddress = row[COL.address];
      if (!rawAddress || !String(rawAddress).trim()) continue;
      if (!serialMatchesDate(row[COL.date], importDate)) continue;

      if (candidates.length + 1 > MAX_IMPORT_ROWS) {
        throw new Error(
          `More than ${MAX_IMPORT_ROWS} jobs found for this date — split them across separate route codes first.`
        );
      }

      const address = readCell(row, COL.address, rowNum, 'the address', MAX_ADDRESS_CHARS);
      const notes = readCell(row, COL.notes, rowNum, 'the notes cell', MAX_NOTES_CHARS);
      const size = readCell(row, COL.size, rowNum, 'the size cell', MAX_SIZE_CHARS);
      const agentText = readCell(row, COL.agentName, rowNum, 'the agent name', MAX_NAME_CHARS);
      const clientName = readCell(row, COL.clientName, rowNum, 'the agency name', MAX_NAME_CHARS);

      // Row reference appended so admin can trace back to the source sheet for contact details
      const noteParts = [notes, size && `(${size})`].filter(Boolean).join(' ');
      const signDescription = noteParts ? `${noteParts} — Row ${rowNum}` : `Row ${rowNum}`;

      candidates.push({ rowNum, address, clientName, agentText, notes, signDescription });
    }

    if (candidates.length === 0) {
      const dateLabel = `${importDate.getDate()}/${importDate.getMonth() + 1}/${importDate.getFullYear()}`;
      throw new Error(
        `No jobs found for ${dateLabel} in "${sheetName}". ` +
        `Check the date and tab name are correct.`
      );
    }

    // Distinct addresses only — multi-unit properties repeat an address across
    // rows, and geocoding it once is both faster and cheaper. This replaces the
    // old in-loop coordCache and preserves its behaviour.
    const uniqueAddresses = [...new Set(candidates.map((c) => c.address))];

    // Lowest row number per address, so a geocode failure reports the first row
    // the admin will find when they go looking in the sheet.
    const firstRowForAddress = new Map<string, number>();
    for (const c of candidates) {
      const seen = firstRowForAddress.get(c.address);
      if (seen === undefined || c.rowNum < seen) firstRowForAddress.set(c.address, c.rowNum);
    }

    const { results, failure } = await mapWithConcurrency(
      uniqueAddresses,
      GEOCODE_CONCURRENCY,
      (address) => geocodeAddress(address, accessToken)
    );

    if (failure) {
      const address = uniqueAddresses[failure.index];
      const rowNum = firstRowForAddress.get(address) ?? 0;
      throw new Error(
        `Row ${rowNum}: ${failure.error instanceof Error ? failure.error.message : 'Geocoding failed.'}`
      );
    }

    const coordCache = new Map(uniqueAddresses.map((address, i) => [address, results[i]]));

    return candidates.map((c, i) => {
      const coords = coordCache.get(c.address)!;
      return {
        clientName: c.clientName,
        agentName: c.agentText,
        agentEmail: '',  // not in sheet — see the agent-email gap noted in the handover
        address: c.address,
        signDescription: c.signDescription,
        jobType: detectJobType(c.agentText, c.notes),
        latitude: coords.latitude,
        longitude: coords.longitude,
        sortOrder: i + 1,
      };
    });
  },

  // Save parsed jobs to Supabase, linked to a route code.
  // Replace-incomplete semantics:
  //   1. Delete the route's INCOMPLETE jobs. The DELETE policy (migration 011)
  //      is scoped to is_complete = false — completed jobs are completion
  //      evidence (photo, GPS, timestamp) and survive every re-import.
  //   2. Skip import rows matching a surviving completed job (same address +
  //      job_type) so the insert doesn't trip the duplicate-location trigger
  //      (P0004) on work that's already done.
  //   3. Insert the rest. Returns a summary for the dashboard message.
  async saveJobsToRoute(
    jobs: Omit<SignJob, 'id' | 'isComplete'>[],
    routeCodeId: string
  ): Promise<{ imported: number; skippedCompleted: number }> {
    const { error: deleteError } = await supabase
      .from('jobs')
      .delete()
      .eq('route_code_id', routeCodeId)
      .eq('is_complete', false);

    if (deleteError) throw new Error(`Could not clear existing jobs: ${deleteError.message}`);

    // Whatever still exists on the route after the delete is completed work.
    const { data: survivors, error: survivorsError } = await supabase
      .from('jobs')
      .select('address, job_type')
      .eq('route_code_id', routeCodeId);

    if (survivorsError) throw new Error(`Could not read existing jobs: ${survivorsError.message}`);

    const completedKeys = new Set(
      ((survivors ?? []) as { address: string; job_type: string }[]).map(
        (j) => `${j.address.trim().toLowerCase()}|${j.job_type}`
      )
    );

    const toImport = jobs.filter(
      (job) => !completedKeys.has(`${job.address.trim().toLowerCase()}|${job.jobType}`)
    );
    const skippedCompleted = jobs.length - toImport.length;

    if (toImport.length === 0) return { imported: 0, skippedCompleted };

    const records = toImport.map((job) => ({
      route_code_id: routeCodeId,
      client_name: job.clientName,
      agent_name: job.agentName,
      agent_email: job.agentEmail || null,
      address: job.address,
      sign_description: job.signDescription,
      job_type: job.jobType,
      latitude: job.latitude,
      longitude: job.longitude,
      sort_order: job.sortOrder,
      is_complete: false,
    }));

    const { error } = await supabase.from('jobs').insert(records);
    if (error) {
      // P0004 = duplicate-location trigger: an address+type in this sheet is
      // already assigned to ANOTHER driver today (same-route duplicates were
      // filtered above). Surface that in admin language, not SQLSTATE.
      if (error.code === 'P0004') {
        throw new Error(
          'Import blocked: a job in this sheet is already assigned to another driver today. ' +
            'Check the route assignments, then re-import.'
        );
      }
      throw new Error(error.message);
    }
    return { imported: toImport.length, skippedCompleted };
  },
};
