// Sign2Sign — delete-admin-account Edge Function
//
// Apple App Store guideline 5.1.1(v): apps that let users create an account
// must let them initiate account deletion from within the app. This function
// is the server-side endpoint the admin "Delete account" UI calls.
//
// Flow:
//   1. Client sends `Authorization: Bearer <admin access_token>`.
//   2. Function calls supabase.auth.getUser(token) with the anon key. That
//      verifies the JWT signature against the project's JWT secret and
//      returns the authenticated user, or null/error if the token is
//      missing, expired, or for a different project.
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
//
// We DO want JWT verification here (the default), unlike validate-code:
// only an authenticated admin should be able to delete their own account.

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
