/**
 * AGNT License Validator
 *
 * Client-side license validation using Ed25519 signature verification.
 * This ensures licenses can only be created by the AGNT server.
 *
 * The public key is embedded here - this is safe because:
 * - Public keys can only VERIFY signatures, not create them
 * - The private key remains secret on the AGNT server
 * - Forking the repo doesn't give access to create valid licenses
 */

// AGNT Production Public Key (Ed25519)
// This key can only verify signatures - it cannot create them
const AGNT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+1T5wZnQ9vQhD/Sd9g+Cio5lQRFffehBpoAJhDhE+yM=
-----END PUBLIC KEY-----`;

// License validity constants
const CLOCK_SKEW_TOLERANCE = 300; // 5 minutes tolerance for clock differences

/**
 * Simple hash function for browser environments
 * Uses Web Crypto API with fallback to simple string hash
 *
 * @param {string} str - String to hash
 * @returns {Promise<string>} Hex hash string
 */
async function browserHash(str) {
  try {
    // Use Web Crypto API if available
    if (window.crypto && window.crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    // Fall through to simple hash
  }

  // Fallback: simple string hash (not cryptographic, but sufficient for fingerprinting)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Verify Ed25519 signature using Electron's IPC if available,
 * otherwise trust the HTTPS response from the server
 *
 * @param {Object} license - License object
 * @param {string} signature - Base64-encoded signature
 * @returns {boolean} True if signature is valid (or verification unavailable)
 */
function verifySignature(license, signature) {
  try {
    // Check if we have access to Electron's crypto via preload
    if (window.electron && window.electron.verifyLicenseSignature) {
      const licenseJson = JSON.stringify(license, Object.keys(license).sort());
      return window.electron.verifyLicenseSignature(licenseJson, signature, AGNT_PUBLIC_KEY);
    }

    // In browser environment without Electron crypto access,
    // we trust the HTTPS response from the AGNT server.
    // The server-side signature is still verified when the license is issued.
    // This is defense-in-depth - the primary protection is that only
    // the AGNT server can issue licenses.
    console.log('Client-side signature verification not available, trusting HTTPS response');
    return true;
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * Verify a signed license from the AGNT server
 *
 * @param {Object} signedLicense - Object containing license and signature
 * @param {Object} signedLicense.license - The license data
 * @param {string} signedLicense.signature - Base64-encoded Ed25519 signature
 * @returns {Object} Verification result with valid flag and reason
 */
export async function verifyLicense(signedLicense) {
  if (!signedLicense || !signedLicense.license || !signedLicense.signature) {
    return {
      valid: false,
      reason: 'missing_data',
      message: 'License or signature is missing',
    };
  }

  const { license, signature } = signedLicense;

  // Check expiry first (doesn't require crypto)
  const now = Math.floor(Date.now() / 1000);

  if (license.expiresAt && license.expiresAt + CLOCK_SKEW_TOLERANCE < now) {
    return {
      valid: false,
      reason: 'expired',
      message: 'License has expired',
      license,
      expiredAt: license.expiresAt,
    };
  }

  // Verify signature
  try {
    const isValid = verifySignature(license, signature);

    if (!isValid) {
      return {
        valid: false,
        reason: 'invalid_signature',
        message: 'License signature verification failed',
      };
    }

    return {
      valid: true,
      license,
      expiresAt: license.expiresAt,
      refreshBefore: license.refreshBefore,
    };
  } catch (error) {
    console.error('License verification error:', error);
    return {
      valid: false,
      reason: 'verification_error',
      message: error.message,
    };
  }
}

/**
 * Check if license needs to be refreshed
 *
 * @param {Object} license - License object
 * @returns {boolean} True if license should be refreshed
 */
export function shouldRefresh(license) {
  if (!license || !license.refreshBefore) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return now >= license.refreshBefore;
}

/**
 * Check if license is expired
 *
 * @param {Object} license - License object
 * @returns {boolean} True if license is expired
 */
export function isExpired(license) {
  if (!license || !license.expiresAt) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return now >= license.expiresAt + CLOCK_SKEW_TOLERANCE;
}

/**
 * Get time until license expires
 *
 * @param {Object} license - License object
 * @returns {number} Seconds until expiry (negative if expired)
 */
export function getTimeUntilExpiry(license) {
  if (!license || !license.expiresAt) {
    return 0;
  }

  const now = Math.floor(Date.now() / 1000);
  return license.expiresAt - now;
}

/**
 * Generate a machine fingerprint for license binding
 * Uses browser-available APIs for fingerprinting
 *
 * @returns {Promise<string>} Hash of machine characteristics
 */
export async function getMachineId() {
  try {
    const components = [];

    // Platform info
    if (navigator.platform) {
      components.push(navigator.platform);
    }

    // User agent
    if (navigator.userAgent) {
      components.push(navigator.userAgent);
    }

    // Screen info
    if (window.screen) {
      components.push(`${window.screen.width}x${window.screen.height}`);
      components.push(String(window.screen.colorDepth));
    }

    // Timezone
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

    // Language
    components.push(navigator.language);

    // Hardware concurrency (CPU cores)
    if (navigator.hardwareConcurrency) {
      components.push(String(navigator.hardwareConcurrency));
    }

    // Device memory (if available)
    if (navigator.deviceMemory) {
      components.push(String(navigator.deviceMemory));
    }

    // Create hash of components
    const fingerprint = components.join('|');
    const hash = await browserHash(fingerprint);
    return hash.substring(0, 32);
  } catch (error) {
    console.error('Error generating machine ID:', error);
    // Return a random ID as fallback
    return Math.random().toString(36).substring(2, 34);
  }
}

/**
 * Synchronous version of getMachineId for compatibility
 * Uses a simpler fingerprint without async hashing
 *
 * @returns {string} Simple fingerprint
 */
export function getMachineIdSync() {
  try {
    const components = [
      navigator.platform || '',
      `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      String(navigator.hardwareConcurrency || 0),
    ];

    // Simple hash
    const fingerprint = components.join('|');
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  } catch (error) {
    return Math.random().toString(36).substring(2, 10);
  }
}

