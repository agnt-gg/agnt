import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { REMOTE_URL: 'https://remote.test', BASE_URL: 'http://local.test/api' } }));
vi.mock('@/views/_utils/encryption.js', () => ({ encrypt: (value) => `enc(${value})` }));
const authService = vi.hoisted(() => ({
  startOAuth: vi.fn(),
  pollOAuthStatus: vi.fn(),
  exchangeOAuth: vi.fn(),
}));
vi.mock('@/services/providerAuthService.js', () => ({ default: authService }));

import { useAiProviderConnect } from './useAiProviderConnect.js';

/**
 * A SimpleModal double that behaves like the real one: showModal resolves when
 * confirm() or cancel() is called, and `isOpen` tracks it. `answer` makes it
 * answer by itself (prompt text, true, null) as a user would.
 */
function fakeModal({ answer } = {}) {
  const modal = {
    isOpen: false,
    shown: [],
    resolve: null,
    showModal: vi.fn((options) => {
      modal.shown.push(options);
      modal.isOpen = true;
      return new Promise((resolve) => {
        modal.resolve = resolve;
        if (answer !== undefined) queueMicrotask(() => modal.isOpen && (modal.isOpen = false, resolve(answer)));
      });
    }),
    confirm: vi.fn(() => { modal.isOpen = false; modal.resolve?.(true); }),
    cancel: () => { modal.isOpen = false; modal.resolve?.(null); },
  };
  return modal;
}

function fakeStore({ connected = [], dispatch = {} } = {}) {
  return {
    getters: { 'appAuth/connectedApps': connected },
    state: { appAuth: { connectedApps: connected } },
    dispatch: vi.fn(async (type, payload) => (dispatch[type] ? dispatch[type](payload) : true)),
  };
}

const setup = ({ store, modal = fakeModal(), onSelected = vi.fn() } = {}) => {
  const modalRef = ref(modal);
  const api = useAiProviderConnect(modalRef, { store, source: 'test', onSelected });
  return { ...api, modal, onSelected };
};

