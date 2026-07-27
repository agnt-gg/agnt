import fs from 'fs';
import { app, BrowserWindow, Menu, globalShortcut, screen, ipcMain, nativeImage, shell, dialog, utilityProcess, protocol, net, clipboard, crashReporter } from 'electron';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

// DEBUG: Show which main.js is being loaded
console.log('=== LOADING MAIN.JS FROM:', import.meta.url, '===');
import https from 'https'; // Import https for update checks
import dotenv from 'dotenv';
import {
  initDesktopConnection,
  getUiLoadUrl,
  prepareConnectionForLaunch,
  waitForBackendReady,
  recoverOnActivate,
  stopDesktopConnection,
} from './electron/desktop-connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env early so USE_EXTERNAL_BACKEND / BACKEND_URL work before boot.
// Packaged builds still prefer userData desktop-connection.json from Settings.
if (!app.isPackaged) {
  const rootEnvPath = path.join(__dirname, '.env');
  if (fs.existsSync(rootEnvPath)) {
    try {
      dotenv.config({ path: rootEnvPath });
    } catch (err) {
      console.warn('[connection] Could not load root .env:', err.message);
    }
  }
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================
// One boot id for this app launch, exported into the env so the backend and
// the workflow child inherit it. Every record from every process then shares
// a correlation key with no IPC required.
import { randomUUID } from 'crypto';
import { installDiagnostics, diagnosticsDir } from './backend/src/diagnostics/install.js';
import { installElectronCrashHooks } from './backend/src/diagnostics/electronHooks.js';

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
let windowControlIpcRegistered = false;
/** webContents ids that already have F11/Escape handlers */
const chromeAttached = new Set();

/**
 * Wire F11 / Escape / title freeze once per BrowserWindow webContents.
 */
function attachMainWindowChrome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const id = mainWindow.webContents.id;
  if (chromeAttached.has(id)) return;
  chromeAttached.add(id);
  mainWindow.webContents.once('destroyed', () => chromeAttached.delete(id));

  mainWindow.webContents.on('before-input-event', (event, input) => {
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
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
}

/** Register window control IPC once (createWindow may run multiple times). */
function registerWindowControlIpc() {
  if (windowControlIpcRegistered) return;
  windowControlIpcRegistered = true;

  ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.on('maximize-window', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });
  ipcMain.on('close-window', () => {
    if (mainWindow) mainWindow.close();
  });
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
      startBackend();
      waitForBackendReady().then((ok) => {
        if (!ok) return;
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
function createWindow() {
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

  // Handle media permissions for microphone access (required for speech recognition)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'];
    if (allowedPermissions.includes(permission)) {
      console.log(`Granting permission: ${permission}`);
      callback(true);
    } else {
      console.log(`Denying permission: ${permission}`);
      callback(false);
    }
  });

  // Handle permission checks
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'];
    if (allowedPermissions.includes(permission)) {
      return true;
    }
    return false;
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

  // Load the UI (local co-located backend or external-mode local proxy origin).
  const loadUrl = getUiLoadUrl();
  console.log('[connection] Loading UI from:', loadUrl);
  mainWindow.loadURL(loadUrl);

  mainWindow.center();
  mainWindow.show();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  initDesktopConnection({
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    dirname: __dirname,
    getMainWindow: () => mainWindow,
  });
  registerWindowControlIpc();

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

  // Hybrid connection: local Express OR external proxy UI + remote API.
  prepareConnectionForLaunch({ startBackend }).then((ready) => {
    if (!ready) return;
    supervisor.state = 'running';
    console.log('Backend is ready. Creating main window...');
    createWindow();
    attachMainWindowChrome();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!app.isReady() || BrowserWindow.getAllWindows().length > 0) return;
  recoverOnActivate({
    createWindow,
    attachChrome: attachMainWindowChrome,
  }).then(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      supervisor.state = 'running';
    }
  });
});

app.on('will-quit', () => {
  supervisor.state = 'quitting'; // terminal: beats 'restarting', prevents zombie respawn
  if (backendProcess) {
    console.log('Shutting down backend process...');
    backendProcess.kill();
  }
  stopDesktopConnection();
  globalShortcut.unregisterAll();
});
