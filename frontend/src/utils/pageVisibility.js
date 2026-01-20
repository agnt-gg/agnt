/**
 * Page Visibility Utility
 * Helps manage API calls and polling based on page visibility to reduce unnecessary requests
 */

class PageVisibilityManager {
  constructor() {
    this.isVisible = !document.hidden;
    this.listeners = new Set();
    this.eventHandlers = {
      visibilityChange: null,
      focus: null,
      blur: null,
    };
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.eventHandlers.visibilityChange = () => {
      this.isVisible = !document.hidden;
      this.notifyListeners();
    };
    document.addEventListener('visibilitychange', this.eventHandlers.visibilityChange);

    // Also listen for window focus/blur as backup
    this.eventHandlers.focus = () => {
      this.isVisible = true;
      this.notifyListeners();
    };
    window.addEventListener('focus', this.eventHandlers.focus);

    this.eventHandlers.blur = () => {
      this.isVisible = false;
      this.notifyListeners();
    };
    window.addEventListener('blur', this.eventHandlers.blur);
  }

  /**
   * Clean up all event listeners and timers
   */
  destroy() {
    if (this.eventHandlers.visibilityChange) {
      document.removeEventListener('visibilitychange', this.eventHandlers.visibilityChange);
    }
    if (this.eventHandlers.focus) {
      window.removeEventListener('focus', this.eventHandlers.focus);
    }
    if (this.eventHandlers.blur) {
      window.removeEventListener('blur', this.eventHandlers.blur);
    }
    this.listeners.clear();
  }

  notifyListeners() {
    this.listeners.forEach((callback) => {
      try {
        callback(this.isVisible);
      } catch (error) {
        console.error('Error in page visibility listener:', error);
      }
    });
  }

  /**
   * Add a listener for visibility changes
   * @param {Function} callback - Function to call when visibility changes
   * @returns {Function} - Cleanup function to remove the listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Check if page is currently visible
   * @returns {boolean}
   */
  get visible() {
    return this.isVisible;
  }

  /**
   * Wrapper for setTimeout that respects page visibility
   * @param {Function} callback - Function to execute
   * @param {number} delay - Delay in milliseconds
   * @param {Object} options - Options
   * @param {number} options.hiddenMultiplier - Multiply delay by this when page is hidden (default: 2)
   * @returns {number} - Timer ID
   */
  setTimeout(callback, delay, options = {}) {
    const { hiddenMultiplier = 2 } = options;
    const actualDelay = this.isVisible ? delay : delay * hiddenMultiplier;
    return setTimeout(callback, actualDelay);
  }

  /**
   * Wrapper for setInterval that respects page visibility
   * @param {Function} callback - Function to execute
   * @param {number} interval - Interval in milliseconds
   * @param {Object} options - Options
   * @param {number} options.hiddenMultiplier - Multiply interval by this when page is hidden (default: 2)
   * @param {boolean} options.pauseWhenHidden - Pause completely when hidden (default: false)
   * @returns {Object} - Object with clear() method and timer management
   */
  setInterval(callback, interval, options = {}) {
    const { hiddenMultiplier = 2, pauseWhenHidden = false } = options;
    let timerId = null;
    let isCleared = false;

    const scheduleNext = () => {
      if (isCleared) return;

      if (pauseWhenHidden && !this.isVisible) {
        // Wait for visibility change instead of scheduling
        const cleanup = this.addListener((visible) => {
          if (visible && !isCleared) {
            cleanup();
            scheduleNext();
          }
        });
        return;
      }

      const actualInterval = this.isVisible ? interval : interval * hiddenMultiplier;
      timerId = setTimeout(() => {
        if (!isCleared) {
          try {
            callback();
          } catch (error) {
            console.error('Error in visibility-aware interval callback:', error);
          }
          scheduleNext();
        }
      }, actualInterval);
    };

    scheduleNext();

    return {
      clear: () => {
        isCleared = true;
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      },
    };
  }

  /**
   * Create a debounced function that respects page visibility
   * @param {Function} func - Function to debounce
   * @param {number} delay - Debounce delay in milliseconds
   * @param {Object} options - Options
   * @param {boolean} options.skipWhenHidden - Skip execution when page is hidden (default: true)
   * @returns {Function} - Debounced function
   */
  debounce(func, delay, options = {}) {
    const { skipWhenHidden = true } = options;
    let timeoutId = null;

    return (...args) => {
      if (skipWhenHidden && !this.isVisible) {
        return;
      }

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!skipWhenHidden || this.isVisible) {
          func.apply(this, args);
        }
      }, delay);
    };
  }

  /**
   * Create a throttled function that respects page visibility
   * @param {Function} func - Function to throttle
   * @param {number} delay - Throttle delay in milliseconds
   * @param {Object} options - Options
   * @param {boolean} options.skipWhenHidden - Skip execution when page is hidden (default: true)
   * @returns {Function} - Throttled function
   */
  throttle(func, delay, options = {}) {
    const { skipWhenHidden = true } = options;
    let lastExecution = 0;
    let timeoutId = null;

    return (...args) => {
      const now = Date.now();

      if (skipWhenHidden && !this.isVisible) {
        return;
      }

      if (now - lastExecution >= delay) {
        lastExecution = now;
        func.apply(this, args);
      } else if (!timeoutId) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (!skipWhenHidden || this.isVisible) {
            lastExecution = Date.now();
            func.apply(this, args);
          }
        }, delay - (now - lastExecution));
      }
    };
  }
}

// Create singleton instance
const pageVisibility = new PageVisibilityManager();

export default pageVisibility;

// Export individual utilities for convenience
export const {
  visible,
  addListener,
  setTimeout: visibilityAwareTimeout,
  setInterval: visibilityAwareInterval,
  debounce: visibilityAwareDebounce,
  throttle: visibilityAwareThrottle,
} = pageVisibility;
