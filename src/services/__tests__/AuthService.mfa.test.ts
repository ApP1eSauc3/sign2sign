import { AuthService } from '../AuthService';
import { supabase } from '../supabaseClient';

// Same seam as AuthService.test.ts, plus supabase.auth.mfa.
jest.mock('../supabaseClient', () => ({
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-123',
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      getSession: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
      signOut: jest.fn(),
      mfa: {
        getAuthenticatorAssuranceLevel: jest.fn(),
        listFactors: jest.fn(),
        enroll: jest.fn(),
        challengeAndVerify: jest.fn(),
        unenroll: jest.fn(),
      },
    },
  },
}));

const auth = supabase.auth as unknown as {
  signInWithPassword: jest.Mock;
  getSession: jest.Mock;
  verifyOtp: jest.Mock;
  updateUser: jest.Mock;
  signOut: jest.Mock;
  mfa: Record<'getAuthenticatorAssuranceLevel' | 'listFactors' | 'enroll' | 'challengeAndVerify' | 'unenroll', jest.Mock>;
};

const VERIFIED = { id: 'f-verified', factor_type: 'totp', status: 'verified' };
const UNVERIFIED = { id: 'f-stale', factor_type: 'totp', status: 'unverified' };
const factors = (...all: object[]) => ({
  data: { all, totp: all.filter((f) => (f as { status: string }).status === 'verified'), phone: [] },
  error: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt', user: { id: 'u1', email: 'a@b.com' } } } });
  auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  auth.mfa.unenroll.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('needsMfaChallenge', () => {
  it('is true when the session is aal1 and the account can reach aal2', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
    await expect(AuthService.needsMfaChallenge()).resolves.toBe(true);
  });

  it('is false once the session is aal2', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    await expect(AuthService.needsMfaChallenge()).resolves.toBe(false);
  });

  it('is false for an admin without a factor (MFA is optional)', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    await expect(AuthService.needsMfaChallenge()).resolves.toBe(false);
  });

  // The database (migration 018) is the enforcement point; a lookup failure
  // here must not lock an admin out of the app.
  it('is false when the lookup fails', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(AuthService.needsMfaChallenge()).resolves.toBe(false);
  });
});

describe('verifyMfaCode', () => {
  it('verifies the code against the verified TOTP factor', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(UNVERIFIED, VERIFIED));
    await expect(AuthService.verifyMfaCode(' 123456 ')).resolves.toBeNull();
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-verified', code: '123456' });
  });

  it.each(['12345', '1234567', 'abcdef', ''])('rejects %p without calling Supabase', async (code) => {
    const result = await AuthService.verifyMfaCode(code);
    expect(result?.message).toMatch(/6-digit code/);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('says so when the account has no factor', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(UNVERIFIED));
    expect((await AuthService.verifyMfaCode('123456'))?.message).toMatch(/not set up/);
  });

  it('returns a friendly message for a wrong code', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code entered' } });
    expect((await AuthService.verifyMfaCode('000000'))?.message).toMatch(/not correct/);
  });
});

describe('startMfaEnrollment', () => {
  it('clears abandoned unverified factors before enrolling a new one', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(UNVERIFIED));
    auth.mfa.enroll.mockResolvedValue({
      data: { id: 'f-new', totp: { qr_code: '<svg/>', secret: 'SECRET', uri: 'otpauth://totp/x' } },
      error: null,
    });
    const result = await AuthService.startMfaEnrollment();
    expect(auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-stale' });
    expect(auth.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Sign2Site authenticator', issuer: 'Sign2Site' });
    expect(result).toEqual({ factorId: 'f-new', qrCode: '<svg/>', secret: 'SECRET', uri: 'otpauth://totp/x' });
  });

  it('never unenrolls a verified factor while starting', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    auth.mfa.enroll.mockResolvedValue({ data: { id: 'f', totp: { qr_code: '', secret: '', uri: '' } }, error: null });
    await AuthService.startMfaEnrollment();
    expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it('returns an error object when enrolment fails', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors());
    auth.mfa.enroll.mockResolvedValue({ data: null, error: { message: 'too many factors' } });
    expect(await AuthService.startMfaEnrollment()).toEqual({ message: 'Could not start two-step sign-in. Try again.' });
  });
});

