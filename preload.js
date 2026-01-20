const { contextBridge, ipcRenderer } = require('electron');

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

  // Listen for update notifications from main process
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, updateInfo) => callback(updateInfo));
  },
});
