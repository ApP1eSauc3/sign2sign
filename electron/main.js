const { app, BrowserWindow, shell, Menu, ipcMain, session, safeStorage, screen, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// Thin shell only — no business logic lives here.
// All app logic runs in the React web build loaded by the BrowserWindow.
// Build flow: npm run web → npm run electron:build

const WEB_BUILD_PATH = path.join(__dirname, '..', 'dist');
const DEV_SERVER_URL = 'http://localhost:8081';
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const SECURE_FILE = path.join(app.getPath('userData'), 'secure-store.json');

const isDev = !app.isPackaged;

// ─── Custom app:// scheme ───────────────────────────────────────────────────
// Production serves the web build over a custom standard scheme instead of
// file://. file:// carries extra privileges and gives us no clean way to attach
// a strict per-response CSP header; serving the bundle ourselves over app:// lets
// us treat the renderer as a normal secure origin AND stamp a strict CSP onto
// every document response. Dev still uses the Metro server.
const APP_SCHEME = 'app';
const APP_HOST = 'bundle';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// Must be called before the app 'ready' event. standard+secure makes 'self',
// fetch/XHR and secure-context APIs behave exactly as they would over https://.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// ─── Single instance ──────────────────────────────────────────────────────────
// Prevent the admin from opening two dashboards side-by-side. On the second
// launch, focus the existing window and forward any OAuth protocol URL.

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Exit synchronously — app.quit() is async and the rest of this module
  // would otherwise keep running (registering protocols, IPC handlers, etc.)
  // on the duplicate instance before the quit completes.
  app.exit(0);
}

// ─── Protocol handler (OAuth) ─────────────────────────────────────────────────
// Register sign2sign:// so Google OAuth can redirect back after authentication.
// On Windows, the protocol URL arrives as a CLI argument on the second instance.
// On macOS/Linux it fires the 'open-url' event on the first instance.
//
// Add this to your Google Cloud Console OAuth redirect URIs:
//   sign2sign://oauth

if (process.defaultApp) {
  // Running via `electron .` in dev — register with the explicit executable path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('sign2sign', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('sign2sign');
}

// ─── Window state ─────────────────────────────────────────────────────────────

function loadWindowState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    // Sanity-check: ignore stale state if the window would be off-screen
    if (typeof state.width === 'number' && typeof state.height === 'number') {
      // Drop a saved x/y that lands on a display that's no longer connected
      // (e.g. an external monitor that's been unplugged) — otherwise the window
      // restores off-screen and looks like it failed to open.
      if (typeof state.x === 'number' && typeof state.y === 'number') {
        const onScreen = screen.getAllDisplays().some((d) => {
          const b = d.bounds;
          return (
            state.x >= b.x &&
            state.y >= b.y &&
            state.x < b.x + b.width &&
            state.y < b.y + b.height
          );
        });
        if (!onScreen) {
          delete state.x;
          delete state.y;
        }
      }
      return state;
    }
  } catch {
    // File doesn't exist yet or is corrupt — use defaults
  }
  return { width: 1280, height: 800 };
}

function saveWindowState(win) {
  if (win.isMinimized() || win.isMaximized()) return;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(win.getBounds()), 'utf8');
  } catch {
    // Non-fatal — next launch just uses defaults
  }
}

// ─── Window creation ──────────────────────────────────────────────────────────

let mainWindow = null;
let pendingOAuthUrl = null; // buffered if open-url fires before window exists

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    title: 'Sign2Sign Admin',
    show: false, // reveal only after content is ready to avoid flash
  });

  // Open external links in the system browser, not a new Electron window.
  // This also routes the Google OAuth popup to the system browser so the
  // protocol redirect (sign2sign://) can complete correctly.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://localhost'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Lock navigation to the app's own origin. Without this, an XSS or a
  // malicious link could navigate the main window to a remote page that then
  // runs with the app's (privileged) context. In-app routes are app:// in
  // production and the dev server in development; anything else is opened in
  // the system browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const inApp = url.startsWith(APP_ORIGIN) || url.startsWith(DEV_SERVER_URL);
    if (!inApp) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
    }
  });

  // This is a single-window admin tool — never attach <webview> tags.
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Flush any OAuth URL that arrived before the window was ready
    if (pendingOAuthUrl) {
      mainWindow.webContents.send('oauth-callback', pendingOAuthUrl);
      pendingOAuthUrl = null;
    }
  });

  // Persist window bounds on move/resize
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

// Reject IPC from any frame that isn't our own renderer (Electron security #17).
// In prod the app loads from app://; in dev from the Metro dev server. Anything
// else — an injected iframe or remote frame — is denied.
function validateSender(frame) {
  if (!frame) return false;
  let url;
  try {
    url = new URL(frame.url);
  } catch {
    return false;
  }
  return isDev ? url.origin === DEV_SERVER_URL : url.origin === APP_ORIGIN;
}

// Renderer calls this to open a URL in the system browser (e.g. Google OAuth).
// String prefix matching is unsafe: "https://evil.com@actuallybad.example"
// passes a startsWith check. Parse the URL and enforce protocol + hostname.
ipcMain.handle('open-external', (event, url) => {
  if (!validateSender(event.senderFrame)) return;
  if (typeof url !== 'string') return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  const isHttps = parsed.protocol === 'https:';
  const isLocalDev = parsed.protocol === 'http:' && parsed.hostname === 'localhost';
  if (isHttps || isLocalDev) {
    shell.openExternal(parsed.toString());
  }
});

// ─── Encrypted secure storage (safeStorage) ─────────────────────────────────
// Backs the renderer's secureStorage util on Electron. Values are encrypted
// with the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on
// Linux) and persisted as base64 in a JSON file under userData. This keeps
// the Supabase admin session and Google OAuth tokens out of plaintext.

