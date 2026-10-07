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

import { useAiProviderConnect, formatBytes } from './useAiProviderConnect.js';

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
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/setProvider', { provider: 'Local', source: 'test' });
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

  it('Ollama (or any local server) already serving: used at once', async () => {
    global.fetch.mockResolvedValue(reply({ ready: true, running: true, models: ['qwen3:8b'], installed: false, server: { id: 'ollama' } }));
    const store = fakeStore();
    const { connect, onSelected, modal } = setup({ store });
    await connect(LOCAL);
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/fetchLocalModels', { forceRefresh: true });
    expect(onSelected).toHaveBeenCalledOnce();
    expect(modal.showModal).not.toHaveBeenCalled();
  });
});

// AGNT runs the model itself: detect hardware, download llama.cpp + a model, start it.
describe('useAiProviderConnect — AGNT runs a local model itself', () => {
  const LOCAL = { id: 'local', name: 'Local' };
  const GB = 1024 ** 3;
  const reply = (body) => ({ ok: true, json: async () => body });
  const calls = () => global.fetch.mock.calls.map(([url, init]) => (init?.method || 'GET') + ' ' + url.replace('http://local.test/api/local-models/', ''));
  const managed = (overrides = {}) => ({
    supported: true,
    hardware: { gpu: 'NVIDIA GeForce GTX 1660 SUPER', vramBytes: 6 * GB, ramBytes: 32 * GB },
    engine: { build: 'win32-x64-cuda12', label: 'NVIDIA CUDA 12', bytes: 0.6 * GB, installed: false },
    models: [{ id: 'qwen3.5-4b', name: 'Qwen 3.5 4B', blurb: 'A good everyday model.', sizeBytes: 2.6 * GB, fit: 'gpu', downloaded: false, recommended: true }],
    recommendedId: 'qwen3.5-4b',
    job: null,
    ...overrides,
  });
  const nothingRunning = (m = managed()) => ({ ready: false, running: false, models: [], installed: false, canStart: false, managed: m });
  const job = (phase, extra = {}) => ({ modelId: 'qwen3.5-4b', phase, bytesDone: 0, bytesTotal: 3.2 * GB, error: null, errorCode: null, ...extra });

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    localStorage.setItem('token', 't');
    window.electron = { openExternalUrl: vi.fn() };
  });

  it('one click: offers the model that fits this GPU, downloads with live progress, then uses it', async () => {
    vi.useFakeTimers();
    try {
      global.fetch
        .mockResolvedValueOnce(reply(nothingRunning()))
        .mockResolvedValueOnce(reply(nothingRunning(managed({ job: job('engine') }))))
        .mockResolvedValueOnce(reply(nothingRunning(managed({ job: job('model', { bytesDone: 1.6 * GB }) }))))
        .mockResolvedValueOnce(reply({ ready: true, running: true, models: ['qwen3.5-4b'], managed: managed({ job: job('ready', { bytesDone: 3.2 * GB }) }) }));
      const modal = fakeModal();
      const store = fakeStore();
      const { connect, onSelected } = setup({ store, modal });
      const done = connect(LOCAL);

      await vi.waitFor(() => expect(modal.shown.length).toBe(1));
      expect(modal.shown[0].title).toBe('Run AI on this computer');
      expect(modal.shown[0].message).toContain('Qwen 3.5 4B');
      expect(modal.shown[0].message).toContain('runs fully on your NVIDIA GeForce GTX 1660 SUPER');
      expect(modal.shown[0].confirmText).toBe('Download & run (3.2 GB)');
      modal.confirm();

      await vi.waitFor(() => expect(modal.shown.length).toBe(2));
      expect(modal.shown[1].title).toBe('Setting up Qwen 3.5 4B');
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(modal.message).toContain('Downloading Qwen 3.5 4B'));
      expect(modal.message).toContain('1.6 GB of 3.2 GB (50%)');
      await vi.advanceTimersByTimeAsync(1000);
      await done;

      expect(calls()).toEqual(['GET status', 'POST managed/setup', 'GET status', 'GET status']);
      expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ modelId: 'qwen3.5-4b' });
      expect(modal.confirm).toHaveBeenCalledTimes(2); // the user's click, then the progress dialog closing itself
      expect(store.dispatch).toHaveBeenCalledWith('aiProvider/setProvider', { provider: 'Local', source: 'test' });
      expect(onSelected).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('"Not now": nothing is downloaded', async () => {
    global.fetch.mockResolvedValue(reply(nothingRunning()));
    const { connect, onSelected } = setup({ store: fakeStore(), modal: fakeModal({ answer: null }) });
    await connect(LOCAL);
    expect(calls()).toEqual(['GET status']);
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('Cancel in the progress dialog cancels the setup on the backend', async () => {
    // Like the backend: the job runs until cancelled, then reports so.
    let cancelled = false;
    let first = true;
    global.fetch.mockImplementation(async (url, init) => {
      if (url.endsWith('/managed/cancel')) cancelled = true;
      if (first) { first = false; return reply(nothingRunning()); }
      return reply(nothingRunning(managed({ job: job(cancelled ? 'cancelled' : 'model') })));
    });
    const modal = fakeModal();
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    const done = connect(LOCAL);
    await vi.waitFor(() => expect(modal.shown.length).toBe(1));
    modal.confirm();
    await vi.waitFor(() => expect(modal.shown.length).toBe(2));
    modal.cancel();
    await done;
    expect(calls()).toContain('POST managed/cancel');
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('a failed setup says why', async () => {
    global.fetch
      .mockResolvedValueOnce(reply(nothingRunning(managed({ job: job('model') }))))
      .mockResolvedValueOnce(reply(nothingRunning(managed({ job: job('error', { error: 'Not enough disk space: this needs 3.2 GB and 1.0 GB is free.' }) }))));
    const modal = fakeModal();
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    const done = connect(LOCAL);
    await vi.waitFor(() => expect(modal.shown.length).toBe(2));
    expect(modal.shown[1].title).toBe('Local model setup failed');
    expect(modal.shown[1].message).toContain('Not enough disk space');
    modal.confirm();
    await done;
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('a setup already running (another window, or Hide) is joined, not restarted', async () => {
    global.fetch
      .mockResolvedValueOnce(reply(nothingRunning(managed({ job: job('model') }))))
      .mockResolvedValueOnce(reply({ ready: true, models: ['qwen3.5-4b'], managed: managed({ job: job('ready') }) }));
    const modal = fakeModal();
    const { connect, onSelected } = setup({ store: fakeStore(), modal });
    await connect(LOCAL);
    expect(calls()).toEqual(['GET status', 'GET status']);
    expect(modal.shown[0].title).toBe('Setting up Qwen 3.5 4B');
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it('LM Studio running with no model, and AGNT can run one: offers it instead of a dead end', async () => {
    global.fetch.mockResolvedValue(reply({ ...nothingRunning(), running: true, installed: true }));
    const modal = fakeModal({ answer: null });
    const { connect } = setup({ store: fakeStore(), modal });
    await connect(LOCAL);
    expect(modal.shown[0].title).toBe('Run AI on this computer');
    expect(modal.shown[0].confirmText).toMatch(/^Download & run/);
  });

  it('a model that only fits partly says it will be slower', async () => {
    const slow = managed({ models: [{ ...managed().models[0], fit: 'mixed' }] });
    global.fetch.mockResolvedValue(reply(nothingRunning(slow)));
    const modal = fakeModal({ answer: null });
    await setup({ store: fakeStore(), modal }).connect(LOCAL);
    expect(modal.shown[0].message).toContain('slower');
  });

  it('nothing fits this computer: says so instead of downloading', async () => {
    global.fetch.mockResolvedValue(reply(nothingRunning(managed({ recommendedId: null }))));
    const modal = fakeModal({ answer: true });
    await setup({ store: fakeStore(), modal }).connect(LOCAL);
    expect(modal.shown[0].title).toBe('Not enough memory for a local model');
    expect(calls()).toEqual(['GET status']);
  });

  it('the hardware name is escaped into the dialog', async () => {
    const hostile = managed({ hardware: { gpu: '<img src=x onerror=alert(1)>' } });
    global.fetch.mockResolvedValue(reply(nothingRunning(hostile)));
    const modal = fakeModal({ answer: null });
    await setup({ store: fakeStore(), modal }).connect(LOCAL);
    expect(modal.shown[0].message).not.toContain('<img');
    expect(modal.shown[0].message).toContain('&lt;img');
  });
});

describe('useAiProviderConnect — a flow that finishes late never overrides a newer choice', () => {
  const LOCAL = { id: 'local', name: 'Local' };
  const reply = (body) => ({ ok: true, json: async () => body });
  const localSetupRunning = { ready: false, running: false, models: [], installed: false, canStart: false,
    managed: { supported: true, hardware: {}, engine: { installed: true }, recommendedId: 'qwen3.5-4b',
      models: [{ id: 'qwen3.5-4b', name: 'Qwen 3.5 4B', sizeBytes: 1, fit: 'gpu', downloaded: false }],
      job: { modelId: 'qwen3.5-4b', phase: 'model', bytesDone: 0, bytesTotal: 1 } } };
  const localReady = { ready: true, running: true, models: ['qwen3.5-4b'],
    managed: { ...localSetupRunning.managed, job: { modelId: 'qwen3.5-4b', phase: 'ready' } } };
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

  it('THE REPORTED BUG: a local model that finishes setting up after the user chose another AI does not replace it', async () => {
    const store = fakeStore({ selectedProvider: 'OpenAI-Codex' });
    let statusReads = 0;
    global.fetch.mockImplementation(async () => {
      statusReads += 1;
      if (statusReads === 1) return reply(localSetupRunning);
      store.state.aiProvider.selectedProvider = 'Claude-Code';
      return reply(localReady);
    });
    const { connect, onSelected } = setup({ store });
    await connect(LOCAL);
    expect(switchedToLocal(store)).toBe(false);
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('a later tile click supersedes a slower one still in flight', async () => {
    let finishStart;
    global.fetch.mockImplementation(async (url) => {
      if (url.endsWith('/local-models/start')) return new Promise((resolve) => { finishStart = () => resolve(reply(localReady)); });
      return reply({ running: false, models: [], installed: true, canStart: true });
    });
    const store = fakeStore();
    const { connect, modal } = setup({ store });
    const slowLocal = connect(LOCAL);
    await vi.waitFor(() => expect(modal.shown[0]?.title).toBe('Starting LM Studio'));
    modal.confirm();

    await connect({ id: 'agnt', name: 'AGNT Flash' });
    expect(store.dispatch).toHaveBeenCalledWith('aiProvider/useProvider', { provider: 'AGNT', source: 'test' });

    finishStart();
    await slowLocal;
    expect(switchedToLocal(store)).toBe(false);
  });

  it('a flow whose selection is untouched still switches when it finishes', async () => {
    global.fetch
      .mockResolvedValueOnce(reply(localSetupRunning))
      .mockResolvedValueOnce(reply(localReady));
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

describe('formatBytes', () => {
  it.each([[734003200, '700 MB'], [2740937888, '2.6 GB'], [1000, '1 MB']])('%d → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
