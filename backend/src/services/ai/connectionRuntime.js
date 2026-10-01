import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';

/**
 * Opt-in connection runtime for explicitly configured API and OAuth clients.
 *
 * No registrations are built in and nothing installs this runtime at import
 * time. Existing providers remain on their existing paths until each migration
 * is explicitly wired and verified. OAuth clients must be registered for the
 * integrating application; this module neither constructs vendor identities
 * nor implements first-party billing attribution.
 *
 * credentialStore owns persistence/encryption. A record's ownedByAgnt flag
 * controls refresh and deletion; merely discovering a credential grants neither.
 * Network, storage and clock dependencies are injected for isolated tests.
 */
export class ConnectionError extends Error {
  constructor(code, { status } = {}) {
    super(code);
    this.name = 'ConnectionError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const fail = (code, options) => { throw new ConnectionError(code, options); };
const identifier = value => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) fail('invalid_connection_id');
  return value;
};
const secret = value => {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) fail('invalid_credential');
  return value;
};
const positive = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) fail('invalid_runtime_limit');
  return value;
};

function checkedUrl(value, allowLoopback = false) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_endpoint'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:'))) {
    fail('invalid_endpoint');
  }
  return url;
}

function normalizeProfile(profile) {
  const id = identifier(profile?.id);
  const type = profile?.auth?.type;
  if (!['api-key', 'oauth-pkce', 'oauth-device'].includes(type)) fail('unsupported_authentication');
  const baseUrl = checkedUrl(profile.baseUrl).href;
  const auth = { type };
  if (type !== 'api-key') {
    auth.clientId = secret(profile.auth.clientId);
    auth.tokenUrl = checkedUrl(profile.auth.tokenUrl).href;
    const scopes = profile.auth.scopes || [];
    if (!Array.isArray(scopes) || scopes.some(s => typeof s !== 'string' || !s || /\s/.test(s))) fail('invalid_scopes');
    auth.scope = scopes.join(' ');
    if (type === 'oauth-pkce') {
      auth.authorizeUrl = checkedUrl(profile.auth.authorizeUrl).href;
      auth.redirectUri = checkedUrl(profile.auth.redirectUri, true).href;
    } else {
      auth.deviceUrl = checkedUrl(profile.auth.deviceUrl).href;
    }
  }
  return Object.freeze({ id, baseUrl, auth: Object.freeze(auth) });
}

function normalizeTokens(body, previous, now) {
  const accessToken = secret(body?.access_token);
  if (body.token_type && String(body.token_type).toLowerCase() !== 'bearer') fail('unsupported_token_type');
  let expiresAt = null;
  if (body.expires_in !== undefined) {
    const seconds = Number(body.expires_in);
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(Math.ceil(seconds * 1000))) fail('invalid_token_expiry');
    expiresAt = now + seconds * 1000;
    if (!Number.isSafeInteger(Math.ceil(expiresAt))) fail('invalid_token_expiry');
  }
  return {
    ...(previous || {}),
    accessToken,
    refreshToken: body.refresh_token ? secret(body.refresh_token) : previous?.refreshToken || null,
    expiresAt,
    scope: typeof body.scope === 'string' ? body.scope : previous?.scope || '',
    ownedByAgnt: true,
  };
}

