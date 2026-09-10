import { AuthService } from '../AuthService';
import { supabase } from '../supabaseClient';

// Mirrors RouteCodeService.test.ts: mock the seam the code actually uses.
// AuthService reaches Supabase through supabase.auth for the session-bearing
// calls, and through fetch for the two Edge Functions.
jest.mock('../supabaseClient', () => ({
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-123',
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

const auth = supabase.auth as unknown as {
  signInWithPassword: jest.Mock;
  signOut: jest.Mock;
  getSession: jest.Mock;
  resetPasswordForEmail: jest.Mock;
  verifyOtp: jest.Mock;
  updateUser: jest.Mock;
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const SESSION = { session: { access_token: 'admin-jwt', user: { id: 'u1' } } };

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  // Silence the intentional console.warn trail; assert on it where it matters.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  auth.getSession.mockResolvedValue({ data: SESSION });
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('signIn', () => {
  it('returns null on success', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(AuthService.signIn('a@b.com', 'pw')).resolves.toBeNull();
  });

  // The membership-oracle guard: "Email not confirmed" must never reach the UI.
  it('flattens every failure to one message', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    const result = await AuthService.signIn('a@b.com', 'pw');
    expect(result).toEqual({ message: 'Invalid email or password.' });
    expect(result?.message).not.toMatch(/not confirmed/i);
  });
});

describe('requestPasswordReset', () => {
  it('lowercases and trims the address before sending', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await AuthService.requestPasswordReset('  Admin@Sign2Site.com.AU ');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('admin@sign2site.com.au');
  });

  // No redirectTo: the code is read out of the email, never the link, so there
  // is no redirect URL to allowlist.
  it('passes no redirectTo option', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await AuthService.requestPasswordReset('a@b.com');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.com');
    expect(auth.resetPasswordForEmail.mock.calls[0]).toHaveLength(1);
  });

  // Each of these identifies a registered address to anyone reading the
  // response. All three must be indistinguishable from success at the boundary.
  it.each([
    ['a per-address rate limit', { message: 'For security purposes, you can only request this after 54 seconds' }],
    ['an unknown address', { message: 'User not found' }],
    ['an SMTP failure', { message: 'Error sending recovery email' }],
  ])('resolves silently on %s', async (_label, error) => {
    auth.resetPasswordForEmail.mockResolvedValue({ error });
    await expect(AuthService.requestPasswordReset('a@b.com')).resolves.toBeUndefined();
    // The real reason still has to reach someone — it goes to the console.
    expect(console.warn).toHaveBeenCalledWith(
      '[auth] password reset request failed:',
      error.message
    );
  });
});

describe('completePasswordReset', () => {
  const INPUT = { email: 'a@b.com', code: '123456', newPassword: 'new-password' };

  it('verifies the code then sets the password, in that order', async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });

    await expect(
      AuthService.completePasswordReset({ ...INPUT, type: 'recovery' })
    ).resolves.toBeNull();

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '123456',
      type: 'recovery',
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("passes the 'invite' type through for a first-time admin", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    await AuthService.completePasswordReset({ ...INPUT, type: 'invite' });
    expect(auth.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite' }));
  });

  it('normalises the email and trims the pasted code', async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    await AuthService.completePasswordReset({
      email: ' A@B.com ',
      code: ' 123456 ',
      newPassword: 'pw',
      type: 'recovery',
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '123456',
      type: 'recovery',
    });
  });

  it('never sets a password when the code is rejected', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });

    await expect(
      AuthService.completePasswordReset({ ...INPUT, type: 'recovery' })
    ).resolves.toEqual({ message: 'That code is invalid or has expired. Request a new one.' });

    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  // The important one. verifyOtp mints a session; if updateUser then fails and
  // we keep it, the user is signed in with the OLD password still live — or on
  // the invite path, with an account that has no password at all.
  it('drops the session when the password update fails', async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({
      error: { message: 'Password should be at least 6 characters' },
    });

    const result = await AuthService.completePasswordReset({ ...INPUT, type: 'invite' });

    expect(auth.signOut).toHaveBeenCalled();
    // Validation messages about the just-chosen password are useful and safe
    // to surface — the caller is already authenticated at this point.
    expect(result).toEqual({ message: 'Password should be at least 6 characters' });
  });

  it('still reports the failure when the cleanup signOut itself throws', async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: { message: 'boom' } });
    auth.signOut.mockRejectedValue(new Error('already gone'));

    await expect(
      AuthService.completePasswordReset({ ...INPUT, type: 'recovery' })
    ).resolves.toEqual({ message: 'boom' });
  });
});

describe('inviteAdmin', () => {
  it('posts the lowercased email with the admin JWT', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ invited: true }));

    await expect(AuthService.inviteAdmin('  New.Admin@Example.COM ')).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://proj.supabase.co/functions/v1/invite-admin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key-123',
          Authorization: 'Bearer admin-jwt',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ email: 'new.admin@example.com' }),
      })
    );
  });

  it('refuses without a session rather than calling the function', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(AuthService.inviteAdmin('a@b.com')).resolves.toEqual({
      message: 'You are not signed in.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Not flattened, unlike signIn — the caller has already proved they are an
  // admin, and this is the one response that stops them re-inviting forever.
  it('surfaces the already-registered conflict verbatim', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: 'already_registered', message: 'That email already has an account.' }, 409)
    );
    await expect(AuthService.inviteAdmin('a@b.com')).resolves.toEqual({
      message: 'That email already has an account.',
    });
  });

  it('falls back to the error code when the body carries no message', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429));
    await expect(AuthService.inviteAdmin('a@b.com')).resolves.toEqual({ message: 'rate_limited' });
  });

  it('falls back to the status line when the error body is not JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not json'); },
    });
    await expect(AuthService.inviteAdmin('a@b.com')).resolves.toEqual({
      message: 'Server returned 502.',
    });
  });

  it('reports a network failure instead of throwing', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));
    await expect(AuthService.inviteAdmin('a@b.com')).resolves.toEqual({
      message: 'Network request failed',
    });
  });
});

describe('deleteAccount', () => {
  it('clears the local session after the function succeeds', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ deleted: true }));

    await expect(AuthService.deleteAccount()).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://proj.supabase.co/functions/v1/delete-admin-account',
      expect.objectContaining({ method: 'POST' })
    );
    expect(auth.signOut).toHaveBeenCalled();
  });

  // The shared transport sends no body for delete; adding one would change
  // the request shape the deployed function has been accepting since v8.
  it('sends no request body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ deleted: true }));
    await AuthService.deleteAccount();
    expect((global.fetch as jest.Mock).mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('leaves the session alone when the deletion fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: 'delete_failed', message: 'Could not delete.' }, 500)
    );
    await expect(AuthService.deleteAccount()).resolves.toEqual({ message: 'Could not delete.' });
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
