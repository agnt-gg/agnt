import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ConnectionError, createConnectionRuntime } from './connectionRuntime.js';

// Fictitious clients: no vendor tokens, local stores or network are accessed.
const profiles = [
  { id: 'key', baseUrl: 'https://api.example.test/v1/', auth: { type: 'api-key' } },
  { id: 'browser', baseUrl: 'https://api.example.test/v1/', auth: {
    type: 'oauth-pkce', clientId: 'registered-test-client', authorizeUrl: 'https://identity.example.test/authorize',
    tokenUrl: 'https://identity.example.test/token', redirectUri: 'http://127.0.0.1:54321/callback', scopes: ['read', 'write'],
  } },
  { id: 'device', baseUrl: 'https://other.example.test/api/', auth: {
    type: 'oauth-device', clientId: 'device-test-client', deviceUrl: 'https://identity.example.test/device', tokenUrl: 'https://identity.example.test/token',
  } },
];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let runtime, store, records, fetchImpl, clock;
const saved = id => records.get(id);
const pending = (extra = {}) => ({ device_code: 'device-secret', user_code: 'ABCD-1234', verification_uri: 'https://identity.example.test/verify', expires_in: 600, interval: 5, ...extra });

beforeEach(() => {
  clock = 1000000;
  records = new Map();
  store = {
    read: vi.fn(async id => structuredClone(records.get(id) || null)),
    write: vi.fn(async (id, value) => { records.set(id, structuredClone(value)); }),
    remove: vi.fn(async id => { records.delete(id); }),
  };
  fetchImpl = vi.fn();
  runtime = createConnectionRuntime({ profiles, credentialStore: store, fetchImpl, now: () => clock });
});

async function browserSession() {
  const session = await runtime.startSignIn('browser');
  return { ...session, state: new URL(session.authUrl).searchParams.get('state') };
}
async function signIn(session, body = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }) {
  fetchImpl.mockResolvedValueOnce(json(body));
  return runtime.completeSignIn('browser', { sessionId: session.sessionId, state: session.state, code: 'approved-code' });
}

describe('explicit profiles and safe status', () => {
  it('registers no defaults and performs no work until called', () => {
    const empty = createConnectionRuntime({ credentialStore: store, fetchImpl });
    expect(() => empty.getConnection('key')).toThrow('unknown_connection');
    expect(fetchImpl).not.toHaveBeenCalled(); expect(store.read).not.toHaveBeenCalled();
  });
  it('exposes immutable profile configuration, not caller-owned mutable objects', () => {
    const mutable = structuredClone(profiles);
    const local = createConnectionRuntime({ profiles: mutable, credentialStore: store });
    mutable[1].auth.clientId = 'changed'; mutable[1].auth.scopes.push('admin');
    expect(local.getConnection('browser').auth.clientId).toBe('registered-test-client');
    expect(local.getConnection('browser').auth.scope).toBe('read write');
    expect(Object.isFrozen(local.getConnection('browser').auth)).toBe(true);
  });
  it.each(['../escape', '', 'path/other', 'x\nheader'])('rejects invalid connection id %j', id => {
    expect(() => runtime.getConnection(id)).toThrow('invalid_connection_id');
  });
  it('rejects duplicate profiles and incomplete storage adapters', () => {
    expect(() => createConnectionRuntime({ profiles: [profiles[0], profiles[0]], credentialStore: store })).toThrow('duplicate_connection_id');
    expect(() => createConnectionRuntime({ credentialStore: { read() {} } })).toThrow('invalid_credential_store');
  });
  it.each(['http://api.example.test', 'https://user:secret@api.example.test', 'file:///tmp/test', 'https://api.example.test/#fragment'])('rejects unsafe endpoint %s', baseUrl => {
    expect(() => createConnectionRuntime({ profiles: [{ ...profiles[0], baseUrl }], credentialStore: store })).toThrow('invalid_endpoint');
  });
  it('allows only HTTPS or loopback HTTP redirect URIs', () => {
    const profile = structuredClone(profiles[1]); profile.auth.redirectUri = 'http://not-loopback.example.test/callback';
    expect(() => createConnectionRuntime({ profiles: [profile], credentialStore: store })).toThrow('invalid_endpoint');
    profile.auth.redirectUri = 'http://[::1]:54321/callback';
    expect(createConnectionRuntime({ profiles: [profile], credentialStore: store }).getConnection('browser').auth.redirectUri).toContain('[::1]');
  });
  it('returns metadata only from status', async () => {
    expect(await runtime.describeConnection('key')).toEqual({ id: 'key', connected: false, ownedByAgnt: false, expiresAt: null, expired: false });
    records.set('key', { accessToken: 'sensitive-access', refreshToken: 'sensitive-refresh', ownedByAgnt: false, expiresAt: clock - 1 });
    const status = await runtime.describeConnection('key');
    expect(status).toEqual({ id: 'key', connected: true, ownedByAgnt: false, expiresAt: clock - 1, expired: true });
    expect(JSON.stringify(status)).not.toContain('sensitive');
  });
});

