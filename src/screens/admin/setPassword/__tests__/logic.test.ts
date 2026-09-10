import { validateSetPassword, MIN_PASSWORD_LENGTH } from '../logic';

// A valid baseline every test mutates one field of, so each case names
// exactly the thing it is testing and nothing else.
const VALID = {
  email: 'admin@sign2site.com.au',
  code: '123456',
  password: 'correct-horse',
  confirmPassword: 'correct-horse',
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
      ['12345', 'five digits'],
      ['1234567', 'seven digits'],
      ['12345a', 'a letter'],
      ['', 'empty'],
    ])('rejects %p (%s)', (code) => {
      expect(validateSetPassword({ ...VALID, code })).toMatchObject({ ok: false, field: 'code' });
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
    it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH}`, () => {
      const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
      expect(validateSetPassword({ ...VALID, password: short, confirmPassword: short })).toEqual({
        ok: false,
        field: 'password',
        message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    });

    it(`accepts a password of exactly ${MIN_PASSWORD_LENGTH}`, () => {
      const exact = 'a'.repeat(MIN_PASSWORD_LENGTH);
      expect(validateSetPassword({ ...VALID, password: exact, confirmPassword: exact })).toEqual({ ok: true });
    });

    // Whitespace is a legitimate password character. Trimming here would set a
    // different password than the one typed, and the user's saved copy would
    // then silently fail to log them in.
    it('does not trim the password when measuring length', () => {
      const padded = '   ';  // 3 chars, all spaces — under the minimum
      expect(validateSetPassword({ ...VALID, password: padded, confirmPassword: padded }))
        .toMatchObject({ ok: false, field: 'password' });
    });

    it('preserves surrounding whitespace as significant', () => {
      const padded = ' hunter2padded ';
      expect(validateSetPassword({ ...VALID, password: padded, confirmPassword: padded })).toEqual({ ok: true });
      // ...and a confirm that was trimmed is therefore a genuine mismatch
      expect(validateSetPassword({ ...VALID, password: padded, confirmPassword: padded.trim() }))
        .toMatchObject({ ok: false, field: 'confirm' });
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
