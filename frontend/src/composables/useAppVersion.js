import { ref } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

// Singleton state - shared across all components
const appVersion = ref('');
let initialized = false;
let fetchPromise = null;

/**
 * Composable for getting the app version.
 * Uses singleton pattern to fetch version once and share across all components.
 *
 * @returns {Object} - { appVersion: Ref<string>, fetchVersion: Function }
 */
export function useAppVersion() {
  const fetchVersion = async () => {
    // Return cached version if already fetched
    if (initialized && appVersion.value) {
      return appVersion.value;
    }

    // If a fetch is already in progress, wait for it
    if (fetchPromise) {
      return fetchPromise;
    }

    fetchPromise = (async () => {
      // Try Electron API first
      if (window.electron?.getAppVersion) {
        try {
          appVersion.value = await window.electron.getAppVersion();
          initialized = true;
          return appVersion.value;
        } catch (e) {
          console.log('[useAppVersion] Electron getAppVersion failed, trying API');
        }
      }

      // Fallback to backend API
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/version`);
        const data = await response.json();
        appVersion.value = data.version;
        initialized = true;
      } catch (e) {
        console.error('[useAppVersion] Failed to get version from API:', e);
        appVersion.value = '0.0.0'; // Fallback version
      }

      return appVersion.value;
    })();

    const result = await fetchPromise;
    fetchPromise = null;
    return result;
  };

  return {
    appVersion,
    fetchVersion,
  };
}
