/**
 * CHUNK RECOVERY
 *
 * Why this exists
 * ---------------
 * Every screen and screen-widget is a lazy `import()`. Vite names those chunks
 * by content hash (`Settings.B4rtEn8e.js`) and, because `emptyOutDir` defaults
 * to true, a rebuild DELETES the hashes the running renderer is still holding.
 * A long-lived Electron session then asks for a file that no longer exists,
 * the SPA catch-all answers with `index.html`, and the browser rejects
 * `text/html` as a module script.
 *
 * `defineAsyncComponent()` with no `errorComponent` renders NOTHING when its
 * loader rejects. That is the blank Settings page: not a hang, not slow data —
 * a dead chunk with no UI to say so. A restart "fixes" it because the fresh
 * `index.html` points at hashes that exist.
 *
 * The build side of this (keeping retired hashes on disk) lives in
 * `frontend/build/assetRetention.js`. This module is the client half:
 *
 *   1. recognise a chunk-load failure (as opposed to a real component error),
 *   2. reload ONCE to pick up the current index.html,
 *   3. and if that already happened, stop and show something a human can act
 *      on instead of reloading forever.
 *
 * Every lazy component in the app must be created here — `Terminal.vue` and
 * the canvas widget registry both load screens, and a fix in only one of them
 * leaves the other blank.
 */

import { defineAsyncComponent, h } from 'vue';
import ChunkLoadFailed from './ChunkLoadFailed.vue';

/** sessionStorage key holding the timestamp of the last recovery reload. */
export const RELOAD_MARK_KEY = 'agnt:chunk-reload-at';

/**
 * How long a recovery reload suppresses the next one. Long enough that a
 * genuinely broken deploy cannot spin, short enough that a second, unrelated
 * rebuild later in the session still gets its own automatic recovery.
 */
export const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Chrome/Firefox/Safari/Vite all word this differently, and the
 * HTML-served-as-JS case reports as a MIME error rather than a fetch error.
 */
const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /unable to preload css/i,
  /loading chunk \S+ failed/i,
  /loading css chunk/i,
  /importing a module script failed/i,
  /expected a javascript(-or-wasm)? module script/i,
  /is not a valid javascript mime type/i,
  /failed to load module script/i,
];

/**
 * True when `error` means "the chunk did not arrive", false when it means
 * "the component threw". Only the former is safe to answer with a reload —
 * reloading on a real runtime error would hide the bug and loop the user.
 */
export function isChunkLoadError(error) {
  if (!error) return false;
  const text = `${error.message || ''} ${error.name || ''} ${error.type || ''}`;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Pure decision so the loop-protection is testable without a window.
 *
 * @returns {'reload'|'fail'}
 */
export function decideChunkRecovery({ now, lastAttemptAt, cooldownMs = RELOAD_COOLDOWN_MS }) {
  if (!Number.isFinite(lastAttemptAt)) return 'reload';
  // A mark in the future means a corrupt value or a clock change. Treat it as
  // "we just tried" — refusing to reload is always the safe direction.
  if (lastAttemptAt > now) return 'fail';
  return now - lastAttemptAt >= cooldownMs ? 'reload' : 'fail';
}

/** sessionStorage throws in private mode and does not exist under SSR/tests. */
function safeStorage() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function readReloadMark(storage = safeStorage()) {
  try {
    const raw = storage?.getItem(RELOAD_MARK_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && raw !== null && raw !== '' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeReloadMark(at, storage = safeStorage()) {
  try {
    storage?.setItem(RELOAD_MARK_KEY, String(at));
  } catch {
    /* storage unavailable — the cooldown degrades to "reload once per load" */
  }
}

export function clearReloadMark(storage = safeStorage()) {
  try {
    storage?.removeItem(RELOAD_MARK_KEY);
  } catch {
    /* ignore */
  }
}

function defaultReload() {
  // `location.reload()` re-requests index.html, which is served `no-cache` and
  // therefore revalidates — the renderer comes back pointing at live hashes.
  if (typeof window !== 'undefined') window.location.reload();
}

/**
 * Full-bleed neutral fill shown while a chunk is in flight. Matches the
 * placeholder Terminal.vue used to render itself.
 */
export const ScreenPlaceholder = {
  name: 'ScreenPlaceholder',
  render: () => h('div', { style: 'flex:1;width:100%;height:100%;background:var(--color-background)' }),
};

/**
 * The single way this app creates a lazy component.
 *
 * @param {() => Promise<any>} loader  Bare `() => import('...')`.
 * @param {object} [options]
 * @param {string} [options.name]      Label used in diagnostics/UI.
 * @returns {import('vue').Component}
 */
export function lazyComponent(loader, options = {}) {
  const {
    name = 'view',
    reload = defaultReload,
    storage,
    now = () => Date.now(),
    cooldownMs = RELOAD_COOLDOWN_MS,
    loadingComponent = ScreenPlaceholder,
    errorComponent = ChunkLoadFailed,
    delay = 0,
  } = options;

  const resolveStorage = () => (storage === undefined ? safeStorage() : storage);

  return defineAsyncComponent({
    loader,
    loadingComponent,
    errorComponent,
    delay,
    onError(error, retry, fail) {
      if (!isChunkLoadError(error)) {
        // A real error inside the module. Surfacing it is the correct answer;
        // reloading would just replay the same crash.
        console.error(`[chunk] ${name} failed to initialise:`, error);
        fail();
        return;
      }

      const store = resolveStorage();
      const decision = decideChunkRecovery({
        now: now(),
        lastAttemptAt: readReloadMark(store),
        cooldownMs,
      });

      if (decision === 'reload') {
        console.warn(`[chunk] ${name} is stale (build replaced its hash); reloading once to pick up the current build.`);
        writeReloadMark(now(), store);
        reload();
        return;
      }

      console.error(`[chunk] ${name} still unavailable after a recovery reload; showing the recovery UI.`, error);
      fail();
    },
  });
}
