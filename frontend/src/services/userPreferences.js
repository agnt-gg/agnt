/**
 * Cross-device UI preferences — client half of GET/PUT /api/users/preferences.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FIXES
 * ---------------------------------------------------------------------------
 * Theme, font, background treatment and panel geometry lived only in the
 * localStorage of the browser that set them. Set a theme on the desktop, open
 * the laptop, get the default. Workspace tabs (/api/workspaces) and widget
 * layouts (/api/layouts) already followed the user; presentation did not.
 *
 * ---------------------------------------------------------------------------
 * WHY A SUBSCRIBER AND NOT 17 EDITS
 * ---------------------------------------------------------------------------
 * Every synced setting already flows through exactly one named Vuex mutation
 * that writes localStorage. Rather than append a push call to each of those
 * bodies — seventeen chances to miss one, and seventeen future settings that
 * silently do not sync — this observes `store.subscribe` and maps mutation
 * type to preference key in one table. Adding a synced setting later is one
 * line in MUTATION_MAP, and theme.js never has to know this file exists.
 *
 * localStorage remains the source of truth for FIRST PAINT. theme.js reads it
 * in its state initialisers at module load, which is synchronous and cannot
 * wait for a network round trip. The server is the RECONCILER, applied after
 * mount — the same shape useWorkspaces already uses.
 *
 * ---------------------------------------------------------------------------
 * THE TWO RACES THIS HAS TO SURVIVE
 * ---------------------------------------------------------------------------
 * 1. ECHO. Hydration applies remote values by committing mutations, which the
 *    subscriber sees, which would push them straight back to the server —
 *    an infinite round trip that also bumps updatedAt and lets a stale device
 *    win. `applying` suppresses the subscriber for the duration.
 *
 * 2. IN-FLIGHT USER EDIT. Hydration takes a few hundred ms. A theme change
 *    made in that window is NEWER than anything the server can return, so
 *    applying the remote value would visibly undo an action the user just
 *    took. `touchedKeys` records what the user changed since boot and
 *    hydration skips exactly those keys — not the whole hydrate, which would
 *    throw away every other device's settings over one keystroke.
 */

import { API_CONFIG } from '@/tt.config.js';

const DEVICE_ID_KEY = 'agnt:deviceId';
const DEVICE_LABEL_KEY = 'agnt:deviceLabel';

// Long enough to coalesce a drag (which fires a mutation per animation frame)
// into one request; short enough that a theme click feels immediate on the
// other device. Matches the 400ms useWorkspaces already uses for its push.
const PUSH_DEBOUNCE_MS = 400;

/**
 * mutation type → where its payload belongs.
 *
 * `pick` turns a mutation payload into { prefKey: value } pairs. Most are a
 * bare value; the multi-panel mutations carry an object and write several keys
 * at once, which is precisely why this is a function rather than a key name.
 *
 * SCOPES (enforced server-side too):
 *   global — taste. Resolution-independent, meant to be true everywhere.
 *   device — fit. Pixel geometry, which is a property of the SCREEN. Syncing
 *            a 27-inch sidebar width onto a 13-inch laptop is a regression,
 *            not a feature.
 *
 * DELIBERATELY ABSENT:
 *   SET_DARK_MODE / SET_CYBERPUNK_MODE — legacy mutations whose state is
 *     derived from currentTheme. Syncing them too would let a stale legacy
 *     write contradict the theme it is derived from.
 *   SET_HAS_CUSTOM_BACKGROUND / SET_BACKGROUND_FILE_NAME — the background
 *     MEDIA lives in IndexedDB and is not synced, so advertising its presence
 *     on a device that cannot render it would produce a blank background and
 *     a settings panel that lies.
 *   Banner-dismissed flags — per-browser by intent.
 */
