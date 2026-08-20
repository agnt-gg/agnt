const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => {
    let validChannels = ['minimize-window', 'maximize-window', 'close-window', 'open-download-page', 'open-external-url'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // Update system - invoke handlers (async with response)
  // Browser widget: expose a CDP endpoint for the <webview> the widget renders,
  // so an agent can drive the browser the user is looking at. Scoped by
  // webContents id — the renderer cannot ask for a bridge to anything else,
  // and main.js validates the id before attaching a debugger.
  browserBridge: {
    start: (webContentsId) => ipcRenderer.invoke('browser-bridge:start', webContentsId),
    stop: (webContentsId) => ipcRenderer.invoke('browser-bridge:stop', webContentsId),
  },
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Update system - one-way messages
  openDownloadPage: () => ipcRenderer.send('open-download-page'),
  openExternalUrl: (url) => ipcRenderer.send('open-external-url', url),

  // OS file manager bridge — used by the artifacts file tree right-click menu.
  // Renderer code should guard on `window.electron?.revealInFolder` so the menu
  // entries can be hidden in non-Electron contexts (web/Docker).
  revealInFolder: (fullPath) => ipcRenderer.send('shell:show-item-in-folder', fullPath),
  openPath: (fullPath) => ipcRenderer.send('shell:open-path', fullPath),

  /**
   * Native folder chooser for directory settings. Renderer code MUST feature
   * detect `window.electron?.chooseDirectory` — browser and Docker users have
   * no Electron bridge and need the typed path to keep working.
   *
   * Always resolves: { ok: true, path } | { ok: false, reason }, where reason
   * is 'canceled' | 'remote-backend' | 'failed'. Cancel is not an error.
   * @param {{ defaultPath?: string, title?: string, buttonLabel?: string }} [options]
   */
  chooseDirectory: (options) => ipcRenderer.invoke('dialog:choose-directory', options),

  // Diagnostics relay. The renderer is sandboxed and has no fs, so client-side
  // errors reach disk through main. Fire-and-forget by design: a failing error
  // reporter must never itself throw inside an error handler.
  reportError: (payload) => ipcRenderer.send('diagnostics:client-error', payload),

  // Connection (desktop only): choose between this machine's backend and a
  // remote one. Renderer code MUST feature-detect `window.electron?.connection`
  // — browser and Docker users have no Electron bridge and must not see the UI.
  connection: {
    get: () => ipcRenderer.invoke('connection:get'),
    test: (url) => ipcRenderer.invoke('connection:test', url),
    set: (next) => ipcRenderer.invoke('connection:set', next),
    relaunch: () => ipcRenderer.invoke('connection:relaunch'),
    // Re-poll the configured backend and load it in place. No process restart,
    // which is what makes recovery viable when a remote drops mid-session.
    retry: () => ipcRenderer.invoke('connection:retry'),
    // Run a local backend for THIS SESSION ONLY, leaving connection.json alone.
    useLocalNow: () => ipcRenderer.invoke('connection:use-local-now'),
    // Port already held by a healthy AGNT: share it rather than fork a second
    // backend that cannot bind. Nothing is spawned, so nothing is killed on quit.
    useExistingLocal: () => ipcRenderer.invoke('connection:use-existing-local'),
    // ...or stop the one that is running and start a fresh backend here.
    replaceLocal: () => ipcRenderer.invoke('connection:replace-local'),
    /**
     * Live connection phase. Used by electron/connection-error.html to show a
     * progressing "connecting" state instead of a blank window, and by Settings
     * to report that the app fell back to this computer.
     * @returns {() => void} unsubscribe
     */
    onState: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('connection:state', handler);
      return () => ipcRenderer.removeListener('connection:state', handler);
    },
  },

  // Listen for update notifications from main process
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, updateInfo) => callback(updateInfo));
  },

  /**
   * Auto-update (desktop only). Renderer code MUST feature-detect
   * `window.electron?.autoUpdate` — browser and Docker users have no Electron
   * bridge and keep the agnt.gg download banner instead.
   *
   * The update downloads itself in the background on every platform. macOS and
   * Linux then install it when the app is quit; Windows waits for `install()`,
   * because with no code-signing certificate the installer raises SmartScreen
   * and a prompt cannot appear after a user has closed the app.
   */
  autoUpdate: {
    // { enabled, platform, needsExplicitInstall }
    status: () => ipcRenderer.invoke('update:status'),
    // { ok: true } | { ok: false, reason: 'goal-running', goals } | { ok:false, reason:'not-packaged' }
    install: () => ipcRenderer.invoke('update:install'),
    onDownloaded: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('update:downloaded', h);
      return () => ipcRenderer.removeListener('update:downloaded', h);
    },
    onProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('update:progress', h);
      return () => ipcRenderer.removeListener('update:progress', h);
    },
  },
});
