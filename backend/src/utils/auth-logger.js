/**
 * AuthLogger - Token-safe authentication event logging
 *
 * Logs auth events with sanitized data to prevent token exposure.
 * Never logs full tokens - only first 8 characters + "..."
 */

const AUTH_EVENTS = [
  'keychain_read',
  'keychain_write',
  'token_refresh',
  'oauth_start',
  'oauth_complete',
  'oauth_error',
  'auth_error',
  'credentials_loaded',
  'credentials_saved',
];

/**
 * Sanitize a token by keeping only first 8 characters
 * @param {string} token - The token to sanitize
 * @returns {string} - Sanitized token
 */
function sanitizeToken(token) {
  if (!token || typeof token !== 'string') {
    return '[empty]';
  }
  if (token.length <= 8) {
    return '[redacted]';
  }
  return `${token.slice(0, 8)}...`;
}

/**
 * Deep sanitize an object, redacting any token-like values
 * @param {any} obj - Object to sanitize
 * @returns {any} - Sanitized object
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Check if this looks like a token
    const tokenPatterns = [
      /^sk-ant-/,      // Anthropic tokens
      /^sk-/,          // OpenAI tokens
      /^eyJ/,          // JWT tokens
      /^rt_/,          // Refresh tokens
      /^gsk_/,         // Groq tokens
    ];

    if (tokenPatterns.some(pattern => pattern.test(obj))) {
      return sanitizeToken(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Always sanitize keys that look like they contain tokens
      const sensitiveKeys = [
        'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
        'token', 'apikey', 'api_key', 'secret', 'password', 'credential',
      ];

      if (sensitiveKeys.includes(key.toLowerCase())) {
        sanitized[key] = sanitizeToken(value);
      } else {
        sanitized[key] = sanitizeObject(value);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Log an authentication event with sanitized metadata
 * @param {string} event - Event type (see AUTH_EVENTS)
 * @param {object} [metadata={}] - Additional metadata to log
 */
export function logAuthEvent(event, metadata = {}) {
  const timestamp = new Date().toISOString();
  const sanitizedMetadata = sanitizeObject(metadata);

  // Format: [AUTH] [timestamp] event: metadata
  const logMessage = `[AUTH] [${timestamp}] ${event}: ${JSON.stringify(sanitizedMetadata)}`;

  // Log to console with appropriate level based on event type
  if (event.includes('error')) {
    console.error(logMessage);
  } else if (event === 'oauth_complete' || event === 'credentials_saved') {
    console.log(logMessage);
  } else {
    console.log(logMessage);
  }

  return { event, timestamp, metadata: sanitizedMetadata };
}

/**
 * Create a scoped logger for a specific provider
 * @param {string} provider - Provider name (e.g., 'claude', 'codex')
 * @returns {object} - Scoped logger with logEvent method
 */
export function createAuthLogger(provider) {
  return {
    logEvent(event, metadata = {}) {
      return logAuthEvent(event, { provider, ...metadata });
    },
    keychainRead(success, details = {}) {
      return logAuthEvent('keychain_read', { provider, success, ...details });
    },
    keychainWrite(success, details = {}) {
      return logAuthEvent('keychain_write', { provider, success, ...details });
    },
    tokenRefresh(success, details = {}) {
      return logAuthEvent('token_refresh', { provider, success, ...details });
    },
    oauthStart(details = {}) {
      return logAuthEvent('oauth_start', { provider, ...details });
    },
    oauthComplete(success, details = {}) {
      return logAuthEvent('oauth_complete', { provider, success, ...details });
    },
    error(code, message, details = {}) {
      return logAuthEvent('auth_error', { provider, code, message, ...details });
    },
  };
}

export default {
  logAuthEvent,
  createAuthLogger,
  sanitizeToken,
  sanitizeObject,
  AUTH_EVENTS,
};