export function createConnectionRuntime({
  profiles = [], credentialStore, fetchImpl = globalThis.fetch, now = Date.now,
  random = randomBytes, sessionTtlMs, maxPendingSessions, requestTimeoutMs, refreshMarginMs = 60000,
} = {}) {
  if (!credentialStore || !['read', 'write', 'remove'].every(k => typeof credentialStore[k] === 'function')) fail('invalid_credential_store');
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof random !== 'function') fail('invalid_runtime_dependency');
  if (!Array.isArray(profiles)) fail('invalid_profiles');
  const registry = new Map();
  for (const profile of profiles) {
    const normalized = normalizeProfile(profile);
    if (registry.has(normalized.id)) fail('duplicate_connection_id');
    registry.set(normalized.id, normalized);
  }
  const lifetime = positive(sessionTtlMs, 10 * 60 * 1000);
  const capacity = positive(maxPendingSessions, 32);
  const timeout = positive(requestTimeoutMs, 30000);
  if (!Number.isSafeInteger(refreshMarginMs) || refreshMarginMs < 0) fail('invalid_runtime_limit');
  const sessions = new Map();
  const locks = new Map();
  const getConnection = id => registry.get(identifier(id)) || fail('unknown_connection');
  const prune = () => { for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id); };

  // A failed operation must release its lane. Work on a different connection is
  // independent; refresh, sign-in completion and disconnect on one are serialized.
  async function exclusive(id, operation) {
    const previous = locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    locks.set(id, gate);
    try { await previous; return await operation(); }
    finally { release(); if (locks.get(id) === gate) locks.delete(id); }
  }
  async function storage(method, id, value) {
    try { return await credentialStore[method](id, value); }
    catch { fail('credential_storage_failed'); }
  }
  async function network(url, options) {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'manual', signal }); }
    catch { fail(signal.aborted ? 'request_aborted' : 'connection_unavailable'); }
    // Never forward an authorization token through an automatic redirect.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      fail('redirect_refused', { status: response.status });
    }
    return response;
  }
  async function oauthPost(url, fields) {
    const response = await network(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
    });
    let body;
    try { body = await response.json(); } catch { fail('invalid_auth_response', { status: response.status }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_auth_response', { status: response.status });
    return { response, body };
  }
  const sessionFor = (id, sessionId, type) => {
    const session = sessions.get(sessionId);
    if (!session || session.connectionId !== id || session.type !== type) fail('invalid_signin_session');
    if (session.expiresAt <= now()) { sessions.delete(sessionId); fail('signin_expired'); }
    return session;
  };
  function reserve(id, type) {
    prune();
    if (sessions.size >= capacity) fail('signin_capacity_reached');
    const sessionId = random(24).toString('base64url');
    if (sessions.has(sessionId)) fail('signin_id_collision');
    const session = { connectionId: id, type, sessionId, expiresAt: now() + lifetime };
    sessions.set(sessionId, session);
    return session;
  }

  async function describeConnection(id) {
    getConnection(id);
    const record = await storage('read', id);
    const connected = typeof record?.accessToken === 'string' && !!record.accessToken;
    return Object.freeze({
      id, connected, ownedByAgnt: connected && record.ownedByAgnt === true,
      expiresAt: connected ? record.expiresAt ?? null : null,
      expired: connected && Number.isFinite(record.expiresAt) && record.expiresAt <= now(),
    });
  }
  async function connectApiKey(id, value) {
    const profile = getConnection(id);
    if (profile.auth.type !== 'api-key') fail('unsupported_operation');
    const accessToken = secret(value);
    return exclusive(id, async () => {
      await storage('write', id, { accessToken, ownedByAgnt: true, expiresAt: null });
      return { success: true };
    });
  }
  async function startSignIn(id) {
    const profile = getConnection(id);
    if (profile.auth.type === 'api-key') fail('unsupported_operation');
    return exclusive(id, async () => {
      const session = reserve(id, profile.auth.type);
      try {
        if (profile.auth.type === 'oauth-pkce') {
          session.verifier = random(32).toString('base64url');
          session.state = random(32).toString('base64url');
          const url = new URL(profile.auth.authorizeUrl);
          const fields = { response_type: 'code', client_id: profile.auth.clientId, redirect_uri: profile.auth.redirectUri,
            state: session.state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(session.verifier).digest('base64url') };
          if (profile.auth.scope) fields.scope = profile.auth.scope;
          for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
          return { sessionId: session.sessionId, authUrl: url.href, expiresAt: session.expiresAt };
        }
        const { response, body } = await oauthPost(profile.auth.deviceUrl, {
          client_id: profile.auth.clientId, ...(profile.auth.scope ? { scope: profile.auth.scope } : {}),
        });
        if (!response.ok || body.error) fail('signin_start_failed', { status: response.status });
        if (session.expiresAt <= now()) fail('signin_expired');
        session.deviceCode = secret(body.device_code);
        const userCode = secret(body.user_code);
        const verificationUri = checkedUrl(body.verification_uri).href;
        const expires = Number(body.expires_in), interval = Number(body.interval ?? 5);
        if (!Number.isSafeInteger(expires) || expires <= 0 || !Number.isSafeInteger(interval) || interval <= 0 || interval > 86400) fail('invalid_device_response');
        session.expiresAt = Math.min(session.expiresAt, now() + expires * 1000);
        session.intervalMs = interval * 1000;
        session.nextPollAt = now() + session.intervalMs;
        return { sessionId: session.sessionId, userCode, verificationUri, expiresAt: session.expiresAt, intervalMs: session.intervalMs };
      } catch (error) { sessions.delete(session.sessionId); throw error; }
    });
  }
  async function completeSignIn(id, { sessionId, state, code } = {}) {
    const profile = getConnection(id);
    return exclusive(id, async () => {
      const session = sessionFor(id, sessionId, 'oauth-pkce');
      if (typeof state !== 'string' || state !== session.state) fail('invalid_oauth_state');
      secret(code);
      // Authorization codes are single-use. A failed exchange requires a new
      // sign-in rather than racing a second exchange with the same verifier.
      sessions.delete(sessionId);
      const { response, body } = await oauthPost(profile.auth.tokenUrl, {
        grant_type: 'authorization_code', client_id: profile.auth.clientId,
        code, code_verifier: session.verifier, redirect_uri: profile.auth.redirectUri,
      });
      if (!response.ok || body.error) fail('signin_exchange_failed', { status: response.status });
      if (session.expiresAt <= now()) fail('signin_expired');
      const record = normalizeTokens(body, null, now());
      await storage('write', id, record);
      return { success: true };
    });
  }
  async function pollSignIn(id, sessionId) {
    const profile = getConnection(id);
    return exclusive(id, async () => {
      const session = sessionFor(id, sessionId, 'oauth-device');
      if (now() < session.nextPollAt) return { state: 'pending', retryAt: session.nextPollAt };
      session.nextPollAt = now() + session.intervalMs;
      const { response, body } = await oauthPost(profile.auth.tokenUrl, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: session.deviceCode, client_id: profile.auth.clientId,
      });
      if (session.expiresAt <= now()) { sessions.delete(sessionId); fail('signin_expired'); }
      if (body.error === 'authorization_pending' || body.error === 'slow_down') {
        if (body.error === 'slow_down') session.intervalMs += 5000;
        session.nextPollAt = now() + session.intervalMs;
        return { state: 'pending', retryAt: session.nextPollAt };
      }
      sessions.delete(sessionId);
      if (!response.ok || body.error) fail('signin_exchange_failed', { status: response.status });
      await storage('write', id, normalizeTokens(body, null, now()));
      return { state: 'success' };
    });
  }
  async function cancelSignIn(id, sessionId) {
    getConnection(id);
    return exclusive(id, () => {
      const session = sessions.get(sessionId);
      if (!session || session.connectionId !== id) return false;
      return sessions.delete(sessionId);
    });
  }
  async function refreshOwned(profile, current) {
    if (current?.ownedByAgnt !== true) fail('credential_not_owned');
    if (profile.auth.type === 'api-key' || !current.refreshToken) fail('refresh_unavailable');
    const { response, body } = await oauthPost(profile.auth.tokenUrl, {
      grant_type: 'refresh_token', refresh_token: secret(current.refreshToken), client_id: profile.auth.clientId,
    });
    if (!response.ok || body.error) fail('refresh_failed', { status: response.status });
    const latest = await storage('read', profile.id);
    if (latest?.accessToken !== current.accessToken || latest?.refreshToken !== current.refreshToken || latest?.ownedByAgnt !== true) fail('credential_changed');
    const record = normalizeTokens(body, current, now());
    await storage('write', profile.id, record);
    return record;
  }
  async function refreshConnection(id) {
    const profile = getConnection(id);
    return exclusive(id, async () => {
      const current = await storage('read', id);
      if (!current?.accessToken) fail('not_connected');
      await refreshOwned(profile, current);
      return { success: true };
    });
  }
  async function resolveCredential(id) {
    const profile = getConnection(id);
    return exclusive(id, async () => {
      const current = await storage('read', id);
      if (!current?.accessToken) fail('not_connected');
      const accessToken = secret(current.accessToken);
      const expiring = Number.isFinite(current.expiresAt) && current.expiresAt <= now() + refreshMarginMs;
      if (!expiring) return accessToken;
      // Borrowed credentials can be used while valid, but cannot be rotated.
      if (current.ownedByAgnt !== true || !current.refreshToken || profile.auth.type === 'api-key') {
        if (current.expiresAt <= now()) fail('credential_expired');
        return accessToken;
      }
      return (await refreshOwned(profile, current)).accessToken;
    });
  }
  async function disconnectConnection(id) {
    getConnection(id);
    return exclusive(id, async () => {
      for (const [key, session] of sessions) if (session.connectionId === id) sessions.delete(key);
      const record = await storage('read', id);
      if (!record) return { disconnected: true, credentialPreserved: false };
      if (record.ownedByAgnt !== true) return { disconnected: false, credentialPreserved: true };
      await storage('remove', id);
      return { disconnected: true, credentialPreserved: false };
    });
  }
  async function request(id, relativePath, { method = 'GET', headers = {}, body, signal } = {}) {
    const profile = getConnection(id);
    const base = new URL(profile.baseUrl);
    const target = checkedUrl(new URL(relativePath, base).href);
    if (target.origin !== base.origin) fail('credential_destination_refused');
    const supplied = new Headers(headers);
    if (supplied.has('authorization')) fail('authorization_override_refused');
    supplied.set('Authorization', `Bearer ${await resolveCredential(id)}`);
    return network(target.href, { method, headers: supplied, body, signal });
  }
  return Object.freeze({ getConnection, describeConnection, connectApiKey, startSignIn, completeSignIn,
    pollSignIn, cancelSignIn, refreshConnection, resolveCredential, disconnectConnection, request });
}

