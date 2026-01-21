import fs from 'fs';
import { execSync } from 'child_process';

/**
 * Detects system Chrome/Chromium installation as a fallback
 * when Electron's Chromium is not available or suitable
 */
export function findSystemChrome() {
  const platform = process.platform;
  let possiblePaths = [];

  if (platform === 'win32') {
    // Build paths dynamically to handle undefined env vars
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    possiblePaths = [
      // Standard Chrome installations
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : null,
      // Chrome Beta/Dev/Canary
      localAppData ? `${localAppData}\\Google\\Chrome Beta\\Application\\chrome.exe` : null,
      localAppData ? `${localAppData}\\Google\\Chrome Dev\\Application\\chrome.exe` : null,
      localAppData ? `${localAppData}\\Google\\Chrome SxS\\Application\\chrome.exe` : null,
      // Chromium
      localAppData ? `${localAppData}\\Chromium\\Application\\chrome.exe` : null,
      // Edge (Chromium-based, works with Puppeteer)
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      // Brave
      localAppData ? `${localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe` : null,
      `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ].filter(Boolean); // Remove null entries
  } else if (platform === 'darwin') {
    possiblePaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  } else {
    // GNU/Linux
    possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/chrome',
    ];
  }

  // Check each possible path
  for (const chromePath of possiblePaths) {
    try {
      if (fs.existsSync(chromePath)) {
        console.log(`Found system Chrome at: ${chromePath}`);
        return chromePath;
      }
    } catch (err) {
      // Continue checking other paths
    }
  }

  // Try using 'which' command on Unix-like systems
  if (platform !== 'win32') {
    try {
      const whichChrome = execSync('which google-chrome || which chromium || which chromium-browser', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (whichChrome && fs.existsSync(whichChrome)) {
        console.log(`Found system Chrome via which: ${whichChrome}`);
        return whichChrome;
      }
    } catch (err) {
      // which command failed, continue
    }
  }

  console.warn('No system Chrome/Chromium installation found');
  return null;
}

/**
 * Checks if a path points to an Electron app rather than a real Chrome browser
 */
function isElectronExecutable(execPath) {
  if (!execPath) return true;

  const lowerPath = execPath.toLowerCase();

  // Check for common Electron indicators
  const electronIndicators = [
    'electron',
    'agnt',
    'node_modules',
    // Add more app names that might be Electron-based
  ];

  for (const indicator of electronIndicators) {
    if (lowerPath.includes(indicator)) {
      return true;
    }
  }

  // Check if it's the current process (definitely Electron if we're running in Electron)
  if (execPath === process.execPath) {
    return true;
  }

  // Check if the executable name suggests it's a real browser
  const validBrowserNames = ['chrome', 'chromium', 'msedge', 'brave', 'opera', 'vivaldi'];
  const fileName = execPath.split(/[/\\]/).pop()?.toLowerCase() || '';

  const isValidBrowser = validBrowserNames.some((name) => fileName.includes(name));

  return !isValidBrowser;
}

/**
 * Gets the best available Chrome executable path
 * Priority: 1) System Chrome (most reliable), 2) Configured path if valid, 3) null
 *
 * Note: We prioritize system Chrome because Electron's bundled Chromium (process.execPath)
 * is not a standalone Chrome executable and cannot be used with Puppeteer.
 * The PUPPETEER_EXECUTABLE_PATH env var may incorrectly point to the Electron app itself.
 */
export function getBestChromePath() {
  // First, try system Chrome - this is the most reliable option
  const systemChrome = findSystemChrome();
  if (systemChrome) {
    console.log(`[Chrome Detector] Using system Chrome: ${systemChrome}`);
    return systemChrome;
  }

  // Check if PUPPETEER_EXECUTABLE_PATH is set and points to a valid Chrome
  // (not the Electron app itself)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH;

    // Skip if it points to an Electron app (not a real Chrome)
    if (isElectronExecutable(configuredPath)) {
      console.warn(`[Chrome Detector] Skipping PUPPETEER_EXECUTABLE_PATH (${configuredPath}) - appears to be Electron, not Chrome`);
    } else if (fs.existsSync(configuredPath)) {
      console.log(`[Chrome Detector] Using configured Chromium: ${configuredPath}`);
      return configuredPath;
    } else {
      console.warn(`[Chrome Detector] Configured path does not exist: ${configuredPath}`);
    }
  }

  console.error('[Chrome Detector] No Chrome/Chromium installation found!');
  console.error('[Chrome Detector] Please install Google Chrome from https://www.google.com/chrome/');
  return null;
}

/**
 * Validates that a Chrome executable exists and is accessible
 */
export function validateChromePath(chromePath) {
  if (!chromePath) {
    return false;
  }

  try {
    return fs.existsSync(chromePath);
  } catch (err) {
    return false;
  }
}

/**
 * Gets a user-friendly error message when Chrome is not found
 */
export function getChromeNotFoundMessage() {
  const platform = process.platform;
  let installInstructions = '';

  if (platform === 'win32') {
    installInstructions = 'Please install Google Chrome from https://www.google.com/chrome/';
  } else if (platform === 'darwin') {
    installInstructions = 'Please install Google Chrome from https://www.google.com/chrome/';
  } else {
    // GNU/Linux
    installInstructions = `Please install Chrome or Chromium:
  - Ubuntu/Debian: sudo apt install chromium-browser
  - Fedora/RHEL: sudo dnf install chromium
  - Arch: sudo pacman -S chromium`;
  }

  return `Chrome/Chromium not found. ${installInstructions}`;
}
