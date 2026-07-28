/**
 * Capacitor shell helpers for mobile lite.
 *
 * After pairing, the WebView navigates to the AGNT host (often http://LAN).
 * That origin is not a secure context, so getUserMedia / QR scan is blocked.
 * Camera works on the local Capacitor assets (agntchat://localhost). Bounce
 * setup / add-server / scan back there when the camera cannot run in-page.
 */

/** Matches mobile/mobile-lite capacitor.config ios.scheme */
const IOS_SCHEME = 'agntchat';

export function isCapacitorNative() {
  if (typeof window === 'undefined') return false;
  try {
    const Cap = window.Capacitor;
    if (Cap) {
      if (typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) return true;
      if (Cap.isNative === true) return true;
    }
    // Bridge sometimes missing on remote pages; UA still marks the WebView.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    if (/Capacitor/i.test(ua)) return true;
    const { protocol } = window.location;
    if (protocol === `${IOS_SCHEME}:` || protocol === 'capacitor:' || protocol === 'ionic:') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * True when the current document can use getUserMedia for QR.
 * Secure contexts + Capacitor local schemes; plain http://LAN is false.
 */
export function canUseWebCamera() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const { protocol, hostname } = window.location;
    if (window.isSecureContext) return true;
    if (protocol === 'https:') return true;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
    // Capacitor custom-scheme local shell (agntchat://localhost, etc.)
    if (protocol === `${IOS_SCHEME}:` || protocol === 'capacitor:' || protocol === 'ionic:') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Remote http(s) AGNT host in the WebView — camera will not work here. */
export function isRemoteInsecureHost() {
  if (typeof window === 'undefined') return false;
  try {
    const { protocol, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return false;
    if (protocol === `${IOS_SCHEME}:` || protocol === 'capacitor:' || protocol === 'ionic:') {
      return false;
    }
    // Plain http to a LAN/Tailscale/public host — not a secure camera context.
    return protocol === 'http:';
  } catch {
    return false;
  }
}

/** Local Capacitor www bootstrap with setup chooser (paste + Scan QR). */
export function nativeShellSetupUrl() {
  const platform =
    (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || '';
  if (platform === 'android') {
    // Capacitor Android serves local assets on https://localhost by default.
    return 'https://localhost/?setup=1';
  }
  // iOS uses the configured custom scheme (see mobile-lite-configure.mjs).
  return `${IOS_SCHEME}://localhost/?setup=1`;
}

/**
 * Leave the current page for the local Capacitor shell so QR camera works.
 * Returns true when a navigation started.
 *
 * Used when getUserMedia cannot run (typical on http://LAN inside the app).
 * Does not require window.Capacitor — the custom URL scheme still opens the shell.
 */
export function bounceToNativeShellForSetup() {
  if (canUseWebCamera()) return false;
  if (typeof window === 'undefined') return false;
  try {
    const { protocol } = window.location;
    // Already on the local shell — caller should open the in-page scanner.
    if (protocol === `${IOS_SCHEME}:` || protocol === 'capacitor:' || protocol === 'ionic:') {
      return false;
    }
  } catch {
    /* ignore */
  }
  window.location.assign(nativeShellSetupUrl());
  return true;
}
