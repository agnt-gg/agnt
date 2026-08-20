import fs from 'fs';
import { app, BrowserWindow, Menu, globalShortcut, screen, ipcMain, nativeImage, shell, dialog, utilityProcess, protocol, net, clipboard, crashReporter, webContents } from 'electron';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

// DEBUG: Show which main.js is being loaded
console.log('=== LOADING MAIN.JS FROM:', import.meta.url, '===');
// http/https are no longer imported here: the only consumer was the inline
// health poller, which now lives in electron/backendHealth.js.
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// DIAGNOSTICS
// ============================================================================
// One boot id for this app launch, exported into the env so the backend and
// the workflow child inherit it. Every record from every process then shares
// a correlation key with no IPC required.
import { randomUUID } from 'crypto';
import { installDiagnostics, diagnosticsDir } from './backend/src/diagnostics/install.js';
import { installElectronCrashHooks } from './backend/src/diagnostics/electronHooks.js';
import {
  resolveConnection,
  writeConfig as writeConnectionConfig,
  normalizeRemoteUrl,
} from './electron/connectionConfig.js';
import { waitForBackend as pollBackendHealth, probeBackendOnce } from './electron/backendHealth.js';
import { localFilePathFromUrl } from './electron/localFileLink.js';

const BOOT_ID = randomUUID();
process.env.AGNT_BOOT_ID = BOOT_ID;

const { recorder } = installDiagnostics({
  proc: 'main',
  dir: diagnosticsDir(app.getPath('userData')),
  bootId: BOOT_ID,
  getState: () => ({
    backendPid: backendProcess?.pid,
    supervisorState: supervisor?.state,
    windowOpen: Boolean(mainWindow && !mainWindow.isDestroyed()),
    appVersion: typeof APP_VERSION === 'string' ? APP_VERSION : undefined,
  }),
});

// Platform-specific ffmpeg binary paths
const getFfmpegPath = () => {
  const platform = process.platform;
  let ffmpegBinary;

  if (platform === 'win32') {
    ffmpegBinary = 'ffmpeg.exe';
  } else if (platform === 'darwin') {
    ffmpegBinary = 'ffmpeg';
  } else {
    ffmpegBinary = 'ffmpeg';
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', ffmpegBinary)
    : path.join(__dirname, 'node_modules', 'ffmpeg-static', ffmpegBinary);
};

const ffmpegPath = getFfmpegPath();

// Make sure to set this environment variable
process.env.FFMPEG_PATH = ffmpegPath;

// Configure Puppeteer/Playwright to skip downloading browsers
// We will rely on system-installed browsers (Chrome, Edge, etc.) detected at runtime
// This prevents package conflicts on GNU/Linux and reduces bundle size
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';

// GPU hardware acceleration — enabled by default for smooth rendering.
// The original blanket disable (commit 4580f33, Feb 2026) was added to fix
// a black screen issue, but it forces all rendering through SwiftShader
// (CPU-based software rasterizer), causing ~98% CPU on the GPU process and
// severe sluggishness on canvas-heavy pages like the Workflow Designer.
//
// If you experience a black screen on launch, set AGNT_DISABLE_GPU=1 in
// your environment and restart AGNT.
if (process.env.AGNT_DISABLE_GPU === '1') {
  console.log('[GPU] Hardware acceleration disabled via AGNT_DISABLE_GPU=1');
  app.disableHardwareAcceleration();
}

// Register custom protocol for serving local files into the renderer.
// Rendered HTML (e.g. LLM-generated chat messages) uses agnt-file:// URLs
// instead of file:// so Chromium's webSecurity doesn't block them.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'agnt-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow;
let backendProcess;
// Which window attachWindowBehaviour() has already wired up (see there).
let behaviourAttachedTo = null;

// ============================================================================
// CONNECTION — local backend (default) vs remote backend
// ============================================================================
// The remote backend serves its own frontend, so "use a remote backend" is
// just pointing the window at a different origin: no proxy, no second origin,
// no CORS change, no version skew. Resolved once here; three guards below read
// it. Unconfigured => { mode: 'local' } => today's behaviour, byte for byte.
let connection = { mode: 'local', url: null, source: 'default' };
try {
  connection = resolveConnection({ userDataPath: app.getPath('userData') });
  if (connection.invalid) console.warn('[connection]', connection.invalid);
  console.log(
    connection.mode === 'remote'
      ? `[connection] remote backend: ${connection.url} (from ${connection.source})`
      : '[connection] local backend'
  );
} catch (err) {
  console.error('[connection] resolution failed, falling back to local:', err.message);
}
const isRemoteMode = () => connection.mode === 'remote' && Boolean(connection.url);

// ---------------------------------------------------------------------------
// RUNTIME connection state (as opposed to CONFIGURED intent)
// ---------------------------------------------------------------------------
// `connection` is what the user asked for and never changes at runtime.
// `activeMode` is what the app is actually talking to right now, which can
// differ after a per-session fallback. Keeping the two separate is what lets
// the UI say "configured for remote, currently running on this computer"
// instead of quietly rewriting the setting behind the user's back.
let activeMode = connection.mode;
let fellBack = false;
let connectPhase = isRemoteMode() ? 'connecting' : 'ready';
let healthPoll = null;
let localBackendSpawned = false;

// Set when the user chooses to share a backend that was ALREADY running on
// this port. Nothing was forked, so nothing may be reaped on quit either.
let localBackendAttached = false;
// Identity of the AGNT found squatting on the local port, if any.
let occupant = null;

const isRemoteActive = () => activeMode === 'remote' && Boolean(connection.url);
const statusPagePath = () => path.join(__dirname, 'electron', 'connection-error.html');
const localPort = () => Number(process.env.PORT || 3333);

/**
 * Windows shell APIs are unreliable with forward slashes, and every path that
 * arrives from a URL has them. Applied at the single point where a path meets
 * the OS so no caller has to remember.
 */
const nativePath = (p) => (process.platform === 'win32' ? String(p).replace(/\//g, '\\') : String(p));

/** Open an absolute path in whatever application the OS associates with it. */
async function openLocalPathInOS(absPath) {
  try {
    const errorMessage = await shell.openPath(nativePath(absPath));
    if (errorMessage) console.error('[Electron] openPath failed:', absPath, errorMessage);
  } catch (err) {
    console.error('[Electron] openPath threw:', absPath, err.message);
  }
}
const localBackendUrl = () => `http://localhost:${localPort()}`;

/**
 * Get a local backend, at most once per launch — but ASK FIRST.
 *
 * THE BUG THIS FIXES: this used to fork unconditionally and let the child
 * discover the collision. When an AGNT backend already owned the port (the
 * commonest cause being an orphan the previous launch failed to reap — see
 * reapBackend and the SIGTERM handler in backend/server.js), the child lost the
 * bind, retried five times, exited nonzero, and the supervisor read that as a
 * crash and quit the app. Meanwhile a healthy backend was answering on that
 * exact port the whole time.
 *
 * A collision is not a crash, it is a QUESTION — use the one that is running,
 * or replace it? — and the connection status page already exists to ask
 * questions like that. So resolve it before spawning anything.
 *
 * @returns {Promise<'spawned'|'occupied'|'already'>}
 */
async function ensureLocalBackend() {
  if (localBackendSpawned || localBackendAttached) return 'already';

  // Cheap in the normal case: nothing listening on loopback means an instant
  // ECONNREFUSED, not a timeout.
  const found = await probeBackendOnce({ port: localPort() });
  if (found.alive) {
    occupant = found;
    connectPhase = 'occupied';
    console.warn(
      `[connection] an AGNT backend is already listening on port ${localPort()}` +
        `${found.pid ? ` (pid ${found.pid})` : ''}${found.version ? `, version ${found.version}` : ''}` +
        ' — asking the user whether to use it or replace it.'
    );
    showStatusPage({
      phase: 'occupied',
      occupiedBy: 'agnt',
      port: localPort(),
      pid: found.pid,
      remoteVersion: found.version,
      // Without a pid there is nothing to signal, so "start fresh" cannot be
      // offered honestly. Older backends predate identity in /api/health.
      canReplace: Number.isInteger(found.pid),
    });
    return 'occupied';
  }

  localBackendSpawned = true;
  startBackend();
  return 'spawned';
}

/**
 * Normal local boot: get a backend, then wait for it and show the app.
 *
 * Split out of the ready handler because the poll must NOT start when the port
 * turned out to be occupied — it would succeed instantly against the occupant
 * and silently attach the user to a backend they never agreed to share.
 */
async function startLocalBoot() {
  if ((await ensureLocalBackend()) === 'occupied') return;
  healthPoll = pollBackendHealth({
    port: localPort(),
    log: (m) => console.log('[backend]', m),
    onReady: () => {
      healthPoll = null;
      supervisor.state = 'running';
      connectPhase = 'ready';
      console.log('Backend is ready. Creating main window...');
      createWindow();
      attachWindowBehaviour();
    },
  });
}

/**
 * Adopt the backend that was already running, without forking one.
 *
 * `localBackendAttached` is what makes this safe on the way out: reapBackend
 * only ever signals a child WE forked, so quitting this window can never kill
 * a backend that belongs to another app instance.
 */
function useExistingLocalBackend() {
  localBackendAttached = true;
  activeMode = 'local';
  connectPhase = 'ready';
  supervisor.state = 'running';
  console.log(`[connection] sharing the AGNT backend already on port ${localPort()}.`);
  loadActiveTarget();
  attachWindowBehaviour();
}

/**
 * Stop the backend that owns the port, then fork ours.
 *
 * Escalates, and verifies by PROBING rather than by trusting the signal: a pid
 * can exit while the socket lingers, and process.kill() reports nothing about
 * whether the port was actually released.
 */
async function replaceLocalBackend() {
  const pid = occupant?.pid;
  if (!Number.isInteger(pid)) return { ok: false, error: 'The running backend did not report a process id.' };

  const gone = async () => !(await probeBackendOnce({ port: localPort(), timeoutMs: 500 })).alive;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log(`[connection] stopping the backend on port ${localPort()} (pid ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    // ESRCH: already dead, and something else may hold the socket.
    if (err.code !== 'ESRCH') {
      return { ok: false, error: `Couldn't stop it — ${err.message}` };
    }
  }

  for (let i = 0; i < 20 && !(await gone()); i += 1) await wait(250);
  if (!(await gone())) {
    console.warn(`[connection] pid ${pid} ignored SIGTERM for 5s — SIGKILL.`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 8 && !(await gone()); i += 1) await wait(250);
  }
  if (!(await gone())) return { ok: false, error: 'It is still holding the port.' };

  occupant = null;
  connectPhase = 'connecting';
  pushConnectionState({ phase: 'connecting', detail: 'Starting AGNT on this computer…' });
  localBackendSpawned = true;
  startBackend();
  healthPoll = pollBackendHealth({
    port: localPort(),
    log: (m) => console.log('[backend]', m),
    onReady: () => {
      healthPoll = null;
      supervisor.state = 'running';
      connectPhase = 'ready';
      loadActiveTarget();
      attachWindowBehaviour();
    },
  });
  return { ok: true };
}

function pushConnectionState(patch = {}) {
  notifyRenderer('connection:state', {
    phase: connectPhase,
    url: connection.url,
    activeMode,
    fellBack,
    ...patch,
  });
}

/**
 * Put the connection status page on screen, creating the window if needed.
 * The page both listens for `connection:state` and asks for it on load; push on
 * did-finish-load so a race between loadFile and the push cannot leave it blank.
 */
function showStatusPage(patch = {}) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow({ initial: 'status' });
      mainWindow.webContents.once('did-finish-load', () => pushConnectionState(patch));
      return;
    }

    // Already showing it? Just push the new state. Calling loadFile again
    // RELOADS the page, which discards its listener, restarts its script and
    // flashes the card — for the commonest transition of all, connecting ->
    // failed, where nothing needs to be reloaded.
    if ((mainWindow.webContents.getURL() || '').includes('connection-error.html')) {
      pushConnectionState(patch);
      return;
    }

    mainWindow.loadFile(statusPagePath());
    mainWindow.webContents.once('did-finish-load', () => pushConnectionState(patch));
  } catch (err) {
    console.error('Failed to show the connection status page:', err.message);
  }
}

