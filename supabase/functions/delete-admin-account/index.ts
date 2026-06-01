// Sign2Sign — delete-admin-account Edge Function
//
// Apple App Store guideline 5.1.1(v): apps that let users create an account
// must let them initiate account deletion from within the app. This function
// is the server-side endpoint the admin "Delete account" UI calls.
//
// Flow:
//   1. Client sends `Authorization: Bearer <admin access_token>`.
//   2. The Supabase Functions gateway verifies the JWT signature against
//      the project's JWT secret (verify_jwt=true, the default) and returns
//      401 before this code runs if the header is missing or the JWT is
//      malformed. We re-validate with auth.getUser(token) to catch tokens
//      that are syntactically valid but reference a user that no longer
//      exists (e.g. a replayed token after deletion).
//   3. Function then uses a service-role client to call
//      supabase.auth.admin.deleteUser(user.id), which permanently removes
//      the row from auth.users. Linked rows in public.* with ON DELETE
//      CASCADE are removed by the database; rows without a cascade
//      (route_codes, jobs) are retained intentionally — those belong to
//      the operating entity, not to the admin personally.
//   4. Sessions for the deleted user become invalid the moment auth.users
//      is gone — no separate sign-out call is needed server-side.
//
// Deploy:
//   supabase functions deploy delete-admin-account

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Anon client used only to verify the caller's JWT. We never use it to
// mutate auth state — only to extract the authenticated user id.
const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Service-role client used only to perform the deletion. The service-role
// key never leaves the function — it is not shipped in the mobile bundle.
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// In-memory per-IP throttle. Defence-in-depth alongside the gateway's own
// JWT verification: a deleted-user token cannot be replayed indefinitely,
// and a script that hammers this endpoint hits a 429 quickly instead of
// flooding our logs. Mirrors the pattern in validate-code/index.ts.
const ipAttempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;  // an admin should self-delete at most once

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
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [ip, entry] of ipAttempts) {
    if (entry.windowStart < cutoff) ipAttempts.delete(ip);
  }
}, WINDOW_MS).unref?.();

// CORS — the iOS app and Electron desktop don't need this, but a future
// web admin (or the Expo web preview) does. Wildcard is acceptable here:
// the function is JWT-protected, so the origin can't substitute for auth.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
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

  const authHeader = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) {
    return jsonResponse({ error: 'missing_authorization' }, 401);
  }
  const accessToken = match[1];

  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'invalid_token' }, 401);
  }

  const userId = userData.user.id;
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    return jsonResponse({ error: 'delete_failed', message: deleteError.message }, 500);
  }

  return jsonResponse({ deleted: true, user_id: userId });
});
