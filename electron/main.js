const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Thin shell only — no business logic lives here.
// All app logic runs in the React web build loaded below.
// Build flow: npm run web → npx electron .

const WEB_BUILD_PATH = path.join(__dirname, '..', 'dist');
const DEV_SERVER_URL = 'http://localhost:8081'; // expo start --web port

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#147EC4', // colors.brand — matches splash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    title: 'Sign2Sign Admin',
  });

  // Open external links in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(WEB_BUILD_PATH, 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-open window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Windows/Linux: quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