/** Point the existing window at whatever backend is currently active. */
function loadActiveTarget() {
  const target = isRemoteActive() ? connection.url : localBackendUrl();
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else mainWindow.loadURL(target);
}

/**
 * Poll the configured remote, then load it.
 *
 * The bound lives in electron/backendHealth.js and is WALL CLOCK. It used to be
 * an attempt count (24) with a 15s socket timeout per attempt, which measured
 * 366 SECONDS before the user was told anything when the server accepted TCP
 * and never replied — and during all of it there was no window at all.
 */
function beginRemoteConnect() {
  connectPhase = 'connecting';
  pushConnectionState({ attempt: 0, elapsedMs: 0 });
  healthPoll = pollBackendHealth({
    baseUrl: connection.url,
    log: (m) => console.log('[connection]', m),
    onAttempt: ({ attempt, elapsedMs }) => pushConnectionState({ attempt, elapsedMs }),
    onReady: () => {
      healthPoll = null;
      connectPhase = 'ready';
      supervisor.state = 'running';
      console.log(`[connection] remote backend reachable — loading ${connection.url}`);
      loadActiveTarget();
    },
    onFail: ({ why }) => {
      healthPoll = null;
      supervisor.state = 'running';
      // Opt-in only (Settings → Connection). Silently switching which DATABASE
      // someone is using is the "where did all my agents go?" confusion this
      // feature exists to remove, so it happens only when asked for — and even
      // then it is announced, per-session, and reported by connection:get.
      if (connection.fallbackToLocal === true) {
        console.warn(`[connection] remote unreachable (${why}) — using this computer for this session (opted in).`);
        return startLocalSessionFallback(why);
      }
      connectPhase = 'failed';
      console.error(`[connection] remote unreachable (${why}).`);
      showStatusPage({ phase: 'failed', why });
    },
  });
}

/**
 * Run a local backend for THIS LAUNCH ONLY.
 *
 * connection.json is deliberately untouched: a transient outage must not cost
 * the user the remote address they configured, and the next launch has to try
 * the remote again. Otherwise one bad afternoon permanently and silently moves
 * someone onto a different database.
 */
async function startLocalSessionFallback(why) {
  healthPoll?.cancel('switching to this computer');
  healthPoll = null;
  activeMode = 'local';
  fellBack = true;
  connectPhase = 'connecting';
  pushConnectionState({ phase: 'connecting', detail: 'Starting AGNT on this computer…' });
  // 'occupied' means the status page is now asking which backend to use, and
  // the poll below must not run: it would succeed instantly against the
  // occupant and answer the question on the user's behalf.
  if ((await ensureLocalBackend()) === 'occupied') return;
  // Local policy: unbounded, exactly as a normal local boot. Our own backend is
  // coming up and there is nothing better to fall back TO.
  healthPoll = pollBackendHealth({
    port: localPort(),
    log: (m) => console.log('[connection:local]', m),
    onReady: () => {
      healthPoll = null;
      connectPhase = 'ready';
      supervisor.state = 'running';
      console.log(`[connection] running on this computer (${why}). Configured remote left unchanged.`);
      loadActiveTarget();
    },
  });
}

