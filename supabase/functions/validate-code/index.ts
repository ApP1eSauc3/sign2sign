// Sign2Sign — validate-code Edge Function
//
// IP-throttled wrapper around the validate_route_code() RPC. The in-DB rate
// limit (006_rate_limit_codes.sql) is keyed by a UUID the driver client
// persists in SecureStore — a determined attacker rotates that UUID per
// request and bypasses the throttle. This function adds a second rate-limit
// keyed by the caller's IP (as forwarded by the Supabase API gateway), which
// is much harder to rotate cheaply.
//
// Deploy:
//   supabase functions deploy validate-code --no-verify-jwt
//
// The --no-verify-jwt flag is correct here: drivers do NOT have Supabase
// Auth accounts, so there is no JWT to verify. Throttling + the RPC's own
// SECURITY DEFINER checks provide all the authorisation we need.
//
// After deploy, follow up with migration 008_revoke_rpc_from_anon.sql which
// revokes execute permission on validate_route_code from anon — at that
// point this Edge Function is the only path drivers can use to validate a
// code, and the bypass is closed.
//
// Until 008 is applied, both paths work in parallel and the client can be
// switched over without downtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// In-memory IP throttle. Edge Functions are stateless across invocations on
// cold starts but reuse memory across warm invocations on the same worker —
// good enough for opportunistic throttling, not a hard guarantee. The DB
// rate limit (per client_id) remains the durable backstop.
const ipAttempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30; // ~one attempt every 2s — generous for legitimate use

function checkIpThrottle(ip: string): boolean {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    ipAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

// Periodic cleanup so the Map doesn't grow without bound on a long-lived worker.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [ip, entry] of ipAttempts) {
    if (entry.windowStart < cutoff) ipAttempts.delete(ip);
  }
}, WINDOW_MS).unref?.();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Service-role client so the RPC call bypasses RLS and the post-008
// "anon cannot execute validate_route_code" grant.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // Supabase API gateway forwards the caller IP in x-forwarded-for.
  // First entry is the client; subsequent entries are gateway hops.
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const ip = xff.split(',')[0]?.trim() || 'unknown';

  if (!checkIpThrottle(ip)) {
    return jsonResponse(
      { error: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' },
      429
    );
  }

  let payload: { code?: unknown; client_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const code = typeof payload.code === 'string' ? payload.code : null;
  const clientId = typeof payload.client_id === 'string' ? payload.client_id : null;

  if (!code || !/^\d{6}$/.test(code)) {
    return jsonResponse({ error: 'invalid_code_format' }, 400);
  }
  if (!clientId) {
    return jsonResponse({ error: 'client_id_required' }, 400);
  }

  const { data, error } = await supabase.rpc('validate_route_code', {
    p_code: code,
    p_client_id: clientId,
  });

  if (error) {
    if (error.code === 'P0005') {
      return jsonResponse(
        { error: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' },
        429
      );
    }
    return jsonResponse({ error: 'rpc_error', message: error.message }, 500);
  }

  // RPC returns null for invalid/expired code, JSONB payload on success.
  return jsonResponse({ session: data });
});