describe('useAiProviderConnect — one click from a tile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    localStorage.setItem('token', 't');
  });

  it('uses AGNT Flash straight away, under its store name', async () => {
    const store = fakeStore();
    const { connect, onSelected, modal } = setup({ store });
    await connect({ id: 'agnt', name: 'AGNT Flash' });
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/useProvider', { provider: 'AGNT', source: 'test' });
    expect(onSelected).toHaveBeenCalledOnce();
    expect(modal.showModal).not.toHaveBeenCalled();
  });

  it('uses an already-connected provider with no dialog at all', async () => {
    const store = fakeStore({ connected: ['openai'] });
    const { connect, modal, onSelected } = setup({ store });
    await connect({ id: 'openai', name: 'OpenAI', connectionType: 'apikey' });
    expect(onSelected).toHaveBeenCalledOnce();
    expect(modal.showModal).not.toHaveBeenCalled();
  });

  // The old pipeline showed the provider's instructions with a "Continue"
  // button BEFORE going to the vendor: one more click on every OAuth connect.
  it('goes straight to the vendor for OAuth, with no Continue dialog first', async () => {
    // jsdom's window.location cannot be replaced, so the redirect itself is
    // not observable here. What is: the vendor request goes out on the click,
    // and the only dialog that can appear is an error (this vendor answers
    // with no consent URL), never an instructions-then-Continue gate.
    const store = fakeStore();
    const modal = fakeModal({ answer: true });
    const { connect } = setup({ store, modal });
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await connect({ id: 'github', name: 'GitHub', connectionType: 'oauth', instructions: 'Read this first' });
    expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/remote\.test\/auth\/connect\/github\?origin=/);
    expect(modal.shown.map((o) => o.title)).toEqual(['Connection Error']);
    expect(modal.shown.some((o) => o.confirmText === 'Continue')).toBe(false);
  });

  it('closes the Codex waiting dialog by itself when sign-in completes', async () => {
    let finishPoll;
    const store = fakeStore({
      dispatch: {
        'appAuth/fetchCodexStatus': vi
          .fn()
          .mockResolvedValueOnce({ available: false })
          .mockResolvedValueOnce({ available: true }),
        'appAuth/startCodexDeviceAuth': async () => ({ success: true, deviceUrl: 'https://auth.test/device', deviceCode: 'AB<CD', sessionId: 's1' }),
        'appAuth/pollCodexDeviceAuth': () => new Promise((resolve) => { finishPoll = resolve; }),
      },
    });
    window.open = vi.fn();
    const { connect, modal, onSelected } = setup({ store });
    const running = connect({ id: 'openai-codex', name: 'ChatGPT' });
    await vi.waitFor(() => expect(modal.showModal).toHaveBeenCalled());

    // The code is shown escaped; there is no "I have logged in" to press.
    expect(modal.shown[0].message).toContain('AB&lt;CD');
    expect(modal.shown[0].confirmText).not.toMatch(/logged in|signed in/i);
    expect(window.open).toHaveBeenCalledWith('https://auth.test/device', '_blank');

    finishPoll({ state: 'success' });
    await running;
    expect(modal.confirm).toHaveBeenCalledOnce();
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it('selects nothing when the user cancels the wait', async () => {
    const store = fakeStore({
      dispatch: {
        'appAuth/fetchCodexStatus': async () => ({ available: false }),
        'appAuth/startCodexDeviceAuth': async () => ({ success: true, deviceUrl: 'https://auth.test/d', deviceCode: 'X', sessionId: 's' }),
        'appAuth/pollCodexDeviceAuth': () => new Promise(() => {}),
      },
    });
    window.open = vi.fn();
    const { connect, modal, onSelected } = setup({ store });
    const running = connect({ id: 'openai-codex', name: 'ChatGPT' });
    await vi.waitFor(() => expect(modal.showModal).toHaveBeenCalled());
    modal.cancel();
    await running;
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('polls Antigravity on its own and uses it on success', async () => {
    authService.startOAuth.mockResolvedValue({ authUrl: 'https://google.test', sessionId: 'g1' });
    authService.pollOAuthStatus.mockResolvedValue({ status: 'success' });
    window.open = vi.fn();
    const store = fakeStore();
    const { connect, modal, onSelected } = setup({ store });
    await connect({ id: 'antigravity', name: 'Antigravity' });
    expect(authService.pollOAuthStatus).toHaveBeenCalledWith('antigravity', 'g1');
    expect(modal.confirm).toHaveBeenCalledOnce();
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it('saves a pasted key, then uses it, with no success alert to dismiss', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const store = fakeStore();
    const { saveApiKey, modal, onSelected } = setup({ store });
    await saveApiKey({ id: 'openai', name: 'OpenAI' }, 'sk-1');
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://remote.test/auth/apikeys/openai');
    expect(JSON.parse(init.body).apiKey).toBe('enc(sk-1)');
    expect(onSelected).toHaveBeenCalledOnce();
    expect(modal.showModal).not.toHaveBeenCalled();
  });

  it('still says what went wrong when a key is refused', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 });
    const store = fakeStore();
    const modal = fakeModal({ answer: true });
    const { saveApiKey, onSelected } = setup({ store, modal });
    await saveApiKey({ id: 'openai', name: 'OpenAI' }, 'bad');
    expect(modal.shown[0].title).toBe('Error');
    expect(onSelected).not.toHaveBeenCalled();
  });
});