describe('confirmMfaEnrollment', () => {
  it('verifies the first code against the new factor', async () => {
    await expect(AuthService.confirmMfaEnrollment('f-new', '654321')).resolves.toBeNull();
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-new', code: '654321' });
  });

  it('rejects a malformed code locally', async () => {
    expect((await AuthService.confirmMfaEnrollment('f-new', '65'))?.message).toMatch(/6-digit/);
  });
});

describe('disableMfa', () => {
  it('requires a correct current code before removing the factor', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid' } });
    expect((await AuthService.disableMfa('000000'))?.message).toMatch(/not correct/);
    expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it('removes the factor after a correct code', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    await expect(AuthService.disableMfa('123456')).resolves.toBeNull();
    expect(auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-verified' });
  });
});

describe('reauthenticate', () => {
  it('signs in again as the current user with the password', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(AuthService.reauthenticate({ password: 'pw' })).resolves.toBeNull();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw' });
  });

  it('flattens a wrong password to one message', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    expect(await AuthService.reauthenticate({ password: 'nope' })).toEqual({ message: 'That password is not correct.' });
  });

  it('uses the authenticator code when one is given', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    await expect(AuthService.reauthenticate({ code: '123456' })).resolves.toBeNull();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalled();
  });

  it('refuses when there is no signed-in user', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await AuthService.reauthenticate({ password: 'pw' })).toEqual({ message: 'You are not signed in.' });
  });
});

describe('admin functions: stale-session answers', () => {
  function respond(status: number, body: unknown) {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: status < 300, status, json: async () => body });
  }

  it.each(['reauth_required', 'mfa_required'])('surfaces a 403 %s as a typed code the screen can act on', async (error) => {
    respond(403, { error, message: 'Enter your password to continue.' });
    expect(await AuthService.inviteAdmin('x@y.com')).toEqual({ message: 'Enter your password to continue.', code: error });
  });

  it('does not attach a code to other errors', async () => {
    respond(409, { error: 'already_registered', message: 'That email already has an account.' });
    expect(await AuthService.inviteAdmin('x@y.com')).toEqual({ message: 'That email already has an account.' });
  });

  it('keeps an unrecognised 403 untyped', async () => {
    respond(403, { error: 'forbidden' });
    expect(await AuthService.deleteAccount()).toEqual({ message: 'forbidden' });
  });
});

// GoTrue refuses a password change below aal2 for an account with MFA
// (internal/api/user.go), and an emailed recovery code only reaches aal1.
describe('password reset for an admin with two-step sign-in', () => {
  const RESET = { email: 'a@b.com', code: '12345678', newPassword: 'Correct-Horse-9!', type: 'recovery' as const };

  beforeEach(() => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it('stops after the emailed code and asks for the authenticator code, keeping the session', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
    const result = await AuthService.completePasswordReset(RESET);
    expect(result).toEqual(expect.objectContaining({ code: 'mfa_required' }));
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('sets the password straight away for an admin without MFA', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    await expect(AuthService.completePasswordReset(RESET)).resolves.toBeNull();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Correct-Horse-9!' });
  });

  it('finishes with the authenticator code: verify first, then set the password', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    await expect(AuthService.completePasswordResetWithMfa({ totp: '123456', newPassword: 'Correct-Horse-9!' })).resolves.toBeNull();
    expect(auth.mfa.challengeAndVerify.mock.invocationCallOrder[0])
      .toBeLessThan(auth.updateUser.mock.invocationCallOrder[0]);
  });

  it('a wrong authenticator code keeps the session for another try', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid' } });
    const result = await AuthService.completePasswordResetWithMfa({ totp: '000000', newPassword: 'x' });
    expect(result?.message).toMatch(/not correct/);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('a refused password still drops the session, as on the non-MFA path', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    auth.updateUser.mockResolvedValue({ error: { message: 'Password is known to be weak' } });
    const result = await AuthService.completePasswordResetWithMfa({ totp: '123456', newPassword: 'Password123!' });
    expect(result).toEqual({ message: 'Password is known to be weak' });
    expect(auth.signOut).toHaveBeenCalled();
  });
});
