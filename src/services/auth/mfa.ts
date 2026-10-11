// Two-step sign-in (TOTP) internals for AuthService. AuthService is the
// facade and keeps every public method name; this file holds the bodies so
// the facade stays under the 300-line cap (src/services/CLAUDE.md →
// "Splitting a service"). Optional per admin (Liam, 2026-10-11). Once an admin
// has a verified factor, migration 018 makes the database refuse their
// session until it reaches aal2.
import { supabase } from '../supabaseClient';
import type { AuthError, MfaEnrollment } from '../AuthService';

const TOTP_CODE = /^\d{6}$/;

// True when this session has a password but still owes an authenticator
// code: Supabase reports nextLevel aal2 above currentLevel. Any error is
// treated as "no challenge needed": the database is the enforcement point,
// and a false negative only means the dashboard loads empty, never that
// data is exposed.
export async function needsMfaChallenge(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

export async function hasVerifiedFactor(): Promise<boolean> {
  return (await verifiedTotpFactorId()) !== null;
}

// Promotes the session to aal2 (or refreshes its totp timestamp, which is
// what the Edge Functions' recent-auth check reads).
export async function verifyMfaCode(code: string): Promise<AuthError | null> {
  const trimmed = code.trim();
  if (!TOTP_CODE.test(trimmed)) return { message: 'Enter the 6-digit code from your authenticator app.' };
  const factorId = await verifiedTotpFactorId();
  if (!factorId) return { message: 'Two-step sign-in is not set up on this account.' };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: trimmed });
  if (error) {
    console.warn('[auth] mfa verify failed:', error.message);
    return { message: 'That code is not correct. Codes change every 30 seconds — try the current one.' };
  }
  return null;
}

// Step 1 of turning it on. Clears any half-finished enrolment first, so an
// admin who abandoned the QR screen can start again cleanly instead of
// piling up unverified factors (Supabase allows only a few).
export async function startMfaEnrollment(): Promise<MfaEnrollment | AuthError> {
  const { data: listed, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { message: 'Could not start two-step sign-in. Try again.' };
  for (const factor of listed?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Sign2Sign authenticator',
    issuer: 'Sign2Sign',
  });
  if (error || !data) {
    console.warn('[auth] mfa enroll failed:', error?.message);
    return { message: 'Could not start two-step sign-in. Try again.' };
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

// Step 2: the first code proves the authenticator app is set up correctly.
// Supabase then marks the factor verified, signs out the admin's OTHER
// sessions, and promotes this one to aal2.
export async function confirmMfaEnrollment(factorId: string, code: string): Promise<AuthError | null> {
  const trimmed = code.trim();
  if (!TOTP_CODE.test(trimmed)) return { message: 'Enter the 6-digit code from your authenticator app.' };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: trimmed });
  if (error) {
    console.warn('[auth] mfa enroll verify failed:', error.message);
    return { message: 'That code is not correct. Check the app shows "Sign2Sign" and try the current code.' };
  }
  return null;
}

// Turning it off takes a current code, the same as GitHub's sudo prompt: a
// borrowed, unlocked laptop must not be enough to strip the second factor.
export async function disableMfa(code: string): Promise<AuthError | null> {
  const verifyError = await verifyMfaCode(code);
  if (verifyError) return verifyError;
  const factorId = await verifiedTotpFactorId();
  if (!factorId) return null;
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    console.warn('[auth] mfa unenroll failed:', error.message);
    return { message: 'Could not turn off two-step sign-in. Try again.' };
  }
  return null;
}

export async function verifiedTotpFactorId(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  return data.totp[0]?.id ?? null;
}
