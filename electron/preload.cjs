const { contextBridge, ipcRenderer } = require('electron');

// Exposed as window.permanotes (see src/lib/platform.ts DesktopBridge)
contextBridge.exposeInMainWorld('permanotes', {
  saveFile: (defaultName, bytes) => ipcRenderer.invoke('pn:save-file', defaultName, bytes),
  pendingFiles: () => ipcRenderer.invoke('pn:pending-files'),
  onOpenFile: (cb) => ipcRenderer.on('pn:open-file', (_e, f) => cb(f)),
  writeBackup: (name, bytes, keep) => ipcRenderer.invoke('pn:write-backup', name, bytes, keep),
  openAttachment: (name, bytes) => ipcRenderer.invoke('pn:open-attachment', name, bytes),
  backupFolder: () => ipcRenderer.invoke('pn:backup-folder'),
  showBackupFolder: () => ipcRenderer.invoke('pn:show-backup-folder'),
  version: () => ipcRenderer.invoke('pn:version'),
  onMenu: (cb) => ipcRenderer.on('pn:menu', (_e, id) => cb(id)),
});

// Ctrl + mouse wheel (or trackpad pinch) zooms the whole app; the main process remembers the size
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  ipcRenderer.send('pn:zoom-wheel', e.deltaY);
}, { passive: false });
