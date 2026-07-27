import { ref, computed, onMounted } from 'vue';

/**
 * Desktop hybrid connection info for UI banners (external mode, remote host).
 * Prefers preload sync snapshot; refreshes from IPC when available.
 */
export function useDesktopConnection() {
  const useExternalBackend = ref(false);
  const backendUrl = ref('');
  const loaded = ref(false);

  const isExternalMode = computed(() => Boolean(useExternalBackend.value));
  const remoteHostLabel = computed(() => {
    const url = (backendUrl.value || '').trim();
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.host || url;
    } catch {
      return url;
    }
  });

  function applyRuntime(rt = {}) {
    useExternalBackend.value = Boolean(rt.useExternalBackend);
    backendUrl.value = typeof rt.backendUrl === 'string' ? rt.backendUrl : '';
  }

  async function refresh() {
    if (typeof window === 'undefined') {
      loaded.value = true;
      return;
    }

    // Sync snapshot from preload (available before first paint in Electron)
    if (window.__AGNT_DESKTOP__) {
      applyRuntime(window.__AGNT_DESKTOP__);
    }

    const electron = window.electron;
    if (electron?.getConnectionConfig) {
      try {
        const cfg = await electron.getConnectionConfig();
        useExternalBackend.value = Boolean(cfg.useExternalBackend);
        backendUrl.value =
          cfg.backendUrl ||
          cfg.form?.backendUrl ||
          cfg.stored?.backendUrl ||
          backendUrl.value ||
          '';
      } catch {
        // keep snapshot
      }
    }

    loaded.value = true;
  }

  onMounted(refresh);

  return {
    loaded,
    useExternalBackend,
    backendUrl,
    isExternalMode,
    remoteHostLabel,
    refresh,
  };
}
