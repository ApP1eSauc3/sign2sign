import { createClient } from '@supabase/supabase-js';
import { secureStorage } from '../utils/secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly at module load if the env wasn't bundled. The non-null
// assertions previously here produced the literal string "undefined" as
// the URL/key, which surfaced as opaque 404s deep in service calls.
if (!url || !anonKey) {
  throw new Error(
    'Supabase config missing: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local before starting Expo.'
  );
}

// Exported (narrowed to string after the guard above) for the few callers that
// must build URLs the JS client doesn't cover — e.g. invoking an Edge Function
// by fetch in RouteCodeService. Both are EXPO_PUBLIC_ values, already bundled
// into the shipped client; exporting them leaks nothing the bundle doesn't.
export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;

// Supabase needs somewhere to persist the admin session between app launches.
// secureStorage picks the right backend per platform: device keychain on
// native, OS-keychain-encrypted IPC on Electron, localStorage on plain web.
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
