import * as SecureStore from 'expo-secure-store';

// Platform-aware secure key/value storage. Used for the Supabase admin
// session, Google OAuth tokens, and the driver client_id.
//
// Why this exists: expo-secure-store is native-only — calling it on web
// (which is what the Electron admin build loads) throws "Unsupported". The
// previous code called SecureStore directly and would have crashed the
// Electron admin app on first auth.
//
// Backends, in priority order:
//   1. Electron  — encrypted via the OS keychain through the safeStorage IPC
//      bridge exposed by electron/preload.js. Tokens never sit in plaintext.
//   2. Plain web — window.localStorage. NOT encrypted; this branch only runs
//      in a browser context outside Electron (e.g. `expo start --web` during
//      development), never in the shipped desktop app.
//   3. Native    — expo-secure-store (iOS Keychain / Android Keystore).
//
// `document` is undefined in React Native and defined in any DOM environment,
// so we use it to detect web/Electron without importing react-native here —
// that keeps services (which import this util) free of an RN dependency.

const isDom = typeof document !== 'undefined';

type ElectronSecureStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

function electronBridge(): ElectronSecureStorage | null {
  if (typeof window !== 'undefined' && window.electron?.secureStorage) {
    return window.electron.secureStorage;
  }
  return null;
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const bridge = electronBridge();
    if (bridge) return bridge.get(key);
    if (isDom) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    const bridge = electronBridge();
    if (bridge) {
      await bridge.set(key, value);
      return;
    }
    if (isDom) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Storage disabled (private mode / quota) — non-fatal
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },

  async removeItem(key: string): Promise<void> {
    const bridge = electronBridge();
    if (bridge) {
      await bridge.delete(key);
      return;
    }
    if (isDom) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Non-fatal
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
