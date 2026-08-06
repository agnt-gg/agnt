import { onUnmounted, ref } from 'vue';

/**
 * Native folder chooser for settings that hold a directory path.
 *
 * WHEN BROWSING IS MEANINGFUL, AND WHY IT IS NOT ALWAYS
 * -----------------------------------------------------
 * A directory path only means something to the process that will open it. The
 * workspace root is created and read by the BACKEND, so a native dialog is the
 * right answer exactly when the backend is this machine:
 *
 *   Electron + local backend   browse — the dialog and the backend share a disk
 *   Electron + remote backend  don't — we would browse the wrong filesystem
 *   browser / Docker           can't — there is no bridge to a native dialog
 *
 * The middle case is the one worth naming. Nothing about it fails loudly: the
 * user picks a folder that exists on their laptop, we post it to a server where
 * that path is absent, and the backend's `mkdir -p` cheerfully CREATES it
 * somewhere they will never look. A plausible wrong answer, which is worse than
 * a refusal.
 *
 * MAIN IS THE AUTHORITY; THIS IS ADVISORY.
 * `available` exists so the button can be hidden before it is clicked, but the
 * main process re-checks and can still answer 'remote-backend'. It has to: the
 * mode changes mid-session when a remote drops and the app falls back to this
 * computer. When the two disagree, main wins and this state corrects itself —
 * rather than the renderer holding a second, staler opinion of the same fact.
 *
 * @returns {{
 *   available: import('vue').Ref<boolean>,
 *   unavailableReason: import('vue').Ref<'no-bridge'|'remote-backend'|null>,
 *   remoteUrl: import('vue').Ref<string|null>,
 *   browse: (options?: object) => Promise<string|null>,
 *   refresh: () => Promise<void>,
 * }}
 */
export function useDirectoryPicker() {
  const bridge = typeof window !== 'undefined' ? window.electron : undefined;
  const hasBridge = typeof bridge?.chooseDirectory === 'function';

  const available = ref(hasBridge);
  const unavailableReason = ref(hasBridge ? null : 'no-bridge');
  const remoteUrl = ref(null);

  const markRemote = (url = null) => {
    available.value = false;
    unavailableReason.value = 'remote-backend';
    remoteUrl.value = url;
  };

  const markLocal = () => {
    available.value = true;
    unavailableReason.value = null;
    remoteUrl.value = null;
  };

  /**
   * Ask the main process what the app is CURRENTLY talking to.
   *
   * `activeMode`, not `mode`: after a per-session fallback the configured mode
   * still says remote while the backend is demonstrably running here, and in
   * that state browsing is correct. Reading `mode` would disable the picker for
   * a user whose files are on the very disk this dialog would open.
   */
  const refresh = async () => {
    if (!hasBridge) return;
    if (typeof bridge?.connection?.get !== 'function') {
      // Older bridge with no connection API: it cannot be in remote mode,
      // because remote mode is the thing that API was added for.
      markLocal();
      return;
    }
    try {
      const state = await bridge.connection.get();
      if (state?.activeMode === 'remote') markRemote(state?.url || null);
      else markLocal();
    } catch {
      // Main is unreachable for a reason that has nothing to do with the user's
      // folder. Leave the button up: clicking it re-asks the authority, and the
      // worst case is the honest 'remote-backend' message instead of a silently
      // missing control.
      markLocal();
    }
  };

  refresh();

  // The mode changes under us when a remote drops and the app falls back to
  // this computer. Without this the button stays hidden for the rest of a
  // session that is now perfectly capable of browsing.
  let unsubscribe;
  if (typeof bridge?.connection?.onState === 'function') {
    try {
      unsubscribe = bridge.connection.onState(() => {
        refresh();
      });
    } catch {
      unsubscribe = undefined;
    }
  }
  onUnmounted(() => {
    try {
      unsubscribe?.();
    } catch {
      /* nothing useful to do while tearing down */
    }
  });

  /**
   * Open the dialog. Resolves to the chosen path, or null for every outcome
   * that is not a choice — cancel included, because cancelling is ordinary and
   * callers should not have to distinguish it from failure to leave state alone.
   * @param {{ defaultPath?: string, title?: string, buttonLabel?: string }} [options]
   */
  const browse = async (options = {}) => {
    if (!hasBridge) return null;
    let result;
    try {
      result = await bridge.chooseDirectory(options);
    } catch {
      return null;
    }
    // Main just told us something this composable believed otherwise. Take its
    // word and update, so the button disappears instead of failing again.
    if (result?.reason === 'remote-backend') {
      markRemote(result?.remoteUrl || null);
      return null;
    }
    if (result?.ok && typeof result.path === 'string' && result.path) {
      markLocal();
      return result.path;
    }
    return null;
  };

  return { available, unavailableReason, remoteUrl, browse, refresh };
}
