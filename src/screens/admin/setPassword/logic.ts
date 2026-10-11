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

// GoTrue emails a numeric {{ .Token }} whose length is a project setting,
// `mailer_otp_length`, not a constant. Supabase allows 6–10, and this project
// was read at 8 on 2026-10-10 (`npm run auth:audit`). The original /^\d{6}$/
// meant no real code could ever pass. Accepting the whole range keeps the
// screen correct if the setting changes, and the server stays the real check:
// a wrong-length code is still refused by verifyOtp.
export const CODE_MIN_LENGTH = 6;
export const CODE_MAX_LENGTH = 10;
const CODE_PATTERN = new RegExp(`^\\d{${CODE_MIN_LENGTH},${CODE_MAX_LENGTH}}$`);

// These rules MIRROR the project's live GoTrue password policy. They do not
// set it. Read with `npm run auth:audit` on 2026-10-10:
//   password_min_length          12
//   password_required_characters (the raw string below)
//   password_hibp_enabled        true  (cannot be mirrored: server only)
//
// Decision (Liam, 2026-10-10): keep the server's policy, composition rules
// included, and match it here. NIST SP 800-63B advises against composition
// rules, and that trade-off was weighed and declined. Do not "fix" this back
// to length-only while the server still enforces composition.
//
// Why the client checks at all: verifyOtp spends the emailed code BEFORE
// updateUser applies the policy, so a password the server will refuse costs
// the user their code, and a new one is capped at 2 emails an hour. This
// check only ever fails input early. HIBP and any future server rule still
// reject at updateUser, and that message is shown to the user.
//
// If the policy changes in the dashboard, re-run `npm run auth:audit` and
// paste the new values here. The tests pin both.
export const MIN_PASSWORD_LENGTH = 12;

// Copied verbatim from the config (JSON-unescaped). Colons separate the
// classes, and a backslash before a colon makes that colon literal.
export const PASSWORD_REQUIRED_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:' +
  '!@#$%^&*()_+-=[]{};\'\\\\:"|<>?,./`~';

// A port of GoTrue's PasswordRequiredCharacters.Decode
// (supabase/auth internal/conf/configuration.go, read 2026-10-10). It is
// ported rather than hand-split because the symbol class contains a literal
// "\" and ":", which are exactly the characters a by-eye split gets wrong.
export function parseRequiredCharacters(value: string): string[] {
  const parts = value.split(':');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (part === '') continue;
    if (part.endsWith('\\')) {
      parts[i] = part.slice(0, -1) + ':' + parts[i + 1];
      parts[i + 1] = '';
    }
  }
  return parts.filter((part) => part !== '');
}

const REQUIRED_CLASSES = parseRequiredCharacters(PASSWORD_REQUIRED_CHARACTERS);

// Index-aligned with REQUIRED_CLASSES, for a message that names what is
// missing rather than reciting the server's character lists.
const CLASS_NAMES = ['a lowercase letter', 'an uppercase letter', 'a number', 'a symbol'];

// Every class needs at least one character from its own set, exactly as GoTrue
// checks it. A space, "£" or "é" is NOT a symbol here, so the client must not
// treat one as a symbol either.
export function missingCharacterClasses(password: string): string[] {
  const chars = [...password];
  return REQUIRED_CLASSES
    .map((set, i) => (chars.some((c) => set.includes(c)) ? null : CLASS_NAMES[i] ?? `one of ${set}`))
    .filter((name): name is string => name !== null);
}

export const PASSWORD_RULE_HINT =
  `Passwords need at least ${MIN_PASSWORD_LENGTH} characters, with upper and lower case, a number and a symbol.`;

export function validateSetPassword(input: SetPasswordInput): SetPasswordValidation {
  const email = input.email.trim();
  if (email.length === 0) {
    return { ok: false, field: 'email', message: 'Enter the email the code was sent to.' };
  }
  if (!isLikelyEmail(email)) {
    return { ok: false, field: 'email', message: 'That does not look like an email address.' };
  }

  // Trimmed before testing: the code is usually pasted or copied out of
  // a mail client, which very often brings a trailing space with them.
  if (!CODE_PATTERN.test(input.code.trim())) {
    return { ok: false, field: 'code', message: 'Enter the code from the email — digits only.' };
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
  const missing = missingCharacterClasses(input.password);
  if (missing.length > 0) {
    return {
      ok: false,
      field: 'password',
      message: `Add ${missing.join(', ')}.`,
    };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, field: 'confirm', message: 'The two passwords do not match.' };
  }

  return { ok: true };
}
