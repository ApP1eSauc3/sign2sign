import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';
import * as mfa from './auth/mfa';

// `code` is set only when the caller can act on it: the admin Edge Functions
// answer 403 with one of these when the session is not fresh enough for a
// destructive action (supabase/functions/_shared/recentAuth.ts). The screen
// then asks for the password or authenticator code and retries.
export type ReauthCode = 'reauth_required' | 'mfa_required';
export type AuthError = { message: string; code?: ReauthCode };

// What the Account screen needs to start authenticator-app enrolment. The
// secret and URI are shown to the user once and never stored or logged
// (auth-js asks the same of its own callers).
export type MfaEnrollment = { factorId: string; qrCode: string; secret: string; uri: string };


// Shared transport for the admin-only Edge Functions. Both of them take a
// bearer admin JWT and return either a JSON body or an error shape; the
// only differences are the function name and the optional body, so the
// fetch/ok/parse dance lives here once.
//
// Returns null on success. On failure it prefers the function's own
// `message`, then its `error` code, then the status line — Edge Functions
// in this repo always send `{ error, message? }`.
async function callAdminFunction(name: string, body?: unknown): Promise<AuthError | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { message: 'You are not signed in.' };

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        // apikey is required by the Supabase gateway; Authorization carries
        // the admin's JWT so the function can identify the caller.
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e: unknown) {
    return { message: e instanceof Error ? e.message : 'Network error.' };
  }

  if (!response.ok) {
    let detail = `Server returned ${response.status}.`;
    let code: ReauthCode | undefined;
    try {
      const parsed = await response.json() as { message?: string; error?: string };
      if (parsed.message) detail = parsed.message;
      else if (parsed.error) detail = parsed.error;
      if (response.status === 403 && (parsed.error === 'reauth_required' || parsed.error === 'mfa_required')) {
        code = parsed.error;
      }
    } catch { /* keep the status-line detail */ }
    return code ? { message: detail, code } : { message: detail };
  }

  return null;
}

