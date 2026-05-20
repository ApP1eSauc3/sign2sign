import { createClient } from '@supabase/supabase-js';
import { secureStorage } from '../utils/secureStorage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly at module load if the env wasn't bundled. The non-null
// assertions previously here produced the literal string "undefined" as
// the URL/key, which surfaced as opaque 404s deep in service calls.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Supabase config missing: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local before starting Expo.'
  );
}

// Supabase needs somewhere to persist the admin session between app launches.
// secureStorage picks the right backend per platform: device keychain on
// native, OS-keychain-encrypted IPC on Electron, localStorage on plain web.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
