/**
 * Keeping a CDP bridge alive for as long as the Browser widget is on screen.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 * The widget used to open its bridge from a one-shot listener:
 *
 *     el.addEventListener('dom-ready', openBridge, { once: true });
 *
 * That treats the bridge's lifetime as equal to the WIDGET's lifetime. It is
 * not. The bridge belongs to the guest `webContents` inside the <webview>, and
 * that guest is destroyed and rebuilt several times during a normal session —
 * a renderer crash, an out-of-memory reap, or the element being re-parented
 * when the canvas re-lays-out are all enough. Each rebuild produces a NEW
 * webContents id, and main.js closes the old bridge on `destroyed` precisely so
 * a debugger is not left attached to a corpse.
 *
 * So after the first rebuild there was no bridge at all, and nothing that could
 * ever open another one. Worse, the widget kept the dead ws:// URL and its
 * 20-second heartbeat kept announcing it, so the backend's registry filled with
 * an endpoint whose server had already closed. The probe pruned it, and every
 * later turn was told "there is no Browser widget open" while the widget sat
 * there visibly showing a page.
 *
 * Observed exactly that way: several successful navigations, then permanent
 * failure, with the widget on screen and no loopback bridge listening anywhere.
 *
 * ---------------------------------------------------------------------------
 * THE FIX: RE-ASSERT, DO NOT REMEMBER
 * ---------------------------------------------------------------------------
 * `browser-bridge:start` is idempotent — it hands back the existing bridge when
 * one is live (`reused: true`) and builds a new one when it is not. So the
 * repair is to stop treating "I opened a bridge once" as a fact worth caching
 * and instead re-assert it: on every dom-ready, on every heartbeat, and after
 * any event that says the guest went away.
 *
 * That makes the widget self-healing against every cause at once, including
 * ones not yet met, because it never has to work out WHY the bridge went away.
 * A backend restart is covered by the same loop, since re-asserting always ends
 * in a fresh announcement.
 */

/**
 * @param {object} deps
 * @param {{ start: (id: number) => Promise<{ ok: boolean, cdpUrl?: string, error?: string, reused?: boolean }>,
 *           stop: (id: number) => unknown }} deps.bridgeApi
 * @param {() => number|null} deps.getWebContentsId Current guest id, or null.
 * @param {(cdpUrl: string) => Promise<void>|void} deps.announce
 * @param {(message: string) => void} [deps.onStatus] '' clears the error pane.
 */
export function createBridgeSession({ bridgeApi, getWebContentsId, announce, onStatus = () => {} }) {
  let webContentsId = null;
  let cdpUrl = null;
  let inFlight = null;

  async function open() {
    let id = null;
    try {
      id = getWebContentsId();
    } catch {
      // The guest is mid-rebuild. Not an error state — the next dom-ready or
      // the next heartbeat will find it.
      id = null;
    }
    if (id === null || id === undefined) return null;

    // A CHANGED ID IS THE WHOLE POINT. It means the guest we had a bridge to no
    // longer exists, main.js has already closed that bridge, and the URL we are
    // holding is dead. Drop it before asking for a new one so a failed start
    // cannot leave us announcing the previous corpse.
    if (id !== webContentsId) {
      webContentsId = id;
      cdpUrl = null;
    }

    const result = await bridgeApi.start(id);
    if (!result?.ok) {
      cdpUrl = null;
      onStatus(result?.error || 'Could not open a browser bridge.');
      return null;
    }

    cdpUrl = result.cdpUrl;
    onStatus('');
    return cdpUrl;
  }

  return {
    get cdpUrl() { return cdpUrl; },
    get webContentsId() { return webContentsId; },

    /**
     * Make sure a bridge exists for the current guest, then announce it.
     *
     * Safe to call as often as you like: overlapping calls share one attempt,
     * because dom-ready and the heartbeat routinely fire together and two
     * concurrent starts on the same surface would race to attach a debugger.
     */
    refresh() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const url = await open();
        if (url) await announce(url);
        return url;
      })().finally(() => { inFlight = null; });
      return inFlight;
    },

    /** Release the bridge. Called when the widget really is going away. */
    stop() {
      const id = webContentsId;
      webContentsId = null;
      cdpUrl = null;
      if (id !== null && id !== undefined) {
        try { bridgeApi.stop(id); } catch { /* the window may already be gone */ }
      }
    },
  };
}

export default createBridgeSession;
