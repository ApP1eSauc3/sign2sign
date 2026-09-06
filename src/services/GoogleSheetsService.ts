import { secureStorage } from '../utils/secureStorage';
import { supabase } from './supabaseClient';
import { GoogleAuthService } from './GoogleAuthService';
import { SignJob } from '../data/SignJob';
import { detectJobType, parseCandidates } from './sheets/rowMapper';
import { geocodeAddress, GEOCODE_CONCURRENCY } from './sheets/geocoding';
import { mapWithConcurrency } from './sheets/concurrency';

const GOOGLE_TOKEN_KEY = 'google_oauth_token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

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
    // Phase 1 (parseCandidates) parses, validates and counts without touching
    // the network, so the row cap and every malformed-cell error are raised
    // before a single billable geocode request goes out.
    //
    // Phase 2 geocodes the DISTINCT addresses concurrently. Sequential awaits
    // inside the loop meant one round trip per unique address end to end —
    // ~40 addresses at 150-300ms each is 6-12 seconds of spinner for work that
    // is entirely independent.
    const candidates = parseCandidates(allRows, importDate);

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