/** Re-try the CONFIGURED connection in place — no process restart. */
function retryConfiguredConnection() {
  healthPoll?.cancel('retrying');
  healthPoll = null;
  activeMode = connection.mode;
  fellBack = false;
  if (!isRemoteActive()) {
    // startLocalSessionFallback calls ensureLocalBackend itself; calling it
    // here too would probe the port twice for one user action.
    return startLocalSessionFallback('retry');
  }
  showStatusPage({ phase: 'connecting', attempt: 0, elapsedMs: 0 });
  beginRemoteConnect();
}

// ============================================================================
// BACKEND SUPERVISOR - sanctioned self-restart support
// ============================================================================
// Exit code 42 from the backend means "respawn me" (see
// backend/src/services/RestartManager.js). Any other nonzero exit keeps the
// pre-existing crash semantics (log + quit in 5s).
const RESTART_EXIT_CODE = 42;
// Declared in backend/server.js as PORT_IN_USE_EXIT_CODE. "Something else owns
// the port" is a connection condition with a UI, not a crash — exiting 1 for it
// made the supervisor quit the entire app over a machine that was fine.
const PORT_IN_USE_EXIT_CODE = 43;
const supervisor = {
  state: 'starting', // 'starting' | 'running' | 'restarting' | 'quitting'
  restartTimestamps: [],
  FLAP_WINDOW_MS: 60_000,
  FLAP_MAX: 3, // >3 restarts inside 60s = something is broken, stop the loop
};

function notifyRenderer(channel, payload = {}) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (err) {
    console.warn('notifyRenderer failed:', err.message);
  }
}

/**
 * Single exit handler for BOTH spawn paths (dev fork + packaged
 * utilityProcess). Replaces the two previous inline 'exit' listeners.
 */
function handleBackendExit(code, signal, lastStderr, lastStdout) {
  console.log(`Backend process exited with code ${code}, signal ${signal ?? 'n/a'}`);

  // Terminal state wins: if the app is quitting, never respawn. Prevents
  // the zombie-backend-into-dying-Electron race.
  if (supervisor.state === 'quitting') {
    console.log('App is quitting - not respawning backend.');
    return;
  }

  if (code === PORT_IN_USE_EXIT_CODE) {
    // Reached only when the preflight in ensureLocalBackend found nothing that
    // ANSWERS AGNT's health check, yet the bind still failed — i.e. a non-AGNT
    // program owns the port. Respawning cannot help and quitting is a lie about
    // what went wrong, so hand it to the connection page, which is the one
    // surface built to explain "the backend you wanted isn't reachable".
    localBackendSpawned = false; // let "Try again" fork again
    // The poll started alongside this fork is now chasing a backend that will
    // never arrive. Left running it retries every 250ms for the life of the app.
    healthPoll?.cancel('port is held by another program');
    healthPoll = null;
    connectPhase = 'occupied';
    console.error(`[connection] port ${localPort()} is held by something that is not AGNT.`);
    showStatusPage({
      phase: 'occupied',
      occupiedBy: 'unknown',
      port: localPort(),
      pid: null,
      canReplace: false,
    });
    return;
  }

  if (code === RESTART_EXIT_CODE) {
    // Sanctioned restart. Flap guard first.
    const now = Date.now();
    supervisor.restartTimestamps = supervisor.restartTimestamps.filter(
      (t) => now - t < supervisor.FLAP_WINDOW_MS
    );
    if (supervisor.restartTimestamps.length >= supervisor.FLAP_MAX) {
      console.error(
        `Backend restart flapping (${supervisor.FLAP_MAX}+ in ${supervisor.FLAP_WINDOW_MS / 1000}s). ` +
          'Refusing to respawn. Quitting in 5 seconds...'
      );
      setTimeout(() => app.quit(), 5000);
      return;
    }
    supervisor.restartTimestamps.push(now);
    supervisor.state = 'restarting';
    notifyRenderer('backend:restarting');
    console.log('Sanctioned backend restart - respawning...');

    // Brief pause for OS-level socket/handle cleanup, then respawn with a
    // FRESH env snapshot (startBackend rebuilds .env layering from disk, so
    // "restart yourself" doubles as credential hot-reload).
    setTimeout(() => {
      // GUARD 1: in remote mode there is no local backend to respawn. This
      // branch is only reachable via handleBackendExit, which itself can only
      // fire for a process we forked — but the guard is kept explicit so the
      // invariant survives future edits to the supervisor.
      if (isRemoteMode()) {
        console.log('Remote backend mode — nothing to respawn.');
        return;
      }
      startBackend();
      pollBackendHealth({
        port: process.env.PORT || 3333,
        log: (m) => console.log('[backend]', m),
        onReady: () => {
          supervisor.state = 'running';
          console.log('Backend respawned and healthy.');
          notifyRenderer('backend:restarted');
          // Reload the renderer so the UI reconnects to the fresh backend
          // instead of sitting on dead sockets/requests looking frozen.
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('Reloading renderer against fresh backend...');
              mainWindow.webContents.reload();
            }
          } catch (err) {
            console.warn('Renderer reload after restart failed:', err.message);
          }
        },
      });
    }, 500);
    return;
  }

  // Unsanctioned nonzero exit: pre-existing crash behavior, unchanged.
  if (code !== 0 && code !== null) {
    // Persist the dying backend's output. Without this the only artifact is
    // whatever happens to be in a developer's terminal scrollback — and in a
    // packaged build there is no terminal at all.
    recorder.dumpCrash('backend-exit', new Error(`backend exited with code ${code}`), {
      code,
      signal,
      supervisorState: supervisor.state,
      stderrTail: (lastStderr || '').slice(-4000),
      stdoutTail: (lastStdout || '').slice(-2000),
    });
    console.error('Backend process crashed!');
    console.error('Exit code:', code);
    if (signal) console.error('Signal:', signal);
    console.error('Last stderr output:', (lastStderr || '').slice(-500));
    console.error('Last stdout output:', (lastStdout || '').slice(-500));
    console.error('App will quit in 5 seconds...');
    setTimeout(() => {
      app.quit();
    }, 5000);
  }
}

// ============================================================================
// AUTO-UPDATE SYSTEM
// ============================================================================
// Read version dynamically from package.json - NEVER hardcode!
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const APP_VERSION = packageJson.version;
const UPDATE_CHECK_URL = 'https://agnt.gg/api/updates/check';

console.log(`[Update] App version from package.json: ${APP_VERSION}`);

/**
 * Get the platform identifier for update checks
 */
function getPlatformId() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return 'win';
  } else if (platform === 'darwin') {
    return arch === 'arm64' ? 'mac-arm' : 'mac-intel';
  } else if (platform === 'linux') {
    return 'linux-appimage'; // Default to AppImage for GNU/Linux
  }
  return 'win'; // Fallback
}

/**
 * Check for updates from agnt.gg
 */
