// Set-password form validation, extracted from SetPasswordScreen so it can be
// tested without rendering a screen (the importDate.logic.ts pattern).
//
// This is a courtesy layer, not a security boundary. GoTrue re-validates the
// code and the password server-side and is the only authority on either; the
// point of validating here is to spend a round trip — and one of the user's
// limited code attempts — only on input that could plausibly succeed.

import { isLikelyEmail } from '../../../utils/email';

export type SetPasswordField = 'email' | 'code' | 'password' | 'confirm';

export type SetPasswordValidation =
  | { ok: true }
  | { ok: false; field: SetPasswordField; message: string };

export interface SetPasswordInput {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
}

// GoTrue emails a six-digit {{ .Token }}.
const CODE_PATTERN = /^\d{6}$/;

// NIST SP 800-63B §5.1.1.2 sets 8 characters as the floor for a user-chosen
// secret and explicitly advises against composition rules (mandatory symbols,
// mixed case), which push users toward predictable substitutions. Length is
// the only rule here for that reason.
//
// This is stricter than the GoTrue default of 6 on purpose: if the project's
// own minimum is ever raised in the dashboard, the server rejects and its
// message is passed through — this constant only ever fails input early, it
// can never let through something the server would refuse for being short.
export const MIN_PASSWORD_LENGTH = 8;

export function validateSetPassword(input: SetPasswordInput): SetPasswordValidation {
  const email = input.email.trim();
  if (email.length === 0) {
    return { ok: false, field: 'email', message: 'Enter the email the code was sent to.' };
  }
  if (!isLikelyEmail(email)) {
    return { ok: false, field: 'email', message: 'That does not look like an email address.' };
  }

  // Trimmed before testing: the six digits are usually pasted or copied out of
  // a mail client, which very often brings a trailing space with them.
  if (!CODE_PATTERN.test(input.code.trim())) {
    return { ok: false, field: 'code', message: 'The code is the 6 digits from the email.' };
  }

  // Never trimmed. A leading or trailing space is a legitimate character in a
  // password, and silently stripping it here would set a different password
  // than the one the user typed — after which their password manager's copy
  // no longer works and nothing explains why.
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: 'password',
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, field: 'confirm', message: 'The two passwords do not match.' };
  }

  return { ok: true };
}
