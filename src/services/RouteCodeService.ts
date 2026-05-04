import { supabase } from './supabaseClient';
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

function generateSixDigitCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
  // Driver: load session from a 6-digit code (anon key + RLS).
  // Returns null when the code is invalid or expired.
  // Throws when there is a network or server problem — callers should distinguish these.
  async loadSession(code: string): Promise<DriverSession | null> {
    const { data, error } = await supabase
      .from('route_codes')
      .select(`
        id,
        code,
        driver_slot,
        expires_at,
        is_active,
        jobs (
          id,
          client_name,
          agent_name,
          agent_email,
          address,
          sign_description,
          job_type,
          latitude,
          longitude,
          sort_order,
          is_complete,
          photo_key,
          photo_gps_lat,
          photo_gps_lng,
          photo_timestamp
        )
      `)
      .eq('code', code)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error) {
      // PGRST116 = no rows — code is invalid or expired, not a network failure
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    if (!data) return null;

    return {
      routeCode: data.code,
      driverSlot: data.driver_slot,
      jobs: (data.jobs as JobRow[]).map((j) => ({
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
      })),
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

    return (data ?? []).map((j: JobRow) => ({
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
    }));
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