function checkForUpdates() {
  return new Promise((resolve, reject) => {
    const platform = getPlatformId();
    const url = `${UPDATE_CHECK_URL}?version=${APP_VERSION}&platform=${platform}`;

    console.log(`[Update] Checking for updates: ${url}`);

    https
      .get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const updateInfo = JSON.parse(data);
            console.log('[Update] Response:', updateInfo);

            if (updateInfo.updateAvailable) {
              console.log(`[Update] New version available: ${updateInfo.latestVersion}`);
            } else {
              console.log('[Update] App is up to date');
            }

            resolve(updateInfo);
          } catch (error) {
            console.error('[Update] Failed to parse response:', error);
            reject(error);
          }
        });
      })
      .on('error', (error) => {
        console.error('[Update] Check failed:', error);
        reject(error);
      });
  });
}

/**
 * Send update info to renderer process
 */
function notifyRendererOfUpdate(updateInfo) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-available', updateInfo);
  }
}

// IPC handlers for update system
// ─────────────────── Browser widget: CDP bridge lifecycle ───────────────────
// The Browser widget renders a real Chromium surface inside AGNT and lets an
// agent drive it. The agent is a separate Python process, so it needs a CDP
// endpoint — but Electron only offers a PAGE-scoped debugger, and browser-use
// speaks the BROWSER protocol. CdpBridge closes that gap over a loopback socket
// scoped to one webContents and one token. See electron/CdpBridge.js for the
// measured evidence behind its (small) emulated surface.
//
// Keyed by webContents id so a widget that re-renders reuses its bridge instead
// of stacking a second debugger on the same surface.
const browserBridges = new Map();

function closeBrowserBridge(webContentsId) {
  const bridge = browserBridges.get(webContentsId);
  if (!bridge) return false;
  browserBridges.delete(webContentsId);
  try { bridge.close(); } catch (err) { console.error('[browser-bridge] close failed:', err.message); }
  return true;
}

