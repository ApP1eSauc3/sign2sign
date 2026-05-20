// Type declarations for the IPC bridge exposed by electron/preload.js.
// Only present at runtime when the app is running inside Electron.

interface Window {
  electron?: {
    openExternal: (url: string) => Promise<void>;
    onOAuthCallback: (callback: (url: string) => void) => () => void;
    secureStorage: {
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    platform: NodeJS.Platform;
  };
}
