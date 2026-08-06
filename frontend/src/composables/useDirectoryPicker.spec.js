import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useDirectoryPicker } from './useDirectoryPicker.js';

/**
 * Run the composable inside a real component instance.
 *
 * It registers onUnmounted, which is a no-op warning outside a component and
 * would silently skip the listener-cleanup assertions below.
 */
function withPicker() {
  let api;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useDirectoryPicker();
        return () => h('div');
      },
    }),
  );
  return { api: () => api, wrapper };
}

const bridge = (overrides = {}) => ({
  chooseDirectory: vi.fn(async () => ({ ok: true, path: '/picked' })),
  connection: {
    get: vi.fn(async () => ({ activeMode: 'local', mode: 'local', url: null })),
    onState: vi.fn(() => () => {}),
  },
  ...overrides,
});

describe('useDirectoryPicker — when browsing is offered', () => {
  afterEach(() => {
    delete window.electron;
  });

  it('is unavailable with no Electron bridge, and says why', async () => {
    const { api } = withPicker();
    await nextTick();
    expect(api().available.value).toBe(false);
    expect(api().unavailableReason.value).toBe('no-bridge');
  });

  it('never calls a bridge that is not there', async () => {
    const { api } = withPicker();
    await expect(api().browse()).resolves.toBeNull();
  });

  it('is available with a bridge and a local backend', async () => {
    window.electron = bridge();
    const { api } = withPicker();
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(true);
    expect(api().unavailableReason.value).toBeNull();
  });

  it('is unavailable against a remote backend, and names the machine', async () => {
    // The defect this prevents: the user picks a folder on their laptop, we
    // post it to a server where the path is absent, and the backend's mkdir -p
    // creates it somewhere they will never look.
    window.electron = bridge({
      connection: {
        get: vi.fn(async () => ({ activeMode: 'remote', mode: 'remote', url: 'http://box.local:3333' })),
        onState: vi.fn(() => () => {}),
      },
    });
    const { api } = withPicker();
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(false);
    expect(api().unavailableReason.value).toBe('remote-backend');
    expect(api().remoteUrl.value).toBe('http://box.local:3333');
  });

  it('reads activeMode, not the configured mode', async () => {
    // Configured for remote, currently fallen back to this computer. The disk
    // under the dialog IS the backend's disk, so browsing is correct — reading
    // `mode` would disable the picker for exactly the user it works for.
    window.electron = bridge({
      connection: {
        get: vi.fn(async () => ({ activeMode: 'local', mode: 'remote', fellBack: true, url: 'http://box.local:3333' })),
        onState: vi.fn(() => () => {}),
      },
    });
    const { api } = withPicker();
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(true);
  });

  it('stays available when main cannot be asked', async () => {
    // An unreachable main says nothing about the user's folder. A missing
    // button is a worse answer than a button that explains itself on click.
    window.electron = bridge({
      connection: {
        get: vi.fn(async () => {
          throw new Error('no ipc');
        }),
        onState: vi.fn(() => () => {}),
      },
    });
    const { api } = withPicker();
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(true);
  });

  it('treats a bridge with no connection API as local', async () => {
    // Remote mode is the reason that API exists, so its absence means there
    // is no remote to be wrong about.
    window.electron = { chooseDirectory: vi.fn(async () => ({ ok: true, path: '/p' })) };
    const { api } = withPicker();
    await nextTick();
    expect(api().available.value).toBe(true);
  });
});

describe('useDirectoryPicker — choosing', () => {
  afterEach(() => {
    delete window.electron;
  });

  it('returns the chosen path', async () => {
    window.electron = bridge();
    const { api } = withPicker();
    await expect(api().browse({ defaultPath: '/start' })).resolves.toBe('/picked');
    expect(window.electron.chooseDirectory).toHaveBeenCalledWith({ defaultPath: '/start' });
  });

  it('returns null on cancel, so the caller leaves the field alone', async () => {
    window.electron = bridge({ chooseDirectory: vi.fn(async () => ({ ok: false, reason: 'canceled' })) });
    const { api } = withPicker();
    await expect(api().browse()).resolves.toBeNull();
  });

  it('returns null when the dialog itself fails', async () => {
    window.electron = bridge({ chooseDirectory: vi.fn(async () => ({ ok: false, reason: 'failed', error: 'boom' })) });
    const { api } = withPicker();
    await expect(api().browse()).resolves.toBeNull();
  });

  it('returns null rather than throwing when the bridge rejects', async () => {
    window.electron = bridge({
      chooseDirectory: vi.fn(async () => {
        throw new Error('ipc died');
      }),
    });
    const { api } = withPicker();
    await expect(api().browse()).resolves.toBeNull();
  });

  it('ignores an ok result with no path', async () => {
    window.electron = bridge({ chooseDirectory: vi.fn(async () => ({ ok: true, path: '' })) });
    const { api } = withPicker();
    await expect(api().browse()).resolves.toBeNull();
  });

  it('defers to main when main says remote, even having believed otherwise', async () => {
    // Main is the authority. Two opinions of one fact is the bug; this is the
    // rule that keeps the second one from surviving.
    window.electron = bridge({
      chooseDirectory: vi.fn(async () => ({ ok: false, reason: 'remote-backend', remoteUrl: 'http://box:3333' })),
    });
    const { api } = withPicker();
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(true);

    await expect(api().browse()).resolves.toBeNull();
    expect(api().available.value).toBe(false);
    expect(api().unavailableReason.value).toBe('remote-backend');
    expect(api().remoteUrl.value).toBe('http://box:3333');
  });
});

describe('useDirectoryPicker — following the connection', () => {
  afterEach(() => {
    delete window.electron;
  });

  it('re-checks when the connection changes mid-session', async () => {
    let mode = 'remote';
    let fire;
    window.electron = bridge({
      connection: {
        get: vi.fn(async () => ({ activeMode: mode, url: 'http://box:3333' })),
        onState: vi.fn((cb) => {
          fire = cb;
          return () => {};
        }),
      },
    });
    const { api } = withPicker();
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(false);

    // The remote dropped and the app fell back to this computer.
    mode = 'local';
    fire({ phase: 'ready' });
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(true);
  });

  it('unsubscribes on unmount, so a remount does not stack listeners', async () => {
    const off = vi.fn();
    window.electron = bridge({
      connection: {
        get: vi.fn(async () => ({ activeMode: 'local' })),
        onState: vi.fn(() => off),
      },
    });
    const { wrapper } = withPicker();
    await nextTick();
    wrapper.unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('survives a bridge whose onState throws', async () => {
    window.electron = bridge({
      connection: {
        get: vi.fn(async () => ({ activeMode: 'local' })),
        onState: vi.fn(() => {
          throw new Error('nope');
        }),
      },
    });
    const { api, wrapper } = withPicker();
    await nextTick();
    await nextTick();
    expect(api().available.value).toBe(true);
    expect(() => wrapper.unmount()).not.toThrow();
  });
});
