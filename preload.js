const { contextBridge, ipcRenderer } = require('electron');

// Sync snapshot for Settings/status. External mode uses same-origin proxy:
// UI on 127.0.0.1:19333, so API is window.location.origin/api (no remote BASE_URL inject).
const desktopRuntime = (() => {
  try {
    return ipcRenderer.sendSync('connection:get-desktop-runtime') || {};
  } catch {
    return {};
  }
})();

contextBridge.exposeInMainWorld('__AGNT_DESKTOP__', desktopRuntime);

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => {
    let validChannels = ['minimize-window', 'maximize-window', 'close-window', 'open-download-page', 'open-external-url'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // Update system - invoke handlers (async with response)
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Update system - one-way messages
  openDownloadPage: () => ipcRenderer.send('open-download-page'),
  openExternalUrl: (url) => ipcRenderer.send('open-external-url', url),

  // Hybrid / external backend connection (Settings → Connection).
  getConnectionConfig: () => ipcRenderer.invoke('connection:get'),
  setConnectionConfig: (config) => ipcRenderer.invoke('connection:set', config),
  testConnection: (config) => ipcRenderer.invoke('connection:test', config),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  getDesktopRuntime: () => desktopRuntime,

  // OS file manager bridge — used by the artifacts file tree right-click menu.
  // Renderer code should guard on `window.electron?.revealInFolder` so the menu
  // entries can be hidden in non-Electron contexts (web/Docker).
  revealInFolder: (fullPath) => ipcRenderer.send('shell:show-item-in-folder', fullPath),
  openPath: (fullPath) => ipcRenderer.send('shell:open-path', fullPath),

  // Diagnostics relay. The renderer is sandboxed and has no fs, so client-side
  // errors reach disk through main. Fire-and-forget by design: a failing error
  // reporter must never itself throw inside an error handler.
  reportError: (payload) => ipcRenderer.send('diagnostics:client-error', payload),

  // Listen for update notifications from main process
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, updateInfo) => callback(updateInfo));
  },
});
