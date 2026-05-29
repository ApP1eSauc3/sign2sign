import { secureStorage } from '../utils/secureStorage';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';
import { DriverSession, DailyCode, JobType, SignJob } from '../data/SignJob';

// DB row shapes — map snake_case DB columns to camelCase domain types at the boundary.
// These types live here, not in src/data/, because they are a DB implementation detail.
type JobRow = {
  id: string;
  client_name: string;
  agent_name: string | null;
  agent_email: string | null;
  address: string;
  sign_description: string;
  job_type: string;
  latitude: number;
  longitude: number;
  sort_order: number;
  is_complete: boolean;
  photo_key: string | null;
  photo_gps_lat: number | null;
  photo_gps_lng: number | null;
  photo_timestamp: string | null;
};

// Shape returned by the validate_route_code() RPC (see 006_rate_limit_codes.sql).
type ValidateRouteCodePayload = {
  id: string;
  code: string;
  driver_slot: number;
  jobs: JobRow[];
};

const CLIENT_ID_KEY = 'driver_client_id';

// Cryptographically secure 6-digit code generator. Math.random() is biased
// and predictable across modern V8 with enough samples — fatal when the
// generated value IS the driver credential. crypto.getRandomValues is
// available globally in both Hermes (RN 0.76+) and the Electron renderer.
function generateSixDigitCode(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Cryptographic RNG unavailable — cannot generate driver codes safely.');
  }
  // Reject values outside the largest multiple of 900000 that fits in Uint32
  // so the modulo is unbiased.
  const LIMIT = Math.floor(0xffffffff / 900000) * 900000;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= LIMIT);
  return (100000 + (v % 900000)).toString();
}

// Stable per-install identifier used to rate-limit code validation attempts
// in the RPC. Persisted in the device keychain — does not leak across reinstalls.
async function getOrCreateClientId(): Promise<string> {
  const existing = await secureStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID unavailable — cannot create client id.');
  }
  const id = crypto.randomUUID();
  await secureStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

function mapJobRow(j: JobRow): SignJob {
  return {
    id: j.id,
    clientName: j.client_name,
    agentName: j.agent_name ?? '',
    agentEmail: j.agent_email ?? '',
    address: j.address,
    signDescription: j.sign_description,
    jobType: (j.job_type === 'removal' ? 'removal' : 'install') as JobType,
    latitude: j.latitude,
    longitude: j.longitude,
    sortOrder: j.sort_order,
    isComplete: j.is_complete,
    photoKey: j.photo_key ?? undefined,
    photoGPSLat: j.photo_gps_lat ?? undefined,
    photoGPSLng: j.photo_gps_lng ?? undefined,
    photoTimestamp: j.photo_timestamp ? new Date(j.photo_timestamp) : undefined,
  };
}

function expiryNextMorning(): string {
  // Expire at 06:00 the following morning rather than 23:59 tonight.
  // Drivers finishing late jobs or working past midnight are not locked out
  // mid-shift. The code is still single-day — it expires before the next
  // morning's batch is generated.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
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
      // fetch only rejects on network failure (see src/services/CLAUDE.md).
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
    const today = new Date().toISOString().split('T')[0];
    const expires = expiryNextMorning();
    const results: DailyCode[] = [];

    for (const slot of driverSlots) {
      // Step 1: deactivate any existing active code for this slot today.
      // This satisfies the partial unique index and invalidates the old credential.
      // Drivers mid-route on the old code will receive RLS write errors — intentional
      // when the admin explicitly regenerates codes.
      const { error: deactivateError } = await supabase
        .from('route_codes')
        .update({ is_active: false })
        .eq('driver_slot', slot)
        .eq('created_date', today)
        .eq('is_active', true);

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

  // Admin: fetch all jobs for a route code (active codes only — RLS constraint)
  async getRouteJobs(routeCodeId: string): Promise<SignJob[]> {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('route_code_id', routeCodeId)
      .order('sort_order');

    if (error) throw new Error(error.message);

    return ((data ?? []) as JobRow[]).map(mapJobRow);
  },

  // Admin: fetch today's active codes for the dashboard
  async getActiveCodes(): Promise<DailyCode[]> {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('route_codes')
      .select('*')
      .eq('created_date', today)
      .eq('is_active', true)
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
