// "Sudo mode" for destructive admin actions (account deletion, inviting an
// admin): a valid session is not enough, the user must have proved who they
// are in the last few minutes. Closes S-2 in
// docs/SECURITY_CHECKLIST_CROSSCHECK_2026_10_11.md.
//
// How "recent" is known: the access token's `amr` claim lists each way this
// session was authenticated, with a Unix timestamp. Supabase Auth stores those
// per session (mfa_amr_claims) and only moves a timestamp when the user
// authenticates that way again; a token refresh does not touch it (checked in
// supabase/auth internal/models/sessions.go CalculateAALAndAMR and amr.go
// AddClaimToSession, 2026-10-11). So a stolen refresh token cannot make a
// session look freshly authenticated.
//
// The app re-proves identity right before the call:
//   * no MFA:   signInWithPassword again  → fresh `password` entry
//   * with MFA: verify a TOTP code         → fresh `totp` entry, session aal2
//
// The JWT has already been verified (gateway verify_jwt + auth.getUser) by the
// time this runs, so decoding the payload without checking the signature is
// safe here and only here.

export const REAUTH_WINDOW_SECONDS = 5 * 60;
// Tolerate a little clock skew between Auth and the function host.
const FUTURE_SKEW_SECONDS = 60;
const STRONG_METHODS = new Set(['password', 'totp']);

type AmrEntry = { method?: unknown; timestamp?: unknown };
export type JwtPayload = { aal?: unknown; amr?: unknown };

export type RecentAuthResult =
  | { ok: true }
  | { ok: false; error: 'mfa_required' | 'reauth_required'; message: string };

export function decodeJwtPayload(token: string): JwtPayload | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export function checkRecentAuth(
  payload: JwtPayload,
  hasVerifiedFactor: boolean,
  nowSeconds: number,
): RecentAuthResult {
  // An admin who turned on two-step sign-in must be at aal2 for this, even if
  // their password is fresh: a stolen password alone must not be enough.
  if (hasVerifiedFactor && payload.aal !== 'aal2') {
    return {
      ok: false,
      error: 'mfa_required',
      message: 'Enter the code from your authenticator app to continue.',
    };
  }

  const amr = Array.isArray(payload.amr) ? (payload.amr as AmrEntry[]) : [];
  const recent = amr.some((entry) => {
    if (typeof entry?.method !== 'string' || !STRONG_METHODS.has(entry.method)) return false;
    if (typeof entry.timestamp !== 'number') return false;
    const age = nowSeconds - entry.timestamp;
    return age <= REAUTH_WINDOW_SECONDS && age >= -FUTURE_SKEW_SECONDS;
  });
  if (recent) return { ok: true };

  return {
    ok: false,
    error: 'reauth_required',
    message: hasVerifiedFactor
      ? 'Enter the code from your authenticator app to continue.'
      : 'Enter your password to continue.',
  };
}
