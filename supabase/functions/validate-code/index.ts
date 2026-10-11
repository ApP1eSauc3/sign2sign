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
// ⚠️ Since 2026-10-11 this calls validate_route_code(code, client_id, ip) and
//    record_security_event(), which exist only after migrations 016 and 017.
//    Run `supabase db push` first, then deploy this.
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
import { clientIp } from '../_shared/clientIp.ts';
import { recordSecurityEvent } from '../_shared/securityEvents.ts';

// In-memory IP throttle. Edge Functions are stateless across invocations on
// cold starts but reuse memory across warm invocations on the same worker —
// good enough for opportunistic throttling, not a hard guarantee. The DB
// rate limit (per client_id) remains the durable backstop.
const ipAttempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30; // ~one attempt every 2s — generous for legitimate use

// {"code":"123456","client_id":"<uuid>"} is ~60 bytes. 1 KiB is room to spare.
const MAX_BODY_BYTES = 1024;

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

// A lockout is logged to security_events once per IP per minute, not once per
// refused request: under a real attack the refusals arrive many times a
// second, and the useful fact is "this IP was locked out", not each retry.
const lockoutLogged = new Map<string, number>();
function shouldLogLockout(key: string): boolean {
  const now = Date.now();
  const last = lockoutLogged.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  lockoutLogged.set(key, now);
  return true;
}

// Periodic cleanup so the Maps don't grow without bound on a long-lived worker.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [ip, entry] of ipAttempts) {
    if (entry.windowStart < cutoff) ipAttempts.delete(ip);
  }
  for (const [key, at] of lockoutLogged) {
    if (at < cutoff) lockoutLogged.delete(key);
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

  // Supabase API gateway forwards the caller IP in x-forwarded-for; clientIp()
  // takes the first entry and returns null unless it is a well-formed address.
  const callerIp = clientIp(req);
  const ip = callerIp ?? 'unknown';

  if (!checkIpThrottle(ip)) {
    if (shouldLogLockout(`mem:${ip}`)) {
      await recordSecurityEvent(supabase, {
        type: 'driver.lockout', ip: callerIp, detail: { limit: 'ip_memory' },
      });
    }
    return jsonResponse(
      { error: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' },
      429
    );
  }

  // Cap the body before parsing it. The only legitimate payload here is a
  // six-digit code and a UUID — a few dozen bytes.
  //
  // Two checks, because one is not enough. Content-Length rejects the common
  // oversized case without buffering anything, but a chunked request sends no
  // Content-Length at all, so the header check alone is trivially bypassed.
  // The length check after reading catches that. Neither is the real ceiling
  // for a genuinely huge body — the Supabase Edge gateway is — but together
  // they stop this function from parsing megabytes of attacker JSON.
  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large' }, 413);
  }

  let payload: { code?: unknown; client_id?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'payload_too_large' }, 413);
    }
    payload = JSON.parse(raw);
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

  // 3-argument form (migration 017): the IP makes the per-network limit
  // durable in Postgres instead of only in this worker's memory.
  const { data, error } = await supabase.rpc('validate_route_code', {
    p_code: code,
    p_client_id: clientId,
    p_ip: callerIp,
  });

  if (error) {
    // P0005: this device has 5 failures in 60s. P0006: this IP has 30.
    if (error.code === 'P0005' || error.code === 'P0006') {
      const limit = error.code === 'P0005' ? 'device' : 'ip';
      if (shouldLogLockout(`${limit}:${limit === 'device' ? clientId : ip}`)) {
        await recordSecurityEvent(supabase, {
          type: 'driver.lockout', ip: callerIp, targetId: limit === 'device' ? clientId : null, detail: { limit },
        });
      }
      return jsonResponse(
        { error: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' },
        429
      );
    }
    // Never hand a raw Postgres error to an unauthenticated caller — the
    // text names functions, columns and constraints, which is free
    // reconnaissance. Log the detail, return a generic failure.
    console.error('[validate-code] rpc_error:', error.message);
    return jsonResponse({ error: 'rpc_error', message: 'Could not validate the code. Try again.' }, 500);
  }

  // RPC returns null for invalid/expired code, JSONB payload on success.
  return jsonResponse({ session: data });
});