/** Parse SSE without rewriting response payloads or interpreting vendor types. */
export async function* readEventStream(response, { maxFrameBytes = 1024 * 1024 } = {}) {
  positive(maxFrameBytes, 1024 * 1024);
  if (!response?.ok) fail('upstream_http_error', { status: response?.status });
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) fail('invalid_event_stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', frameBytes = 0, event = '', data = [], lastId = '', retry, ended = false;
  const record = () => {
    const result = data.length ? { event: event || 'message', data: data.join('\n'), id: lastId, ...(retry === undefined ? {} : { retry }) } : null;
    event = ''; data = []; retry = undefined; frameBytes = 0;
    return result;
  };
  function line(value) {
    if (value === '') return record();
    frameBytes += Buffer.byteLength(value, 'utf8') + 1;
    if (frameBytes > maxFrameBytes) fail('event_frame_too_large');
    if (value.startsWith(':')) return null;
    const colon = value.indexOf(':');
    const key = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (key === 'event') event = content;
    else if (key === 'data') data.push(content);
    else if (key === 'id' && !content.includes('\0')) lastId = content;
    else if (key === 'retry' && /^\d+$/.test(content) && Number.isSafeInteger(Number(content))) retry = Number(content);
    return null;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index = 0;
      while (index < pending.length) {
        const delimiter = pending.slice(index).search(/[\r\n]/);
        if (delimiter < 0) break;
        const end = index + delimiter;
        if (pending[end] === '\r' && end + 1 === pending.length && !done) break;
        const item = line(pending.slice(index, end));
        index = end + (pending[end] === '\r' && pending[end + 1] === '\n' ? 2 : 1);
        if (item) yield item;
      }
      pending = pending.slice(index);
      if (frameBytes + Buffer.byteLength(pending, 'utf8') > maxFrameBytes) fail('event_frame_too_large');
      if (done) { ended = true; break; } // SSE requires a blank line to dispatch; incomplete EOF is discarded.
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
