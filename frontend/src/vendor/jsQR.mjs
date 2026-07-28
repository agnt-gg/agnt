/**
 * ESM wrapper around vendored UMD jsQR (no npm install / Artifactory).
 * Source: jsQR 1.4.0 via jsDelivr — see jsQR.js header for license.
 */
import './jsQR.js';

const impl =
  (typeof globalThis !== 'undefined' && globalThis.jsQR) ||
  (typeof window !== 'undefined' && window.jsQR) ||
  null;

if (!impl) {
  throw new Error('jsQR failed to load');
}

export default impl;