ipcMain.handle('browser-bridge:start', async (_evt, webContentsId) => {
  try {
    const existing = browserBridges.get(webContentsId);
    if (existing && !existing.closed) return { ok: true, cdpUrl: existing.cdpUrl, reused: true };

    const guest = webContents.fromId(webContentsId);
    if (!guest || guest.isDestroyed()) {
      return { ok: false, error: 'That browser surface no longer exists.' };
    }

    const { CdpBridge } = await import('./electron/CdpBridge.js');
    const bridge = new CdpBridge(guest, { log: (m) => console.log(`[browser-bridge:${webContentsId}]`, m) });
    const cdpUrl = await bridge.start();
    browserBridges.set(webContentsId, bridge);

    // If the surface goes away underneath us, take the bridge with it — a
    // bridge holding a debugger on a destroyed webContents is a leak that
    // reports itself as a working endpoint.
    guest.once('destroyed', () => closeBrowserBridge(webContentsId));

    return { ok: true, cdpUrl, reused: false };
  } catch (err) {
    console.error('[browser-bridge] start failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('browser-bridge:stop', (_evt, webContentsId) => ({ ok: closeBrowserBridge(webContentsId) }));

app.on('before-quit', () => {
  for (const id of [...browserBridges.keys()]) closeBrowserBridge(id);
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const updateInfo = await checkForUpdates();
    return updateInfo;
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return APP_VERSION;
});

// Renderer diagnostics relay. The renderer is sandboxed with no fs access, so
// window.onerror / unhandledrejection / Vue errorHandler reach disk via main.
ipcMain.on('diagnostics:client-error', (_event, payload = {}) => {
  try {
    recorder.write(payload.level || 'ERROR', payload.src || 'renderer', payload.msg || 'client error', {
      err: payload.err,
      data: {
        url: payload.url,
        line: payload.line,
        col: payload.col,
        componentStack: payload.componentStack,
      },
    });
  } catch (err) {
    console.warn('diagnostics relay failed:', err.message);
  }
});

ipcMain.on('open-download-page', () => {
  shell.openExternal('https://agnt.gg/downloads');
});

ipcMain.on('open-external-url', (event, url) => {
  if (url && typeof url === 'string' && url.startsWith('http')) {
    shell.openExternal(url);
  } else {
    console.error('[Electron] Invalid URL passed to open-external-url:', url);
  }
});

// Reveal a file or folder in the OS file manager (Explorer / Finder / Files).
// Used by the artifacts file tree right-click menu.
ipcMain.on('shell:show-item-in-folder', (event, fullPath) => {
  if (typeof fullPath !== 'string' || !fullPath) {
    console.error('[Electron] shell:show-item-in-folder: invalid path:', fullPath);
    return;
  }
  shell.showItemInFolder(fullPath);
});

/**
 * Native "choose a folder" dialog, for settings that hold a directory path.
 *
 * WHY THIS REFUSES WHEN THE BACKEND IS REMOTE
 * -------------------------------------------
 * A folder path is only meaningful to the process that will open it, and the
 * workspace root is created and read by the BACKEND (FileSystemRoutes does the
 * mkdir). When the backend is another machine, this dialog browses the wrong
 * filesystem: the user picks a folder they can see, we send it to a server
 * where that path is absent or — worse — is a different real directory. So the
 * picker declines rather than producing a plausible wrong answer, and the
 * renderer explains why.
 *
 * `isRemoteActive()` rather than `connection.mode`, deliberately: after a
 * per-session fallback the configured mode says remote while the app is
 * demonstrably running against this computer, and in THAT state browsing is
 * correct. The question is what the backend is actually talking to.
 *
 * Resolves rather than throws on cancel — closing a dialog is an ordinary
 * outcome, not an error, and making callers try/catch it invites a bare catch
 * that also swallows real failures.
 */
ipcMain.handle('dialog:choose-directory', async (_evt, options = {}) => {
  if (isRemoteActive()) {
    return { ok: false, reason: 'remote-backend', remoteUrl: connection.url || null };
  }

  // Parent the dialog to the window. Unparented, Windows is free to place it
  // BEHIND the app, which reads as a freeze — the user clicked Browse and
  // nothing happened, and the modal they cannot see is swallowing their clicks.
  const parent = BrowserWindow.getFocusedWindow() || mainWindow || null;
  const startIn = typeof options.defaultPath === 'string' ? options.defaultPath.trim() : '';

  const dialogOptions = {
    title: typeof options.title === 'string' && options.title ? options.title : 'Choose a folder',
    // 'createDirectory' is the macOS New Folder button; on Windows the native
    // dialog always offers one. Without it a Mac user cannot pick a folder
    // that does not exist yet, which is most of them on a fresh install.
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: typeof options.buttonLabel === 'string' && options.buttonLabel ? options.buttonLabel : 'Use this folder',
  };
  // Only set defaultPath when we have one. Passing '' makes the dialog open at
  // an unpredictable location rather than the OS default.
  if (startIn) dialogOptions.defaultPath = startIn;

  try {
    const result = parent
      ? await dialog.showOpenDialog(parent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    const chosen = result?.filePaths?.[0];
    if (result?.canceled || !chosen) return { ok: false, reason: 'canceled' };
    return { ok: true, path: chosen };
  } catch (err) {
    console.error('[Electron] dialog:choose-directory failed:', err);
    return { ok: false, reason: 'failed', error: String(err?.message || err) };
  }
});

// Open a folder directly in the OS file manager. For files, prefer
// shell:show-item-in-folder — openPath on a file would launch it in its
// associated app, which isn't what the menu action implies.
ipcMain.on('shell:open-path', async (event, fullPath) => {
  if (typeof fullPath !== 'string' || !fullPath) {
    console.error('[Electron] shell:open-path: invalid path:', fullPath);
    return;
  }
  try {
    const errorMessage = await shell.openPath(nativePath(fullPath));
    if (errorMessage) {
      console.error('[Electron] shell:open-path failed:', errorMessage);
    }
  } catch (err) {
    console.error('[Electron] shell:open-path threw:', err);
  }
});
// ============================================================================

// Function to start the bundled backend executable
function startBackend() {
  // A fresh child gets a fresh reaping budget — otherwise a sanctioned restart
  // (exit 42) after a reap would leave the new backend unkillable on quit.
  backendReaped = false;
  // With ASAR enabled, backend files are inside the archive but accessible via Electron's patched fs
  // __dirname will be inside app.asar when packaged (e.g., C:\...\resources\app.asar)
  const serverPath = path.join(__dirname, 'backend', 'server.js');

  // IMPORTANT: CWD cannot be inside ASAR archive - use userData directory instead
  // The backend code will still read files from ASAR via __dirname (Electron patches fs)
  // but the working directory must be a real writable filesystem path
  const backendCwd = app.isPackaged ? app.getPath('userData') : path.join(__dirname, 'backend');

  // For native modules, use the unpacked path when ASAR is enabled
  const nodeModulesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
    : path.join(__dirname, 'node_modules');

  console.log('Starting backend server at:', serverPath);
  console.log('Using working directory:', backendCwd);
  console.log('NODE_PATH set to:', nodeModulesPath);
  console.log('app.isPackaged:', app.isPackaged);
  console.log('process.execPath:', process.execPath);
  console.log('__dirname:', __dirname);
  console.log('resourcesPath:', process.resourcesPath);

  // Verify that the backend server file exists
  if (!fs.existsSync(serverPath)) {
    console.error('ERROR: Backend server file does not exist at:', serverPath);
    app.quit();
    return;
  } else {
    console.log('Backend server file exists.');
  }

  // Config files location: user data for packaged app (writable), backend dir for dev
  const userDataPath = app.getPath('userData');
  const envPath = app.isPackaged
    ? path.join(userDataPath, '.env')
    : path.join(__dirname, 'backend', '.env');
  const mcpPath = app.isPackaged
    ? path.join(userDataPath, 'mcp.json')
    : path.join(__dirname, 'backend', 'mcp.json');

  // Copy default config files to user data on first run (if they don't exist)
  if (app.isPackaged) {
    const defaultEnvPath = path.join(__dirname, 'backend', '.env');
    const defaultMcpPath = path.join(__dirname, 'backend', 'mcp.json');

    if (!fs.existsSync(envPath) && fs.existsSync(defaultEnvPath)) {
      try {
        fs.copyFileSync(defaultEnvPath, envPath);
        console.log('Copied default .env to user data:', envPath);
      } catch (err) {
        console.warn('Could not copy default .env:', err.message);
      }
    }
    if (!fs.existsSync(mcpPath) && fs.existsSync(defaultMcpPath)) {
      try {
        fs.copyFileSync(defaultMcpPath, mcpPath);
        console.log('Copied default mcp.json to user data:', mcpPath);
      } catch (err) {
        console.warn('Could not copy default mcp.json:', err.message);
      }
    }
  }

  let fileEnv = {};
  if (!fs.existsSync(envPath)) {
    console.warn('WARNING: .env file does not exist at:', envPath);
  } else {
    console.log('.env file found at:', envPath);
    try {
      const envContent = fs.readFileSync(envPath);
      fileEnv = dotenv.parse(envContent);
      console.log('Successfully parsed .env file');
    } catch (err) {
      console.error('Failed to parse .env file:', err);
    }
  }

  // Packaged: overlay the user's .env ON TOP of the bundled defaults. The
  // first-run copy above only happens once, so without this merge, existing
  // installs never receive keys added to backend/.env in later releases
  // (e.g. ANTIGRAVITY_CLIENT_ID). Defaults form the base; anything the user
  // customized in their AppData .env still wins. Runtime-only — the user's
  // file is never modified.
  if (app.isPackaged) {
    const defaultEnvPath = path.join(__dirname, 'backend', '.env');
    if (fs.existsSync(defaultEnvPath)) {
      try {
        const defaultEnv = dotenv.parse(fs.readFileSync(defaultEnvPath));
        const missingKeys = Object.keys(defaultEnv).filter((k) => !(k in fileEnv));
        fileEnv = { ...defaultEnv, ...fileEnv };
        if (missingKeys.length > 0) {
          console.log('Bundled .env defaults applied for missing keys:', missingKeys.join(', '));
        }
      } catch (err) {
        console.warn('Failed to read bundled default .env:', err.message);
      }
    }
  }

  // User keys overlay: load root agnt-pro/.env on top of backend/.env so users
  // can put their personal keys (OPENAI_API_KEY, etc.) in the repo-root .env
  // — backend/.env stays the source of truth for system stuff (JWT, encryption,
  // OAuth client IDs). Root wins on conflict so a user override always sticks.
  if (!app.isPackaged) {
    const userEnvPath = path.join(__dirname, '.env');
    if (fs.existsSync(userEnvPath) && userEnvPath !== envPath) {
      try {
        const userEnv = dotenv.parse(fs.readFileSync(userEnvPath));
        fileEnv = { ...fileEnv, ...userEnv };
        console.log('User .env overlay loaded:', userEnvPath, `(${Object.keys(userEnv).length} keys)`);
      } catch (err) {
        console.warn('Failed to read user .env at', userEnvPath, ':', err.message);
      }
    }
  }

  // NODE_PATH: include both ASAR modules and unpacked native modules
  const nodePathValue = app.isPackaged
    ? `${path.join(__dirname, 'node_modules')}${path.delimiter}${nodeModulesPath}`
    : nodeModulesPath;  // For packaged apps, unpacked files are in app.asar.unpacked (outside the ASAR)
  // utilityProcess can't read from ASAR, so plugins must be unpacked
  const unpackedPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : __dirname;

  // ─── macOS GUI PATH fix ───────────────────────────────────────────────
  // macOS launchd gives GUI apps a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
  // that excludes Homebrew, nvm, volta, fnm, etc. This causes spawn('node', ...)
  // and spawn('python3', ...) to fail with ENOENT inside tool execution.
  // Append well-known binary locations so user-installed tools are discoverable.
  // Nonexistent directories in PATH are harmlessly ignored by the OS.
  if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    const extraPaths = [
      '/opt/homebrew/bin',            // Homebrew (Apple Silicon)
      '/opt/homebrew/sbin',
      '/usr/local/bin',               // Homebrew (Intel) / manual installs
      '/usr/local/sbin',
      path.join(home, '.nvm/current/bin'),
      path.join(home, '.volta/bin'),
      path.join(home, '.fnm/current/bin'),
      path.join(home, '.local/bin'),
    ];
    const currentPath = process.env.PATH || '';
    const currentEntries = currentPath.split(':');
    const missing = extraPaths.filter(p => p && !currentEntries.includes(p));
    if (missing.length > 0) {
      process.env.PATH = currentPath + ':' + missing.join(':');
      console.log('[PATH] macOS GUI fix — appended:', missing.join(', '));
    }
  }

  const env = {
    ...process.env,
    ...fileEnv, // Merge file env vars
    ENV_PATH: envPath,
    MCP_CONFIG_PATH: mcpPath,
    USER_DATA_PATH: userDataPath,
    APP_PATH: __dirname, // Pass the app path for backend to access bundled files
    UNPACKED_PATH: unpackedPath, // Path to unpacked files (for utilityProcess which can't read ASAR)
    NODE_ENV: app.isPackaged ? 'production' : 'development',
    NODE_PATH: nodePathValue,
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  };

  // Use bounded buffers to prevent "Invalid string length" errors
  // Keep only the last 50KB of output for error reporting
  const MAX_BUFFER_SIZE = 50000;
  let backendStderr = '';
  let backendStdout = '';

  if (app.isPackaged) {
    // In packaged app, use Electron's utilityProcess.fork() which works with the bundled Node runtime
    console.log('Using utilityProcess.fork() for packaged app');
    backendProcess = utilityProcess.fork(serverPath, [], {
      cwd: backendCwd,
      stdio: 'pipe',
      env: env,
    });

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      backendStdout += output;
      if (backendStdout.length > MAX_BUFFER_SIZE) {
        backendStdout = backendStdout.slice(-MAX_BUFFER_SIZE);
      }
      console.log('Backend stdout:', output);
    });

    backendProcess.stderr.on('data', (data) => {
      const output = data.toString();
      backendStderr += output;
      if (backendStderr.length > MAX_BUFFER_SIZE) {
        backendStderr = backendStderr.slice(-MAX_BUFFER_SIZE);
      }
      console.error('Backend stderr:', output);
    });

    backendProcess.on('spawn', () => {
      console.log('Backend process spawned successfully');
    });

    backendProcess.on('exit', (code) => {
      handleBackendExit(code, null, backendStderr, backendStdout);
    });
  } else {
    // In development, use the system Node that npm resolved — not Electron's
    // process.execPath. Inside Electron, process.execPath points to the
    // Electron binary, which can SIGSEGV when loading native modules compiled
    // for system Node (ABI mismatch). See: https://github.com/agnt-gg/agnt/issues/40
    const devNodeExecPath =
      process.env.npm_node_execpath ||
      process.env.NODE ||
      process.env.npm_config_node ||
      'node';
    console.log('Using child_process.fork() for development');
    console.log('Development backend Node execPath:', devNodeExecPath);
    backendProcess = fork(serverPath, [], {
      cwd: backendCwd,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: env,
      execPath: devNodeExecPath,
    });

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      backendStdout += output;
      if (backendStdout.length > MAX_BUFFER_SIZE) {
        backendStdout = backendStdout.slice(-MAX_BUFFER_SIZE);
      }
      console.log('Backend stdout:', output);
    });

    backendProcess.stderr.on('data', (data) => {
      const output = data.toString();
      backendStderr += output;
      if (backendStderr.length > MAX_BUFFER_SIZE) {
        backendStderr = backendStderr.slice(-MAX_BUFFER_SIZE);
      }
      console.error('Backend stderr:', output);
    });

    backendProcess.on('error', (error) => {
      console.error('Backend process error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
      });
    });

    backendProcess.on('exit', (code, signal) => {
      handleBackendExit(code, signal, backendStderr, backendStdout);
    });
  }
}

