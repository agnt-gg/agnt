/**
 * These tests pin the behaviour that turns a blank screen into something a
 * user can see and act on:
 *
 *   - a chunk that vanished gets exactly ONE automatic reload,
 *   - a component that threw gets NO reload (that would hide the bug),
 *   - and once the reload is spent, the failure becomes visible UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h } from 'vue';
import {
  isChunkLoadError,
  decideChunkRecovery,
  lazyComponent,
  readReloadMark,
  writeReloadMark,
  clearReloadMark,
  RELOAD_COOLDOWN_MS,
  RELOAD_MARK_KEY,
} from './chunkRecovery.js';

/** In-memory stand-in for sessionStorage. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const Ok = { name: 'Ok', render: () => h('div', { class: 'ok' }, 'loaded') };
const Loading = { name: 'Loading', render: () => h('div', { class: 'loading' }) };
const Failed = {
  name: 'Failed',
  props: { error: { type: [Error, Object, String], default: null } },
  render() {
    return h('div', { class: 'failed' }, this.error?.message || '');
  },
};

/**
 * Async components swap their root element after resolution, so they must be
 * mounted INSIDE a host element — a wrapper mounted directly on the async
 * component keeps searching from the element it captured at mount time.
 */
function host(Async) {
  return mount({ render: () => h('div', { class: 'host' }, [h(Async)]) });
}

function mountLazy(loader, options = {}) {
  return host(
    lazyComponent(loader, {
      loadingComponent: Loading,
      errorComponent: Failed,
      ...options,
    }),
  );
}

describe('isChunkLoadError', () => {
  it('recognises every browser wording for a missing chunk', () => {
    const missing = [
      "Failed to fetch dynamically imported module: http://localhost:3333/assets/js/Settings.B4rtEn8e.js",
      'error loading dynamically imported module',
      'Loading chunk 42 failed.',
      'Loading CSS chunk 7 failed.',
      'Importing a module script failed.',
      // The exact shape of OUR bug: the SPA catch-all answered with index.html.
      "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
      "'text/html' is not a valid JavaScript MIME type.",
      'Unable to preload CSS for /assets/css/index.DEAAfVF5.css',
    ];
    for (const message of missing) {
      expect(isChunkLoadError(new Error(message)), message).toBe(true);
    }
  });

  it('does not claim a real component error is a chunk error', () => {
    const real = [
      new TypeError("Cannot read properties of undefined (reading 'map')"),
      new Error('store.dispatch is not a function'),
      new ReferenceError('foo is not defined'),
    ];
    for (const error of real) {
      expect(isChunkLoadError(error), error.message).toBe(false);
    }
  });

  it('is safe on null/undefined', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('decideChunkRecovery', () => {
  const now = 1_000_000;

  it('reloads when nothing has been tried', () => {
    expect(decideChunkRecovery({ now, lastAttemptAt: null })).toBe('reload');
  });

  it('refuses a second reload inside the cooldown — this is the loop guard', () => {
    expect(decideChunkRecovery({ now, lastAttemptAt: now - 1 })).toBe('fail');
    expect(decideChunkRecovery({ now, lastAttemptAt: now - (RELOAD_COOLDOWN_MS - 1) })).toBe('fail');
  });

  it('allows a fresh reload once the cooldown has passed', () => {
    expect(decideChunkRecovery({ now, lastAttemptAt: now - RELOAD_COOLDOWN_MS })).toBe('reload');
  });

  it('treats a future-dated mark as "just tried" rather than reloading', () => {
    // Clock change or a corrupt value must never be able to start a loop.
    expect(decideChunkRecovery({ now, lastAttemptAt: now + 60_000 })).toBe('fail');
  });

  it('honours an explicit cooldown', () => {
    expect(decideChunkRecovery({ now, lastAttemptAt: now - 500, cooldownMs: 100 })).toBe('reload');
  });
});

describe('reload mark storage', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    writeReloadMark(1234, storage);
    expect(storage._map.get(RELOAD_MARK_KEY)).toBe('1234');
    expect(readReloadMark(storage)).toBe(1234);
    clearReloadMark(storage);
    expect(readReloadMark(storage)).toBeNull();
  });

  it('treats a garbage value as absent', () => {
    expect(readReloadMark(memoryStorage({ [RELOAD_MARK_KEY]: 'not-a-number' }))).toBeNull();
    expect(readReloadMark(memoryStorage({ [RELOAD_MARK_KEY]: '' }))).toBeNull();
  });

  it('survives storage that throws (private mode)', () => {
    const hostile = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    expect(readReloadMark(hostile)).toBeNull();
    expect(() => writeReloadMark(1, hostile)).not.toThrow();
    expect(() => clearReloadMark(hostile)).not.toThrow();
  });
});

describe('lazyComponent', () => {
  let warn;
  let error;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders the component when the chunk loads', async () => {
    // Resolved with the component directly: Vue only unwraps `.default` for a
    // real ES module, which a hand-built object is not.
    const wrapper = mountLazy(() => Promise.resolve(Ok));
    await flushPromises();
    expect(wrapper.find('.ok').exists()).toBe(true);
  });

  it('reloads exactly once when the chunk is gone', async () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    const loader = vi.fn(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/js/Settings.B4rtEn8e.js')),
    );

    mountLazy(loader, { reload, storage, now: () => 5_000, name: 'SettingsScreen' });
    await flushPromises();

    expect(reload).toHaveBeenCalledTimes(1);
    // The mark is what stops the next mount from reloading again.
    expect(readReloadMark(storage)).toBe(5_000);
  });

  it('shows the recovery UI instead of reloading again after one attempt', async () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    const now = 5_000;
    writeReloadMark(now - 1_000, storage); // a reload already happened

    const wrapper = mountLazy(
      () => Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/js/Settings.B4rtEn8e.js')),
      { reload, storage, now: () => now },
    );
    await flushPromises();

    expect(reload).not.toHaveBeenCalled();
    expect(wrapper.find('.failed').exists()).toBe(true);
  });

  it('never reloads on a genuine error inside the module', async () => {
    const reload = vi.fn();
    const storage = memoryStorage();

    const wrapper = mountLazy(() => Promise.reject(new TypeError('x.map is not a function')), {
      reload,
      storage,
      now: () => 1,
    });
    await flushPromises();

    expect(reload).not.toHaveBeenCalled();
    // And it surfaces rather than rendering nothing.
    expect(wrapper.find('.failed').exists()).toBe(true);
    expect(error).toHaveBeenCalled();
  });

  it('shows the loading placeholder while the chunk is in flight', () => {
    let resolve;
    const wrapper = mountLazy(() => new Promise((r) => { resolve = r; }));
    expect(wrapper.find('.loading').exists()).toBe(true);
    resolve(Ok);
  });

  it('always renders SOMETHING on failure — the original bug was an empty div', async () => {
    // Defaults (no errorComponent override) must still produce visible output.
    const reload = vi.fn();
    const storage = memoryStorage({ [RELOAD_MARK_KEY]: '900' });
    const wrapper = host(
      lazyComponent(
        () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
        { reload, storage, now: () => 1_000 },
      ),
    );
    await flushPromises();

    expect(reload).not.toHaveBeenCalled();
    expect(wrapper.text().length).toBeGreaterThan(0);
    expect(wrapper.text()).toMatch(/couldn't load/i);
  });
});
