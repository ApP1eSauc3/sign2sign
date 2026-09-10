// Shared email-shape check.
//
// Used by the set-password form and the admin-invite form, and deliberately
// kept identical to the pattern in supabase/functions/invite-admin/index.ts —
// a client that accepts what the server rejects produces an error the user
// cannot act on.
//
// Permissive about the local part on purpose. RFC 5321 allows far more than
// people expect (quoted strings, '+' tags, unicode), and every regex that
// tries to be exhaustive ends up rejecting somebody's real address. The mail
// server is the only true validator; this exists to catch the typo class —
// missing '@', missing dot, stray whitespace — before a round trip is spent.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// RFC 5321 §4.5.3.1.3 caps a forward-path at 254 octets.
export const MAX_EMAIL_LENGTH = 254;

export function isLikelyEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(trimmed);
}
