import {
  validateSetPassword,
  parseRequiredCharacters,
  missingCharacterClasses,
  MIN_PASSWORD_LENGTH,
  PASSWORD_REQUIRED_CHARACTERS,
  CODE_MAX_LENGTH,
} from '../logic';

// A valid baseline every test mutates one field of, so each case names
// exactly the thing it is testing and nothing else.
const VALID = {
  email: 'admin@sign2site.com.au',
  code: '123456',
  password: 'Correct-Horse-9',
  confirmPassword: 'Correct-Horse-9',
};

describe('validateSetPassword', () => {
  it('accepts a well-formed submission', () => {
    expect(validateSetPassword(VALID)).toEqual({ ok: true });
  });

  describe('email', () => {
    it('rejects an empty email with a prompt to enter one', () => {
      const result = validateSetPassword({ ...VALID, email: '   ' });
      expect(result).toEqual({
        ok: false,
        field: 'email',
        message: 'Enter the email the code was sent to.',
      });
    });

    it.each(['nodomain', 'no@tld', 'two words@example.com', '@example.com'])(
      'rejects %p as malformed',
      (email) => {
        const result = validateSetPassword({ ...VALID, email });
        expect(result).toMatchObject({ ok: false, field: 'email' });
      }
    );

    it.each(['a.b+tag@sub.example.co.uk', 'UPPER@EXAMPLE.COM'])(
      'accepts %p — the local part is deliberately permissive',
      (email) => {
        expect(validateSetPassword({ ...VALID, email })).toEqual({ ok: true });
      }
    );

    it('accepts an email padded with whitespace', () => {
      expect(validateSetPassword({ ...VALID, email: '  admin@example.com  ' })).toEqual({ ok: true });
    });
  });

  describe('code', () => {
    it.each([
      ['12345', 'five digits — below Supabase minimum'],
      ['12345678901', 'eleven digits — above Supabase maximum'],
      ['1234567a', 'a letter'],
      ['1234 5678', 'an inner space'],
      ['', 'empty'],
    ])('rejects %p (%s)', (code) => {
      expect(validateSetPassword({ ...VALID, code })).toMatchObject({ ok: false, field: 'code' });
    });

    // The length is the project's `mailer_otp_length` (6–10), not a constant.
    // This suite once pinned "seven digits is rejected", which made the
    // 6-only bug look like intended behaviour; the live project sends 8.
    it.each([
      ['123456', 'six — Supabase minimum'],
      ['12345678', 'eight — this project, read 2026-10-10'],
      ['1234567890', 'ten — Supabase maximum'],
    ])('accepts %p (%s)', (code) => {
      expect(validateSetPassword({ ...VALID, code })).toEqual({ ok: true });
    });

    it('allows the input to hold the longest valid code', () => {
      expect(CODE_MAX_LENGTH).toBe(10);
    });

    // Codes are pasted out of a mail client far more often than typed.
    it('accepts a code with surrounding whitespace', () => {
      expect(validateSetPassword({ ...VALID, code: ' 123456 ' })).toEqual({ ok: true });
    });

    it('reports the code before the password, so the user fixes the cheap thing first', () => {
      const result = validateSetPassword({ ...VALID, code: 'bad', password: 'x', confirmPassword: 'y' });
      expect(result).toMatchObject({ field: 'code' });
    });
  });

  describe('password', () => {
    // Pinned to the live GoTrue policy (`npm run auth:audit`, 2026-10-10).
    // If either pin fails, the dashboard setting changed or this file drifted
    // from it. Re-read the audit; do not just edit the number.
    it('mirrors the project policy: 12 characters minimum', () => {
      expect(MIN_PASSWORD_LENGTH).toBe(12);
    });

    it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH}`, () => {
      const short = 'Aa1!'.padEnd(MIN_PASSWORD_LENGTH - 1, 'a');
      expect(validateSetPassword({ ...VALID, password: short, confirmPassword: short })).toEqual({
        ok: false,
        field: 'password',
        message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    });

    it(`accepts a password of exactly ${MIN_PASSWORD_LENGTH}`, () => {
      const exact = 'Aa1!'.padEnd(MIN_PASSWORD_LENGTH, 'a');
      expect(validateSetPassword({ ...VALID, password: exact, confirmPassword: exact })).toEqual({ ok: true });
    });

    it.each([
      ['CORRECT-HORSE-9', 'a lowercase letter'],
      ['correct-horse-9', 'an uppercase letter'],
      ['Correct-Horse-x', 'a number'],
      ['CorrectHorse99', 'a symbol'],
    ])('rejects %p for missing %s, and names it', (password, missing) => {
      expect(validateSetPassword({ ...VALID, password, confirmPassword: password })).toEqual({
        ok: false,
        field: 'password',
        message: `Add ${missing}.`,
      });
    });

    it('names every missing class at once, so the user fixes it in one go', () => {
      const password = 'correcthorsebattery';
      expect(validateSetPassword({ ...VALID, password, confirmPassword: password })).toMatchObject({
        message: 'Add an uppercase letter, a number, a symbol.',
      });
    });

    // GoTrue checks each class against its own literal set. Anything outside
    // that set does not count as a symbol, so letting one through here would
    // spend the user's code on a password the server then refuses.
    it.each([
      ['CorrectHorse 99', 'a space'],
      ['CorrectHorse£99', 'a pound sign'],
      ['CorrectHorse—99', 'an em dash'],
    ])('does not count %p (%s) as a symbol', (password) => {
      expect(validateSetPassword({ ...VALID, password, confirmPassword: password })).toMatchObject({
        ok: false,
        message: 'Add a symbol.',
      });
    });

    it.each([['\\'], [':'], ['"'], ['`'], ['~']])(
      'counts %p as a symbol, matching the server set',
      (symbol) => {
        const password = `CorrectHorse9${symbol}`;
        expect(validateSetPassword({ ...VALID, password, confirmPassword: password })).toEqual({ ok: true });
      },
    );

    // Whitespace is a legitimate password character. Trimming here would set a
    // different password than the one typed, and the user's saved copy would
    // then silently fail to log them in.
    it('counts surrounding spaces toward the length, because they are kept', () => {
      const padded = ' Aa1!aaaaaa ';  // 12 only with both spaces
      expect(padded.trim().length).toBeLessThan(MIN_PASSWORD_LENGTH);
      expect(validateSetPassword({ ...VALID, password: padded, confirmPassword: padded })).toEqual({ ok: true });
    });

    it('preserves surrounding whitespace as significant', () => {
      const padded = ' Correct-Horse-9 ';
      expect(validateSetPassword({ ...VALID, password: padded, confirmPassword: padded })).toEqual({ ok: true });
      // ...and a confirm that was trimmed is therefore a genuine mismatch
      expect(validateSetPassword({ ...VALID, password: padded, confirmPassword: padded.trim() }))
        .toMatchObject({ ok: false, field: 'confirm' });
    });
  });

  describe('parseRequiredCharacters (port of GoTrue Decode)', () => {
    it('splits the live policy into exactly four classes', () => {
      expect(parseRequiredCharacters(PASSWORD_REQUIRED_CHARACTERS)).toEqual([
        'abcdefghijklmnopqrstuvwxyz',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        '0123456789',
        '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~',
      ]);
    });

    it('treats a backslash-escaped colon as a literal colon, not a separator', () => {
      expect(parseRequiredCharacters('ab:c\\:d')).toEqual(['ab', 'c:d']);
    });

    it('drops empty classes', () => {
      expect(parseRequiredCharacters('ab::cd:')).toEqual(['ab', 'cd']);
    });
  });

  describe('missingCharacterClasses', () => {
    it('reports nothing for a compliant password', () => {
      expect(missingCharacterClasses('Correct-Horse-9')).toEqual([]);
    });
  });

  describe('confirmation', () => {
    it('rejects a mismatch against the confirm field, not the password field', () => {
      expect(validateSetPassword({ ...VALID, confirmPassword: 'something-else' })).toEqual({
        ok: false,
        field: 'confirm',
        message: 'The two passwords do not match.',
      });
    });
  });
});
