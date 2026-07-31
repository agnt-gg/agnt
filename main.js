import fs from 'fs';
import { app, BrowserWindow, Menu, globalShortcut, screen, ipcMain, nativeImage, shell, dialog, utilityProcess, protocol, net, clipboard, crashReporter } from 'electron';
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
import { waitForBackend as pollBackendHealth } from './electron/backendHealth.js';

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

// Detect if this is an AGNT Lite build
// Lite builds have a marker file created during the build process
const isLiteBuild = (() => {
  if (process.env.AGNT_LITE_MODE === 'true') {
    return true; // Explicitly set via environment variable
  }

  if (app.isPackaged) {
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
    const liteMarkerPath = path.join(resourcesPath, '.agnt-lite-mode');

    if (fs.existsSync(liteMarkerPath)) {
      console.log('[Lite Mode] Detected AGNT Lite build');
      return true;
    }
  }

  return false;
})();

// Set AGNT_LITE_MODE environment variable for backend
if (isLiteBuild) {
  process.env.AGNT_LITE_MODE = 'true';
  console.log('[Lite Mode] Browser automation features disabled');
}

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

const isRemoteActive = () => activeMode === 'remote' && Boolean(connection.url);
const statusPagePath = () => path.join(__dirname, 'electron', 'connection-error.html');
const localBackendUrl = () => `http://localhost:${process.env.PORT || 3333}`;

/** Fork the local backend at most once per launch. */
function ensureLocalBackend() {
  if (localBackendSpawned) return;
  localBackendSpawned = true;
  startBackend();
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
function startLocalSessionFallback(why) {
  healthPoll?.cancel('switching to this computer');
  healthPoll = null;
  activeMode = 'local';
  fellBack = true;
  connectPhase = 'connecting';
  pushConnectionState({ phase: 'connecting', detail: 'Starting AGNT on this computer…' });
  ensureLocalBackend();
  // Local policy: unbounded, exactly as a normal local boot. Our own backend is
  // coming up and there is nothing better to fall back TO.
  healthPoll = pollBackendHealth({
    port: process.env.PORT || 3333,
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
    ensureLocalBackend();
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

// Open a folder directly in the OS file manager. For files, prefer
// shell:show-item-in-folder — openPath on a file would launch it in its
// associated app, which isn't what the menu action implies.
ipcMain.on('shell:open-path', async (event, fullPath) => {
  if (typeof fullPath !== 'string' || !fullPath) {
    console.error('[Electron] shell:open-path: invalid path:', fullPath);
    return;
  }
  try {
    const errorMessage = await shell.openPath(fullPath);
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
    },
    autoHideMenuBar: true,
    backgroundColor: '#070710',
  });

  if (process.platform === 'darwin') {
    app.dock.setIcon(iconPath);
  }

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
  localPort: Number(process.env.PORT || 3333),
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

ipcMain.handle('connection:relaunch', () => {
  app.relaunch();
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
  if (!isRemoteMode()) ensureLocalBackend();

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

  // Instead of a fixed delay, poll until the backend is ready.
  pollBackendHealth({
    port: process.env.PORT || 3333,
    log: (m) => console.log('[backend]', m),
    onReady: () => {
      supervisor.state = 'running';
      console.log('Backend is ready. Creating main window...');
      createWindow();
      attachWindowBehaviour();
    },
  });
});

/**
 * Window behaviour that must be attached once per window, for BOTH boot paths.
 * It used to live inline in the local-only success callback; remote mode now
 * creates its window earlier, so this had to become callable from both.
 */
function attachWindowBehaviour() {
  if (!mainWindow || mainWindow.isDestroyed()) return;


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

app.on('will-quit', () => {
  supervisor.state = 'quitting'; // terminal: beats 'restarting', prevents zombie respawn
  if (backendProcess) {
    console.log('Shutting down backend process...');
    backendProcess.kill();
  }
  globalShortcut.unregisterAll();
});
