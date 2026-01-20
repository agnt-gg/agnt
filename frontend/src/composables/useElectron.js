import { ref } from 'vue';

// Singleton state - shared across all components
const isElectron = ref(false);
let initialized = false;

/**
 * Composable for Electron environment detection and API access.
 * Uses singleton pattern to check once and share across all components.
 *
 * @returns {Object} - { isElectron: Ref<boolean>, electron: object }
 *
 * @example
 * // In component setup:
 * const { isElectron, electron } = useElectron();
 *
 * // Conditional rendering:
 * <WindowControls v-if="isElectron" />
 *
 * // Calling Electron APIs:
 * electron.send('minimize-window');
 * const version = await electron.getAppVersion();
 */
export function useElectron() {
  // Initialize on first call
  if (!initialized) {
    isElectron.value = typeof window !== 'undefined' && window.electron !== undefined;
    initialized = true;
  }

  return {
    /**
     * Reactive boolean indicating if running in Electron
     */
    isElectron,

    /**
     * Direct access to window.electron API
     * Always use optional chaining: electron?.method()
     */
    electron: typeof window !== 'undefined' ? window.electron : undefined,
  };
}

/**
 * Utility functions for common Electron operations
 */
export const electronUtils = {
  /**
   * Send IPC message to main process
   * @param {string} channel - IPC channel name
   * @param {any} data - Data to send
   */
  send(channel, data) {
    if (typeof window !== 'undefined' && window.electron?.send) {
      window.electron.send(channel, data);
    }
  },

  /**
   * Invoke IPC method on main process
   * @param {string} channel - IPC channel name
   * @param {any} data - Data to send
   * @returns {Promise<any>}
   */
  async invoke(channel, data) {
    if (typeof window !== 'undefined' && window.electron?.invoke) {
      return await window.electron.invoke(channel, data);
    }
    return null;
  },

  /**
   * Listen to IPC event from main process
   * @param {string} channel - IPC channel name
   * @param {Function} callback - Callback function
   */
  on(channel, callback) {
    if (typeof window !== 'undefined' && window.electron?.on) {
      window.electron.on(channel, callback);
    }
  },

  /**
   * Window control methods
   */
  window: {
    minimize() {
      if (typeof window !== 'undefined' && window.electron?.send) {
        window.electron.send('minimize-window');
      }
    },
    maximize() {
      if (typeof window !== 'undefined' && window.electron?.send) {
        window.electron.send('maximize-window');
      }
    },
    close() {
      if (typeof window !== 'undefined' && window.electron?.send) {
        window.electron.send('close-window');
      }
    },
  },
};
