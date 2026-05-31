import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';

export type AuthError = { message: string };

export const AuthService = {
  async signIn(email: string, password: string): Promise<AuthError | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { message: error.message } : null;
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  },

  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  // Calls the delete-admin-account Edge Function, which validates the bearer
  // JWT and removes the row from auth.users via the service role. On success,
  // clears the local session — supabase.auth.signOut() would 401 against the
  // now-deleted user, so we drop the session directly instead.
  async deleteAccount(): Promise<AuthError | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { message: 'You are not signed in.' };

    let response: Response;
    try {
      response = await fetch(`${SUPABASE_URL}/functions/v1/delete-admin-account`, {
        method: 'POST',
        headers: {
          // apikey is required by the Supabase gateway; Authorization carries
          // the admin's JWT so the function can identify the caller.
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (e: unknown) {
      return { message: e instanceof Error ? e.message : 'Network error.' };
    }

    if (!response.ok) {
      let detail = `Server returned ${response.status}.`;
      try {
        const body = await response.json() as { message?: string; error?: string };
        if (body.message) detail = body.message;
        else if (body.error) detail = body.error;
      } catch { /* keep the status-line detail */ }
      return { message: detail };
    }

    // Drop the local session — the auth.users row is gone, so any further
    // call with this access token would 401.
    await supabase.auth.signOut().catch(() => { /* expected to 401 */ });
    return null;
  },
};
