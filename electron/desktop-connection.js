/**
 * Desktop hybrid connection lifecycle (Electron main-process only).
 *
 * Owns: config cache, local UI reverse-proxy, health wait, cold-start window,
 * connection IPC, and activate recovery. main.js should call into this module
 * instead of branching hybrid logic through the process entry file.
 */
import path from 'path';
import {
  resolveConnectionConfig,
  readStoredConnectionConfig,
  writeStoredConnectionConfig,
  normalizeBackendUrl,
  validateBackendUrl,
  probeBackendHealth,
  waitUntilHealthy,
} from './connection-config.js';
import { startLocalUiServer, resolveFrontendDistPath } from './local-ui-server.js';

/** @type {null | {
 *   app: import('electron').App,
 *   BrowserWindow: typeof import('electron').BrowserWindow,
 *   dialog: import('electron').Dialog,
 *   ipcMain: import('electron').IpcMain,
 *   dirname: string,
 *   getMainWindow: () => import('electron').BrowserWindow | null,
 * }} */
let ctx = null;

/** @type {ReturnType<typeof resolveConnectionConfig> | null} */
let activeConnection = null;
/** @type {import('http').Server | null} */
let localUiServer = null;
/** @type {string | null} */
let localUiOrigin = null;
/** @type {import('electron').BrowserWindow | null} */
let connectionSetupWindow = null;
let ipcRegistered = false;

/**
 * @param {NonNullable<typeof ctx>} deps
 */
export function initDesktopConnection(deps) {
  ctx = deps;
  registerConnectionIpc();
}

function requireCtx() {
  if (!ctx) throw new Error('desktop-connection: initDesktopConnection() not called');
  return ctx;
}

export function getActiveConnection() {
  if (activeConnection) return activeConnection;
  const { app } = requireCtx();
  activeConnection = resolveConnectionConfig({ userDataPath: app.getPath('userData') });
  console.log(
    `[connection] mode=${activeConnection.useExternalBackend ? 'external' : 'local'} ` +
      `url=${activeConnection.backendUrl} source=${activeConnection.source}`
  );
  return activeConnection;
}

export function invalidateConnectionCache() {
  activeConnection = null;
}

export function getLocalUiOrigin() {
  return localUiOrigin;
}

/**
 * UI load URL for the main BrowserWindow.
 * External mode never falls back to remote UI (that hid Settings → Connection).
 */
export function getUiLoadUrl() {
  const connection = getActiveConnection();
  if (connection.useExternalBackend) {
    if (!localUiOrigin) {
      throw new Error('External mode requires local UI server before opening the main window');
    }
    return localUiOrigin;
  }
  return `http://localhost:${process.env.PORT || 3333}`;
}

/**
 * Ensure loopback static UI + reverse proxy is running (external mode only).
 */
export async function ensureLocalUiServer(connection = getActiveConnection()) {
  if (localUiServer && localUiOrigin) {
    return { origin: localUiOrigin };
  }
  const { app, dirname } = requireCtx();
  const distDir = resolveFrontendDistPath({ app, dirname });
  const { server, origin } = await startLocalUiServer(distDir, {
    proxyTarget: connection.backendUrl,
  });
  localUiServer = server;
  localUiOrigin = origin;
  return { origin };
}

/**
 * Poll until the active backend answers /api/health.
 * @returns {Promise<boolean>} true if healthy
 */
export async function waitForBackendReady() {
  const connection = getActiveConnection();
  const maxAttempts = connection.useExternalBackend ? 40 : Infinity;
  const intervalMs = connection.useExternalBackend ? 500 : 250;

  const result = await waitUntilHealthy(connection.backendUrl, {
    maxAttempts,
    intervalMs,
    requestTimeoutMs: 30000,
    onAttempt(attempt, url, last) {
      const detail = last.ok ? 'ok' : last.error || `HTTP ${last.status || '?'}`;
      console.log(`Attempting to connect to backend ${url} (attempt ${attempt})… ${detail}`);
    },
  });

  if (result.ok) {
    console.log('Backend is ready');
    return true;
  }

  handleBackendUnreachable(
    connection.healthUrl,
    result.error
      ? `${result.error} (after ${result.attempts} attempts)`
      : `Health check failed after ${result.attempts} attempts`
  );
  return false;
}

/**
 * Boot connection side of app start: local Express or external proxy UI, then health.
 * @param {{ startBackend: () => void }} opts
 * @returns {Promise<boolean>}
 */
export async function prepareConnectionForLaunch({ startBackend }) {
  const connection = getActiveConnection();
  if (connection.useExternalBackend) {
    console.log('[connection] External backend mode — skipping local Express fork');
    try {
      await ensureLocalUiServer(connection);
    } catch (err) {
      const { dialog, app } = requireCtx();
      console.error('[connection] Failed to start local UI server:', err.message);
      dialog.showErrorBox(
        'Cannot start AGNT UI',
        `External backend mode needs the packaged frontend (frontend/dist).\n\n${err.message}`
      );
      app.quit();
      return false;
    }
  } else {
    startBackend();
  }
  return waitForBackendReady();
}

/**
 * macOS dock activate with no windows: reopen main UI if healthy, else setup.
 * @param {{ createWindow: () => void, attachChrome: () => void }} opts
 */