function readSecureStore() {
  try {
    return JSON.parse(fs.readFileSync(SECURE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeSecureStore(store) {
  fs.writeFileSync(SECURE_FILE, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
}

ipcMain.handle('secure-get', (event, key) => {
  if (!validateSender(event.senderFrame)) return null;
  if (typeof key !== 'string') return null;
  const store = readSecureStore();
  const encoded = store[key];
  if (typeof encoded !== 'string') return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    return null; // key rotated / corrupt — treat as absent
  }
});

ipcMain.handle('secure-set', (event, key, value) => {
  if (!validateSender(event.senderFrame)) return;
  if (typeof key !== 'string' || typeof value !== 'string') return;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption unavailable — refusing to store secrets in plaintext.');
  }
  const store = readSecureStore();
  store[key] = safeStorage.encryptString(value).toString('base64');
  writeSecureStore(store);
});

ipcMain.handle('secure-delete', (event, key) => {
  if (!validateSender(event.senderFrame)) return;
  if (typeof key !== 'string') return;
  const store = readSecureStore();
  delete store[key];
  writeSecureStore(store);
});

// ─── app:// asset server + CSP ──────────────────────────────────────────────

// Extension → MIME map for the assets the Expo web export emits.
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain',
};

// Single source of truth for the CSP. The security-critical directive is
// script-src: prod drops BOTH 'unsafe-inline' and 'unsafe-eval' (the external
// JS bundle is covered by 'self'), which blocks injected and eval'd script —
// the high-severity class. style-src keeps 'unsafe-inline' in dev and prod:
// react-native-web sets inline style *attributes* at runtime, and a CSP nonce
// can only whitelist <style>/<link> elements, never style attributes — so there
// is no nonce-based way to allow them. Style injection is far lower severity
// than script injection, so this is an accepted trade-off for this stack.
function buildContentSecurityPolicy({ dev }) {
  const scriptSrc = dev ? "'self' 'unsafe-inline' 'unsafe-eval' blob:" : "'self' blob:";
  const styleSrc = "'self' 'unsafe-inline'";
  const connectSrc = dev
    ? "'self' https://*.supabase.co wss://*.supabase.co https://sheets.googleapis.com https://oauth2.googleapis.com https://maps.googleapis.com http://localhost:* ws://localhost:*"
    : "'self' https://*.supabase.co wss://*.supabase.co https://sheets.googleapis.com https://oauth2.googleapis.com https://maps.googleapis.com";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `connect-src ${connectSrc}`,
    // Photos load as signed URLs from Supabase storage only.
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Serves the packaged web build over app://. Resolves the request path inside
// dist/ (rejecting traversal), and attaches a strict CSP header to the HTML
// document response.
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (rel === '/' || rel === '') rel = '/index.html';

    const root = path.resolve(WEB_BUILD_PATH);
    let resolved = path.resolve(root, '.' + rel);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    let ext = path.extname(resolved).toLowerCase();

    // Single-page fallback: an extensionless route that isn't a real file
    // resolves to index.html so client-side navigation keeps working.
    if (!ext) {
      try {
        await fs.promises.access(resolved);
      } catch {
        resolved = path.join(root, 'index.html');
        ext = '.html';
      }
    }

    if (ext === '.html') {
      let html;
      try {
        html = await fs.promises.readFile(resolved, 'utf8');
      } catch {
        return new Response('Not found', { status: 404 });
      }
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': buildContentSecurityPolicy({ dev: false }),
        },
      });
    }

    try {
      const data = await fs.promises.readFile(resolved);
      return new Response(data, {
        headers: { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // ── Content Security Policy ────────────────────────────────────────────────
  // Prod serves its CSP header straight from the app:// handler
  // (registerAppProtocol). Dev loads from the Metro server, which we can't
  // rewrite, so we apply the CSP via response headers here; it relaxes to
  // allow Metro's HMR ('unsafe-inline'/'unsafe-eval').
  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [buildContentSecurityPolicy({ dev: true })],
        },
      });
    });
  } else {
    registerAppProtocol();
  }

  // Deny every device-permission request (camera, mic, geolocation, etc.).
  // The admin web build needs none — those flows live in the native mobile
  // app. Denying by default removes a class of abuse if the renderer is
  // ever compromised.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  // ── App menu ───────────────────────────────────────────────────────────────
  // macOS requires a proper menu or the app has no way to quit, copy, paste, etc.
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  createWindow();

  // macOS: re-open window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS: protocol URL fires on the already-running instance.
// Can arrive before ready-to-show if the app was launched via the URL —
// buffer it so the window can flush it once the renderer is ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('oauth-callback', url);
  } else {
    pendingOAuthUrl = url;
  }
});

// Windows/Linux: second-instance carries the protocol URL as a CLI argument
app.on('second-instance', (_, commandLine) => {
  const url = commandLine.find((arg) => arg.startsWith('sign2sign://'));
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (url) mainWindow.webContents.send('oauth-callback', url);
  }
});

// Windows/Linux: quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────
// Checks GitHub Releases for a newer *signed* build and installs it on quit.
// Only runs in packaged builds: electron-updater needs a signed app and the
// app-update.yml that electron-builder bakes in from the `publish` config in
// electron-builder.yml (owner/repo). No credentials are needed at runtime —
// GH_TOKEN is only required when *publishing* a release, not when checking.
if (!isDev) {
  const { autoUpdater } = require('electron-updater');
  // A failed or unsigned update check must never block the app — log and move on.
  autoUpdater.on('error', (err) => console.error('[auto-updater]', err));
  app.whenReady().then(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  });
}
