/**
 * Settings → Connection.
 *
 * The card's job after a failed remote is to tell the truth: the configuration
 * still says "remote" while the app is demonstrably running on this computer.
 * A UI that reports the CONFIGURED mode there would be lying, and "why does it
 * say remote when my agents are gone?" is the confusion this whole feature
 * exists to remove.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ConnectionSection from './ConnectionSection.vue';

function bridge(overrides = {}) {
  const listeners = [];
  const api = {
    get: vi.fn(async () => ({
      mode: 'remote',
      url: 'http://box:3333',
      source: 'file',
      activeMode: 'remote',
      fellBack: false,
      phase: 'ready',
      fallbackToLocal: false,
      envPinned: false,
      localPort: 3333,
      ...overrides,
    })),
    test: vi.fn(async () => ({ ok: true, latencyMs: 12 })),
    set: vi.fn(async () => ({ ok: true, restartRequired: true })),
    relaunch: vi.fn(async () => ({})),
    retry: vi.fn(async () => ({ ok: true })),
    useLocalNow: vi.fn(async () => ({ ok: true })),
    onState: vi.fn((cb) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i > -1) listeners.splice(i, 1);
      };
    }),
  };
  return { api, emit: (payload) => listeners.forEach((l) => l(payload)) };
}

/**
 * `.conn-note-warn` is shared by three different notices (env-pinned, plaintext
 * http, fallback). Asserting on the class alone passes for the wrong reason —
 * the http fixture URL legitimately raises the plaintext warning.
 */
const fallbackBanner = (w) => w.findAll('.conn-note-warn').find((n) => n.text().includes("Couldn't reach"));

let harness = null;
function install(overrides) {
  harness = bridge(overrides);
  globalThis.window.electron = { connection: harness.api };
  return harness;
}

async function mountCard(overrides) {
  install(overrides);
  const w = mount(ConnectionSection);
  await flushPromises();
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  delete globalThis.window.electron;
});

describe('availability', () => {
  it('says it is desktop-only when there is no Electron bridge', async () => {
    delete globalThis.window.electron;
    const w = mount(ConnectionSection);
    await flushPromises();
    expect(w.text()).toContain('only applies to the AGNT desktop app');
    expect(w.find('.conn-options').exists()).toBe(false);
    w.unmount();
  });
});

describe('the fallback banner', () => {
  it('is absent while the app is really on the configured backend', async () => {
    const w = await mountCard();
    expect(fallbackBanner(w)).toBeUndefined();
    w.unmount();
  });

  it('appears, and names the server, when the app fell back to this computer', async () => {
    const w = await mountCard({ fellBack: true, activeMode: 'local' });
    const banner = fallbackBanner(w);
    expect(banner, 'no fallback banner rendered').toBeTruthy();
    expect(banner.text()).toContain('http://box:3333');
    expect(banner.text()).toContain('this session');
    w.unmount();
  });

  it('says the remote setting is unchanged, because it is', async () => {
    const w = await mountCard({ fellBack: true, activeMode: 'local' });
    expect(w.text()).toMatch(/remote setting is unchanged/i);
    // And the radio still reflects the CONFIGURED mode.
    expect(w.find('input[value="remote"]').element.checked).toBe(true);
    w.unmount();
  });

  it('offers an in-place reconnect that does not relaunch', async () => {
    const w = await mountCard({ fellBack: true, activeMode: 'local' });
    await w.find('.conn-inline-btn').trigger('click');
    await flushPromises();
    expect(harness.api.retry).toHaveBeenCalledTimes(1);
    expect(harness.api.relaunch).not.toHaveBeenCalled();
    w.unmount();
  });

  it('updates live if a fallback happens while the screen is open', async () => {
    const w = await mountCard();
    expect(fallbackBanner(w)).toBeUndefined();
    harness.emit({ phase: 'connecting', fellBack: true, activeMode: 'local' });
    await flushPromises();
    expect(fallbackBanner(w)).toBeTruthy();
    w.unmount();
  });

  it('unsubscribes on unmount, so it cannot leak a listener per visit', async () => {
    const w = await mountCard();
    const stop = harness.api.onState.mock.results[0].value;
    expect(typeof stop).toBe('function');
    w.unmount();
    // Emitting after unmount must not throw on a dead component.
    expect(() => harness.emit({ fellBack: true })).not.toThrow();
  });
});

describe('the opt-in preference', () => {
  it('is off by default and reflected from the config', async () => {
    const w = await mountCard();
    expect(w.find('.conn-check input').element.checked).toBe(false);
    w.unmount();
  });

  it('shows as on when enabled', async () => {
    const w = await mountCard({ fallbackToLocal: true });
    expect(w.find('.conn-check input').element.checked).toBe(true);
    w.unmount();
  });

  it('explains that a local backend is a different database', async () => {
    // Without that sentence the checkbox reads as "make it work anyway", which
    // is exactly the misunderstanding that makes a silent fallback dangerous.
    const w = await mountCard();
    expect(w.find('.conn-check').text()).toMatch(/different database/i);
    w.unmount();
  });

  it('is included in the saved payload', async () => {
    const w = await mountCard();
    await w.find('.conn-check input').setValue(true);
    await w.find('.conn-btn-primary').trigger('click');
    await flushPromises();
    expect(harness.api.set).toHaveBeenCalledWith({
      mode: 'remote',
      url: 'http://box:3333',
      fallbackToLocal: true,
    });
    w.unmount();
  });

  it('toggling it alone is enough to enable Save', async () => {
    const w = await mountCard();
    expect(w.find('.conn-btn-primary').element.disabled).toBe(true);
    await w.find('.conn-check input').setValue(true);
    expect(w.find('.conn-btn-primary').element.disabled).toBe(false);
    w.unmount();
  });

  it('is not offered for a local connection, where it means nothing', async () => {
    const w = await mountCard({ mode: 'local', url: null });
    expect(w.find('.conn-check').exists()).toBe(false);
    w.unmount();
  });

  it('is disabled when the URL is pinned by the environment', async () => {
    const w = await mountCard({ envPinned: true });
    expect(w.find('.conn-check input').element.disabled).toBe(true);
    w.unmount();
  });
});

describe('saving local does not carry the preference', () => {
  it('sends a bare local payload', async () => {
    const w = await mountCard({ fallbackToLocal: true });
    await w.find('input[value="local"]').setValue();
    await w.find('.conn-btn-primary').trigger('click');
    await flushPromises();
    expect(harness.api.set).toHaveBeenCalledWith({ mode: 'local' });
    w.unmount();
  });
});