const MUTATION_MAP = {
  'theme/SET_THEME': { scope: 'global', pick: (v) => ({ currentTheme: v }) },
  'theme/SET_FONT_FAMILY': { scope: 'global', pick: (v) => ({ fontFamily: v }) },
  'theme/SET_GREYSCALE_MODE': { scope: 'global', pick: (v) => ({ greyscaleMode: v }) },
  'theme/SET_USE_CUSTOM_BACKGROUND': { scope: 'global', pick: (v) => ({ useCustomBackground: v }) },
  'theme/SET_BG_OPACITY': { scope: 'global', pick: (v) => ({ bgOpacity: v }) },
  'theme/SET_BG_BLUR': { scope: 'global', pick: (v) => ({ bgBlur: v }) },
  'theme/SET_PANEL_POSITION': { scope: 'global', pick: (v) => ({ panelPosition: v }) },
  'theme/SET_ASSET_PANEL_FULL_WIDTH': { scope: 'global', pick: (v) => ({ assetPanelFullWidth: v }) },

  'theme/SET_UI_SCALE': { scope: 'device', pick: (v) => ({ uiScale: v }) },
  'theme/SET_ACTUAL_LEFT_PANEL_WIDTH': { scope: 'device', pick: (v) => ({ actualLeftPanelWidth: v }) },
  'theme/SET_MAIN_CONTENT_WIDTH': { scope: 'device', pick: (v) => ({ mainContentWidth: v }) },
  'theme/SET_SHOW_LEFT_PANEL': { scope: 'device', pick: (v) => ({ showLeftPanel: v }) },
  'theme/SET_SHOW_RIGHT_PANEL': { scope: 'device', pick: (v) => ({ showRightPanel: v }) },
  'theme/SET_LEFT_PANEL_COLLAPSED': { scope: 'device', pick: (v) => ({ leftPanelCollapsed: v }) },
  'theme/SET_RIGHT_PANEL_COLLAPSED': { scope: 'device', pick: (v) => ({ rightPanelCollapsed: v }) },
  'theme/SET_PANEL_WIDTHS': {
    scope: 'device',
    pick: (p) => ({ leftPanelWidth: p?.leftWidth, rightPanelWidth: p?.rightWidth }),
  },
  'theme/SET_THREE_PANEL_WIDTHS': {
    scope: 'device',
    pick: (p) => ({
      actualLeftPanelWidth: p?.actualLeftWidth,
      mainContentWidth: p?.mainWidth,
      rightPanelWidth: p?.rightWidth,
    }),
  },
};

/**
 * preference key → how to read its CURRENT value out of theme state.
 *
 * Separate from APPLY_MAP because three of these do not round-trip by name:
 * the store calls them `isGreyscaleMode` and `isAssetPanelFullWidth`, and
 * `leftPanelWidth`/`rightPanelWidth` are written through a single combined
 * mutation. Guessing the state key from the preference key would silently
 * return `undefined` for those, which compares unequal to everything and
 * quietly reinstates the "every boot repaints" behaviour this exists to stop.
 *
 * Every APPLY_MAP key must appear here — userPreferences.spec.js fails if one
 * is missing, so adding a preference cannot half-land.
 */
const READ_MAP = {
  currentTheme: (s) => s.currentTheme,
  fontFamily: (s) => s.fontFamily,
  greyscaleMode: (s) => s.isGreyscaleMode,
  useCustomBackground: (s) => s.useCustomBackground,
  bgOpacity: (s) => s.bgOpacity,
  bgBlur: (s) => s.bgBlur,
  panelPosition: (s) => s.panelPosition,
  assetPanelFullWidth: (s) => s.isAssetPanelFullWidth,

  uiScale: (s) => s.uiScale,
  actualLeftPanelWidth: (s) => s.actualLeftPanelWidth,
  mainContentWidth: (s) => s.mainContentWidth,
  showLeftPanel: (s) => s.showLeftPanel,
  showRightPanel: (s) => s.showRightPanel,
  leftPanelCollapsed: (s) => s.leftPanelCollapsed,
  rightPanelCollapsed: (s) => s.rightPanelCollapsed,
  leftPanelWidth: (s) => s.leftPanelWidth,
  rightPanelWidth: (s) => s.rightPanelWidth,
};

