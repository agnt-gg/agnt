import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cold start paints this computer's connections as soon as the local backend
 * answers, not after the CLI status probes (923 ms cold on 2026-09-30, one of
 * them 887 ms) and not after agnt.gg. The final answer is unchanged.
 */

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api', REMOTE_URL: 'https://api.agnt.gg' },
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const { cliStatus } = vi.hoisted(() => ({ cliStatus: { impl: async () => ({ available: false, apiUsable: false }) } }));
vi.mock('@/services/providerAuthService.js', () => ({
  default: { getStatus: vi.fn((id) => cliStatus.impl(id)) },
}));
vi.mock('@/services/localKeyBackfill.js', () => ({ backfillLocalProviderKeys: vi.fn(async () => {}) }));
vi.mock('@/store/app/aiProvider.js', () => ({
  resolveProviderKey: (id) => String(id).toLowerCase(),
  PROVIDER_DISPLAY_NAMES: {},
}));

const LOCAL = 'http://localhost:3333/api/auth/connected';
const REMOTE = 'https://api.agnt.gg/auth/connected';

let axios;
let appAuth;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.clearAllMocks();
  cliStatus.impl = async () => ({ available: false, apiUsable: false });
  axios = (await import('axios')).default;
  appAuth = (await import('./appAuth.js')).default;
});

const ctx = (connectedApps = []) => ({ commit: vi.fn(), dispatch: vi.fn(), state: { connectedApps }, rootState: { userAuth: { token: null } } });
const appsCommits = (c) => c.commit.mock.calls.filter(([m]) => m === 'SET_CONNECTED_APPS').map(([, v]) => v);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('AGNT account-native connection', () => {
  it('a verified free account is connected without license, OAuth, API key or a probe', () => {
    const state = { connectedApps: [] };
    expect(appAuth.getters.connectedApps(state, {}, {}, { 'userAuth/isAuthenticated': true })).toEqual(['agnt']);
    expect(appAuth.getters.connectedApps(state, {}, {}, { 'userAuth/isAuthenticated': false })).toEqual([]);
  });
  it('never retains an account-native connection after sign-out or duplicates it', () => {
    const state = { connectedApps: ['openai', 'agnt'] };
    expect(appAuth.getters.connectedApps(state, {}, {}, { 'userAuth/isAuthenticated': true })).toEqual(['openai', 'agnt']);
    expect(appAuth.getters.connectedApps(state, {}, {}, { 'userAuth/isAuthenticated': false })).toEqual(['openai']);
  });
  it('a disconnected CLI cannot be resurrected by stale cache or the remote lane', async () => {
    cliStatus.impl = async id => ({ available: false, disconnected: id === 'cursor-cli' });
    axios.get.mockImplementation(async url => ({ data: url === REMOTE ? ['cursor-cli', 'gmail'] : [] }));
    const c = ctx(['cursor-cli', 'openai']);
    await appAuth.actions.fetchConnectedApps(c);
    expect(appsCommits(c).at(-1)).toEqual(['gmail']);
  });
  it('a disconnected CLI drops from the cached list even when the remote lane is down', async () => {
    cliStatus.impl = async id => ({ available: false, disconnected: id === 'cursor-cli' });
    axios.get.mockImplementation(async url => { if (url === REMOTE) throw new Error('down'); return { data: [] }; });
    const c = ctx(['cursor-cli', 'gmail']);
    await appAuth.actions.fetchConnectedApps(c);
    expect(appsCommits(c).at(-1)).toEqual(['gmail']);
  });
});

describe('fetchConnectedApps on a cold start', () => {
  it('commits the local set while the CLI probes and agnt.gg are still pending', async () => {
    let releaseCli;
    cliStatus.impl = () => new Promise((resolve) => { releaseCli = resolve; });
    axios.get.mockImplementation((url) => {
      if (url === LOCAL) return Promise.resolve({ data: ['openai'] });
      if (url === REMOTE) return new Promise(() => {}); // agnt.gg never answers
      return Promise.resolve({ data: [] });
    });

    const c = ctx();
    appAuth.actions.fetchConnectedApps(c);
    await flush();

    expect(appsCommits(c)).toEqual([['openai']]);
    releaseCli({ available: false });
  });

  it('still lands the CLI providers when agnt.gg fails', async () => {
    // The refresh-only branch never runs on a cold start, so the commit after
    // the CLI probes is the only way they reach the list in this run.
    cliStatus.impl = async (id) => ({ available: id === 'claude-code', apiUsable: id === 'claude-code' });
    axios.get.mockImplementation((url) => {
      if (url === LOCAL) return Promise.resolve({ data: ['openai'] });
      if (url === REMOTE) return Promise.reject(new Error('down'));
      return Promise.resolve({ data: [] });
    });

    const c = ctx();
    await appAuth.actions.fetchConnectedApps(c);

    expect(appsCommits(c).at(-1)).toEqual(['openai', 'claude-code']);
  });

  it('never commits a partial set on a refresh poll', async () => {
    axios.get.mockImplementation((url) => {
      if (url === LOCAL) return Promise.resolve({ data: ['openai'] });
      if (url === REMOTE) return new Promise(() => {});
      return Promise.resolve({ data: [] });
    });

    const c = ctx(['openai', 'google']); // google is remote-only
    appAuth.actions.fetchConnectedApps(c);
    await flush();

    expect(appsCommits(c)).toEqual([]);
  });
});