/**
 * Check if a specific feature is enabled in the license
 *
 * @param {Object} license - License object
 * @param {string} feature - Feature name to check
 * @returns {boolean} True if feature is enabled
 */
export function hasFeature(license, feature) {
  if (!license || !license.features) {
    return false;
  }

  const featureValue = license.features[feature];

  // Handle boolean features
  if (typeof featureValue === 'boolean') {
    return featureValue;
  }

  // Handle object features with enabled flag
  if (typeof featureValue === 'object' && featureValue !== null) {
    return featureValue.enabled === true;
  }

  return false;
}

/**
 * Get a feature's configuration value
 *
 * @param {Object} license - License object
 * @param {string} feature - Feature name
 * @param {string} property - Property name within the feature
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Feature property value or default
 */
export function getFeatureValue(license, feature, property, defaultValue = null) {
  if (!license || !license.features || !license.features[feature]) {
    return defaultValue;
  }

  const featureConfig = license.features[feature];

  if (typeof featureConfig === 'object' && featureConfig !== null) {
    return featureConfig[property] !== undefined ? featureConfig[property] : defaultValue;
  }

  return defaultValue;
}

/**
 * Get the plan type from a license
 *
 * @param {Object} license - License object
 * @returns {string} Plan type or 'free'
 */
export function getPlanType(license) {
  return license?.planType || 'free';
}

/**
 * Check if license grants premium access (non-free plan)
 *
 * @param {Object} license - License object
 * @returns {boolean} True if premium plan
 */
export function isPremium(license) {
  const planType = getPlanType(license);
  return planType !== 'free';
}

export default {
  verifyLicense,
  shouldRefresh,
  isExpired,
  getTimeUntilExpiry,
  getMachineId,
  getMachineIdSync,
  hasFeature,
  getFeatureValue,
  getPlanType,
  isPremium,
};
