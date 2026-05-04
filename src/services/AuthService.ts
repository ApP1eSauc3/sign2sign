import { supabase } from './supabaseClient';

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
};
