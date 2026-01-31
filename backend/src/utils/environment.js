/**
 * Environment Detection Utilities
 *
 * Detects remote/SSH environments and platform characteristics
 * for appropriate OAuth flow selection.
 */

import fs from 'fs';

/**
 * Check if running in a remote/SSH environment
 * @returns {boolean}
 */
export function isRemoteEnvironment() {
  return !!(
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY ||
    process.env.SSH_CONNECTION ||
    process.env.REMOTE_CONTAINERS ||
    process.env.CODESPACES ||
    process.env.GITPOD_WORKSPACE_ID ||
    process.env.CLOUD_SHELL ||
    (process.platform === 'linux' &&
      !process.env.DISPLAY &&
      !process.env.WAYLAND_DISPLAY &&
      !isWSL())
  );
}

/**
 * Check if running in Windows Subsystem for Linux (WSL)
 * @returns {boolean}
 */
export function isWSL() {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return version.includes('microsoft') || version.includes('wsl');
  } catch {
    return false;
  }
}

/**
 * Check if running in a Docker container
 * @returns {boolean}
 */
export function isDocker() {
  try {
    // Check for .dockerenv file
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }

    // Check cgroup for docker
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return cgroup.includes('docker') || cgroup.includes('containerd');
  } catch {
    return false;
  }
}

/**
 * Check if a graphical environment is available
 * @returns {boolean}
 */
export function hasGraphicalEnvironment() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return true;
  }

  // On Linux, check for display
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * Check if can open browser automatically
 * @returns {boolean}
 */
export function canOpenBrowser() {
  return !isRemoteEnvironment() && hasGraphicalEnvironment();
}

/**
 * Get environment summary for debugging
 * @returns {object}
 */
export function getEnvironmentInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    isRemote: isRemoteEnvironment(),
    isWSL: isWSL(),
    isDocker: isDocker(),
    hasGraphical: hasGraphicalEnvironment(),
    canOpenBrowser: canOpenBrowser(),
    env: {
      SSH_CLIENT: !!process.env.SSH_CLIENT,
      SSH_TTY: !!process.env.SSH_TTY,
      DISPLAY: !!process.env.DISPLAY,
      WAYLAND_DISPLAY: !!process.env.WAYLAND_DISPLAY,
      CODESPACES: !!process.env.CODESPACES,
    },
  };
}

export default {
  isRemoteEnvironment,
  isWSL,
  isDocker,
  hasGraphicalEnvironment,
  canOpenBrowser,
  getEnvironmentInfo,
};
