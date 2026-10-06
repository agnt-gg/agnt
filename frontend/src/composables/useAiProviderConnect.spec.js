import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { REMOTE_URL: 'https://remote.test' } }));
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