// Function to create the main Electron window.
function createWindow(opts = {}) {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(960, height),
    title: 'AGNT',
    frame: false,
    show: false,
    icon: icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      // Enable media permissions for speech recognition
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Powers the Browser widget: a real Chromium surface rendered INSIDE the
      // app, which an agent then drives over CDP (see electron/CdpBridge.js).
      // <webview> is deliberately chosen over opening a second BrowserWindow —
      // the whole point is that the browser lives in the canvas, not beside it.
      // Guest content is isolated by default: no node integration, its own
      // session partition, and no preload is attached to it.
      webviewTag: true,
    },
    autoHideMenuBar: true,
    backgroundColor: '#070710',
  });

  if (process.platform === 'darwin') {
    app.dock.setIcon(iconPath);
  }

  /**
   * WebRTC candidate policy: the default-route interface only.
   *
   * The natural-voice session (frontend useRealtimeVoice.js — the app's only
   * RTCPeerConnection) negotiates ICE against OpenAI. Chromium's default
   * offers host candidates from EVERY adapter, and a dev/power-user Windows
   * box carries plenty that cannot reach the internet — WSL and Hyper-V
   * vSwitches, APIPA stubs, VPN overlays. Each dead pairing burns STUN
   * retransmit timers (~500ms initial RTO, backing off, in priority order)
   * before the one interface with a default route gets its turn, which the
   * user experiences as seconds of "Connecting…" before the mic goes live.
   *
   * 'default_public_interface_only' restricts gathering to the interface the
   * OS already routes traffic through — the only candidate that was ever
   * going to work — and stops WebRTC advertising every private LAN address,
   * which is the setting privacy-hardened browsers ship anyway. If a second
   * WebRTC consumer that needs LAN candidates ever appears, this policy is
   * the first thing to revisit.
   */
  mainWindow.webContents.setWebRTCIPHandlingPolicy('default_public_interface_only');

  // This allowlist gates EVERY privileged capability Chromium asks about, not
  // just the microphone it was originally written for. A permission that is
  // absent is denied SILENTLY: requestFullscreen() never settles, no
  // 'fullscreenerror' fires, and document.fullscreenEnabled stays true, so the
  // browser still paints a fullscreen button that does nothing. Anything added
  // here must be a deliberate, named decision — hence the grouped sets.
  const MEDIA_PERMISSIONS = ['media', 'microphone', 'audioCapture'];
  const CLIPBOARD_PERMISSIONS = ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'];
  // 'fullscreen' backs element.requestFullscreen(): every <video> control bar
  // in chat, artifact previews, chart/3D popouts and embedded widgets.
  // pointerLock/keyboardLock are the same class (renderer-driven display
  // control behind a user gesture) and are what interactive canvases need.
  const DISPLAY_PERMISSIONS = ['fullscreen', 'pointerLock', 'keyboardLock'];
  const ALLOWED_PERMISSIONS = [...MEDIA_PERMISSIONS, ...CLIPBOARD_PERMISSIONS, ...DISPLAY_PERMISSIONS];

  // Both handlers read ONE list. They were duplicated literals, which is
  // exactly how a grant drifts out of one of them unnoticed.
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const granted = ALLOWED_PERMISSIONS.includes(permission);
    if (!granted) console.warn(`[permissions] denied: ${permission}`);
    callback(granted);
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return ALLOWED_PERMISSIONS.includes(permission);
  });

  // Open DevTools for debugging.
  // mainWindow.webContents.openDevTools();

  // PRD-054: native right-click context menu — copy/cut/paste/select-all plus
  // spellcheck suggestions in editable fields. Chromium provides the data via
  // the context-menu event; without a handler Electron shows nothing at all.
  mainWindow.webContents.on('context-menu', (event, params) => {
    const template = [];

    // Spellcheck: suggestions for the misspelled word under the cursor.
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        });
      }
      template.push({
        label: `Add "${params.misspelledWord}" to dictionary`,
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      template.push({ type: 'separator' });
    }

    if (params.isEditable) {
      template.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      );
    } else if (params.selectionText.trim()) {
      template.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
    }

    if (params.linkURL) {
      if (template.length && template[template.length - 1].type !== 'separator') {
        template.push({ type: 'separator' });
      }
      template.push({
        label: 'Copy Link Address',
        click: () => clipboard.writeText(params.linkURL),
      });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      if (template.length && template[template.length - 1].type !== 'separator') {
        template.push({ type: 'separator' });
      }
      template.push({
        label: 'Copy Image',
        click: () => mainWindow.webContents.copyImageAt(params.x, params.y),
      });
    }

    // Trim a trailing separator so the menu never ends with a divider.
    while (template.length && template[template.length - 1].type === 'separator') {
      template.pop();
    }

    if (template.length) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    }
  });

  // Register popup-window handling exactly once. Previously this lived inside
  // a `did-finish-load` callback, which fires on every navigation/reload —
  // each fire stacked another `did-create-window` listener, so popup events
  // were being logged (and handled) multiple times per real event.
  mainWindow.webContents.setWindowOpenHandler(({ url, features }) => {
    console.log('Window open requested:', { url, features });

    // A link to a file on this machine is opened BY THE OS, from its real
    // path. Handing it to shell.openExternal instead sends the user's browser
    // at http://localhost:3333/api/local-file/... — an origin it has no
    // session for, so the answer is "Authentication required" rather than the
    // file. See electron/localFileLink.js.
    const localPath = localFilePathFromUrl(url, { port: localPort() });
    if (localPath) {
      openLocalPathInOS(localPath);
      return { action: 'deny' };
    }

    // Check if this is a popup window (OAuth windows have specific features like width/height)
    // Features string will contain things like "width=600,height=700,toolbar=no"
    const isPopup = features.includes('width=') && features.includes('height=');

    if (isPopup) {
      console.log('Opening OAuth popup in Electron window');
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 700,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
          },
          autoHideMenuBar: true,
          show: true,
        },
        outlivesOpener: true,
      };
    }

    // For regular links (not popups), open in external browser
    console.log('Opening link in external browser:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (childWindow) => {
    console.log('Child window created');

    childWindow.webContents.on('will-redirect', (event, url) => {
      console.log('Popup will redirect to:', url);
      if (url.includes('localhost') && (url.includes('/oauth-callback') || url.includes('/oauth/callback'))) {
        console.log('OAuth callback redirect to localhost detected');
      }
    });

    childWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      console.log('Popup navigating to:', navigationUrl);
      if (navigationUrl.includes('localhost') && (navigationUrl.includes('/oauth-callback') || navigationUrl.includes('/oauth/callback'))) {
        console.log('OAuth callback to localhost detected in popup, allowing navigation');
      } else if (navigationUrl.includes('/oauth-callback') || navigationUrl.includes('/oauth/callback')) {
        console.log('OAuth callback detected in popup');
      }
    });

    childWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('Popup failed to load:', { errorCode, errorDescription, validatedURL });
      if (validatedURL && validatedURL.includes('localhost') && (validatedURL.includes('/oauth-callback') || validatedURL.includes('/oauth/callback'))) {
        console.log('Failed to load localhost OAuth callback, attempting to load directly');
        childWindow.loadURL(validatedURL);
      }
    });

    childWindow.webContents.on('did-finish-load', () => {
      console.log('Popup finished loading:', childWindow.webContents.getURL());
    });
  });

  // Load the URL that is serving your API and frontend.
  //
  // GUARD 3: this single line was the desktop app's only assumption about
  // WHICH backend it belongs to. In remote mode the backend on the other
  // machine serves its own frontend, so the app is same-origin with it and
  // auth, sockets and OAuth behave exactly as they do in a browser.
  const port = process.env.PORT || 3333;
  if (opts.initial === 'status') {
    // Remote mode shows a live status page FIRST so the app always has a window.
    // Loading the remote origin here instead left a blank frame for as long as
    // the server took to answer — which, for an unresponsive host, was forever.
    mainWindow.loadFile(statusPagePath());
  } else {
    mainWindow.loadURL(isRemoteActive() ? connection.url : `http://localhost:${port}`);
  }

  // The OTHER way this app could die: the health check passes, then the origin
  // drops (or never served a frontend), and Chromium paints its own "can't be
  // reached" page — which has no escape hatch, no menu, and no way back. This
  // also covers the remote disappearing mid-session and the user hitting reload.
  // Scoped to remote mode so the local path keeps exactly today's behaviour.
  mainWindow.webContents.on('did-fail-load', (_evt, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED — a superseded navigation, not a failure
    if (!isRemoteActive()) return;
    if (typeof validatedURL === 'string' && validatedURL.startsWith('file://')) return; // the status page itself
    console.error(`[connection] main-frame load failed (${errorCode} ${errorDescription}) for ${validatedURL}`);
    connectPhase = 'failed';
    showStatusPage({ phase: 'failed', why: `${errorDescription} (${errorCode})` });
  });

  mainWindow.center();
  mainWindow.show();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Add IPC listeners for window controls.
  ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('maximize-window', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('close-window', () => {
    if (mainWindow) mainWindow.close();
  });
}