// Reported 2026-10-07: "Run a model on this machine" did nothing when clicked.
describe('useAiProviderConnect — run a model on this machine', () => {
  const LOCAL = { id: 'local', name: 'Local' };
  const reply = (body) => ({ ok: true, json: async () => body });
  const calls = () => global.fetch.mock.calls.map(([url, init]) => (init?.method || 'GET') + ' ' + url);
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    localStorage.setItem('token', 't');
    window.electron = { openExternalUrl: vi.fn() };
  });

  it('LM Studio running with a model: uses it at once', async () => {
    global.fetch.mockResolvedValue(reply({ running: true, models: ['qwen3-8b'], installed: true }));
    const store = fakeStore();
    const { connect, onSelected, modal } = setup({ store });
    await connect(LOCAL);
    expect(calls()).toEqual(['GET http://local.test/api/local-models/status']);
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/setProvider', 'Local');
    expect(onSelected).toHaveBeenCalledOnce();
    expect(modal.showModal).not.toHaveBeenCalled();
  });

  it('installed but stopped: starts LM Studio, then uses it', async () => {
    global.fetch
      .mockResolvedValueOnce(reply({ running: false, models: [], installed: true, canStart: true }))
      .mockResolvedValueOnce(reply({ running: true, models: ['qwen3-8b'], installed: true }));
    const store = fakeStore();
    const { connect, onSelected, modal } = setup({ store });
    await connect(LOCAL);
    expect(calls()).toEqual(['GET http://local.test/api/local-models/status', 'POST http://local.test/api/local-models/start']);
    expect(modal.shown[0].title).toBe('Starting LM Studio');
    expect(modal.confirm).toHaveBeenCalled();
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it('a failed start says why and selects nothing', async () => {
    global.fetch
      .mockResolvedValueOnce(reply({ running: false, models: [], installed: true, canStart: true }))
      .mockResolvedValueOnce(reply({ running: false, models: [], installed: true, error: 'start_failed', detail: 'LM Studio is not set up' }));
    const modal = fakeModal();
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    const done = connect(LOCAL);
    await vi.waitFor(() => expect(modal.shown.length).toBe(2));
    expect(modal.shown[1].title).toBe('LM Studio did not start');
    expect(modal.shown[1].message).toContain('LM Studio is not set up');
    modal.confirm();
    await done;
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('not installed: offers the download; "Not now" does nothing else', async () => {
    global.fetch.mockResolvedValue(reply({ running: false, models: [], installed: false, downloadUrl: 'https://lmstudio.ai/download' }));
    const modal = fakeModal({ answer: null });
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    await connect(LOCAL);
    expect(modal.shown[0].title).toBe('Run AI on this computer');
    expect(modal.shown[0].confirmText).toBe('Download LM Studio');
    expect(window.electron.openExternalUrl).not.toHaveBeenCalled();
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('not installed: "Download" opens LM Studio\'s page and waits for it to appear', async () => {
    vi.useFakeTimers();
    try {
      global.fetch
        .mockResolvedValueOnce(reply({ running: false, models: [], installed: false, downloadUrl: 'https://lmstudio.ai/download' }))
        .mockResolvedValueOnce(reply({ running: false, models: [], installed: false }))
        .mockResolvedValueOnce(reply({ running: true, models: ['qwen3-8b'], installed: true }));
      const modal = fakeModal();
      const { connect, onSelected } = setup({ store: fakeStore(), modal });
      const done = connect(LOCAL);
      await vi.waitFor(() => expect(modal.shown.length).toBe(1));
      modal.confirm(); // Download LM Studio
      await vi.waitFor(() => expect(modal.shown.length).toBe(2));
      expect(window.electron.openExternalUrl).toHaveBeenCalledWith('https://lmstudio.ai/download');
      expect(modal.shown[1].title).toBe('Waiting for LM Studio');
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      await done;
      expect(onSelected).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('running but no model downloaded: says so instead of selecting an empty provider', async () => {
    global.fetch.mockResolvedValue(reply({ running: true, models: [], installed: true }));
    const modal = fakeModal({ answer: true });
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    await connect(LOCAL);
    expect(modal.shown[0].title).toBe('Load a model in LM Studio');
    expect(onSelected).not.toHaveBeenCalled();
  });
});