describe('API keys and credential ownership', () => {
  it('writes a supplied key only through the injected store', async () => {
    expect(await runtime.connectApiKey('key', 'api-key')).toEqual({ success: true });
    expect(saved('key')).toEqual({ accessToken: 'api-key', expiresAt: null, ownedByAgnt: true });
    expect(await runtime.resolveCredential('key')).toBe('api-key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['', '   ', 'key\nheader', null, 17])('rejects invalid key without saving %j', async value => {
    await expect(runtime.connectApiKey('key', value)).rejects.toThrow('invalid_credential'); expect(store.write).not.toHaveBeenCalled();
  });
  it('does not accept a key through an OAuth profile', async () => {
    await expect(runtime.connectApiKey('browser', 'api-key')).rejects.toThrow('unsupported_operation');
  });
  it('leaves borrowed credentials untouched on disconnect and forced refresh', async () => {
    const record = { accessToken: 'borrowed', refreshToken: 'not-ours', expiresAt: clock + 1000, ownedByAgnt: false };
    records.set('browser', record);
    expect(await runtime.resolveCredential('browser')).toBe('borrowed');
    await expect(runtime.refreshConnection('browser')).rejects.toThrow('credential_not_owned');
    expect(await runtime.disconnectConnection('browser')).toEqual({ disconnected: false, credentialPreserved: true });
    expect(saved('browser')).toEqual(record); expect(store.remove).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses an expired borrowed credential without refreshing it', async () => {
    records.set('browser', { accessToken: 'borrowed', ownedByAgnt: false, expiresAt: clock - 1 });
    await expect(runtime.resolveCredential('browser')).rejects.toThrow('credential_expired'); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('disconnects only credentials owned by this runtime', async () => {
    await runtime.connectApiKey('key', 'value');
    expect(await runtime.disconnectConnection('key')).toEqual({ disconnected: true, credentialPreserved: false });
    expect(saved('key')).toBeUndefined();
    expect(await runtime.disconnectConnection('key')).toEqual({ disconnected: true, credentialPreserved: false });
  });
});

describe('PKCE and state binding', () => {
  it('uses S256, fresh verifier/state and the configured redirect', async () => {
    const session = await browserSession(); const url = new URL(session.authUrl);
    expect(url.origin).toBe('https://identity.example.test');
    expect(url.searchParams.get('client_id')).toBe('registered-test-client');
    expect(url.searchParams.get('scope')).toBe('read write');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
    expect(session).not.toHaveProperty('verifier');
    await signIn(session);
    const [endpoint, options] = fetchImpl.mock.calls[0]; const fields = new URLSearchParams(options.body);
    expect(endpoint).toBe('https://identity.example.test/token'); expect(options.redirect).toBe('manual');
    expect(fields.get('grant_type')).toBe('authorization_code'); expect(fields.get('code')).toBe('approved-code');
    expect(createHash('sha256').update(fields.get('code_verifier')).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(fields.get('code_verifier').length).toBeGreaterThanOrEqual(43);
    expect(saved('browser')).toMatchObject({ accessToken: 'access', refreshToken: 'refresh', expiresAt: clock + 3600000, ownedByAgnt: true });
  });
  it('rejects wrong state and cross-connection callbacks before any network call', async () => {
    const session = await browserSession();
    await expect(runtime.completeSignIn('browser', { ...session, state: 'wrong', code: 'code' })).rejects.toThrow('invalid_oauth_state');
    await expect(runtime.completeSignIn('device', { ...session, code: 'code' })).rejects.toThrow('invalid_signin_session');
    expect(fetchImpl).not.toHaveBeenCalled(); await signIn(session); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('consumes a session once even when completion races', async () => {
    const session = await browserSession(); fetchImpl.mockResolvedValue(json({ access_token: 'access' }));
    const results = await Promise.allSettled([1, 2].map(() => runtime.completeSignIn('browser', { ...session, code: 'code' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(store.write).toHaveBeenCalledTimes(1);
  });
  it('cancels or expires pending sessions without storing credentials', async () => {
    const cancelled = await browserSession();
    expect(await runtime.cancelSignIn('device', cancelled.sessionId)).toBe(false);
    expect(await runtime.cancelSignIn('browser', cancelled.sessionId)).toBe(true);
    await expect(signIn(cancelled)).rejects.toThrow('invalid_signin_session');
    const expired = await browserSession(); clock = expired.expiresAt;
    await expect(signIn(expired)).rejects.toThrow('signin_expired'); expect(store.write).not.toHaveBeenCalled();
  });
  it('bounds pending sessions and recovers capacity after cancellation or expiry', async () => {
    const local = createConnectionRuntime({ profiles, credentialStore: store, now: () => clock, maxPendingSessions: 1, sessionTtlMs: 50 });
    const first = await local.startSignIn('browser'); await expect(local.startSignIn('browser')).rejects.toThrow('signin_capacity_reached');
    await local.cancelSignIn('browser', first.sessionId); await local.startSignIn('browser');
    clock += 51; expect(await local.startSignIn('browser')).toHaveProperty('sessionId');
  });
  it('rejects a response that arrives after the sign-in deadline', async () => {
    const session = await browserSession();
    fetchImpl.mockImplementationOnce(async () => { clock = session.expiresAt; return json({ access_token: 'too-late' }); });
    await expect(runtime.completeSignIn('browser', { ...session, code: 'code' })).rejects.toThrow('signin_expired');
    expect(store.write).not.toHaveBeenCalled();
  });
  it.each([
    { access_token: 'token', token_type: 'mac' },
    { access_token: 'token', expires_in: -1 },
    { access_token: 'token', expires_in: 'not-a-number' },
    { refresh_token: 'missing-access' },
  ])('refuses malformed token payload without persistence: %j', async body => {
    const session = await browserSession();
    await expect(signIn(session, body)).rejects.toBeInstanceOf(ConnectionError);
    expect(store.write).not.toHaveBeenCalled();
  });
  it('does not return success if persistence fails', async () => {
    const session = await browserSession(); store.write.mockRejectedValue(Error('secret-value-in-driver-error'));
    await expect(signIn(session)).rejects.toThrow('credential_storage_failed'); expect(saved('browser')).toBeUndefined();
    await expect(signIn(session)).rejects.toThrow('invalid_signin_session');
  });
});

describe('standard device authorization', () => {
  it('does not expose the device secret and honors polling intervals', async () => {
    fetchImpl.mockResolvedValueOnce(json(pending()));
    const session = await runtime.startSignIn('device'); expect(JSON.stringify(session)).not.toContain('device-secret');
    expect(session.userCode).toBe('ABCD-1234');
    expect(await runtime.pollSignIn('device', session.sessionId)).toEqual({ state: 'pending', retryAt: clock + 5000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 5000; fetchImpl.mockResolvedValueOnce(json({ error: 'authorization_pending' }, 400));
    expect(await runtime.pollSignIn('device', session.sessionId)).toMatchObject({ state: 'pending' });
    expect(Object.fromEntries(new URLSearchParams(fetchImpl.mock.calls[1][1].body))).toEqual({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'device-secret', client_id: 'device-test-client' });
    clock += 5000; fetchImpl.mockResolvedValueOnce(json({ error: 'slow_down' }, 400));
    expect(await runtime.pollSignIn('device', session.sessionId)).toEqual({ state: 'pending', retryAt: clock + 10000 });
    clock += 10000; fetchImpl.mockResolvedValueOnce(json({ access_token: 'approved', token_type: 'Bearer', expires_in: 3600 }));
    expect(await runtime.pollSignIn('device', session.sessionId)).toEqual({ state: 'success' });
    expect(saved('device').accessToken).toBe('approved');
    await expect(runtime.pollSignIn('device', session.sessionId)).rejects.toThrow('invalid_signin_session');
  });
  it('denial is terminal and leaves other connections usable', async () => {
    fetchImpl.mockResolvedValueOnce(json(pending())); const session = await runtime.startSignIn('device'); clock += 5000;
    fetchImpl.mockResolvedValueOnce(json({ error: 'access_denied', error_description: 'sensitive' }, 400));
    await expect(runtime.pollSignIn('device', session.sessionId)).rejects.toMatchObject({ code: 'signin_exchange_failed', status: 400 });
    await expect(runtime.pollSignIn('device', session.sessionId)).rejects.toThrow('invalid_signin_session');
    await runtime.connectApiKey('key', 'works'); expect(await runtime.resolveCredential('key')).toBe('works');
  });
  it('refuses a device token arriving after the polling session expires', async () => {
    fetchImpl.mockResolvedValueOnce(json(pending()));
    const session = await runtime.startSignIn('device'); clock += 5000;
    fetchImpl.mockImplementationOnce(async () => { clock = session.expiresAt; return json({ access_token: 'too-late' }); });
    await expect(runtime.pollSignIn('device', session.sessionId)).rejects.toThrow('signin_expired');
    expect(store.write).not.toHaveBeenCalled();
  });
  it('rejects a start response arriving after the sign-in deadline', async () => {
    const local = createConnectionRuntime({ profiles, credentialStore: store, fetchImpl, now: () => clock, sessionTtlMs: 50 });
    fetchImpl.mockImplementationOnce(async () => { clock += 51; return json(pending()); });
    await expect(local.startSignIn('device')).rejects.toThrow('signin_expired');
    expect(store.write).not.toHaveBeenCalled();
  });
  it('invalid device responses release their reserved slot', async () => {
    const local = createConnectionRuntime({ profiles, credentialStore: store, fetchImpl, maxPendingSessions: 1 });
    fetchImpl.mockResolvedValueOnce(json(pending({ interval: -1 })));
    await expect(local.startSignIn('device')).rejects.toThrow('invalid_device_response');
    fetchImpl.mockResolvedValueOnce(json(pending())); expect(await local.startSignIn('device')).toHaveProperty('sessionId');
  });
});

describe('refresh rotation and serialization', () => {
  const expired = () => records.set('browser', { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: clock - 1, ownedByAgnt: true, retained: 'metadata' });
  it('parallel resolves perform only one refresh and preserve metadata', async () => {
    expired(); fetchImpl.mockResolvedValueOnce(json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }));
    expect(await Promise.all(Array.from({ length: 12 }, () => runtime.resolveCredential('browser')))).toEqual(Array(12).fill('new-access'));
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(saved('browser')).toMatchObject({ retained: 'metadata', refreshToken: 'new-refresh' });
    expect(Object.fromEntries(new URLSearchParams(fetchImpl.mock.calls[0][1].body))).toEqual({ grant_type: 'refresh_token', refresh_token: 'old-refresh', client_id: 'registered-test-client' });
  });
  it('retains a refresh token when the server omits a replacement', async () => {
    expired(); fetchImpl.mockResolvedValueOnce(json({ access_token: 'new-access', expires_in: 3600 }));
    await runtime.refreshConnection('browser'); expect(saved('browser').refreshToken).toBe('old-refresh');
  });
  it('a failed refresh preserves the stored record and releases the lane', async () => {
    expired(); const before = structuredClone(saved('browser'));
    fetchImpl.mockResolvedValueOnce(json({ error: 'invalid_grant', description: 'do not print this' }, 400));
    await expect(runtime.resolveCredential('browser')).rejects.toThrow('refresh_failed'); expect(saved('browser')).toEqual(before);
    fetchImpl.mockResolvedValueOnce(json({ access_token: 'recovered', expires_in: 3600 }));
    expect(await runtime.resolveCredential('browser')).toBe('recovered');
  });
  it('disconnect waits for an in-flight refresh and removes its result', async () => {
    expired(); let finish; const request = new Promise(resolve => { finish = resolve; }); fetchImpl.mockReturnValueOnce(request);
    const refresh = runtime.resolveCredential('browser'); await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const disconnect = runtime.disconnectConnection('browser'); finish(json({ access_token: 'renewed', expires_in: 3600 }));
    await refresh; await disconnect; expect(saved('browser')).toBeUndefined();
  });
  it('does not overwrite a credential replaced outside this runtime', async () => {
    expired(); fetchImpl.mockImplementationOnce(async () => {
      records.set('browser', { accessToken: 'external-new', refreshToken: 'external-refresh', ownedByAgnt: true });
      return json({ access_token: 'stale-refresh-result', expires_in: 3600 });
    });
    await expect(runtime.resolveCredential('browser')).rejects.toThrow('credential_changed'); expect(saved('browser').accessToken).toBe('external-new');
  });
  it('a waiting connection cannot block another connection', async () => {
    expired(); let finish; fetchImpl.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const refresh = runtime.resolveCredential('browser'); await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await runtime.connectApiKey('key', 'independent'); expect(await runtime.resolveCredential('key')).toBe('independent');
    finish(json({ access_token: 'renewed', expires_in: 3600 })); await refresh;
  });
  it('storage read and disconnect errors are surfaced without leaking driver details', async () => {
    store.read.mockRejectedValueOnce(Error('sensitive file path'));
    await expect(runtime.describeConnection('browser')).rejects.toThrow('credential_storage_failed');
    expired(); store.remove.mockRejectedValueOnce(Error('sensitive file path'));
    await expect(runtime.disconnectConnection('browser')).rejects.toThrow('credential_storage_failed');
    expect(saved('browser')).toHaveProperty('accessToken', 'old-access');
  });
  it('errors never include provider response bodies or stored credential text', async () => {
    expired(); fetchImpl.mockRejectedValueOnce(Error('old-refresh was rejected by upstream'));
    const error = await runtime.resolveCredential('browser').catch(error => error);
    expect(error).toBeInstanceOf(ConnectionError); expect(error.message).toBe('connection_unavailable'); expect(JSON.stringify(error)).not.toContain('old-refresh');
  });
});

// Production-profile contract tests. Every file is confined to a temporary HOME;
// HTTP, keychain and AGNT persistence are injected and never reach real users.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { createManagedConnection } from './connectionRuntime.js';
import * as defaultModels from './defaultModel.js';

const temporaryHomes = [];
function managedFixture(id, overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'connection-contract-')); temporaryHomes.push(home);
  const stored = new Map(), env = {}, time = { value: 2000000000000 };
  const httpClient = { post: vi.fn(), get: vi.fn() };
  const credentialStore = { readCredential: key => stored.get(key), writeCredential: vi.fn((key, value) => stored.set(key, value)), clearCredential: key => stored.delete(key), getCredentialPath: key => path.join(home, key + '.json') };
  const secretReader = vi.fn(() => null);
  const connection = createManagedConnection(id, { homedir: () => home, env, now: () => time.value, httpClient, credentialStore, readSecretJson: secretReader, ...overrides });
  const write = (relative, value) => { const filename = path.join(home, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value)); return filename; };
  return { connection, home, stored, env, time, httpClient, credentialStore, secretReader, write };
}
const tokenFor = (expiry, claims = {}) => 'e30.' + Buffer.from(JSON.stringify({ exp: expiry, ...claims })).toString('base64url') + '.signature';
afterEach(() => { for (const home of temporaryHomes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });

describe('managed storage contracts', () => {
  it.each(['manual-token', 'health'])('%s probe follows the current catalog model', async operation => {
    const f = managedFixture('claude-code');
    const resolver = vi.spyOn(defaultModels, 'resolveDefaultModel').mockReturnValue('catalog-test-model');
    f.httpClient.post.mockResolvedValue({ status: 200, data: {} });
    try {
      if (operation === 'manual-token') await f.connection.saveManualToken('sk-ant-test');
      else {
        f.stored.set('claude-code', { claudeAiOauth: { accessToken: 'sk-ant-test' } });
        await f.connection.checkApiUsable({ forceRefresh: true });
      }
      expect(resolver).toHaveBeenCalledWith('claude-code');
      expect(f.httpClient.post).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({ model: 'catalog-test-model' }),
        expect.any(Object),
      );
    } finally { resolver.mockRestore(); }
  });
  it.each(['subscriptionType','rateLimitTier','refreshTokenExpiresAt'])('preserves a CLI-shaped block carrying %s', async marker => {
    const f = managedFixture('claude-code');
    const contents = { unrelated: true, claudeAiOauth: { accessToken: 'sk-ant-oat-cli', refreshToken: 'cli-refresh', expiresAt: 1, [marker]: 'present' } };
    const filename = f.write('.claude/.credentials.json', contents);
    expect(f.connection.describeCredential()).toMatchObject({ connected: true, ownedByAgnt: false, source: 'claude-credentials' });
    expect(await f.connection.getAccessToken()).toBe('sk-ant-oat-cli');
    expect(await f.connection.refreshAccessToken()).toMatchObject({ success: false, revoked: false });
    expect(await f.connection.logout()).toMatchObject({ success: true, stillDetected: true });
    expect(JSON.parse(fs.readFileSync(filename))).toEqual(contents); expect(f.httpClient.post).not.toHaveBeenCalled();
  });
  it('refreshes the legacy AGNT block into its own store without clobbering the vendor file', async () => {
    const f = managedFixture('claude-code');
    const old = { unrelated: true, claudeAiOauth: { accessToken: 'sk-ant-oat-old', refreshToken: 'old-refresh', expiresAt: 1, scopes: ['user:inference'] } };
    const filename = f.write('.claude/.credentials.json', old);
    f.httpClient.post.mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 } });
    expect(await f.connection.getAccessToken()).toBe('new-access');
    expect(JSON.parse(fs.readFileSync(filename))).toEqual(old);
    expect(f.stored.get('claude-code')).toEqual({ claudeAiOauth: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: f.time.value + 3300000, scopes: ['user:inference'] } });
    expect(f.httpClient.post.mock.calls[0][0]).toBe('https://console.anthropic.com/v1/oauth/token');
    expect(JSON.parse(f.httpClient.post.mock.calls[0][1])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-refresh' });
    await f.connection.logout(); expect(JSON.parse(fs.readFileSync(filename))).toEqual({ unrelated: true });
  });
  it('own store outranks vendor and keychain, while keychain is never rotated', async () => {
    const f = managedFixture('claude-code'); f.secretReader.mockReturnValue({ claudeAiOauth: { accessToken: 'sk-ant-keychain', refreshToken: 'borrowed', expiresAt: 1 } });
    expect(await f.connection.getAccessToken()).toBe('sk-ant-keychain'); expect(f.httpClient.post).not.toHaveBeenCalled();
    f.write('.claude/.credentials.json', { token: 'sk-ant-flat' }); expect(f.connection.getAccessTokenSync()).toBe('sk-ant-flat');
    f.stored.set('claude-code', { claudeAiOauth: { accessToken: 'sk-ant-owned' } }); expect(f.connection.getAccessTokenSync()).toBe('sk-ant-owned');
  });
  it('keeps response OAuth visible even with both environment and file API keys', async () => {
    const f = managedFixture('openai-codex'); const token = tokenFor(f.time.value / 1000 + 3600, { 'https://api.openai.com/auth': { chatgpt_account_id: 'account-1' } });
    f.env.OPENAI_API_KEY = ' sk-environment ';
    f.write('.codex/auth.json', { OPENAI_API_KEY: 'sk-file', tokens: { access_token: token, refresh_token: 'refresh' }, unrelated: 1 });
    expect(f.connection.getAccessToken()).toBe('sk-environment'); expect(await f.connection.ensureValidOAuthToken()).toBe(token);
    expect(f.connection.getChatGptAccountId()).toBe('account-1');
    delete f.env.OPENAI_API_KEY; expect(f.connection.getAccessToken()).toBe('sk-file');
    await f.connection.logout(); expect(JSON.parse(fs.readFileSync(path.join(f.home,'.codex/auth.json')))).toEqual({ unrelated: 1 });
  });
  it.each(['gemini-cli','antigravity'])('retains the flat credential format and stored OAuth client for %s', async id => {
    const f = managedFixture(id), directory = id === 'gemini-cli' ? '.gemini' : '.antigravity';
    const filename = f.write(directory+'/oauth_creds.json', { access_token: 'old', refresh_token: 'old-refresh', expiry_date: 1, client_id: 'stored-client', client_secret: 'stored-public-secret', custom: true });
    f.httpClient.post.mockResolvedValue({ data: { access_token: 'new', refresh_token: 'rotated', expires_in: 123 } });
    expect(await f.connection.getAccessToken()).toBe('new');
    const fields = Object.fromEntries(new URLSearchParams(f.httpClient.post.mock.calls[0][1]));
    expect(fields).toEqual({ client_id: 'stored-client', client_secret: 'stored-public-secret', grant_type: 'refresh_token', refresh_token: 'old-refresh' });
    expect(JSON.parse(fs.readFileSync(filename))).toMatchObject({ access_token: 'new', refresh_token: 'rotated', expiry_date: f.time.value + 123000, custom: true });
  });
  it('preserves CRLF when changing the stored project or API key', () => {
    const f = managedFixture('gemini-cli'); const filename = f.write('.gemini/.env', 'OTHER=keep\r\nGEMINI_API_KEY=old\r\n');
    f.connection.saveManualApiKey('new-key'); f.connection.saveGcpProject('new-project');
    const result = fs.readFileSync(filename, 'utf8');
    expect(result).toBe('OTHER=keep\r\nGEMINI_API_KEY=new-key\r\nGOOGLE_CLOUD_PROJECT=new-project\r\n');
  });
  it('keeps API-key precedence and preserves unrelated environment lines', async () => {
    const f = managedFixture('gemini-cli'); f.write('.gemini/.env','OTHER=keep\nGEMINI_API_KEY=file-key\n');
    f.write('.gemini/oauth_creds.json',{ access_token: 'oauth', expiry_date: f.time.value + 3600000 });
    expect(await f.connection.getAccessToken()).toBe('file-key'); f.env.GEMINI_API_KEY='environment-key'; expect(await f.connection.getAccessToken()).toBe('environment-key');
    delete f.env.GEMINI_API_KEY; f.connection.saveManualApiKey('new-key'); expect(await f.connection.getAccessToken()).toBe('new-key');
    expect(f.connection.saveGcpProject('project\nINJECT=true').success).toBe(false);
    await f.connection.logout(); expect(fs.readFileSync(path.join(f.home,'.gemini/.env'),'utf8')).toBe('OTHER=keep\n');
  });
  it('deduplicates refresh and prevents refresh from resurrecting a disconnected account', async () => {
    const f = managedFixture('antigravity'); f.write('.antigravity/oauth_creds.json',{ access_token:'old',refresh_token:'old-refresh',expiry_date:1 });
    let finish; f.httpClient.post.mockReturnValue(new Promise(resolve => { finish=resolve; }));
    const first=f.connection.refreshAccessToken(), second=f.connection.refreshAccessToken();
    expect(f.httpClient.post).toHaveBeenCalledTimes(1); await f.connection.logout(); finish({data:{access_token:'new',expires_in:3600}});
    expect(await first).toMatchObject({success:false}); expect(await second).toMatchObject({success:false});
    expect(fs.existsSync(path.join(f.home,'.antigravity/oauth_creds.json'))).toBe(false);
  });
  it('preserves transient-refresh fallback but clears revoked owned message credentials', async () => {
    const f=managedFixture('claude-code'); const record={claudeAiOauth:{accessToken:'old',refreshToken:'refresh',expiresAt:1}}; f.stored.set('claude-code',record);
    f.httpClient.post.mockRejectedValueOnce(Error('offline')); expect(await f.connection.getAccessToken()).toBe('old'); expect(f.stored.get('claude-code')).toEqual(record);
    f.httpClient.post.mockRejectedValueOnce({response:{status:400,data:{error:'invalid_grant'}}}); expect(await f.connection.getAccessToken()).toBeNull(); expect(f.stored.has('claude-code')).toBe(false);
  });
  it('does not give a borrowed keychain refresh token to the SDK', () => {
    const clients=[]; class FakeClient { constructor(){this.handlers={};clients.push(this);}setCredentials(value){this.credentials=value;}on(name,handler){this.handlers[name]=handler;} }
    const f=managedFixture('antigravity',{OAuth2Client:FakeClient}); f.secretReader.mockReturnValue({access_token:'borrowed',refresh_token:'never-rotate',expiry_date:1});
    const client=f.connection.getOAuth2Client(); expect(client.credentials).toMatchObject({access_token:'borrowed'}); expect(client.credentials).not.toHaveProperty('refresh_token');expect(client.handlers).not.toHaveProperty('tokens');
  });
});

describe('managed sign-in contracts', () => {
  it('preserves paste-PKCE fields and consumes successful state exactly once', async () => {
    const f=managedFixture('claude-code'), session=f.connection.startOAuth(), url=new URL(session.authUrl), state=url.searchParams.get('state');
    expect(url.origin).toBe('https://claude.ai'); expect(url.searchParams.get('code')).toBe('true');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(state).digest('base64url'));
    expect(f.connection.parseCodeState('`code#'+state+'`')).toEqual({code:'code',state});
    await expect(f.connection.exchangeCode(session.sessionId,'code','wrong')).rejects.toThrow('state mismatch'); expect(f.httpClient.post).not.toHaveBeenCalled();
    f.httpClient.post.mockResolvedValue({data:{access_token:'issued',expires_in:3600}}); await f.connection.exchangeCode(session.sessionId,'code',state);
    expect(JSON.parse(f.httpClient.post.mock.calls[0][1])).toMatchObject({state,code_verifier:state,redirect_uri:'https://console.anthropic.com/oauth/code/callback'});
    await expect(f.connection.exchangeCode(session.sessionId,'code',state)).rejects.toThrow('expired');
  });
  it('runs a real loopback callback on port zero and saves the expected credential shape', async () => {
    const f=managedFixture('gemini-cli'); f.httpClient.post.mockResolvedValue({data:{access_token:'loopback-token',refresh_token:'refresh',expires_in:3600}});
    const session=await f.connection.startOAuth(), url=new URL(session.authUrl), redirect=url.searchParams.get('redirect_uri');
    try {
      expect(new URL(redirect).hostname).toBe('127.0.0.1');expect(new URL(redirect).port).not.toBe('0');
      const response=await fetch(redirect+'?code=approved&state='+url.searchParams.get('state'),{redirect:'manual'});
      expect(response.status).toBe(302);expect(response.headers.get('location')).toContain('auth_success_gemini');await response.body?.cancel();
      expect(f.connection.getSessionStatus(session.sessionId)).toEqual({status:'success',error:null});
      expect(JSON.parse(fs.readFileSync(path.join(f.home,'.gemini/oauth_creds.json')))).toMatchObject({access_token:'loopback-token',refresh_token:'refresh',expiry_date:f.time.value+3600000});
    } finally { await f.connection.logout(); }
  });
  it('rejects a mismatched loopback state without token exchange', async () => {
    const f=managedFixture('gemini-cli'),session=await f.connection.startOAuth(),url=new URL(session.authUrl);
    try {const response=await fetch(url.searchParams.get('redirect_uri')+'?code=code&state=wrong',{redirect:'manual'});await response.body?.cancel();expect(response.status).toBe(302);expect(f.httpClient.post).not.toHaveBeenCalled();expect(f.connection.getSessionStatus(session.sessionId).status).toBe('error');}
    finally {await f.connection.logout();}
  });
  it('preserves custom device-code exchange and pending status without spawning a CLI', async () => {
    const f=managedFixture('openai-codex'); f.httpClient.post.mockResolvedValueOnce({data:{device_auth_id:'device-id',user_code:'USER-CODE'}});
    const started=await f.connection.startDeviceAuth(); expect(await f.connection.startDeviceAuth()).toEqual(started);expect(f.httpClient.post).toHaveBeenCalledTimes(1);
    f.httpClient.post.mockRejectedValueOnce({response:{status:403}});expect(await f.connection.getDeviceSessionStatus(started.sessionId)).toMatchObject({state:'pending',deviceCode:'USER-CODE'});
    const token=tokenFor(f.time.value/1000+3600);f.httpClient.post.mockResolvedValueOnce({data:{authorization_code:'approved-code',code_verifier:'verifier'}}).mockResolvedValueOnce({data:{access_token:token,refresh_token:'new-refresh',id_token:'id-token'}});
    f.httpClient.get.mockResolvedValue({status:200,data:{models:[]}});
    expect(await f.connection.getDeviceSessionStatus(started.sessionId)).toMatchObject({success:true,state:'success'});
    expect(Object.fromEntries(new URLSearchParams(f.httpClient.post.mock.calls.at(-1)[1]))).toMatchObject({grant_type:'authorization_code',code:'approved-code',code_verifier:'verifier',redirect_uri:'https://auth.openai.com/deviceauth/callback'});
    expect(JSON.parse(fs.readFileSync(path.join(f.home,'.codex/auth.json'))).tokens).toEqual({access_token:token,refresh_token:'new-refresh',id_token:'id-token'});
  });
});

describe('managed cross-operation races', () => {
  it('persists successive SDK refresh-token rotations on one client', () => {
    class Client { setCredentials() {} on(name, handler) { this[name] = handler; } }
    const f = managedFixture('antigravity', { OAuth2Client: Client });
    const filename = f.write('.antigravity/oauth_creds.json', { access_token: 'old', refresh_token: 'refresh-0', expiry_date: f.time.value + 3600000 });
    const client = f.connection.getOAuth2Client();
    client.tokens({ access_token: 'first', refresh_token: 'refresh-1', expiry_date: f.time.value + 3600000 });
    client.tokens({ access_token: 'second', refresh_token: 'refresh-2', expiry_date: f.time.value + 3600000 });
    expect(JSON.parse(fs.readFileSync(filename))).toMatchObject({ access_token: 'second', refresh_token: 'refresh-2' });
  });
  it('deduplicates concurrent device sign-in starts', async () => {
    const f = managedFixture('openai-codex'); let finish;
    f.httpClient.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = f.connection.startDeviceAuth(), second = f.connection.startDeviceAuth();
    finish({ data: { device_auth_id: 'device', user_code: 'USER-CODE' } });
    const [one, two] = await Promise.all([first, second]);
    expect(f.httpClient.post).toHaveBeenCalledTimes(1); expect(one.sessionId).toBe(two.sessionId);
  });
  it('a device sign-in start cannot survive disconnect while its HTTP call is pending', async () => {
    const f = managedFixture('openai-codex'); let finish;
    f.httpClient.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = f.connection.startDeviceAuth(); await f.connection.logout();
    finish({ data: { device_auth_id: 'device', user_code: 'USER-CODE' } });
    expect(await pending).toMatchObject({ success: false });
  });
  it('a manually connected token wins over an older pending refresh', async () => {
    const f = managedFixture('claude-code');
    f.stored.set('claude-code', { claudeAiOauth: { accessToken: 'old', refreshToken: 'refresh-old', expiresAt: 1 } });
    let finish;
    f.httpClient.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ status: 200 });
    const refreshing = f.connection.refreshAccessToken();
    expect(await f.connection.saveManualToken('sk-ant-new')).toMatchObject({ success: true });
    finish({ data: { access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 } });
    expect(await refreshing).toMatchObject({ success: false });
    expect(f.connection.getAccessTokenSync()).toBe('sk-ant-new');
  });
});
