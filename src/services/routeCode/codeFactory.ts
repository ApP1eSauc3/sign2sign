import { getRandomValues } from '../../utils/random';

// Cryptographically secure 6-digit code generator. Math.random() is biased
// and predictable across modern V8 with enough samples — fatal when the
// generated value IS the driver credential.
//
// This used to read the `crypto` global directly, guarded by a comment
// claiming "available globally in both Hermes (RN 0.76+) and the Electron
// renderer". The Electron half was true; the Hermes half was not, and RN 0.83
// ships no `crypto` at all. Only the Electron admin build ever exercised this,
// so the iOS admin app would have thrown here. Now via utils/random.
export function generateSixDigitCode(): string {
  // Reject values outside the largest multiple of 900000 that fits in Uint32
  // so the modulo is unbiased.
  const LIMIT = Math.floor(0xffffffff / 900000) * 900000;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    getRandomValues(buf);
    v = buf[0];
  } while (v >= LIMIT);
  return (100000 + (v % 900000)).toString();
}

// Local calendar date as YYYY-MM-DD. NEVER use toISOString().split('T')[0]
// here — that is the UTC date, and Perth is UTC+8: codes generated before
// 08:00 local would be stamped with *yesterday's* date, vanish from the
// dashboard at 08:00, and dodge the regeneration deactivation filter
// (leaving two live codes per slot). created_date is a local business-day
// label; expiry and validation always use the absolute expires_at instant.
export function localDateString(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function expiryNextMorning(): string {
  // Expire at 06:00 the following morning rather than 23:59 tonight.
  // Drivers finishing late jobs or working past midnight are not locked out
  // mid-shift. The code is still single-day — it expires before the next
  // morning's batch is generated.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}
