const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, typed surface to the renderer. Nothing from Node/Electron
// leaks through except what is explicitly listed here.
contextBridge.exposeInMainWorld('electron', {
  // Open a URL in the system browser (used for Google OAuth)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Subscribe to OAuth protocol callbacks (sign2sign://oauth?code=...).
  // Returns a cleanup function — call it from useEffect's return.
  onOAuthCallback: (callback) => {
    const handler = (_, url) => callback(url);
    ipcRenderer.on('oauth-callback', handler);
    return () => ipcRenderer.removeListener('oauth-callback', handler);
  },

  // OS-keychain-encrypted key/value storage. Backs the renderer's
  // secureStorage util so Supabase sessions and Google tokens are never
  // persisted in plaintext on the desktop.
  secureStorage: {
    get: (key) => ipcRenderer.invoke('secure-get', key),
    set: (key, value) => ipcRenderer.invoke('secure-set', key, value),
    delete: (key) => ipcRenderer.invoke('secure-delete', key),
  },

  // Platform info — lets the renderer know it's inside Electron
  platform: process.platform,
});
