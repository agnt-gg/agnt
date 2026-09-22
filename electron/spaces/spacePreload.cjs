/**
 * Preload for TEAM space views. Deliberately a small subset of preload.js.
 *
 * A team space is a remote origin shared with other people. It gets window
 * controls and space switching, and nothing that reaches this computer: no
 * file dialogs, no reveal/open of local paths, no browser automation bridge,
 * no connection or updater control. Renderer code already feature-detects
 * every one of those, so the team UI simply does not offer them.
 */
const { contextBridge, ipcRenderer } = require('electron');

const WINDOW_CHANNELS = ['minimize-window', 'maximize-window', 'close-window', 'open-external-url'];

contextBridge.exposeInMainWorld('electron', {
  isSpaceView: true,
  send: (channel, data) => { if (WINDOW_CHANNELS.includes(channel)) ipcRenderer.send(channel, data); },
  openExternalUrl: (url) => ipcRenderer.send('open-external-url', url),
  reportError: (payload) => ipcRenderer.send('diagnostics:client-error', payload),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  spaces: {
    list: () => ipcRenderer.invoke('spaces:list'),
    switch: (id, options) => ipcRenderer.invoke('spaces:switch', id, options),
    syncTeams: (teams, options) => ipcRenderer.invoke('spaces:sync-teams', teams, options),
    onChanged: (cb) => {
      const handler = (_evt, state) => cb(state);
      ipcRenderer.on('spaces:changed', handler);
      return () => ipcRenderer.removeListener('spaces:changed', handler);
    },
  },
});
