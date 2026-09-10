// Sign2Sign — invite-admin Edge Function
//
// Public sign-up is disabled on this project, so there is no self-serve path
// to a second admin account. This function is that path: an existing admin
// invites a colleague by email, and GoTrue sends them an invite containing a
// six-digit OTP which SetPasswordScreen exchanges for a password.
//
// Flow:
//   1. Client sends `Authorization: Bearer <admin access_token>` and a JSON
//      body `{ "email": "colleague@example.com" }`.
//   2. The Functions gateway verifies the JWT signature (verify_jwt=true, the
//      default) and 401s before this code runs on a missing/malformed header.
//      We re-resolve with auth.getUser(token) because a valid signature is NOT
//      proof of admin: the anon key is itself a project-signed JWT and it ships
//      in every copy of the app. Only a real auth.users row is admin here —
//      there is no roles table, every `authenticated` user is an admin.
//   3. A service-role client calls auth.admin.inviteUserByEmail(email), which
//      creates the auth.users row with no password and emails the invite.
//
// Why an OTP and not the invite link:
//   inviteUserByEmail does not support PKCE (the browser that opens the invite
//   is usually not the one that sent it), so the link is an implicit-flow URL
//   that would land a session in a web browser, not in this app. The Invite
//   email template is therefore expected to carry `{{ .Token }}`, and the
//   client verifies it with verifyOtp({ type: 'invite' }). Verified against
//   GoTrue's verify.go on 2026-09-10: signupVerify() — which handles both
//   SignupVerification and InviteVerification — does not consult DisableSignup,
//   so invite acceptance keeps working while sign-ups are off.
//
// ⚠️ Two dashboard steps are required before this works end to end. See the
//    "Invite + password-reset runbook" section in ELECTRON_HARDENING_HANDOVER.md.
//
// Deploy:
//   supabase functions deploy invite-admin

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Anon client used only to verify the caller's JWT. Never used to mutate.
const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Service-role client used only to issue the invite. The service-role key
// never leaves the function — it is not shipped in the mobile bundle.
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// In-memory per-IP throttle, mirroring delete-admin-account. Inviting is a
// rare, deliberate act; a caller hammering this endpoint is either a bug or
// an attempt to use our SMTP quota to mail-bomb a third party.
const ipAttempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

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

// CORS — allowlist, not wildcard. Pinned from electron/main.js; see the long
// note in delete-admin-account/index.ts for why an allowlist and not a reject.
const ALLOWED_ORIGINS = ['app://bundle', 'http://localhost:8081'];

const BASE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
};

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...BASE_CORS_HEADERS, 'Access-Control-Allow-Origin': origin };
  }
  return BASE_CORS_HEADERS;
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

// Body cap. Same reasoning as validate-code's: read a bounded string before
// parsing so a multi-megabyte body cannot be buffered into JSON.parse.
const MAX_BODY_BYTES = 1024;

// RFC 5321 caps a forward-path at 254 octets. The regex is deliberately
// permissive about the local part — GoTrue is the real validator; this exists
// to reject obvious junk before it reaches the mail path (open-work #10's
// "the DB column type is the only bound" debt class).
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'method_not_allowed' }, 405);
  }

  const xff = req.headers.get('x-forwarded-for') ?? '';
  const ip = xff.split(',')[0]?.trim() || 'unknown';
  if (!checkIpThrottle(ip)) {
    return jsonResponse(
      req,
      { error: 'rate_limited', message: 'Too many invites. Wait a minute and try again.' },
      429
    );
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) {
    return jsonResponse(req, { error: 'missing_authorization' }, 401);
  }

  const { data: userData, error: userError } = await anonClient.auth.getUser(match[1]);
  if (userError || !userData?.user) {
    return jsonResponse(req, { error: 'invalid_token' }, 401);
  }
  const inviterId = userData.user.id;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse(req, { error: 'invalid_request', message: 'Request too large.' }, 400);
  }

  let email: unknown;
  try {
    ({ email } = JSON.parse(raw || '{}') as { email?: unknown });
  } catch {
    return jsonResponse(req, { error: 'invalid_request', message: 'Malformed request body.' }, 400);
  }

  if (typeof email !== 'string') {
    return jsonResponse(req, { error: 'invalid_request', message: 'An email address is required.' }, 400);
  }
  const normalised = email.trim().toLowerCase();
  if (
    normalised.length === 0 ||
    normalised.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(normalised)
  ) {
    return jsonResponse(
      req,
      { error: 'invalid_email', message: 'That does not look like an email address.' },
      400
    );
  }

  // An admin inviting themselves is a no-op that would send a confusing
  // "you have been invited" mail to the person who just sent it.
  if (normalised === userData.user.email?.toLowerCase()) {
    return jsonResponse(
      req,
      { error: 'already_admin', message: 'That is your own account — you are already an admin.' },
      409
    );
  }

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(normalised);

  if (inviteError) {
    // Unlike the login form, this endpoint is behind an admin JWT, so telling
    // the caller "already registered" is not a membership oracle for anyone
    // who could not already list the admins. It is the single most useful
    // thing we can say, so it is passed through rather than flattened.
    const alreadyExists =
      inviteError.status === 422 || /already (been )?registered|already exists/i.test(inviteError.message);
    if (alreadyExists) {
      return jsonResponse(
        req,
        { error: 'already_registered', message: 'That email already has an account.' },
        409
      );
    }
    console.warn('[invite-admin] invite failed:', inviteError.message);
    return jsonResponse(
      req,
      { error: 'invite_failed', message: 'Could not send the invite. Try again shortly.' },
      502
    );
  }

  // Deliberately does not echo the new user's id: the inviter has no use for
  // it and it is one less identifier on the wire.
  console.log('[invite-admin] invite sent by', inviterId);
  return jsonResponse(req, { invited: true, email: normalised });
});
