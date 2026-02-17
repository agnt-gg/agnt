import fs from 'fs';
import { app, BrowserWindow, Menu, globalShortcut, screen, ipcMain, nativeImage, shell, dialog, utilityProcess } from 'electron';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// DEBUG: Show which main.js is being loaded
console.log('=== LOADING MAIN.JS FROM:', import.meta.url, '===');
import http from 'http'; // Import http to poll the backend
import https from 'https'; // Import https for update checks
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Disable GPU hardware acceleration on macOS to prevent black screen issues
if (process.platform === 'darwin') {
  app.disableHardwareAcceleration();
}

let mainWindow;
let backendProcess;

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

  // NODE_PATH: include both ASAR modules and unpacked native modules
  const nodePathValue = app.isPackaged
    ? `${path.join(__dirname, 'node_modules')}${path.delimiter}${nodeModulesPath}`
    : nodeModulesPath;

  // For packaged apps, unpacked files are in app.asar.unpacked (outside the ASAR)
  // utilityProcess can't read from ASAR, so plugins must be unpacked
  const unpackedPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : __dirname;

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
      console.log(`Backend process exited with code ${code}`);

      if (code !== 0 && code !== null) {
        console.error('Backend process crashed!');
        console.error('Exit code:', code);
        console.error('Last stderr output:', backendStderr.slice(-500));
        console.error('Last stdout output:', backendStdout.slice(-500));

        console.error('App will quit in 5 seconds...');
        setTimeout(() => {
          app.quit();
        }, 5000);
      }
    });
  } else {
    // In development, use regular fork() which works with system Node.js
    console.log('Using child_process.fork() for development');
    backendProcess = fork(serverPath, [], {
      cwd: backendCwd,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
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

    backendProcess.on('error', (error) => {
      console.error('Backend process error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
      });
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`Backend process exited with code ${code}, signal ${signal}`);

      if (code !== 0 && code !== null) {
        console.error('Backend process crashed!');
        console.error('Exit code:', code);
        console.error('Signal:', signal);
        console.error('Last stderr output:', backendStderr.slice(-500));
        console.error('Last stdout output:', backendStdout.slice(-500));

        console.error('App will quit in 5 seconds...');
        setTimeout(() => {
          app.quit();
        }, 5000);
      }
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
    titleBarOverlay: {
      color: '#333',
      symbolColor: '#fff',
    },
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

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setWindowOpenHandler(({ url, features }) => {
      console.log('Window open requested:', { url, features });

      // Check if this is a popup window (OAuth windows have specific features like width/height)
      // Features string will contain things like "width=600,height=700,toolbar=no"
      const isPopup = features.includes('width=') && features.includes('height=');

      if (isPopup) {
        console.log('Opening OAuth popup in Electron window');
        // This is likely an OAuth popup - open in Electron window so callbacks work
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
      import('electron').then(({ shell }) => {
        shell.openExternal(url);
      });
      return { action: 'deny' };
    });

    // Also set up handler for new windows created by popups
    mainWindow.webContents.on('did-create-window', (childWindow) => {
      console.log('Child window created');

      // Intercept redirects - this is crucial for OAuth callbacks
      // When api.agnt.gg redirects to localhost:3333/oauth-callback, we need to handle it
      childWindow.webContents.on('will-redirect', (event, url) => {
        console.log('Popup will redirect to:', url);

        // If redirecting to localhost OAuth callback, log for debugging
        if (url.includes('localhost') && (url.includes('/oauth-callback') || url.includes('/oauth/callback'))) {
          console.log('OAuth callback redirect to localhost detected');
        }
      });

      // Set up navigation handler for the popup window
      childWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        console.log('Popup navigating to:', navigationUrl);

        // Check if this is an OAuth callback URL to localhost
        if (navigationUrl.includes('localhost') && (navigationUrl.includes('/oauth-callback') || navigationUrl.includes('/oauth/callback'))) {
          console.log('OAuth callback to localhost detected in popup, allowing navigation');
        }
        // Check if this is an OAuth callback URL (might be on api.agnt.gg due to redirect issues)
        else if (navigationUrl.includes('/oauth-callback') || navigationUrl.includes('/oauth/callback')) {
          console.log('OAuth callback detected in popup');
        }
      });

      childWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Popup failed to load:', { errorCode, errorDescription, validatedURL });

        // If the load failed because of a redirect to localhost, try to handle it
        if (validatedURL && validatedURL.includes('localhost') && (validatedURL.includes('/oauth-callback') || validatedURL.includes('/oauth/callback'))) {
          console.log('Failed to load localhost OAuth callback, attempting to load directly');
          childWindow.loadURL(validatedURL);
        }
      });

      childWindow.webContents.on('did-finish-load', () => {
        console.log('Popup finished loading:', childWindow.webContents.getURL());
      });
    });
  });

  // Load the URL that is serving your API and frontend.
  const port = process.env.PORT || 3333;
  mainWindow.loadURL(`http://localhost:${port}`);

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

// Polls the backend at localhost:3333 until it responds, then calls the callback.
function waitForBackend(callback) {
  const port = process.env.PORT || 3333;
  const options = {
    hostname: '127.0.0.1', // Use IP instead of localhost
    port: parseInt(port),
    path: '/api/health',
    method: 'GET',
    timeout: 5000, // 5 second timeout per request
  };

  let isBackendReady = false;
  let retryCount = 0;

  // Exponential backoff: start at 500ms, double each time, cap at 5000ms
  const getRetryDelay = () => {
    const baseDelay = 500;
    const maxDelay = 5000;
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    return delay;
  };

  const attempt = () => {
    console.log(`Attempting to connect to backend (attempt ${retryCount + 1})...`);
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200 && !isBackendReady) {
          console.log('Backend is ready');
          isBackendReady = true;
          callback();
        } else if (!isBackendReady) {
          retryCount++;
          const delay = getRetryDelay();
          console.log(`Backend not ready (status ${res.statusCode}). Retry ${retryCount} in ${delay}ms`);
          setTimeout(attempt, delay);
        }
      });
    });

    req.on('error', (error) => {
      retryCount++;
      const delay = getRetryDelay();
      console.log(`Backend connection error (${error.message}). Retry ${retryCount} in ${delay}ms`);
      setTimeout(attempt, delay);
    });

    req.on('timeout', () => {
      req.destroy();
      retryCount++;
      const delay = getRetryDelay();
      console.log(`Backend request timed out. Retry ${retryCount} in ${delay}ms`);
      setTimeout(attempt, delay);
    });

    req.end();
  };

  attempt();
}

app.on('ready', () => {
  // Start the backend process from within Electron.
  startBackend();

  // Instead of a fixed delay, poll until the backend is ready.
  waitForBackend(() => {
    console.log('Backend is ready. Creating main window...');
    createWindow();

    // Register local shortcuts after the window is created.
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

    // Remove global shortcut registrations
    // globalShortcut.register('F11', () => { ... });
    // globalShortcut.register('Escape', () => { ... });

    // Prevent default page title updates.
    mainWindow.on('page-title-updated', (event) => {
      event.preventDefault();
    });
  });
});

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
  if (backendProcess) {
    console.log('Shutting down backend process...');
    backendProcess.kill();
  }
  globalShortcut.unregisterAll();
});