/** preference key → the mutation that applies it during hydration. */
const APPLY_MAP = {
  currentTheme: (store, v) => store.dispatch('theme/setTheme', v),
  fontFamily: (store, v) => store.dispatch('theme/setFontFamily', v),
  greyscaleMode: (store, v) => store.commit('theme/SET_GREYSCALE_MODE', v),
  useCustomBackground: (store, v) => store.commit('theme/SET_USE_CUSTOM_BACKGROUND', v),
  bgOpacity: (store, v) => store.commit('theme/SET_BG_OPACITY', v),
  bgBlur: (store, v) => store.commit('theme/SET_BG_BLUR', v),
  panelPosition: (store, v) => store.commit('theme/SET_PANEL_POSITION', v),
  assetPanelFullWidth: (store, v) => store.commit('theme/SET_ASSET_PANEL_FULL_WIDTH', v),

  uiScale: (store, v) => store.dispatch('theme/setUiScale', v),
  actualLeftPanelWidth: (store, v) => store.commit('theme/SET_ACTUAL_LEFT_PANEL_WIDTH', v),
  mainContentWidth: (store, v) => store.commit('theme/SET_MAIN_CONTENT_WIDTH', v),
  showLeftPanel: (store, v) => store.commit('theme/SET_SHOW_LEFT_PANEL', v),
  showRightPanel: (store, v) => store.commit('theme/SET_SHOW_RIGHT_PANEL', v),
  leftPanelCollapsed: (store, v) => store.commit('theme/SET_LEFT_PANEL_COLLAPSED', v),
  rightPanelCollapsed: (store, v) => store.commit('theme/SET_RIGHT_PANEL_COLLAPSED', v),
  leftPanelWidth: (store, v, state) =>
    store.commit('theme/SET_PANEL_WIDTHS', { leftWidth: v, rightWidth: state.rightPanelWidth }),
  rightPanelWidth: (store, v, state) =>
    store.commit('theme/SET_PANEL_WIDTHS', { leftWidth: state.leftPanelWidth, rightWidth: v }),
};

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

function randomId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* fall through to Math.random */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A stable, opaque id for THIS browser profile.
 *
 * Minted locally and never derived from hardware, IP or a fingerprint: it only
 * has to be stable and unique, and anything cleverer would be a tracking
 * identifier for no functional gain. Clearing site data mints a new one, which
 * costs the user their panel widths on that browser and nothing else.
 *
 * Constrained to [A-Za-z0-9_-]{1,64} to match the server's validator.
 */
export function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing;
    const minted = `dev-${randomId()}`.slice(0, 64);
    localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch {
    // Private mode with storage disabled: return a per-session id so the
    // request still validates. Geometry simply will not persist, which is the
    // correct outcome when the browser refuses to remember anything.
    return `dev-${randomId()}`.slice(0, 64);
  }
}

/**
 * A human-readable label for the device list in Settings ("MacBook", "Windows
 * · Chrome"). Coarse by design — enough for a person to recognise their own
 * machine, not enough to be a fingerprint.
 */