export const AuthService = {
  // Every failure returns the same string. Supabase's own "Invalid login
  // credentials" is already generic, but "Email not confirmed" is not — it
  // confirms the address is registered, which turns the login form into a
  // membership oracle. One message for every failure closes that.
  //
  // The real reason still needs to reach someone, so it goes to the console
  // for now. When security-event logging lands this is the call site that
  // should emit auth.login.failed with a reason class.
  async signIn(email: string, password: string): Promise<AuthError | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return null;
    console.warn('[auth] sign-in failed:', error.message);
    return { message: 'Invalid email or password.' };
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  },

  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  // Asks GoTrue to email a recovery token. Public sign-up is disabled, so this
  // is the only self-serve recovery path an admin has; before it existed,
  // getting back in required Supabase dashboard access (open-work #29).
  //
  // ALWAYS resolves null, even when GoTrue refuses. Three different failures —
  // "no such user", the per-address 429 ("you can only request this after N
  // seconds"), and SMTP trouble — each identify a registered address to anyone
  // who can read the response, which turns this form into the membership
  // oracle that signIn was deliberately written to close. The caller shows one
  // neutral "if that address has an account…" message on every outcome.
  //
  // The cost of that choice: a genuinely offline admin sees the same reassuring
  // message and waits for a code that was never sent. Accepted — retrying is
  // cheap, and the console line below is the trail for anyone debugging it.
  //
  // No `redirectTo` is passed. The reset is completed in-app with the numeric
  // {{ .Token }} from the email, never by following the link, so there is no
  // redirect URL to allowlist and no deep-link handler to maintain.
  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (error) console.warn('[auth] password reset request failed:', error.message);
  },

  // Second half of both email-code flows: exchange the emailed code for a
  // session, then set the password on it.
  //
  // `type` selects which flow. They are the same two API calls in the same
  // order, and differ only in which GoTrue token table the code came from:
  //   'recovery' — a "forgot password" code, for an existing account.
  //   'invite'   — a first-time code from invite-admin, for an account that
  //                exists with no password yet.
  //
  // On success the caller is left holding a live session — verifyOtp issues
  // one — so the screen can go straight to the dashboard rather than bouncing
  // through the login form with credentials the user just typed.
  async completePasswordReset(params: {
    email: string;
    code: string;
    newPassword: string;
    type: 'recovery' | 'invite';
  }): Promise<AuthError | null> {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: params.email.trim().toLowerCase(),
      token: params.code.trim(),
      type: params.type,
    });
    if (verifyError) {
      // Already generic — GoTrue does not distinguish "wrong code" from
      // "no such code" here, so this leaks nothing and needs no flattening.
      console.warn('[auth] code verification failed:', verifyError.message);
      return { message: 'That code is invalid or has expired. Request a new one.' };
    }

    // An admin with two-step sign-in on is only at aal1 here, and GoTrue
    // refuses a password change below aal2 for them (supabase/auth
    // internal/api/user.go: "AAL2 session is required to update email or
    // password when MFA is enabled"). Keep the session (the emailed code is
    // already spent) and let the screen collect the authenticator code; the
    // password is set by completePasswordResetWithMfa.
    if (await mfa.needsMfaChallenge()) {
      return {
        message: 'Two-step sign-in is on for this account. Enter the 6-digit code from your authenticator app to finish.',
        code: 'mfa_required',
      };
    }

    return setNewPassword(params.newPassword);
  },

  // Second half of a reset for an admin with two-step sign-in on: lift the
  // session to aal2 with the authenticator code, then set the password. A
  // wrong code keeps the session so they can retry without a new email.
  async completePasswordResetWithMfa(params: { totp: string; newPassword: string }): Promise<AuthError | null> {
    const mfaError = await mfa.verifyMfaCode(params.totp);
    if (mfaError) return mfaError;
    return setNewPassword(params.newPassword);
  },

  // Calls the delete-admin-account Edge Function, which validates the bearer
  // JWT and removes the row from auth.users via the service role. On success,
  // clears the local session — supabase.auth.signOut() would 401 against the
  // now-deleted user, so we drop the session directly instead.
  async deleteAccount(): Promise<AuthError | null> {
    const err = await callAdminFunction('delete-admin-account');
    if (err) return err;

    // Drop the local session — the auth.users row is gone, so any further
    // call with this access token would 401.
    await supabase.auth.signOut().catch(() => { /* expected to 401 */ });
    return null;
  },

  // Calls the invite-admin Edge Function, which re-resolves the caller as a
  // real auth.users row and then issues auth.admin.inviteUserByEmail via the
  // service role. Public sign-up is disabled on this project, so this is the
  // only way a second admin account comes into existence.
  //
  // Unlike signIn, the error text here is NOT flattened. The caller has
  // already proved they are an admin, so "that email already has an account"
  // tells them nothing they could not learn another way, and it is the one
  // response that stops them re-sending an invite that will never arrive.
  async inviteAdmin(email: string): Promise<AuthError | null> {
    return callAdminFunction('invite-admin', { email: email.trim().toLowerCase() });
  },

  // ─── Two-step sign-in (TOTP) — bodies in ./auth/mfa.ts ─────────────────
  needsMfaChallenge: mfa.needsMfaChallenge,
  hasVerifiedFactor: mfa.hasVerifiedFactor,
  verifyMfaCode: mfa.verifyMfaCode,
  startMfaEnrollment: mfa.startMfaEnrollment,
  confirmMfaEnrollment: mfa.confirmMfaEnrollment,
  disableMfa: mfa.disableMfa,

  // Re-proves identity right before a destructive action (sudo mode). With
  // two-step sign-in on, the authenticator code is the proof; otherwise the
  // password, by signing in again as the same user, which gives the session a
  // fresh `password` timestamp that the Edge Function checks.
  async reauthenticate(proof: { password?: string; code?: string }): Promise<AuthError | null> {
    if (proof.code !== undefined) return mfa.verifyMfaCode(proof.code);

    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user.email;
    if (!email) return { message: 'You are not signed in.' };
    const { error } = await supabase.auth.signInWithPassword({ email, password: proof.password ?? '' });
    if (error) {
      console.warn('[auth] re-authentication failed:', error.message);
      return { message: 'That password is not correct.' };
    }
    return null;
  },
};

// The last step of every email-code flow.
async function setNewPassword(newPassword: string): Promise<AuthError | null> {
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    // verifyOtp already minted a session. Leaving it in place would hand the
    // user a signed-in app whose password is still the old one — or, on the
    // invite path, an account with no password at all that can never be
    // signed into again. Drop it so the only way forward is a fresh code.
    await supabase.auth.signOut().catch(() => { /* best effort */ });
    console.warn('[auth] password update failed:', updateError.message);
    // Passed through, not flattened: these are validation messages about the
    // password the user just chose ("should be at least 6 characters"), and
    // the user is already authenticated at this point.
    return { message: updateError.message };
  }
  return null;
}
