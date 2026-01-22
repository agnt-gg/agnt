/**
 * Lite Mode Helper
 *
 * Utility functions for checking and handling AGNT Lite Mode
 * Lite Mode disables browser automation features (Puppeteer/Playwright)
 * to reduce Docker image size from 1.3GB to 620MB
 */

/**
 * Check if AGNT is running in Lite Mode
 * @returns {boolean} true if running in lite mode (no browser support)
 */
export function isLiteMode() {
  return process.env.AGNT_LITE_MODE === 'true';
}

/**
 * Check if a feature requires browser automation
 * @param {string} featureName - Name of the feature to check
 * @returns {boolean} true if feature requires browser
 */
export function requiresBrowser(featureName) {
  const browserFeatures = [
    'puppeteer',
    'playwright',
    'web-scraper',
    'screenshot',
    'html-to-pdf',
    'browser-automation',
    'web-testing',
    'form-autofill'
  ];

  return browserFeatures.some(feature =>
    featureName.toLowerCase().includes(feature)
  );
}

/**
 * Get a standardized error message for browser features in lite mode
 * @param {string} featureName - Name of the feature being accessed
 * @returns {Object} Error response object
 */
export function getLiteModeError(featureName = 'This feature') {
  return {
    success: false,
    result: null,
    error: `${featureName} is not available in AGNT Lite Mode.\n\n` +
           `Browser automation features (Puppeteer/Playwright) are disabled in the Lite Docker image.\n\n` +
           `To use this feature:\n` +
           `1. Switch to the full Docker image: docker-compose up -d\n` +
           `2. Or use the native AGNT installation (Electron app)\n\n` +
           `Learn more: https://agnt.gg/docs/self-hosting#lite-mode`
  };
}

/**
 * Wrap a browser-dependent function with lite mode check
 * @param {Function} fn - Function to wrap
 * @param {string} featureName - Name of the feature
 * @returns {Function} Wrapped function that checks lite mode first
 */
export function withBrowserCheck(fn, featureName) {
  return async function (...args) {
    if (isLiteMode()) {
      return getLiteModeError(featureName);
    }
    return await fn.apply(this, args);
  };
}

/**
 * Get system info including lite mode status
 * @returns {Object} System information
 */
export function getSystemInfo() {
  return {
    liteMode: isLiteMode(),
    features: {
      browserAutomation: !isLiteMode(),
      aiAgents: true,
      workflows: true,
      plugins: true,
      imageProcessing: true,
      apiIntegrations: true
    },
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version
  };
}

/**
 * Log startup information about lite mode
 */
export function logLiteModeStatus() {
  if (isLiteMode()) {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   ⚡ AGNT LITE MODE ENABLED ⚡        ║');
    console.log('╟────────────────────────────────────────╢');
    console.log('║  Browser automation: DISABLED          ║');
    console.log('║  Image size: ~620MB (vs 1.3GB full)    ║');
    console.log('║  All other features: ENABLED           ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
  } else {
    console.log('');
    console.log('✓ AGNT FULL MODE - All features available');
    console.log('');
  }
}

export default {
  isLiteMode,
  requiresBrowser,
  getLiteModeError,
  withBrowserCheck,
  getSystemInfo,
  logLiteModeStatus
};
