import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { REMOTE_URL: 'https://remote.test', BASE_URL: 'http://local.test/api' } }));
vi.mock('@/views/_utils/encryption.js', () => ({ encrypt: (value) => `enc(${value})` }));
const authService = vi.hoisted(() => ({
  startOAuth: vi.fn(),
  pollOAuthStatus: vi.fn(),
  exchangeOAuth: vi.fn(),
  getCapabilities: vi.fn(),
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

function fakeStore({ connected = [], dispatch = {}, selectedProvider = 'OpenAI-Codex' } = {}) {
  return {
    getters: { 'appAuth/connectedApps': connected },
    state: { appAuth: { connectedApps: connected }, aiProvider: { selectedProvider } },
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

  // Regression: these tiles asked AGNT's server for an OAuth link, which has
  // none for a CLI on this computer: "Failed to connect to Cursor: HTTP error!
  // status: 404".
  it.each([
    ['cursor-cli', 'Cursor'],
    ['grok-build', 'Grok Build'],
  ])('signs %s in through its own CLI login on this computer, never AGNT\'s server', async (id, name) => {
    authService.getCapabilities.mockResolvedValue({ local: true, capabilities: ['status', 'device-auth'] });
    window.electron = { openExternalUrl: vi.fn() };
    const store = fakeStore({
      dispatch: {
        'appAuth/startProviderDeviceAuth': async () => ({ success: true, sessionId: 's1', state: 'pending', deviceUrl: 'https://login.test/device', deviceCode: id === 'grok-build' ? 'ABCD-EFGH' : null }),
        'appAuth/pollProviderDeviceAuth': async () => ({ success: true, state: 'success' }),
      },
    });
    const { connect, modal, onSelected } = setup({ store });
    await connect({ id, name, connectionType: 'oauth' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalledWith('appAuth/startProviderDeviceAuth', id);
    expect(store.dispatch).toHaveBeenCalledWith('appAuth/pollProviderDeviceAuth', expect.objectContaining({ providerId: id, sessionId: 's1' }));
    // The waiting dialog closed itself; nothing asked the user to click anything.
    expect(modal.shown.map((o) => o.title)).toEqual([`Sign in to ${name}`]);
    expect(modal.confirm).toHaveBeenCalled();
    expect(onSelected).toHaveBeenCalledOnce();
    // A code to type is shown, with its page opened; a CLI that opens the browser itself is left to it.
    if (id === 'grok-build') {
      expect(modal.shown[0].message).toContain('ABCD-EFGH');
      expect(window.electron.openExternalUrl).toHaveBeenCalledWith('https://login.test/device');
    } else {
      expect(window.electron.openExternalUrl).not.toHaveBeenCalled();
    }
    delete window.electron;
  });

  it('says why when a CLI login cannot start, instead of an HTTP error', async () => {
    authService.getCapabilities.mockResolvedValue({ local: true, capabilities: ['device-auth'] });
    const store = fakeStore({ dispatch: { 'appAuth/startProviderDeviceAuth': async () => ({ success: true, state: 'error', message: 'cursor-agent is not installed' }) } });
    const { connect, modal } = setup({ store, modal: fakeModal({ answer: true }) });
    await connect({ id: 'cursor-cli', name: 'Cursor', connectionType: 'oauth' });
    expect(modal.shown.map((o) => [o.title, o.message])).toEqual([['Cursor sign-in did not start', 'cursor-agent is not installed']]);
    expect(global.fetch).not.toHaveBeenCalled();
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

  /** fetch by route: { 'GET status': body | (() => body), 'POST prepare': ... }; a body with `status` >= 400 is an error reply. */
  const serve = (routes) => {
    global.fetch.mockImplementation(async (url, init) => {
      const key = `${init?.method || 'GET'} ${String(url).replace('http://local.test/api/local-models/', '')}`;
      const route = routes[key];
      const body = typeof route === 'function' ? route() : route;
      if (body === undefined) throw new Error(`unexpected ${key}`);
      const status = body.httpStatus || 200;
      return { ok: status < 400, status, json: async () => body };
    });
  };
  const READY = { model: 'qwen3-8b', contextLength: 32768, reloaded: true };

  // Reported 2026-10-21: with LM Studio running, the click switched to
  // qwen3.5-4b loaded with 4096 tokens of context, and the first message
  // failed (a turn needs about 23K). The model is made ready first, and the
  // switch goes to that exact model.
  it('LM Studio running with a model: makes it ready, then switches to that model', async () => {
    serve({ 'GET status': { running: true, models: ['qwen3-8b'], installed: true }, 'POST prepare': READY });
    const store = fakeStore();
    const { connect, onSelected, modal } = setup({ store });
    await connect(LOCAL);
    expect(calls()).toEqual(['GET http://local.test/api/local-models/status', 'POST http://local.test/api/local-models/prepare']);
    expect(modal.shown.map((o) => o.title)).toEqual(['Getting the local model ready']);
    expect(modal.confirm).toHaveBeenCalled(); // closed by itself
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/setProvider', { provider: 'Local', source: 'test' });
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/setModel', { model: 'qwen3-8b', source: 'test' });
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it('a model LM Studio cannot load: says why, and keeps the current AI', async () => {
    serve({
      'GET status': { running: true, models: ['qwen3.5-9b'], installed: true },
      'POST prepare': { httpStatus: 422, error: 'load_failed', model: 'qwen3.5-9b', contextLength: 32768, detail: 'out of memory' },
    });
    const modal = fakeModal();
    const store = fakeStore();
    const { connect, onSelected } = setup({ store, modal });
    const done = connect(LOCAL);
    await vi.waitFor(() => expect(modal.shown.length).toBe(2));
    expect(modal.shown[1].title).toBe('The local model is not ready');
    expect(modal.shown[1].message).toContain('could not load qwen3.5-9b with 32768 tokens of context (out of memory)');
    expect(modal.shown[1].message).toContain('still using your current AI');
    modal.confirm();
    await done;
    expect(onSelected).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalledWith('aiProvider/setProvider', expect.anything());
  });

  it('a dialog left open by an earlier attempt is closed, not stacked under the new one', async () => {
    serve({ 'GET status': { running: true, models: ['qwen3-8b'], installed: true }, 'POST prepare': READY });
    const modal = fakeModal();
    modal.isOpen = true; // e.g. the first click's "Starting LM Studio"
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    await connect(LOCAL);
    expect(modal.confirm).toHaveBeenCalled();
    expect(modal.isOpen).toBe(false);
    expect(onSelected).toHaveBeenCalledOnce();
  });

  // Reported 2026-11-06: clicking it started LM Studio, which then failed
  // ("LM Studio did not start a server in time"). AGNT no longer starts,
  // installs or downloads anything: it says how to start a model server.
  it('nothing running: shows how to start a model server, and starts, opens or downloads nothing', async () => {
    serve({ 'GET status': { running: false, models: [], installed: true, canStart: true, managed: { supported: true } } });
    const modal = fakeModal({ answer: null });
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    await connect(LOCAL);
    expect(modal.shown.map((o) => [o.title, o.confirmText, o.cancelText])).toEqual([['Connect a model on this computer', 'Check again', 'Close']]);
    for (const text of ['LM Studio', 'Ollama', 'llama-server', '1234', '11434', '8080']) expect(modal.shown[0].message).toContain(text);
    expect(calls()).toEqual(['GET http://local.test/api/local-models/status']);
    expect(window.electron.openExternalUrl).not.toHaveBeenCalled();
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('a server with no model loaded counts as nothing running', async () => {
    serve({ 'GET status': { running: true, models: [], installed: true } });
    const modal = fakeModal({ answer: null });
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    await connect(LOCAL);
    expect(modal.shown.map((o) => o.title)).toEqual(['Connect a model on this computer']);
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('"Check again" once a server is running uses it', async () => {
    let reads = 0;
    serve({
      'GET status': () => (++reads === 1 ? { running: false, models: [] } : { running: true, models: ['qwen3-8b'], installed: true }),
      'POST prepare': READY,
    });
    const modal = fakeModal();
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    const done = connect(LOCAL);
    await vi.waitFor(() => expect(modal.shown.length).toBe(1));
    modal.confirm(); // Check again
    await done;
    expect(calls()).toEqual([
      'GET http://local.test/api/local-models/status',
      'GET http://local.test/api/local-models/status',
      'POST http://local.test/api/local-models/prepare',
    ]);
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it('Ollama (or any local server) already serving: nothing to prepare, used at once', async () => {
    serve({
      'GET status': { ready: true, running: true, models: ['qwen3:8b'], installed: false, server: { id: 'ollama' } },
      'POST prepare': { model: null, skipped: true },
    });
    const store = fakeStore();
    const { connect, onSelected, modal } = setup({ store });
    await connect(LOCAL);
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/fetchLocalModels', { forceRefresh: true });
    expect(store.dispatch).not.toHaveBeenCalledWith('aiProvider/setModel', expect.anything());
    expect(onSelected).toHaveBeenCalledOnce();
    expect(modal.shown.map((o) => o.title)).toEqual(['Getting the local model ready']);
  });
});

describe('useAiProviderConnect — a flow that finishes late never overrides a newer choice', () => {
  const LOCAL = { id: 'local', name: 'Local' };
  const reply = (body) => ({ ok: true, json: async () => body });
  const localReady = { running: true, models: ['qwen3-8b'], installed: true };
  const READY = { model: 'qwen3-8b', contextLength: 32768, reloaded: true };
  const switchedToLocal = (store) =>
    store.dispatch.mock.calls.some(
      ([type, payload]) => type === 'aiProvider/setProvider' && (typeof payload === 'string' ? payload : payload?.provider) === 'Local',
    );

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    localStorage.setItem('token', 't');
    window.electron = { openExternalUrl: vi.fn() };
  });

  it('THE REPORTED BUG: a local model that becomes ready after the user chose another AI does not replace it', async () => {
    const store = fakeStore({ selectedProvider: 'OpenAI-Codex' });
    global.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/prepare')) { store.state.aiProvider.selectedProvider = 'Claude-Code'; return reply(READY); }
      return reply(localReady);
    });
    const { connect, onSelected } = setup({ store });
    await connect(LOCAL);
    expect(switchedToLocal(store)).toBe(false);
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('a later tile click supersedes a slower one still in flight', async () => {
    let finishPrepare;
    global.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/prepare')) return new Promise((resolve) => { finishPrepare = () => resolve(reply(READY)); });
      return reply(localReady);
    });
    const store = fakeStore();
    const { connect, modal } = setup({ store });
    const slowLocal = connect(LOCAL);
    await vi.waitFor(() => expect(modal.shown[0]?.title).toBe('Getting the local model ready'));
    modal.confirm(); // Hide: keep waiting without the dialog

    await connect({ id: 'agnt', name: 'AGNT Flash' });
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/useProvider', { provider: 'AGNT', source: 'test' });

    finishPrepare();
    await slowLocal;
    expect(switchedToLocal(store)).toBe(false);
  });

  it('a flow whose selection is untouched still switches when it finishes', async () => {
    global.fetch.mockImplementation(async (url) => reply(String(url).endsWith('/prepare') ? READY : localReady));
    const store = fakeStore({ selectedProvider: 'OpenAI-Codex' });
    const { connect, onSelected } = setup({ store });
    await connect(LOCAL);
    expect(switchedToLocal(store)).toBe(true);
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it('a direct selectProvider call (no click ticket) switches at once', async () => {
    const store = fakeStore();
    const { selectProvider, onSelected } = setup({ store });
    await selectProvider({ id: 'agnt', name: 'AGNT Flash' });
    expect(onSelected).toHaveBeenCalledOnce();
  });
});
