/**
 * AuthError - Structured error for authentication failures
 *
 * Provides user-friendly error messages with recovery guidance.
 */

/**
 * Error codes for authentication failures
 * @typedef {'NO_CREDENTIALS' | 'TOKEN_EXPIRED' | 'REFRESH_FAILED' | 'NETWORK_ERROR' | 'INVALID_TOKEN' | 'CSRF_MISMATCH' | 'OAUTH_CANCELLED' | 'MISSING_CONFIG'} AuthErrorCode
 */

/**
 * Recovery actions for authentication errors
 * @typedef {'setup' | 'reauth' | 'retry' | 'contact_support'} RecoveryAction
 */

/**
 * User-friendly messages for error codes
 */
const ERROR_MESSAGES = {
  NO_CREDENTIALS: 'Not authenticated. Please set up authentication to continue.',
  TOKEN_EXPIRED: 'Your session has expired. Please re-authenticate.',
  REFRESH_FAILED: 'Unable to refresh authentication. Please re-authenticate.',
  NETWORK_ERROR: 'Connection error. Please check your internet connection and try again.',
  INVALID_TOKEN: 'Authentication is invalid. Please re-authenticate.',
  CSRF_MISMATCH: 'Security validation failed. Please try again.',
  OAUTH_CANCELLED: 'Authentication was cancelled. Please try again when ready.',
  MISSING_CONFIG: 'Authentication is not configured. Please contact support.',
};

/**
 * Default recovery actions for error codes
 */
const DEFAULT_RECOVERY = {
  NO_CREDENTIALS: 'setup',
  TOKEN_EXPIRED: 'reauth',
  REFRESH_FAILED: 'reauth',
  NETWORK_ERROR: 'retry',
  INVALID_TOKEN: 'reauth',
  CSRF_MISMATCH: 'retry',
  OAUTH_CANCELLED: 'retry',
  MISSING_CONFIG: 'contact_support',
};

/**
 * Custom error class for authentication failures
 */
export class AuthError extends Error {
  /**
   * Create an AuthError
   * @param {AuthErrorCode} code - Error code
   * @param {string} [message] - Custom message (uses default if not provided)
   * @param {RecoveryAction} [recovery] - Suggested recovery action
   * @param {string} [details] - Technical details for logging
   */
  constructor(code, message, recovery, details) {
    super(message || ERROR_MESSAGES[code] || 'Authentication error');
    this.name = 'AuthError';
    this.code = code;
    this.recovery = recovery || DEFAULT_RECOVERY[code] || 'reauth';
    this.details = details || null;
    this.timestamp = new Date().toISOString();
  }

  /**
   * Convert to JSON-serializable object for API responses
   */
  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      recovery: this.recovery,
      timestamp: this.timestamp,
    };
  }

  /**
   * Get recovery guidance for the user
   */
  getRecoveryGuidance() {
    switch (this.recovery) {
      case 'setup':
        return {
          action: 'Set up authentication',
          description: 'Configure your authentication credentials to continue.',
          button: 'Set up now',
        };
      case 'reauth':
        return {
          action: 'Re-authenticate',
          description: 'Your authentication needs to be refreshed.',
          button: 'Re-authenticate',
        };
      case 'retry':
        return {
          action: 'Try again',
          description: 'A temporary error occurred. Please try again.',
          button: 'Retry',
        };
      case 'contact_support':
        return {
          action: 'Contact support',
          description: 'This issue requires assistance from the support team.',
          button: 'Get help',
        };
      default:
        return {
          action: 'Try again',
          description: 'Please try again or re-authenticate if the problem persists.',
          button: 'Retry',
        };
    }
  }

  /**
   * Check if this is a recoverable error
   */
  isRecoverable() {
    return ['setup', 'reauth', 'retry'].includes(this.recovery);
  }

  /**
   * Create AuthError from a generic error
   * @param {Error} error - Original error
   * @param {AuthErrorCode} [defaultCode='NETWORK_ERROR'] - Default code if not determinable
   */
  static fromError(error, defaultCode = 'NETWORK_ERROR') {
    if (error instanceof AuthError) {
      return error;
    }

    // Try to determine error code from error message or status
    let code = defaultCode;
    const message = error.message?.toLowerCase() || '';

    if (message.includes('401') || message.includes('unauthorized')) {
      code = 'INVALID_TOKEN';
    } else if (message.includes('403') || message.includes('forbidden')) {
      code = 'TOKEN_EXPIRED';
    } else if (message.includes('network') || message.includes('econnrefused') || message.includes('timeout')) {
      code = 'NETWORK_ERROR';
    } else if (message.includes('refresh')) {
      code = 'REFRESH_FAILED';
    }

    return new AuthError(code, error.message, null, error.stack);
  }

  /**
   * Create a NO_CREDENTIALS error
   */
  static noCredentials(provider) {
    return new AuthError(
      'NO_CREDENTIALS',
      `Not authenticated with ${provider}. Please set up authentication.`,
      'setup',
      `Provider: ${provider}`
    );
  }

  /**
   * Create a TOKEN_EXPIRED error
   */
  static tokenExpired(provider) {
    return new AuthError(
      'TOKEN_EXPIRED',
      `Your ${provider} session has expired. Please re-authenticate.`,
      'reauth',
      `Provider: ${provider}`
    );
  }

  /**
   * Create a REFRESH_FAILED error
   */
  static refreshFailed(provider, reason) {
    return new AuthError(
      'REFRESH_FAILED',
      `Unable to refresh ${provider} authentication. Please re-authenticate.`,
      'reauth',
      `Provider: ${provider}, Reason: ${reason}`
    );
  }
}

export default AuthError;
