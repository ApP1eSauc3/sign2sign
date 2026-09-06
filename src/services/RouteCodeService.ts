import { secureStorage } from '../utils/secureStorage';
import { randomUUID } from '../utils/random';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';
import { DriverSession, DailyCode, SignJob } from '../data/SignJob';
import { JobRow, mapJobRow } from './routeCode/jobRow';
import {
  generateSixDigitCode,
  localDateString,
  expiryNextMorning,
} from './routeCode/codeFactory';

// Shape returned by the validate_route_code() RPC (see 006_rate_limit_codes.sql).
type ValidateRouteCodePayload = {
  id: string;
  code: string;
  driver_slot: number;
  jobs: JobRow[];
};

const CLIENT_ID_KEY = 'driver_client_id';

// Stable per-install identifier used to rate-limit code validation attempts
// in the RPC. Persisted in the device keychain — does not leak across reinstalls.
async function getOrCreateClientId(): Promise<string> {
  const existing = await secureStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  // Was `crypto.randomUUID()` against the global. Hermes provides no `crypto`,
  // so this threw on every real device before the request was ever made — see
  // the note in utils/uuid.ts.
  const id = randomUUID();
  await secureStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

export const RouteCodeService = {
  // Driver: load session from a 6-digit code via the validate-code Edge Function.
  // Returns null when the code is invalid or expired.
  // Throws when there is a network/server problem OR when the caller is rate-limited
  // (HTTP 429, from either the function's IP throttle or the RPC's per-client_id
  // limit). Callers should surface the thrown message verbatim — it includes the
  // wait-and-retry instruction for the rate-limited case.
  //
  // We hit the Edge Function rather than calling validate_route_code() directly:
  // migration 008 revokes anon's execute grant on that RPC, leaving the function
  // (service-role key + IP throttle) as the only path. See
  // supabase/functions/validate-code/index.ts.
  async loadSession(code: string): Promise<DriverSession | null> {
    const clientId = await getOrCreateClientId();

    let response: Response;
    try {
      response = await fetch(`${SUPABASE_URL}/functions/v1/validate-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Function is deployed --no-verify-jwt (drivers have no Supabase Auth),
          // but the API gateway still expects the anon apikey to route the call.
          // These are public, already-bundled values.
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ code, client_id: clientId }),
      });
    } catch {
      // fetch only rejects on network failure (see the services layer guide).
      throw new Error('Could not reach the server. Check your connection and try again.');
    }

    // Both throttles (IP-keyed in the function, client_id-keyed in the RPC)
    // surface as 429. Match the old P0005 message verbatim.
    if (response.status === 429) {
      throw new Error('Too many attempts. Wait a minute and try again.');
    }

    // 400/405/500 — a genuine fault, not an invalid code. Don't leak internals.
    if (!response.ok) {
      throw new Error('Something went wrong validating that code. Please try again.');
    }

    let body: { session?: unknown };
    try {
      body = await response.json();
    } catch {
      throw new Error('Unexpected response from server while loading route.');
    }

    // The function wraps the RPC result as { session: <payload | null> }.
    // null means the code is invalid or expired.
    const session = body.session;
    if (session === null || session === undefined) return null;

    // Narrow the payload — it crosses the network as unknown.
    const payload = session as ValidateRouteCodePayload;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.jobs)) {
      throw new Error('Unexpected response from server while loading route.');
    }

    return {
      routeCode: payload.code,
      driverSlot: payload.driver_slot,
      jobs: payload.jobs.map(mapJobRow),
    };
  },

  // Admin: generate a fresh code for each driver slot.
  // Deactivates any existing active code for the slot today before inserting,
  // so the partial unique index (one active code per slot per day) is satisfied.
  // Retries only on code value collision (two slots generating the same 6 digits).
  async generateDailyCodes(driverSlots: number[]): Promise<DailyCode[]> {
    const today = localDateString();
    const expires = expiryNextMorning();
    const results: DailyCode[] = [];

    for (const slot of driverSlots) {
      // Step 1: deactivate any LIVE code for this slot — filtered by expiry,
      // not by created_date. A date filter misses codes whose created_date
      // straddles the UTC boundary (the pre-fix bug: a 7am Perth code was
      // stamped with yesterday's UTC date, survived regeneration, and stayed
      // a live credential invisible to the dashboard). Already-expired codes
      // are left alone: they can't validate a session, and deactivating them
      // would cut off the offline-sync grace window (migration 012).
      // Drivers mid-route on the old code will receive RLS write errors — intentional
      // when the admin explicitly regenerates codes.
      const { error: deactivateError } = await supabase
        .from('route_codes')
        .update({ is_active: false })
        .eq('driver_slot', slot)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString());

      // A zero-row update (no existing code) returns error: null — that's fine.
      // Any actual error must be thrown now: if we silently proceed, the old code
      // stays active, the INSERT hits the partial unique index, and the retry loop
      // misreads index violations as code collisions.
      if (deactivateError) {
        throw new Error(`Could not deactivate existing code for Driver ${slot}: ${deactivateError.message}`);
      }

      // Step 2: insert a new code. Only retry on a 6-digit value collision (23505
      // on the code unique constraint) — the slot+date conflict is resolved above.
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const code = generateSixDigitCode();
        const { data, error } = await supabase
          .from('route_codes')
          .insert({ code, driver_slot: slot, created_date: today, expires_at: expires, is_active: true })
          .select()
          .single();

        if (error?.code === '23505') continue; // code value taken — try another
        if (error || !data) throw new Error(error?.message ?? 'Failed to generate code');

        results.push({
          id: data.id,
          code: data.code,
          driverSlot: data.driver_slot,
          createdDate: data.created_date,
          expiresAt: data.expires_at,
          isActive: data.is_active,
        });
        inserted = true;
      }
      if (!inserted) {
        throw new Error(`Could not generate a unique code for Driver ${slot} — please try again`);
      }
    }

    return results;
  },

  // Admin: fetch all jobs for a route code. The "Admins can read all jobs"
  // policy has no expiry predicate — route detail still works the morning
  // after the code expires.
  async getRouteJobs(routeCodeId: string): Promise<SignJob[]> {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('route_code_id', routeCodeId)
      .order('sort_order');

    if (error) throw new Error(error.message);

    return ((data ?? []) as JobRow[]).map(mapJobRow);
  },

  // Admin: record that the completion notice for a job has been approved and
  // sent. Called after the admin's mail client has been handed the message.
  //
  // "Sent" here means the admin approved it and their mail app was opened with
  // the message composed — the app cannot observe whether they then pressed
  // send, because delivery happens outside it. That limit is the trade accepted
  // when the send method was chosen (no email provider, no domain
  // verification); it is recorded here so nobody later reads notice_sent_at as
  // proof of delivery. If proof is ever needed, sending must move server-side.
  //
  // Admin-only by construction: anon holds no UPDATE on jobs since 013, so this
  // reaches the database solely under the "Admins can update jobs" policy.
  async markNoticeSent(jobId: string): Promise<void> {
    // The caller is a screen, and a screen has no business handling sessions.
    // Resolve the admin from the session here.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not signed in — sign in again to approve notices.');

    const { error } = await supabase
      .from('jobs')
      .update({
        notice_sent_at: new Date().toISOString(),
        notice_sent_by: session.user.id,
      })
      .eq('id', jobId);

    if (error) throw new Error(error.message);
  },

  // Admin: fetch the codes drivers can currently use, for the dashboard.
  // Filter on liveness (is_active + unexpired), NOT on created_date — the
  // date column is a local business-day label and pre-fix rows may carry a
  // UTC-shifted date. A code that validates a driver session must always be
  // visible to the admin.
  async getActiveCodes(): Promise<DailyCode[]> {
    const { data, error } = await supabase
      .from('route_codes')
      .select('*')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('driver_slot', { ascending: true });

    if (error) throw new Error(error.message);

    return (data ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      driverSlot: r.driver_slot,
      createdDate: r.created_date,
      expiresAt: r.expires_at,
      isActive: r.is_active,
    }));
  },
};
