// Pure helpers for two-step sign-in (TOTP) screens. No React, no Supabase:
// unit-tested in __tests__/twoStep.logic.test.ts.

// Supabase returns the QR code as SVG markup. Its docs say to prepend a data
// URI prefix; some versions already return one. Handle both, and percent-encode
// the markup so characters such as '#' cannot end the URI early.
export function qrImageUri(qrCode: string): string {
  if (qrCode.startsWith('data:')) return qrCode;
  return `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`;
}

// The setup key is typed by hand when a QR scan is not possible (the iPhone
// running the authenticator is usually the one showing the screen). Groups of
// four are how Google Authenticator, 1Password and Microsoft Authenticator
// all display it, and are far easier to copy without losing your place.
export function formatSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

// Strips the spaces and dashes people paste in from authenticator apps that
// display "123 456".
export function normaliseTotpInput(text: string): string {
  return text.replace(/[\s-]/g, '').slice(0, 6);
}

export type ReauthKind = 'password' | 'code';

// Which proof the sudo prompt should ask for. With two-step sign-in on, the
// authenticator code is the stronger and only sufficient proof: a fresh
// password sign-in would drop the session to aal1, which the Edge Functions
// then refuse as mfa_required.
export function reauthKindFor(hasVerifiedFactor: boolean, serverCode: 'reauth_required' | 'mfa_required'): ReauthKind {
  if (serverCode === 'mfa_required') return 'code';
  return hasVerifiedFactor ? 'code' : 'password';
}
