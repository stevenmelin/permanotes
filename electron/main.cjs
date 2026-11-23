// PermaNotes desktop shell (Windows + Mac). Serves the built web app from app://permanotes/
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
let win = null;
const pending = []; // .pn files opened before the app inside the window was ready
let rendererReady = false;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function readPn(p) {
  try {
    return { name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) };
  } catch (e) {
    dialog.showErrorBox('PermaNotes', `Could not open ${p}:\n\n${e.stack || e}`);
    return null;
  }
}

function openPath(p) {
  if (!p || !p.toLowerCase().endsWith('.pn')) return;
  const f = readPn(p);
  if (!f) return;
  if (win && rendererReady) {
    win.webContents.send('pn:open-file', f);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else pending.push(f);
}

const filesFromArgv = (argv) => argv.slice(1).filter((a) => a.toLowerCase().endsWith('.pn') && fs.existsSync(a));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    filesFromArgv(argv).forEach(openPath);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-file', (e, p) => { e.preventDefault(); openPath(p); }); // macOS Finder
  filesFromArgv(process.argv).forEach(openPath);

  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(DIST, rel));
      if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
      if (!fs.existsSync(file)) return new Response(`Not found: ${rel}`, { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      dialog.showErrorBox('PermaNotes', `The app files are missing (${path.join(DIST, 'index.html')}). The build is incomplete — run the build script again.`);
      app.quit();
      return;
    }
    createWindow();
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

// ---------- remembered window size, position and zoom ----------
const prefsFile = () => path.join(app.getPath('userData'), 'window-prefs.json');
let prefs = { zoom: 1, bounds: null, maximized: false };
function loadPrefs() {
  try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; }
  catch (e) { if (e.code !== 'ENOENT') console.error('Could not read window-prefs.json:', e); }
}
function savePrefs() {
  try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); }
  catch (e) { dialog.showErrorBox('PermaNotes', `Could not save window settings to ${prefsFile()}:\n\n${e.stack || e}`); }
}
const ZOOM_MIN = 0.3, ZOOM_MAX = 3;
function setZoom(z) {
  prefs.zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
  if (win) win.webContents.setZoomFactor(prefs.zoom);
  savePrefs();
}
ipcMain.on('pn:zoom-wheel', (_e, deltaY) => {
  // mouse wheel notch ~ 10%, trackpad pinch is smooth
  setZoom(prefs.zoom * Math.exp(-Math.max(-300, Math.min(300, deltaY)) * 0.001));
});
function boundsVisible(b) {
  return b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
  });
}

// ---------- application menu ----------
const send = (id) => () => { if (win) win.webContents.send('pn:menu', id); };
function buildMenu() {
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: send('new-note') },
        { label: 'New Folder', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-folder') },
        { type: 'separator' },
        { label: 'Open .pn File…', accelerator: 'CmdOrCtrl+O', click: send('open-pn') },
        { label: 'Import from OneNote…', click: send('import-onenote') },
        { type: 'separator' },
        { label: 'Save Note as .pn…', accelerator: 'CmdOrCtrl+S', click: send('save-note') },
        { label: 'Save Folder as .pn…', click: send('save-folder') },
        { label: 'Save All Notes as .pn…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-all') },
        { type: 'separator' },
        { label: 'Sync to Devices', accelerator: 'F5', click: send('sync-now') },
        { label: 'Sync && Settings…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { label: 'Show Backup Folder', click: send('backup-folder') },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Show/Hide Folders', accelerator: 'CmdOrCtrl+1', click: send('toggle-folders') },
        { label: 'Show/Hide Note List', accelerator: 'CmdOrCtrl+2', click: send('toggle-list') },
        { label: 'Show/Hide Formatting Toolbar', accelerator: 'CmdOrCtrl+3', click: send('toggle-toolbar') },
        { label: 'Full Page View', accelerator: 'CmdOrCtrl+Shift+F', click: send('toggle-focus') },
        { label: 'Reset Text Width', click: send('reset-width') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => setZoom(prefs.zoom + 0.1) },
        { label: 'Zoom In ', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => setZoom(prefs.zoom + 0.1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => setZoom(prefs.zoom - 0.1) },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'PermaNotes on GitHub', click: () => shell.openExternal('https://github.com/stevenmelin/permanotes') },
        { label: 'Download Latest Version', click: () => shell.openExternal('https://github.com/stevenmelin/permanotes/releases/latest') },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  buildMenu();
  loadPrefs();
  const b = boundsVisible(prefs.bounds) ? prefs.bounds : { width: 1280, height: 820 };
  win = new BrowserWindow({
    ...b, minWidth: 160, minHeight: 120,
    title: 'PermaNotes',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('render-process-gone', (_e, d) => dialog.showErrorBox('PermaNotes', `The window crashed (${d.reason}, exit code ${d.exitCode}). Your notes are saved locally; restart PermaNotes.`));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => dialog.showErrorBox('PermaNotes', `Failed to load ${url}: ${desc} (${code})`));
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    for (const s of params.dictionarySuggestions || []) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (items.length) items.push({ type: 'separator' });
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    Menu.buildFromTemplate(items).popup();
  });
  if (prefs.maximized) win.maximize();
  // zoom is re-applied on every page load (it does not stick to app:// on its own)
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(prefs.zoom));
  win.webContents.setVisualZoomLevelLimits(1, 1); // trackpad pinch goes through our own zoom instead
  const remember = () => {
    if (!win || win.isDestroyed()) return;
    prefs.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) prefs.bounds = win.getBounds();
  };
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(() => { remember(); savePrefs(); }, 500); };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', () => { remember(); savePrefs(); });
  win.loadURL('app://permanotes/index.html');
}

// ---------- IPC ----------
const backupDir = () => path.join(app.getPath('documents'), 'PermaNotes Backups');

ipcMain.handle('pn:save-file', async (_e, defaultName, bytes) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: defaultName.toLowerCase().endsWith('.pn') ? [{ name: 'PermaNotes file', extensions: ['pn'] }] : [{ name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

ipcMain.handle('pn:pending-files', () => { rendererReady = true; return pending.splice(0); });

ipcMain.handle('pn:write-backup', (_e, name, bytes, keep) => {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  const olds = fs.readdirSync(dir).filter((f) => f.startsWith('PermaNotes Library ') && f.endsWith('.pn')).sort().reverse();
  for (const f of olds.slice(keep)) fs.unlinkSync(path.join(dir, f));
  return p;
});

ipcMain.handle('pn:backup-folder', () => backupDir());
ipcMain.handle('pn:show-backup-folder', async () => {
  fs.mkdirSync(backupDir(), { recursive: true });
  const err = await shell.openPath(backupDir());
  if (err) throw new Error(err);
});

ipcMain.handle('pn:open-attachment', async (_e, name, bytes) => {
  const dir = path.join(app.getPath('temp'), 'PermaNotes');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(name).replace(/[\\/:*?"<>|]/g, '_') || 'attachment';
  const p = path.join(dir, `${Date.now()}-${safe}`);
  fs.writeFileSync(p, Buffer.from(bytes));
  const err = await shell.openPath(p);
  if (err) throw new Error(`No app could open ${safe}: ${err}`);
});

ipcMain.handle('pn:version', () => app.getVersion());