// ============================================================================
// CONNECTION IPC — drives Settings → Connection
// ============================================================================
// Registered at module scope (not inside createWindow) so the connection error
// page can use them too: that page loads when there is no frontend to talk to,
// and it is the user's only escape hatch back to a working app.
ipcMain.handle('connection:get', () => ({
  mode: connection.mode,
  url: connection.url,
  source: connection.source,
  // What the app is ACTUALLY talking to, which differs from `mode` after a
  // per-session fallback. Without this the UI would claim "remote" while the
  // user was demonstrably looking at local data — the exact lie to avoid.
  activeMode,
  fellBack,
  phase: connectPhase,
  fallbackToLocal: connection.fallbackToLocal === true,
  // An env-pinned value outranks the UI. Say so rather than letting someone
  // change a setting that silently does nothing.
  envPinned: connection.source === 'env',
  invalid: connection.invalid || null,
  localPort: localPort(),
  // Present only in the 'occupied' phase, so a status page that reloads (or
  // asks before the push arrives) can render the choice with the same detail
  // it was first shown with, rather than a stripped-down version of it.
  occupiedBy: occupant ? 'agnt' : null,
  pid: occupant?.pid ?? null,
  remoteVersion: occupant?.version ?? null,
  canReplace: Number.isInteger(occupant?.pid),
}));

// Probed from the MAIN process on purpose: no origin, therefore no CORS, and
// it works before the user has committed to the URL.
ipcMain.handle('connection:test', async (_evt, rawUrl) => {
  const check = normalizeRemoteUrl(rawUrl);
  if (!check.ok) return { ok: false, error: `That doesn't look like a server address (${check.reason}).` };

  const started = Date.now();
  try {
    const res = await net.fetch(`${check.url}/api/health`, { method: 'GET' });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, url: check.url, latencyMs, error: `Server answered ${res.status}.` };
    return { ok: true, url: check.url, latencyMs };
  } catch (err) {
    return { ok: false, url: check.url, error: `Couldn't reach it — ${err.message}` };
  }
});