export async function recoverOnActivate({ createWindow, attachChrome }) {
  const connection = getActiveConnection();

  if (!connection.useExternalBackend) {
    createWindow();
    attachChrome();
    return;
  }

  try {
    await ensureLocalUiServer(connection);
    const health = await probeBackendHealth(connection.backendUrl, 5000);
    if (health.ok) {
      console.log('[connection] activate: remote healthy — reopening main window');
      createWindow();
      attachChrome();
      return;
    }
    console.warn('[connection] activate: remote unhealthy —', health.error || health.status);
    showConnectionSetupWindow({
      error: health.error || `Health check failed (HTTP ${health.status || '?'})`,
      healthUrl: connection.healthUrl,
      backendUrl: connection.backendUrl,
    });
  } catch (err) {
    console.error('[connection] activate recovery failed:', err.message);
    showConnectionSetupWindow({
      error: err.message || 'Could not restore the desktop UI.',
      healthUrl: connection.healthUrl,
      backendUrl: connection.backendUrl,
    });
  }
}

export function showConnectionSetupWindow({ error, healthUrl, backendUrl } = {}) {
  const { BrowserWindow, dirname, getMainWindow, app } = requireCtx();

  if (connectionSetupWindow && !connectionSetupWindow.isDestroyed()) {
    connectionSetupWindow.focus();
    return connectionSetupWindow;
  }

  connectionSetupWindow = new BrowserWindow({
    width: 620,
    height: 640,
    title: 'AGNT — Connection Setup',
    frame: true,
    show: false,
    resizable: true,
    minimizable: true,
    backgroundColor: '#070710',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(dirname, 'preload.js'),
      webSecurity: true,
    },
  });

  const query = {};
  if (error) query.error = String(error).slice(0, 500);
  if (healthUrl) query.healthUrl = String(healthUrl);
  if (backendUrl) query.backendUrl = String(backendUrl);

  connectionSetupWindow.loadFile(path.join(dirname, 'electron', 'connection-setup.html'), { query });
  connectionSetupWindow.once('ready-to-show', () => {
    connectionSetupWindow.center();
    connectionSetupWindow.show();
  });
  connectionSetupWindow.on('closed', () => {
    connectionSetupWindow = null;
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      app.quit();
    }
  });

  return connectionSetupWindow;
}

function handleBackendUnreachable(healthUrl, detail) {
  const { dialog, app } = requireCtx();
  const connection = getActiveConnection();
  const message = detail || `Could not connect to ${healthUrl}`;
  console.error('[connection] Backend unreachable:', message);

  if (connection.useExternalBackend) {
    showConnectionSetupWindow({
      error: message,
      healthUrl,
      backendUrl: connection.backendUrl,
    });
    return;
  }

  dialog.showErrorBox(
    'Cannot reach AGNT backend',
    `${message}\n\nThe local backend failed to start. Check the console logs for errors.`
  );
  app.quit();
}

export function stopDesktopConnection() {
  if (localUiServer) {
    try {
      localUiServer.close();
    } catch (err) {
      console.warn('[local-ui] close failed:', err.message);
    }
    localUiServer = null;
    localUiOrigin = null;
  }
}

function registerConnectionIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  const { ipcMain, app } = requireCtx();

  // Sync snapshot for preload. External mode is same-origin (UI+proxy on loopback);
  // renderer uses window.location.origin/api — no injected remote BASE_URL.
  ipcMain.on('connection:get-desktop-runtime', (event) => {
    try {
      const c = getActiveConnection();
      event.returnValue = {
        useExternalBackend: Boolean(c.useExternalBackend),
        backendUrl: c.backendUrl || '',
        uiOrigin: localUiOrigin || null,
      };
    } catch (err) {
      event.returnValue = {
        useExternalBackend: false,
        backendUrl: '',
        uiOrigin: null,
        error: err.message,
      };
    }
  });

  ipcMain.handle('connection:get', () => {
    const userDataPath = app.getPath('userData');
    const effective = resolveConnectionConfig({ userDataPath });
    const stored = readStoredConnectionConfig(userDataPath);
    return {
      ...effective,
      stored,
      form: {
        useExternalBackend: stored.useExternalBackend || effective.useExternalBackend,
        backendUrl: stored.backendUrl || (effective.useExternalBackend ? effective.backendUrl : ''),
      },
    };
  });

  ipcMain.handle('connection:set', (_event, payload = {}) => {
    const userDataPath = app.getPath('userData');
    const useExternalBackend = Boolean(payload.useExternalBackend);
    let backendUrl = normalizeBackendUrl(payload.backendUrl || '');

    if (useExternalBackend) {
      const check = validateBackendUrl(backendUrl);
      if (!check.ok) {
        return { ok: false, error: check.error };
      }
      backendUrl = check.cleaned;
    }

    const stored = writeStoredConnectionConfig(userDataPath, {
      useExternalBackend,
      backendUrl: useExternalBackend ? backendUrl : backendUrl || '',
    });

    invalidateConnectionCache();

    return {
      ok: true,
      stored,
      requiresRestart: true,
      message: 'Connection settings saved. Restart AGNT to apply.',
    };
  });

  ipcMain.handle('connection:test', async (_event, payload = {}) => {
    const backendUrl =
      normalizeBackendUrl(payload.backendUrl) ||
      getActiveConnection().backendUrl ||
      `http://127.0.0.1:${process.env.PORT || 3333}`;
    const result = await probeBackendHealth(backendUrl);
    return { backendUrl, ...result };
  });

  ipcMain.handle('app:relaunch', () => {
    console.log('[connection] Relaunch requested');
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  ipcMain.handle('app:quit', () => {
    console.log('[connection] Quit requested from connection setup');
    app.quit();
    return { ok: true };
  });
}