export function getDeviceLabel() {
  try {
    const stored = localStorage.getItem(DEVICE_LABEL_KEY);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  let label = 'Browser';
  try {
    const ua = navigator.userAgent || '';
    const os = /Macintosh|Mac OS X/.test(ua) ? 'Mac'
      : /Windows/.test(ua) ? 'Windows'
      : /Linux/.test(ua) ? 'Linux'
      : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Android/.test(ua) ? 'Android' : 'Device';
    const browser = /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari'
      : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
    label = `${os} · ${browser}`;
  } catch {
    /* keep the default */
  }
  try {
    localStorage.setItem(DEVICE_LABEL_KEY, label);
  } catch {
    /* ignore */
  }
  return label;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function apiFetch(path, opts = {}) {
  // Same auth convention as every other service (see useWorkspaces.js): JWT
  // from localStorage as a Bearer token. API_CONFIG.BASE_URL rather than a
  // relative '/api/...' because there is no vite dev proxy — a relative URL
  // resolves against the dev server and silently 404s.
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_CONFIG.BASE_URL}/users/preferences${path}`, {
    credentials: 'same-origin',
    // opts BEFORE headers so a caller cannot replace the headers object wholesale.
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      // Caller headers next, so Content-Type stays overridable...
      ...(opts.headers || {}),
      // ...but Authorization goes LAST and therefore wins. This function owns
      // authentication for this endpoint; a caller that passes its own
      // Authorization would otherwise silently send an unauthenticated or
      // wrong-identity request, which surfaces as a 401 nobody can trace back
      // to a header merge order.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`preferences api ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/**
 * Is there a session the BACKEND has confirmed?
 *
 * Deliberately not `!!localStorage.token`. A token string means someone once
 * had a credential, not that it is still valid — gating on it is how the app
 * came to render a full UI for an unverified session (see the sessionState
 * tristate in store/auth/userAuth.js). Reading the getter means the answer
 * comes from the backend, and a session the server has rejected stops
 * producing requests immediately rather than at the next reload.
 */
function isSessionValid(store) {
  try {
    return store?.getters?.['userAuth/isAuthenticated'] === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

let pending = { global: {}, device: {} };
let pendingAt = 0;
let pushTimer = null;
let paintTimer = null;
let applying = false;
let touchedKeys = new Set();
let unsubscribe = null;
let retryDelay = 0;

/**
 * Incremented whenever sync stops (sign-out). A flush that was in flight when
 * a session ended must not resurrect the previous user's preferences into the
 * next one's queue, and it cannot tell that from its own closure — so it
 * captures this counter and compares before touching shared state.
 */
let epoch = 0;

/** First retry delay after a failed push, doubling to RETRY_MAX_MS. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;

function resetState() {
  pending = { global: {}, device: {} };
  pendingAt = 0;
  retryDelay = 0;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  if (paintTimer) clearTimeout(paintTimer);
  paintTimer = null;
  applying = false;
  // A NEW Set rather than .clear(): a flush closure may still hold a reference
  // to the old one, and mutating it would let a dead session's keys reappear.
  touchedKeys = new Set();
  epoch += 1;
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

/**
 * Detach from the store and discard anything queued. Called from endSession.
 *
 * Without this a sign-out leaves the subscriber attached and a debounced push
 * in flight: the request would then be sent with the NEXT user's token, or the
 * previous user's `touchedKeys` would suppress the next user's hydration. That
 * failure mode only became reachable once sign-in stopped reloading the page.
 */
export function stopPreferenceSync() {
  resetState();
  markHydrating(false);
}

/** Test seam — reset module state between specs. */
export function _resetForTests() {
  stopPreferenceSync();
}

async function flush() {
  pushTimer = null;
  const hasGlobal = Object.keys(pending.global).length > 0;
  const hasDevice = Object.keys(pending.device).length > 0;
  if (!hasGlobal && !hasDevice) return;

  const sentGlobal = pending.global;
  const sentDevice = pending.device;
  const sentAt = pendingAt || Date.now();

  const body = {};
  if (hasGlobal) body.global = sentGlobal;
  if (hasDevice) {
    body.device = sentDevice;
    body.deviceId = getDeviceId();
    body.deviceLabel = getDeviceLabel();
  }
  // Stamped when the USER acted, not when the request was built. A tab that
  // has been open for a week must not be able to replay a stale theme over a
  // fresh one simply because its request went out later.
  body.updatedAt = sentAt;

  // Cleared BEFORE the await so changes made during the request queue up for
  // the next flush instead of being sent twice. On failure they are merged
  // back in below.
  pending = { global: {}, device: {} };
  pendingAt = 0;

  const sentEpoch = epoch;

  try {
    await apiFetch('', { method: 'PUT', body: JSON.stringify(body) });
    if (epoch === sentEpoch) retryDelay = 0;
  } catch (e) {
    console.warn('[userPreferences] push failed:', e.message);

    // The session ended while this was in flight. Re-queuing here would push
    // one user's preferences under the next user's token.
    if (epoch !== sentEpoch) return;

    // Put the unsent values BACK. Without this a transient failure drops the
    // change permanently: the local write already happened, so the user sees
    // their theme applied here and nowhere else, forever, with no error.
    //
    // Anything queued while the request was in flight is NEWER, so it wins the
    // merge. updatedAt takes the later of the two: the batch now carries the
    // user's most recent intent, and backdating it would let the server
    // discard the whole thing as stale.
    pending.global = { ...sentGlobal, ...pending.global };
    pending.device = { ...sentDevice, ...pending.device };
    pendingAt = Math.max(sentAt, pendingAt || 0);

    // Bounded backoff. Retrying at the debounce interval would hammer a server
    // that is down; not retrying at all would strand the change until the user
    // happened to touch the same setting again.
    retryDelay = retryDelay ? Math.min(retryDelay * 2, RETRY_MAX_MS) : RETRY_BASE_MS;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, retryDelay);
  }
}

function enqueue(scope, values) {
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    pending[scope][key] = value;
    touchedKeys.add(key);
    changed = true;
  }
  if (!changed) return;

  // Timestamp the FIRST change in the batch. Debouncing must not backdate the
  // user's action to the end of the coalescing window.
  if (!pendingAt) pendingAt = Date.now();

  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, PUSH_DEBOUNCE_MS);
}

/**
 * Reconcile local state with the server. Runs AFTER mount, never at import:
 * theme.js builds its state from localStorage synchronously so the first paint
 * is instant and offline-correct.
 *
 * A remote value that differs from local repaints one beat after load. That is
 * a deliberate trade — blocking first paint on a network round trip would make
 * every boot feel slow to fix a one-frame flicker on the rare boot where two
 * devices actually disagree. The repaint is softened by a short transition
 * (see markHydrating).
 */
export async function hydrateFromServer(store) {
  if (!isSessionValid(store)) return { skipped: 'unverified-session' };

  let remote;
  try {
    remote = await apiFetch(`?deviceId=${encodeURIComponent(getDeviceId())}`, { method: 'GET' });
  } catch (e) {
    console.warn('[userPreferences] hydrate skipped:', e.message);
    return { skipped: 'offline' };
  }

  const prefs = remote?.preferences;
  if (!prefs) return { skipped: 'empty' };

  const applied = [];
  const skipped = [];
  const unchanged = [];

  // Decide what will actually CHANGE before touching the DOM.
  //
  // Comparing against current state, not merely "is this a key we know", is
  // what makes the common boot free. Both sides usually already agree — the
  // browser painted these values from localStorage moments ago — so without
  // this every boot re-dispatches every setting and opens a transition window
  // over the whole document to repaint nothing.
  const work = [];
  for (const source of [prefs.global || {}, prefs.device || {}]) {
    for (const [key, value] of Object.entries(source)) {
      const apply = APPLY_MAP[key];
      if (!apply) continue;
      // The user changed this since boot; their action is newer than anything
      // the server could have returned.
      if (touchedKeys.has(key)) {
        skipped.push(key);
        continue;
      }
      const read = READ_MAP[key];
      if (read && read(store.state.theme) === value) {
        unchanged.push(key);
        continue;
      }
      work.push([key, value, apply]);
    }
  }

  if (!work.length) return { applied, skipped, unchanged };

  applying = true;
  // Opened here and closed on a TIMER, not in the finally below. The apply
  // loop is synchronous, so removing the class at the end of it would take it
  // off in the same frame it went on and the browser would never run the
  // transition at all — the easing this exists for would silently never happen.
  beginHydrationPaint();
  try {
    for (const [key, value, apply] of work) {
      try {
        apply(store, value, store.state.theme);
        applied.push(key);
      } catch (e) {
        console.warn(`[userPreferences] could not apply ${key}:`, e.message);
      }
    }
  } finally {
    applying = false;
  }

  return { applied, skipped, unchanged };
}

/**
 * How long `.prefs-hydrating` stays on the document. Must outlast the CSS
 * transition it enables (250ms, see styles/base/_animations.css) with enough
 * margin for the repaint to start; short enough that ordinary theme switching
 * a moment later is not still easing.
 */
const HYDRATION_PAINT_MS = 400;

/**
 * Open the window in which a hydration repaint eases instead of snapping.
 *
 * Self-closing on a timer: the class must survive the synchronous apply loop,
 * and it must come off even if something in that loop throws, or the app would
 * be left permanently transitioning and every later theme change would feel
 * laggy. Purely cosmetic and fully guarded — this module runs in tests with no
 * DOM.
 */
function beginHydrationPaint() {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.classList.add('prefs-hydrating');
    if (paintTimer) clearTimeout(paintTimer);
    paintTimer = setTimeout(() => {
      paintTimer = null;
      markHydrating(false);
    }, HYDRATION_PAINT_MS);
  } catch {
    /* ignore */
  }
}

