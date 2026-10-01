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