ipcMain.handle('connection:set', (_evt, next) => {
  if (connection.source === 'env') {
    return { ok: false, error: 'AGNT_REMOTE_URL is set in the environment and takes precedence.' };
  }
  try {
    const out = writeConnectionConfig(app.getPath('userData'), next);
    if (!out.ok) return { ok: false, error: out.reason };
    return { ok: true, config: out.config, restartRequired: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('connection:relaunch', async () => {
  app.relaunch();
  // app.exit() does NOT fire will-quit, so without this the backend survives
  // the relaunch and the fresh instance finds its own port taken — the same
  // orphan, produced by the button whose whole job is to fix the connection.
  await reapBackend();
  app.exit(0);
});

// Re-poll and load in place. Cheaper and far less jarring than a relaunch, and
// it is the only sane recovery when the remote drops mid-session.
ipcMain.handle('connection:retry', () => {
  retryConfiguredConnection();
  return { ok: true };
});

// Escape hatch: run locally for this session WITHOUT touching connection.json.
ipcMain.handle('connection:use-local-now', () => {
  startLocalSessionFallback('user chose this computer');
  return { ok: true, activeMode: 'local', configPreserved: true };
});

// Port already held by a healthy AGNT — share it. Two windows onto one backend
// is a supported state (it is what a second app instance has always wanted),
// and it is the right answer for the common case where the occupant is an
// orphan from a previous launch holding the user's own data.
ipcMain.handle('connection:use-existing-local', () => {
  useExistingLocalBackend();
  return { ok: true, activeMode: 'local', attached: true, pid: occupant?.pid ?? null };
});

// ...or replace it. Destructive by nature, so it is the secondary action on the
// page and it never runs without an explicit click.
ipcMain.handle('connection:replace-local', async () => replaceLocalBackend());

// Health polling now lives in electron/backendHealth.js (imported above as
// pollBackendHealth) so its bound can be tested. The version that used to sit
// here was bounded by ATTEMPT COUNT, which is not a bound on anything a user can
// feel: measured against a server that accepted TCP and never replied, the
// documented "~12s" was really 366s. See the header of that module.

app.on('ready', () => {
  // Native minidumps (V8/native aborts never reach JS) plus the four Electron
  // death modes: render-process-gone, child-process-gone, gpu crash, and a
  // frozen window. Windows are auto-watched via 'browser-window-created', so
  // createWindow() and the activate path are both covered with no wiring.
  installElectronCrashHooks(recorder, {
    app,
    crashReporter,
    getState: () => ({
      backendPid: backendProcess?.pid,
      supervisorState: supervisor.state,
      appVersion: APP_VERSION,
    }),
  });

  // Serve agnt-file:///<absolute-path> by streaming the file from disk with
  // proper Range-request support so <video> seeking works.
  protocol.handle('agnt-file', async (request) => {
    try {
      const url = new URL(request.url);
      // Windows: "/C:/Users/..." → "C:/Users/...". *nix: "/home/..." stays as is.
      let filePath = decodeURIComponent(url.pathname).replace(/^\/([a-zA-Z]:)/, '$1');
      if (process.platform === 'win32') filePath = filePath.replace(/\//g, '\\');

      const stat = await fs.promises.stat(filePath);
      const fileSize = stat.size;
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        // video
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.mov': 'video/quicktime',
        '.m4v': 'video/x-m4v',
        // audio
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
        // image
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.avif': 'image/avif',
        '.ico': 'image/x-icon',
        // documents
        '.pdf': 'application/pdf',
        // web — required for iframe rendering of local HTML
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
        '.md': 'text/markdown; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
        // fonts
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
      }[ext] || 'application/octet-stream';

      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const m = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
        const start = m ? parseInt(m[1], 10) : 0;
        const end = m && m[2] ? parseInt(m[2], 10) : fileSize - 1;
        const nodeStream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(nodeStream), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const nodeStream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(nodeStream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      console.error('[agnt-file] failed to serve', request.url, err);
      return new Response('Not found', { status: 404 });
    }
  });

  // GUARD 2: only fork a local backend when we are actually going to use one.
  // In remote mode the backend already runs on another machine.
  if (!isRemoteMode()) {
    // Boot and poll together: the poll must not start when the preflight found
    // the port already occupied, or it would attach without asking.
    startLocalBoot();
  }

  // In remote mode the window comes up FIRST, showing a live status page with a
  // way out, and the health poll runs behind it. Previously createWindow() was
  // only reachable from the success callback, so any slow or unresponsive server
  // meant a process with no window — indistinguishable from a hang.
  if (isRemoteMode()) {
    createWindow({ initial: 'status' });
    attachWindowBehaviour();
    beginRemoteConnect();
    return;
  }

  // The local boot path (preflight -> fork -> poll -> window) lives in
  // startLocalBoot(), called above. It used to be inlined here, which is why
  // the poll could not be skipped when the port turned out to be occupied.
});

/**
 * Window behaviour that must be attached once per window, for BOTH boot paths.
 * It used to live inline in the local-only success callback; remote mode now
 * creates its window earlier, so this had to become callable from both.
 */
function attachWindowBehaviour() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Idempotent per window. There are now four routes to a visible app (local
  // boot, remote connect, session fallback, adopting an existing backend) and
  // several can run in one launch — attaching twice would make F11 toggle
  // fullscreen on and straight back off.
  if (behaviourAttachedTo === mainWindow) return;
  behaviourAttachedTo = mainWindow;


  // HTML5 element fullscreen (a <video> control bar, a chart popout) ALSO
  // puts the window in fullscreen, so isFullScreen() alone cannot tell "the
  // user pressed F11" from "Chromium is showing a fullscreen video". Driving
  // setFullScreen() in that state yanks the window out from under Chromium
  // and leaves document.fullscreenElement pointing at an element that is no
  // longer fullscreen — after which the next fullscreen click does nothing
  // until reload. While the renderer owns fullscreen, keep hands off and let
  // Chromium handle Escape/F11 itself.
  let rendererOwnsFullScreen = false;
  mainWindow.on('enter-html-full-screen', () => {
    rendererOwnsFullScreen = true;
  });
  mainWindow.on('leave-html-full-screen', () => {
    rendererOwnsFullScreen = false;
  });

  // Register local shortcuts after the window is created.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (rendererOwnsFullScreen) return;
    if (input.key === 'F11' && !input.alt && !input.control && !input.meta && !input.shift) {
      const isFullScreen = mainWindow.isFullScreen();
      mainWindow.setFullScreen(!isFullScreen);
      event.preventDefault();
    }
    if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      event.preventDefault();
    }
  });

  // Remove global shortcut registrations
  // globalShortcut.register('F11', () => { ... });
  // globalShortcut.register('Escape', () => { ... });

  // Prevent default page title updates.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

/**
 * Terminate the backend WE forked, and resolve only once it is really gone.
 *
 * THE BUG THIS FIXES: shutdown used to be `backendProcess.kill()` — fire a
 * SIGTERM, assume the best, exit. On macOS that signal reaches a real handler
 * which (before the fix in backend/server.js) could hang forever on
 * server.close(), so Electron exited and left the backend running, still
 * holding port 3333. The next launch inherited the wreckage. On Windows the
 * same call is TerminateProcess, so the bug was invisible there for the entire
 * life of the code.
 *
 * Two independent guarantees, because either one alone has failed in practice:
 * the backend now always exits on SIGTERM, AND this refuses to let the app go
 * before confirming it did.
 */
let backendReaped = false;
function reapBackend({ graceMs = 2500 } = {}) {
  const child = backendProcess;
  if (!child || backendReaped) return Promise.resolve();
  backendReaped = true;
  backendProcess = null;
  supervisor.state = 'quitting'; // terminal: beats 'restarting', prevents zombie respawn

  const pid = child.pid;
  console.log(`Shutting down backend process (pid ${pid})...`);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(`Backend ${pid} ${how}.`);
      resolve();
    };
    const timer = setTimeout(() => {
      console.warn(`Backend ${pid} ignored SIGTERM for ${graceMs}ms — SIGKILL.`);
      try {
        if (Number.isInteger(pid)) process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      finish('force-killed');
    }, graceMs);

    child.once('exit', () => finish('exited'));
    try {
      child.kill();
    } catch (err) {
      console.warn(`kill() threw for pid ${pid}: ${err.message}`);
      finish('was already gone');
    }
  });
}

app.on('will-quit', (event) => {
  supervisor.state = 'quitting';
  globalShortcut.unregisterAll();
  if (!backendProcess || backendReaped) return;
  // Hold the quit open. Without this Electron exits first and the reaping
  // above never gets a chance to run — which is exactly how the orphan that
  // poisoned the next launch was created. reapBackend is idempotent, so the
  // second pass through this handler falls out at the guard above.
  event.preventDefault();
  reapBackend().then(() => app.quit());
});