/** Remove the hydration paint class. Safe to call when it is not present. */
function markHydrating(on) {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.classList.toggle('prefs-hydrating', !!on);
  } catch {
    /* ignore */
  }
}

/**
 * Start observing the store and reconcile with the server.
 *
 * CALL THIS ONLY AFTER THE SESSION IS VERIFIED. Preferences are user data, and
 * boot must not fire requests for a session the backend is about to reject —
 * store/auth/sessionBoot.js calls this from the post-verification idle block,
 * alongside the other per-user loads. isSessionValid is a second line of
 * defence, not the first: it also stops pushes the moment a session is
 * invalidated mid-flight.
 *
 * NEVER THROWS. Its caller runs inside `idle()` — a timer with no caller —
 * where a synchronous throw escapes as an unhandled error rather than a
 * rejection anything can observe, and aborts every step queued after it
 * (run resumption, channel reclaim). Preferences are cosmetic; they must not
 * be able to take the session boot sequence down with them.
 *
 * The subscriber is registered BEFORE the hydrate request goes out, so a
 * setting the user changes during the round trip is captured rather than
 * dropped — it is queued, stamped with the real moment it happened, and wins
 * the server's last-write-wins comparison on its own merits.
 */
export function startPreferenceSync(store) {
  if (unsubscribe) return unsubscribe;

  if (typeof store?.subscribe !== 'function') {
    console.warn('[userPreferences] sync not started: store has no subscribe()');
    return null;
  }

  unsubscribe = store.subscribe((mutation) => {
    if (applying) return; // hydration echo — see the class comment
    const entry = MUTATION_MAP[mutation.type];
    if (!entry) return;
    // No confirmed session: stay purely local. theme.js has already written
    // localStorage, so nothing the user did is lost — it simply does not
    // leave this browser until a session is verified.
    if (!isSessionValid(store)) return;
    const values = entry.pick(mutation.payload);
    if (values) enqueue(entry.scope, values);
  });

  // Deliberately not awaited: boot must not block on the network.
  // Promise.resolve() because hydrateFromServer can throw synchronously before
  // returning a promise — .catch() on a non-promise is itself a synchronous
  // TypeError, which is the exact escape this function promises not to make.
  Promise.resolve()
    .then(() => hydrateFromServer(store))
    .catch((e) => {
      console.warn('[userPreferences] hydrate failed:', e?.message || e);
    });

  return unsubscribe;
}

export const _internal = { MUTATION_MAP, APPLY_MAP, READ_MAP, PUSH_DEBOUNCE_MS };
