import * as fs from 'fs';
import * as path from 'path';
import { isLikelyEmail, MAX_EMAIL_LENGTH } from '../email';

describe('isLikelyEmail', () => {
  it.each([
    'admin@sign2site.com.au',
    'a.b+tag@sub.example.co.uk',
    'UPPER@EXAMPLE.COM',
    "o'brien@example.com",
  ])('accepts %p', (value) => {
    expect(isLikelyEmail(value)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['nodomain', 'no @'],
    ['no@tld', 'no dot in the domain'],
    ['two words@example.com', 'internal space'],
    ['@example.com', 'no local part'],
    ['a@', 'no domain'],
    ['a@b.', 'trailing dot'],
    ['a@.b', 'empty domain label'],
  ])('rejects %p (%s)', (value) => {
    expect(isLikelyEmail(value)).toBe(false);
  });

  it('trims before judging', () => {
    expect(isLikelyEmail('  admin@example.com  ')).toBe(true);
  });

  describe('length', () => {
    // RFC 5321 §4.5.3.1.3 caps a forward-path at 254 octets.
    const domain = '@example.com';
    const local = (n: number) => 'a'.repeat(n);

    it(`accepts exactly ${MAX_EMAIL_LENGTH}`, () => {
      const addr = local(MAX_EMAIL_LENGTH - domain.length) + domain;
      expect(addr).toHaveLength(MAX_EMAIL_LENGTH);
      expect(isLikelyEmail(addr)).toBe(true);
    });

    it(`rejects ${MAX_EMAIL_LENGTH + 1}`, () => {
      const addr = local(MAX_EMAIL_LENGTH + 1 - domain.length) + domain;
      expect(addr).toHaveLength(MAX_EMAIL_LENGTH + 1);
      expect(isLikelyEmail(addr)).toBe(false);
    });
  });
});

// A client that accepts what the server rejects produces an error the user
// cannot act on — they retype a valid-looking address and get the same
// refusal. The two checks are written in two languages in two files that no
// compiler links, so this asserts the pair by reading the deployed source.
//
// If this fails, do NOT relax it: change both sides together.
describe('parity with the invite-admin Edge Function', () => {
  const FUNCTION_SOURCE = path.join(
    __dirname, '..', '..', '..', 'supabase', 'functions', 'invite-admin', 'index.ts'
  );

  function readFunctionSource(): string {
    const src = fs.readFileSync(FUNCTION_SOURCE, 'utf8');
    // Guard against the false-pass this repo has been bitten by before: an
    // empty or moved file must fail loudly, not silently match nothing.
    expect(src.length).toBeGreaterThan(500);
    return src;
  }

  it('uses the same email pattern on both sides', () => {
    const src = readFunctionSource();
    const match = /const EMAIL_PATTERN = (\/.+\/);/.exec(src);
    expect(match).not.toBeNull();

    // Compare against the pattern this module actually applies, read off a
    // real rejection rather than a copy of the literal.
    const serverPattern = match![1];
    expect(serverPattern).toBe('/^[^\\s@]+@[^\\s@.]+(\\.[^\\s@.]+)+$/');
  });

  it('uses the same 254-octet cap on both sides', () => {
    const src = readFunctionSource();
    const match = /const MAX_EMAIL_LENGTH = (\d+);/.exec(src);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(MAX_EMAIL_LENGTH);
  });

  // The server lowercases before validating and before inviting; the client
  // lowercases before sending. Neither may start trimming the *password*.
  it('normalises the address to lowercase before inviting', () => {
    const src = readFunctionSource();
    expect(src).toContain('email.trim().toLowerCase()');
  });
});
