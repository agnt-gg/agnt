import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import xxhashWasm from 'xxhash-wasm';
import { GEMINI_CLI_OAUTH, ANTIGRAVITY_OAUTH } from '../../config/oauthClients.js';
import { getClientIdentity, getClientVersion, getCachedClientVersion } from './clientVersions.js';
import { resolveDefaultModel } from './defaultModel.js';
import { readSecretJson, clearSecretCache, secretStoreSupported } from '../auth/secretStore.js';
import { isLocalProviderDisconnected } from '../auth/localProviderAccess.js';
import * as agntStore from '../auth/agntCredentialStore.js';
import { describeSource } from '../auth/credentialResolver.js';
import { reconcile } from '../../utils/lineEndings.js';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';

/** Capability-based connections. Explicit profiles preserve provider wire contracts;
 * injected storage/network dependencies keep tests isolated from user state.
 * No credentials are read and no network request runs at module import. */
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


// Existing connection profiles: identifiers and wire values remain explicit.
// Storage, refresh, sessions and gateway lifecycle are shared, not subclassed.
const connectionProfiles = {
  'claude-code': {
    name: 'Claude Code', directory: '.claude', filename: '.credentials.json', format: 'nested-camel', block: 'claudeAiOauth',
    source: 'claude-credentials', ownedStore: true, keychain: ['Claude Code-credentials'], keychainSource: 'claude-keychain',
    clientId: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize', tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback', scope: 'org:create_api_key user:profile user:inference',
    flow: 'paste-pkce', encoding: 'json', expiryOffset: 300000, health: 'messages',
  },
  'openai-codex': {
    name: 'OpenAI Codex', directory: '.codex', filename: 'auth.json', homeEnv: 'CODEX_HOME', format: 'nested-snake', block: 'tokens',
    source: 'codex-auth-file', apiKeyEnv: 'OPENAI_API_KEY', apiKeyField: 'OPENAI_API_KEY',
    clientId: process.env.CODEX_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann',
    tokenUrl: 'https://auth.openai.com/oauth/token', deviceStartUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
    devicePollUrl: 'https://auth.openai.com/api/accounts/deviceauth/token', deviceVerifyUrl: 'https://auth.openai.com/codex/device',
    redirectUri: 'https://auth.openai.com/deviceauth/callback', flow: 'device-code-exchange', encoding: 'form', health: 'responses',
  },
  'gemini-cli': {
    name: 'Gemini CLI', directory: '.gemini', filename: 'oauth_creds.json', format: 'flat-snake', source: 'gemini-oauth-file',
    apiKeyEnv: 'GEMINI_API_KEY', apiKeyFile: true, client: GEMINI_CLI_OAUTH,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    flow: 'loopback-pkce', callbackPath: '/oauth2callback', callbackHost: '127.0.0.1', callbackPort: 0, encoding: 'form', health: 'gateway',
    projectEnv: ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID'],
    gateway: { base: 'https://cloudcode-pa.googleapis.com/v1internal', modelBase: 'https://cloudcode-pa.googleapis.com/v1internal',
      metadata: { ide_type: 'GEMINI_CLI', platform: 'WINDOWS_AMD64', plugin_type: 'CLOUD_CODE' }, mode: 'HEALTH_CHECK',
      requiresProject: true, upgradeTier: true, catalog: 'quota' },
  },
  antigravity: {
    name: 'Antigravity', directory: '.antigravity', filename: 'oauth_creds.json', format: 'flat-snake', source: 'antigravity-oauth-file',
    keychain: ['Antigravity-credentials', 'Antigravity', 'antigravity'], keychainEnv: 'AGNT_ANTIGRAVITY_KEYCHAIN_SERVICE', keychainSource: 'antigravity-keychain', client: ANTIGRAVITY_OAUTH,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs',
    flow: 'loopback-pkce', callbackPath: '/oauth-callback', callbackHost: 'localhost', callbackPort: 51121, encoding: 'form', health: 'gateway',
    projectEnv: ['ANTIGRAVITY_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID'],
    gateway: { base: 'https://cloudcode-pa.googleapis.com/v1internal', modelBase: process.env.ANTIGRAVITY_MODEL_GATEWAY || 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal',
      metadata: { ideType: 'ANTIGRAVITY', platform: process.platform === 'win32' ? 'WINDOWS_AMD64' : process.platform === 'darwin' ? process.arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64' : 'LINUX_AMD64', pluginType: 'GEMINI' },
      clientMetadata: { ideType: 'ANTIGRAVITY', platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS', pluginType: 'GEMINI' },
      browserIdentity: true, catalog: 'picker', cooldownMs: 300000, softQuotaFloor: parseFloat(process.env.ANTIGRAVITY_SOFT_QUOTA_FLOOR || '0.10'),
      requestFields: { requestType: 'agent', userAgent: 'antigravity' } },
  },
};

const refreshWindowMs = 300000;
const healthCacheMs = 120000;
const callbackSuccessUrl = 'https://developers.google.com/gemini-code-assist/auth/auth_success_gemini';
const callbackFailureUrl = 'https://developers.google.com/gemini-code-assist/auth/auth_failure_gemini';
const legacyInstances = new Map();
const tokenText = value => typeof value === 'string' ? value.trim() : '';
function decodeTokenClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return null; }
}
function readJsonFile(filename) {
  try { const value = JSON.parse(fs.readFileSync(filename, 'utf8')); return value && typeof value === 'object' ? value : null; } catch { return null; }
}
function writeJsonFile(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(value, null, 2), { mode: 0o600 });
}

/** Build an independent connection from a capability profile. Dependencies are
 * injectable; construction does not inspect credentials or start network I/O. */
export function createManagedConnection(id, dependencies = {}) {
  const profile = connectionProfiles[id];
  if (!profile) throw new Error(`Unknown connection: ${id}`);
  const clock = dependencies.now || Date.now;
  const httpClient = dependencies.httpClient || axios;
  const home = dependencies.homedir || os.homedir;
  const environment = dependencies.env || process.env;
  const store = dependencies.credentialStore || agntStore;
  const keychain = dependencies.readSecretJson || readSecretJson;
  const state = { health: null, refresh: null, deviceStart: null, sessions: new Map(), project: null, onboarded: false, tier: null, paidTier: null, cooldownUntil: 0, generation: 0 };
  let connection;
  function directory() {
    const configured = profile.homeEnv && environment[profile.homeEnv];
    let value = configured ? configured === '~' ? home() : configured.startsWith('~/') ? path.join(home(), configured.slice(2)) : configured : path.join(home(), profile.directory);
    if (profile.homeEnv) { try { value = fs.realpathSync.native(value); } catch { /* Directory may not exist before first sign-in. */ } }
    return value;
  }
  const credentialPath = () => path.join(directory(), profile.filename);
  function readEnvironmentField(name, unquote = false) {
    try {
      const content = fs.readFileSync(path.join(directory(), '.env'), 'utf8');
      const match = content.match(new RegExp(`^${name}=(.+)$`, 'm'));
      const value = match ? match[1].trim() : null;
      return unquote && value ? value.replace(/^["']|["']$/g, '') : value;
    } catch { return null; }
  }
  function writeEnvironmentField(name, value) {
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) return { success: false, error: `Invalid ${name === 'GEMINI_API_KEY' ? 'API key' : 'project ID'}` };
    const filename = path.join(directory(), '.env');
    let content = '';
    try { content = fs.readFileSync(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const existing = content;
    const matcher = new RegExp(`^${name}=.*`, 'm');
    content = matcher.test(content) ? content.replace(matcher, () => `${name}=${value}`) : content.trim() + (content.trim() ? '\n' : '') + `${name}=${value}\n`;
    const prepared = reconcile(existing, content);
    fs.mkdirSync(directory(), { recursive: true }); fs.writeFileSync(filename, prepared.content, 'utf8');
    invalidate(name !== 'GEMINI_API_KEY');
    return { success: true };
  }
  function apiKey() {
    if (!profile.apiKeyEnv) return null;
    const raw = environment[profile.apiKeyEnv];
    const fromEnv = profile.apiKeyFile ? raw : tokenText(raw);
    if (fromEnv) return fromEnv;
    if (profile.apiKeyFile) return readEnvironmentField(profile.apiKeyEnv);
    return tokenText(readJsonFile(credentialPath())?.[profile.apiKeyField]) || null;
  }
  function project() {
    for (const name of profile.projectEnv || []) if (environment[name]) return environment[name];
    return readEnvironmentField('GOOGLE_CLOUD_PROJECT(?:_ID)?', true);
  }
  function decode(data) {
    if (!data) return null;
    const block = profile.block ? data[profile.block] : data;
    if (profile.format === 'nested-camel') {
      const token = block?.accessToken ? String(block.accessToken).trim() : '';
      if (token) return { token, refreshToken: block.refreshToken, expiresAt: block.expiresAt, raw: data, block };
      for (const key of ['oauth_token', 'token', 'access_token']) {
        if (tokenText(data[key])) return { token: tokenText(data[key]), raw: data, block: null };
      }
      return null;
    }
    const token = profile.format === 'nested-snake' ? tokenText(block?.access_token) : block?.access_token;
    return { token: token || null, refreshToken: block?.refresh_token, expiresAt: profile.format === 'nested-snake' ? decodeTokenClaims(token || '')?.exp * 1000 : block?.expiry_date, raw: data, block };
  }
  function readCredential() {
    if (profile.ownedStore) {
      const found = decode(store.readCredential(id));
      if (found) return { ...found, ownedByAgnt: true, source: 'agnt-store', tier: 'agnt-store', credPath: store.getCredentialPath(id) };
    }
    const raw = readJsonFile(credentialPath());
    const found = decode(raw);
    if (found) {
      // Preserve the existing legacy shape discriminator. The shared Codex and
      // Gemini files still lack one; their historical ownership stays explicit.
      const ownedByAgnt = profile.format !== 'nested-camel' || !['subscriptionType', 'rateLimitTier', 'refreshTokenExpiresAt'].some(key => found.block?.[key] !== undefined);
      return { ...found, ownedByAgnt, source: profile.source, tier: 'vendor-file', credPath: credentialPath() };
    }
    const services = profile.keychainEnv && environment[profile.keychainEnv]?.trim() ? [environment[profile.keychainEnv].trim()] : profile.keychain || [];
    for (const service of services) {
      let payload;
      try { payload = keychain({ service, account: os.userInfo?.().username || null }); } catch { continue; }
      const candidate = decode(payload);
      if (candidate && (candidate.token || candidate.refreshToken)) return { ...candidate, ownedByAgnt: false, source: profile.keychainSource, tier: 'secret-store', credPath: `keychain:${service}` };
    }
    return null;
  }
  function invalidate(account = false) {
    state.health = null;
    if (account) { state.project = null; state.onboarded = false; state.tier = null; state.paidTier = null; state.generation++; }
  }
  function persistTokens(tokens, previous = null, refresh = false) {
    if (!tokens?.access_token) throw new Error('Token response missing access_token.');
    const raw = previous?.raw || readJsonFile(credentialPath()) || {};
    if (profile.format === 'nested-camel') {
      const oauth = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous?.refreshToken || null,
        expiresAt: tokens.expires_in ? clock() + tokens.expires_in * 1000 - profile.expiryOffset : null,
        scopes: tokens.scope ? tokens.scope.split(' ') : previous?.block?.scopes || profile.scope.split(' ') };
      store.writeCredential(id, { [profile.block]: oauth }); clearSecretCache();
    } else if (profile.format === 'nested-snake') {
      const block = refresh ? { ...(raw[profile.block] || {}) } : {};
      block.access_token = tokens.access_token;
      for (const key of ['refresh_token', 'id_token']) if (tokens[key]) block[key] = tokens[key];
      writeJsonFile(credentialPath(), { ...raw, [profile.block]: block });
    } else {
      const updated = refresh ? { ...raw } : {};
      Object.assign(updated, { access_token: tokens.access_token, expiry_date: clock() + (tokens.expires_in || 3600) * 1000,
        token_type: tokens.token_type || raw.token_type || 'Bearer', scope: tokens.scope || (refresh ? raw.scope : profile.scope) });
      if (!refresh) updated.refresh_token = tokens.refresh_token;
      for (const key of ['refresh_token', 'id_token']) if (tokens[key]) updated[key] = tokens[key];
      writeJsonFile(credentialPath(), updated);
    }
    invalidate(!refresh && !!profile.gateway);
  }
  function describeCredential() {
    const key = apiKey(), resolved = readCredential();
    const credPath = profile.ownedStore ? store.getCredentialPath(id) : credentialPath();
    if (key && profile.apiKeyEnv && environment[profile.apiKeyEnv]) return { connected: true, source: 'env', tier: 'env', ownedByAgnt: true, label: `environment (${profile.apiKeyEnv})`, credPath, keychainSupported: false };
    if (key && profile.apiKeyFile) return { connected: true, source: 'gemini-env-file', tier: 'vendor-file', ownedByAgnt: true, label: 'API key in ~/.gemini/.env', credPath: path.join(directory(), '.env'), keychainSupported: false };
    const connected = !!(key || resolved?.token || (profile.format === 'flat-snake' && resolved?.refreshToken));
    let label = describeSource(connected ? resolved : null);
    if (connected && !profile.keychain) label = `${profile.name === 'OpenAI Codex' ? 'Codex CLI' : profile.name} credentials file`;
    return { connected, source: connected ? resolved?.source || profile.source : null, tier: connected ? resolved?.tier || 'vendor-file' : null,
      ownedByAgnt: connected && (resolved?.ownedByAgnt ?? true), label, credPath: resolved?.credPath || credPath, keychainSupported: profile.keychain ? secretStoreSupported() : false };
  }
  async function tokenRequest(fields, timeout) {
    const body = profile.encoding === 'json' ? JSON.stringify(fields) : new URLSearchParams(fields).toString();
    return httpClient.post(profile.tokenUrl, body, { headers: { 'Content-Type': profile.encoding === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' }, ...(timeout ? { timeout } : {}) });
  }
  function clientFields(record) {
    return { client_id: record?.raw?.client_id || profile.client?.CLIENT_ID || profile.clientId,
      ...(profile.client ? { client_secret: record?.raw?.client_secret || profile.client.CLIENT_SECRET } : {}) };
  }
  async function refreshAccessToken() {
    if (state.refresh) return state.refresh;
    const operation = (async () => {
      const before = readCredential(), generation = state.generation;
      if (before && !before.ownedByAgnt) return { success: false, revoked: false, error: `Credential belongs to the ${profile.name} CLI; AGNT does not refresh it.` };
      if (!before?.refreshToken) return { success: false, revoked: false, error: 'No refresh token available' };
      try {
        const response = await tokenRequest({ grant_type: 'refresh_token', ...clientFields(before), refresh_token: before.refreshToken }, profile.gateway ? undefined : 15000);
        const latest = readCredential();
        if (generation !== state.generation || latest?.refreshToken !== before.refreshToken || !latest?.ownedByAgnt) return { success: false, revoked: false, error: 'Credential changed during refresh' };
        persistTokens(response.data, latest, true);
        return { success: true, ...(profile.format !== 'flat-snake' ? { accessToken: response.data.access_token } : {}),
          ...(profile.health === 'responses' ? { expiresAt: getTokenExpiry()?.expiresAt || null, rotatedRefreshToken: !!response.data.refresh_token } : {}) };
      } catch (error) {
        const status = error.response?.status, code = error.response?.data?.error;
        const revoked = profile.health === 'messages' ? status === 401 || status === 403 || code === 'invalid_grant' : profile.health === 'responses' ? status === 400 || status === 401 : status === 400 && code === 'invalid_grant';
        if (revoked && profile.health === 'messages' && generation === state.generation) await logout();
        return { success: false, revoked, error: revoked && profile.health === 'messages' ? 'Refresh token revoked. Please reconnect.' : `Refresh failed: ${typeof code === 'string' ? code : error.message}` };
      }
    })();
    state.refresh = operation;
    try { return await operation; } finally { if (state.refresh === operation) state.refresh = null; }
  }
  function getTokenExpiry() {
    const token = readCredential()?.token;
    if (!token || token.startsWith('sk-')) return null;
    const exp = decodeTokenClaims(token)?.exp;
    if (!exp) return null;
    const expires = exp * 1000;
    return { expiresAt: new Date(expires).toISOString(), expiresInMs: expires - clock(), expired: clock() >= expires };
  }
  function isTokenExpiringSoon() { const expiry = getTokenExpiry(); return !!expiry && expiry.expiresInMs <= refreshWindowMs; }
  function tokenSync(oauthOnly = false) { return (!oauthOnly && apiKey()) || readCredential()?.token || null; }
  async function tokenAsync({ autoRefresh = true, oauthOnly = false } = {}) {
    const key = !oauthOnly && apiKey();
    if (key) return key;
    const record = readCredential(); if (!record) return null;
    let needsRefresh = false;
    if (profile.format === 'nested-snake') needsRefresh = isTokenExpiringSoon();
    else if (profile.format === 'nested-camel') needsRefresh = !!record.expiresAt && record.expiresAt - clock() < refreshWindowMs;
    else needsRefresh = !record.token || !record.expiresAt || clock() >= record.expiresAt - refreshWindowMs;
    if (autoRefresh && record.ownedByAgnt && needsRefresh && (record.refreshToken || profile.format === 'nested-snake')) {
      const result = await refreshAccessToken();
      if (result.success) return readCredential()?.token || null;
      if (result.revoked && profile.health === 'messages') return null;
    }
    return record.token || null;
  }
  function getChatGptAccountId() { return decodeTokenClaims(readCredential()?.token || '')?.['https://api.openai.com/auth']?.chatgpt_account_id || null; }
  async function logout() {
    try {
      state.generation++;
      for (const session of state.sessions.values()) session.server?.close();
      state.sessions.clear();
      if (profile.ownedStore) {
        store.clearCredential(id); clearSecretCache();
        const remaining = readCredential();
        if (remaining && !remaining.ownedByAgnt) {
          invalidate(true);
          return { success: true, stillDetected: true, source: remaining.source, message: remaining.tier === 'secret-store'
            ? 'Disconnected from AGNT. The Claude Code CLI still has a session in your keychain — run `claude logout` to end it.'
            : 'Disconnected from AGNT. The Claude Code CLI still has a session in ~/.claude — run `claude logout` to end it.' };
        }
        if (remaining?.ownedByAgnt && remaining.tier === 'vendor-file') {
          const raw = { ...remaining.raw };
          for (const key of [profile.block, 'oauth_token', 'token', 'access_token']) delete raw[key];
          if (Object.keys(raw).length) writeJsonFile(credentialPath(), raw); else if (fs.existsSync(credentialPath())) fs.unlinkSync(credentialPath());
        }
      } else if (profile.block) {
        const raw = readJsonFile(credentialPath());
        if (raw) { delete raw[profile.block]; delete raw[profile.apiKeyField]; writeJsonFile(credentialPath(), raw); }
      } else {
        if (fs.existsSync(credentialPath())) fs.unlinkSync(credentialPath());
        if (profile.apiKeyFile) {
          const filename = path.join(directory(), '.env');
          try { fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace(/^GEMINI_API_KEY=.*\n?/m, ''), 'utf8'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      invalidate(true); state.cooldownUntil = 0;
      return { success: true };
    } catch (error) { return { success: false, error: error.message || 'Failed to disconnect' }; }
  }
  function pruneSessions() {
    for (const [key, session] of state.sessions) if (clock() > session.expiresAt) { session.server?.close(); state.sessions.delete(key); }
    if (state.sessions.size >= 32) throw new Error('Too many pending sign-in sessions');
  }
  function parseCodeState(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    const text = raw.trim().replace(/^`+|`+$/g, '').trim();
    try { const url = new URL(text); if (url.searchParams.get('code') && url.searchParams.get('state')) return { code: url.searchParams.get('code'), state: url.searchParams.get('state') }; } catch { /* Callback may be code#state instead. */ }
    const split = text.indexOf('#'); return split > 0 && split < text.length - 1 ? { code: text.slice(0, split), state: text.slice(split + 1) } : null;
  }
  function newSession() {
    pruneSessions();
    const session = { id: crypto.randomUUID(), verifier: crypto.randomBytes(32).toString('base64url'), state: crypto.randomBytes(16).toString('hex'), status: 'pending', error: null, createdAt: clock(), expiresAt: clock() + 600000, generation: state.generation };
    if (profile.flow === 'paste-pkce') session.state = session.verifier;
    state.sessions.set(session.id, session); return session;
  }
  function authorizationUrl(session, redirectUri) {
    const fields = { ...(profile.flow === 'paste-pkce' ? { code: 'true' } : {}), ...clientFields(), response_type: 'code', redirect_uri: redirectUri, scope: profile.scope,
      state: session.state, code_challenge: crypto.createHash('sha256').update(session.verifier).digest('base64url'), code_challenge_method: 'S256',
      ...(profile.flow === 'loopback-pkce' ? { access_type: 'offline', prompt: 'consent' } : {}) };
    delete fields.client_secret;
    return `${profile.authorizeUrl}?${new URLSearchParams(fields)}`;
  }
  async function exchangeSession(session, code, suppliedState, redirectUri) {
    if (!session || clock() > session.expiresAt || session.status !== 'pending') throw new Error('OAuth session expired or not found. Please try again.');
    if (suppliedState !== session.state) throw new Error('OAuth state mismatch — possible CSRF. Please try again.');
    session.status = 'exchanging';
    try {
      const fields = { grant_type: 'authorization_code', ...clientFields(), code, redirect_uri: redirectUri, code_verifier: session.verifier,
        ...(profile.flow === 'paste-pkce' ? { state: suppliedState } : {}) };
      const response = await tokenRequest(fields, profile.gateway ? undefined : 15000);
      if (clock() > session.expiresAt || state.generation !== session.generation) throw new Error('OAuth session expired or cancelled');
      persistTokens(response.data); session.status = 'success';
      return { success: true };
    } catch (error) { session.status = 'error'; session.error = error.message; throw error; }
  }
  function startOAuth() {
    if (profile.flow === 'paste-pkce') {
      const session = newSession(); return { authUrl: authorizationUrl(session, profile.redirectUri), sessionId: session.id };
    }
    return startLoopback();
  }
  async function startLoopback() {
    if (!profile.client?.CLIENT_ID || !profile.client?.CLIENT_SECRET) throw new Error(`${profile.name} OAuth client is not configured.`);
    const session = newSession();
    const server = http.createServer(async (req, res) => {
      const incoming = new URL(req.url, session.redirectUri);
      if (incoming.pathname !== profile.callbackPath) { res.writeHead(404); res.end('Not found'); return; }
      const error = incoming.searchParams.get('error');
      if (error || incoming.searchParams.get('state') !== session.state) {
        session.status = 'error'; session.error = error ? `Google OAuth error: ${error}` : 'OAuth state mismatch';
        res.writeHead(302, { Location: callbackFailureUrl }); res.end(); server.close(); return;
      }
      const code = incoming.searchParams.get('code');
      if (!code) { res.writeHead(400); res.end('Missing code'); return; }
      try { await exchangeSession(session, code, session.state, session.redirectUri); res.writeHead(302, { Location: callbackSuccessUrl }); }
      catch { res.writeHead(302, { Location: callbackFailureUrl }); }
      res.end(); server.close();
    });
    session.server = server;
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(profile.callbackPort, '127.0.0.1', resolve); });
      session.redirectUri = `http://${profile.callbackHost}:${server.address().port}${profile.callbackPath}`;
      const timer = setTimeout(() => { session.status = 'error'; session.error = 'OAuth timed out'; server.close(); }, 600000);
      timer.unref?.(); server.once('close', () => clearTimeout(timer));
      server.on('error', error => { session.status = 'error'; session.error = `Callback server error: ${error.code || 'unknown'}`; server.close(); });
      return { sessionId: session.id, authUrl: authorizationUrl(session, session.redirectUri) };
    } catch (error) {
      state.sessions.delete(session.id); server.close();
      throw new Error(error.code === 'EADDRINUSE' ? `Port ${profile.callbackPort} is in use — close the other login attempt and retry.` : 'OAuth callback listener could not start');
    }
  }
  async function startDeviceAuth() {
    if (state.deviceStart) return state.deviceStart;
    const operation = requestDeviceSession();
    state.deviceStart = operation;
    try { return await operation; } finally { if (state.deviceStart === operation) state.deviceStart = null; }
  }
  async function requestDeviceSession() {
    const generation = state.generation;
    pruneSessions();
    let session = [...state.sessions.values()].filter(item => item.status === 'pending').sort((a, b) => b.createdAt - a.createdAt)[0];
    try {
      if (!session) {
        const response = await httpClient.post(profile.deviceStartUrl, { client_id: profile.clientId }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
        if (generation !== state.generation) return { success: false, state: 'error', message: 'Device login cancelled' };
        const deviceCode = response.data.user_code || response.data.usercode;
        if (!response.data.device_auth_id || !deviceCode) return { success: false, state: 'error', message: 'OpenAI did not return a device code. Please try again.' };
        session = { id: crypto.randomUUID(), deviceAuthId: response.data.device_auth_id, userCode: deviceCode, status: 'pending', createdAt: clock(), expiresAt: clock() + 900000, generation: state.generation };
        state.sessions.set(session.id, session);
      }
      return { success: true, sessionId: session.id, deviceUrl: profile.deviceVerifyUrl, deviceCode: session.userCode, state: session.status,
        message: 'Open the URL and enter the code to continue device login.', startedAt: new Date(session.createdAt).toISOString(), expiresAt: new Date(session.expiresAt).toISOString() };
    } catch (error) { return { success: false, state: 'error', message: error.response?.status === 429 ? 'Device login is rate-limited (429 Too Many Requests). Please wait a minute and try again.' : 'Failed to start device login' }; }
  }
  async function getDeviceSessionStatus(sessionId) {
    pruneSessions(); const session = state.sessions.get(sessionId);
    if (!session) return { success: false, state: 'error', message: 'Session not found or expired. Start device login again.' };
    if (session.status === 'success') return { success: true, state: 'success', message: 'Device login complete.' };
    if (session.status === 'error') return { success: false, state: 'error', message: session.error || 'Device login failed.' };
    if (session.poll) return session.poll;
    const operation = (async () => {
      try {
        const poll = await httpClient.post(profile.devicePollUrl, { device_auth_id: session.deviceAuthId, user_code: session.userCode }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
        if (!poll.data.authorization_code) return { success: true, state: 'pending', message: 'Waiting for you to complete device login in the browser...' };
        const response = await tokenRequest({ grant_type: 'authorization_code', code: poll.data.authorization_code, redirect_uri: profile.redirectUri, client_id: profile.clientId, code_verifier: poll.data.code_verifier }, 15000);
        if (clock() > session.expiresAt || session.generation !== state.generation) throw new Error('Session expired or cancelled');
        persistTokens(response.data); session.status = 'success';
        return { success: true, state: 'success', message: 'Device login complete and OpenAI Codex connected successfully.', apiStatus: await checkApiUsable({ forceRefresh: true }) };
      } catch (error) {
        const status = error.response?.status;
        if ([403, 404, 429].includes(status)) return { success: true, state: 'pending', deviceUrl: profile.deviceVerifyUrl, deviceCode: session.userCode, message: status === 429 ? 'Rate limited by OpenAI. Will retry shortly...' : 'Waiting for you to complete device login in the browser...' };
        session.status = 'error'; session.error = status === 401 ? 'Authorization was denied.' : 'Failed to check device login status';
        return { success: false, state: 'error', message: session.error };
      }
    })();
    session.poll = operation; try { return await operation; } finally { session.poll = null; }
  }
  async function saveManualToken(token) {
    if (typeof token !== 'string' || !token) return { success: false, error: 'Token is required.' };
    const trimmed = token.trim(); if (!trimmed.startsWith('sk-ant-') || /[\r\n]/.test(trimmed)) return { success: false, error: 'Invalid token format. Expected a token starting with sk-ant-.' };
    let usable = false;
    try { const response = await probeMessages(trimmed, 10000); usable = response.status >= 200 && response.status < 300; }
    catch (error) { const status = error.response?.status; if (status === 401 || status === 403) return { success: false, error: `Token rejected by Anthropic API (status ${status}).` }; usable = status != null; }
    try { store.writeCredential(id, { [profile.block]: { accessToken: trimmed } }); clearSecretCache(); invalidate(); }
    catch (error) { return { success: false, error: `Failed to write credentials: ${error.message}` }; }
    return { success: true, apiUsable: usable, message: usable ? 'Token saved and verified. Claude Code is ready.' : 'Token saved. API verification returned a non-success status but token may still be valid.' };
  }
  async function probeMessages(token, timeout) {
    const headers = { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    if (token.includes('sk-ant-oat')) Object.assign(headers, { Authorization: `Bearer ${token}`, 'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20', 'user-agent': await getClientIdentity('claude-code'), 'x-app': 'cli' });
    else headers['x-api-key'] = token;
    return httpClient.post('https://api.anthropic.com/v1/messages', { model: resolveDefaultModel(id), max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }, { headers, timeout });
  }
  function cachedHealth(value) { state.health = { time: clock(), value }; return value; }
  async function checkApiUsable({ forceRefresh = false } = {}) {
    if (profile.health === 'gateway') return checkGateway(forceRefresh);
    const token = profile.health === 'responses' ? await connection.ensureValidToken() : await connection.getAccessToken({ autoRefresh: true });
    const described = describeCredential();
    if (!token) return { available: false, ...(profile.health === 'responses' ? { cliUsable: false, authPath: credentialPath() } : { sourceLabel: 'not connected', ownedByAgnt: false, keychainSupported: described.keychainSupported, credPath: described.credPath }), apiUsable: false, apiStatus: null, source: null, checkedAt: new Date(clock()).toISOString() };
    if (!forceRefresh && state.health && clock() - state.health.time < healthCacheMs) return state.health.value;
    let apiStatus = null, apiUsable = false;
    try {
      let response;
      if (profile.health === 'messages') response = await probeMessages(token, 5000);
      else {
        const oauth = await connection.ensureValidOAuthToken();
        if (oauth) {
          const headers = { Authorization: `Bearer ${oauth}`, originator: 'codex_cli_rs' }, accountId = getChatGptAccountId();
          if (accountId) headers['ChatGPT-Account-ID'] = accountId;
          response = await httpClient.get(`https://chatgpt.com/backend-api/codex/models?client_version=${await getClientVersion('openai-codex')}`, { headers, timeout: 5000 });
        }
      }
      if (response) { apiStatus = response.status; apiUsable = apiStatus >= 200 && apiStatus < 300; }
    } catch (error) { apiStatus = error.response?.status || null; apiUsable = profile.health === 'messages' && apiStatus !== null && apiStatus !== 401 && apiStatus !== 403; }
    const raw = profile.health === 'responses' ? readJsonFile(credentialPath()) : null;
    return cachedHealth({ available: true, apiUsable, apiStatus, checkedAt: new Date(clock()).toISOString(),
      ...(profile.health === 'responses' ? { cliUsable: true, source: tokenText(raw?.OPENAI_API_KEY) ? 'codex-auth-openai-api-key' : tokenText(raw?.tokens?.access_token) ? 'codex-auth-access-token' : null,
        authPath: credentialPath(), tokenExpiry: getTokenExpiry()?.expiresAt || null }
        : { source: described.source, sourceLabel: described.label, ownedByAgnt: described.ownedByAgnt, keychainSupported: described.keychainSupported, credPath: described.credPath }) });
  }
  function tripCooldown(reason) { state.cooldownUntil = clock() + (profile.gateway?.cooldownMs || 0); state.health = null; console.warn(`[connection:${id}] cooldown — ${reason}`); }
  const isCoolingDown = () => clock() < state.cooldownUntil;
  const cooldownMsLeft = () => Math.max(0, state.cooldownUntil - clock());
  function gatewayBody() { return { metadata: profile.gateway.metadata, ...(profile.gateway.mode ? { mode: profile.gateway.mode } : {}), ...(project() ? { project: project() } : {}) }; }
  function getOAuth2Client() {
    const record = readCredential(); if (!record) return null;
    const Client = dependencies.OAuth2Client || OAuth2Client;
    const client = new Client({ clientId: profile.client.CLIENT_ID, clientSecret: profile.client.CLIENT_SECRET });
    // A borrowed keychain credential is read-only, including SDK auto-refresh.
    client.setCredentials({ access_token: record.token, ...(record.ownedByAgnt ? { refresh_token: record.refreshToken, expiry_date: record.expiresAt } : {}), token_type: record.raw.token_type || 'Bearer', scope: record.raw.scope });
    if (record.ownedByAgnt) {
      const generation = state.generation;
      let expectedRefreshToken = record.refreshToken;
      client.on('tokens', tokens => {
        const latest = readCredential();
        if (generation !== state.generation || !latest?.ownedByAgnt || latest.refreshToken !== expectedRefreshToken) return;
        writeJsonFile(credentialPath(), { ...latest.raw, ...tokens });
        expectedRefreshToken = tokens.refresh_token || expectedRefreshToken;
        invalidate();
      });
    }
    return client;
  }
  async function gatewayHeaders(purpose) { return buildGatewayHeaders(id, purpose); }
  async function requestGateway(client, operation, data, purpose = 'control', method = 'POST') {
    const headers = await gatewayHeaders(purpose), base = purpose === 'catalog' ? profile.gateway.modelBase : profile.gateway.base;
    return client.request({ url: method === 'GET' ? `${base}/${operation}` : `${base}:${operation}`, method, ...(data === undefined ? {} : { data }), ...(Object.keys(headers).length ? { headers } : {}) });
  }
  function rememberTier(data, retain = false) { state.tier = data.currentTier?.id || (retain ? state.tier : null); state.paidTier = data.paidTier?.id || (retain ? state.paidTier : null); }
  async function onboardToTier(client, tierId) {
    const response = await requestGateway(client, 'onboardUser', { tier_id: tierId, metadata: profile.gateway.metadata, ...(project() ? { project: project() } : {}) });
    const finish = operation => { const value = operation.response?.cloudaicompanionProject; state.project = value?.id || value?.name || null; return true; };
    if (!profile.gateway.requiresProject && response.data?.done) return finish(response.data);
    if (response.data?.name) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const operation = await requestGateway(client, response.data.name, undefined, 'control', 'GET');
        if (operation.data?.done) return finish(operation.data);
        await (dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000);
      }
    }
    return false;
  }
  async function ensureOnboarded(suppliedClient) {
    if (profile.gateway.requiresProject ? !!state.project : state.onboarded) return state.project || undefined;
    const client = suppliedClient || getOAuth2Client(); if (!client) return undefined;
    try {
      const response = await requestGateway(client, 'loadCodeAssist', gatewayBody()), data = response.data;
      rememberTier(data);
      const allowed = data.allowedTiers || [], bestPaid = allowed.find(tier => tier.id && tier.id !== 'free-tier');
      if (data.currentTier && (!profile.gateway.requiresProject || data.cloudaicompanionProject)) {
        if (profile.gateway.upgradeTier && state.tier === 'free-tier' && (state.paidTier || bestPaid)) {
          try {
            await onboardToTier(client, state.paidTier || bestPaid.id);
            const reload = await requestGateway(client, 'loadCodeAssist', { metadata: profile.gateway.metadata, mode: profile.gateway.mode });
            rememberTier(reload.data, true); state.project = reload.data.cloudaicompanionProject || state.project;
          } catch (error) { console.warn(`[connection:${id}] Tier upgrade failed: ${error.message}`); }
        }
        state.project ||= data.cloudaicompanionProject || null; state.onboarded = true; return state.project || undefined;
      }
      const selected = bestPaid || allowed.find(tier => tier.id === 'free-tier');
      if (!selected) return undefined;
      state.onboarded = await onboardToTier(client, selected.id); return state.project || undefined;
    } catch (error) { console.warn(`[connection:${id}] Onboarding failed: ${error.message}`); return undefined; }
  }
  async function retrieveEntitlement() {
    const client = getOAuth2Client(); if (!client) return { models: [], unlicensed: false, status: null };
    try { const projectId = await ensureOnboarded(client); const response = await requestGateway(client, 'retrieveUserQuota', projectId ? { project: projectId } : {}, 'catalog');
      return { models: parseQuotaModels(response.data), unlicensed: false, status: response.status }; }
    catch (error) { const failure = classifyGatewayError(error); return { models: [], unlicensed: failure.unlicensed, status: failure.status }; }
  }
  async function checkGateway(forceRefresh) {
    const record = readCredential(), key = apiKey();
    if (profile.gateway.cooldownMs && !record?.token && !record?.refreshToken) return cachedHealth({ available: false, apiUsable: false, hint: 'Not connected' });
    if (isCoolingDown()) return { available: true, apiUsable: false, coolingDown: true, retryAfterMs: cooldownMsLeft(), hint: 'Antigravity is cooling down to protect your Google account. Use an API-key provider meanwhile.' };
    if (!forceRefresh && state.health && clock() - state.health.time < healthCacheMs) return state.health.value;
    if (!key && !record?.token && !record?.refreshToken) return cachedHealth({ available: false, apiUsable: false, hint: 'Not connected' });
    const consumerHint = 'Google discontinued Gemini CLI for consumer accounts on June 18, 2026. Switch to API key mode, connect an Enterprise GCP project, or use the new Antigravity provider.';
    try {
      const token = await connection.getAccessToken({ autoRefresh: true }); if (!token) return cachedHealth({ available: false, apiUsable: false, hint: 'No valid token' });
      if (key) {
        const response = await httpClient.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${token}&pageSize=1`, { headers: {}, timeout: 10000 });
        return cachedHealth({ available: true, apiUsable: response.status === 200, apiStatus: response.status, source: 'api-key', tier: 'api-key', gcpProject: project() || null });
      }
      const response = await httpClient.post(`${profile.gateway.base}:loadCodeAssist`, gatewayBody(), { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...await gatewayHeaders('control') }, timeout: 10000 });
      rememberTier(response.data || {}, true);
      const entitlement = profile.gateway.catalog === 'quota' ? await retrieveEntitlement() : null;
      const result = { available: true, apiUsable: response.status === 200 && !entitlement?.unlicensed, apiStatus: entitlement?.unlicensed ? entitlement.status : response.status,
        source: 'oauth', tier: state.tier || (profile.gateway.catalog === 'picker' ? 'antigravity' : 'unknown'), paidTier: state.paidTier || null, gcpProject: project() || null,
        ...(entitlement ? { entitledModels: entitlement.models } : {}) };
      if (entitlement?.unlicensed) Object.assign(result, { unlicensed: true, deprecated: !project() || undefined, hint: !project() ? consumerHint : `Google Cloud project "${project()}" has no Gemini Code Assist license. Assign a license to this account or switch to API key mode.` });
      return cachedHealth(result);
    } catch (error) {
      const status = error.response?.status, deprecated = profile.gateway.catalog === 'quota' && !apiKey() && !project() && (status === 403 || error.response?.data?.error?.status === 'PERMISSION_DENIED');
      return cachedHealth({ available: true, apiUsable: false, apiStatus: status || null, ...(profile.gateway.catalog === 'quota' ? { deprecated: deprecated || undefined } : {}),
        hint: deprecated ? consumerHint : status === 401 ? 'Token expired or revoked' : status === 403 && profile.gateway.catalog === 'picker' ? 'Access denied — your Google account may not have Antigravity access, or the account was restricted.' : `API error: ${error.message}` });
    }
  }
  async function fetchAvailableModels(suppliedClient) {
    const client = suppliedClient || getOAuth2Client(); if (!client) return [];
    const projectId = await ensureOnboarded(client);
    try {
      const response = await requestGateway(client, 'fetchAvailableModels', projectId ? { project: projectId } : {}, 'catalog');
      const selected = selectChatModels(response.data), fractions = quotaFractions(selected);
      if (fractions.length && Math.max(...fractions) <= profile.gateway.softQuotaFloor) tripCooldown('quota floor');
      return selected;
    } catch (error) { const status = error.response?.status; if (status === 403 || status === 429) tripCooldown(`fetchAvailableModels HTTP ${status}`); console.warn(`[connection:${id}] Catalog failed: ${error.message}`); return []; }
  }
  connection = {
    describeCredential, getCredentialsPath: () => profile.ownedStore ? store.getCredentialPath(id) : credentialPath(), getAuthPath: credentialPath,
    getAccessToken: profile.format === 'nested-snake' ? () => tokenSync() : tokenAsync, getAccessTokenSync: () => tokenSync(),
    getOAuthToken: () => tokenSync(true), getRefreshToken: () => readCredential()?.refreshToken || null,
    ensureValidToken: () => tokenAsync(), ensureValidOAuthToken: () => tokenAsync({ oauthOnly: true }), getChatGptAccountId,
    getTokenExpiry, isTokenExpiringSoon, refreshAccessToken, checkApiUsable, logout,
    startOAuth, parseCodeState, exchangeCode: (sessionId, code, suppliedState) => exchangeSession(state.sessions.get(sessionId), code, suppliedState, profile.redirectUri),
    getSessionStatus: sessionId => { const session = state.sessions.get(sessionId); return session && clock() <= session.expiresAt ? { status: session.status, error: session.error } : { status: 'expired', error: 'Session not found or expired' }; },
    startDeviceAuth, getDeviceSessionStatus, saveManualToken,
    saveManualApiKey: value => writeEnvironmentField('GEMINI_API_KEY', value), isUsingApiKey: () => !!apiKey(),
    saveGcpProject: value => writeEnvironmentField('GOOGLE_CLOUD_PROJECT', value),
    getOAuth2Client, ensureOnboarded, fetchAvailableModels, hasPaidTier: () => !!state.paidTier || !!state.tier && state.tier !== 'free-tier',
    isCoolingDown, cooldownMsLeft, tripCooldown,
  };
  return connection;
}

export function getConnection(id) {
  if (id === 'codex') id = 'openai-codex';
  if (!legacyInstances.has(id)) legacyInstances.set(id, createManagedConnection(id));
  return legacyInstances.get(id);
}

async function buildGatewayHeaders(id, purpose) {
  const gateway = connectionProfiles[id]?.gateway;
  if (!gateway) throw new Error(`Connection ${id} has no gateway capability`);
  if (!gateway.browserIdentity) return purpose === 'catalog' ? { 'User-Agent': `GeminiCLI/${await getClientVersion(id)} (${process.platform}; ${process.arch}; terminal)` } : {};
  const metadata = { 'Client-Metadata': JSON.stringify(gateway.clientMetadata) };
  if (purpose === 'control') return { 'User-Agent': 'google-api-nodejs-client/9.15.1', ...metadata };
  const version = await getClientVersion(id);
  return { 'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${version} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
    ...(purpose === 'inference' ? { 'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1' } : {}), ...metadata };
}




export function selectChatModels(payload) {
  const models = payload?.models || {};
  const deprecated = new Set(Object.keys(payload?.deprecatedModelIds || {}));
  const tabOnly = new Set(payload?.tabModelIds || []);

  const orderedIds = [];
  const add = (id) => {
    if (typeof id === 'string' && id && !orderedIds.includes(id)) orderedIds.push(id);
  };
  for (const sort of payload?.agentModelSorts || []) {
    for (const group of sort?.groups || []) {
      for (const id of group?.modelIds || []) add(id);
    }
  }
  for (const ids of Object.values(payload?.tieredModelIds || {})) {
    for (const id of Array.isArray(ids) ? ids : []) add(id);
  }

  return orderedIds
    .filter((id) => {
      const model = models[id];
      return model
        && !deprecated.has(id)
        && !tabOnly.has(id)
        && model.isInternal !== true
        && model.quotaInfo?.isExhausted !== true;
    })
    .map((id) => {
      const model = models[id];
      return {
        id,
        name: model.displayName || humanizeModelId(id),
        maxTokens: model.maxTokens ?? null,
        maxOutputTokens: model.maxOutputTokens ?? null,
        supportsImages: model.supportsImages ?? false,
        supportsThinking: model.supportsThinking ?? false,
        quotaRemaining: model.quotaInfo?.remainingFraction ?? null,
        quotaResetTime: model.quotaInfo?.resetTime ?? null,
      };
    });
}


export function quotaFractions(selectedModels) {
  return (selectedModels || [])
    .map((m) => m.quotaRemaining)
    .filter((f) => typeof f === 'number' && Number.isFinite(f));
}


export function modelMetadataRecords(selectedModels) {
  return (selectedModels || []).map((m) => ({
    id: m.id,
    contextWindow: m.maxTokens ?? undefined,
    maxOutputLength: m.maxOutputTokens ?? undefined,
    supportsVision: m.supportsImages,
    reasoning: m.supportsThinking,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  }));
}


export function parseQuotaModels(payload) {
  const ids = [];
  for (const bucket of payload?.buckets || []) {
    const id = typeof bucket?.modelId === 'string' ? bucket.modelId.trim().replace(/^models\//, '') : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}


export function classifyGatewayError(error) {
  const status = error?.response?.status ?? null;
  const body = error?.response?.data?.error || {};
  const message = String(body.message || error?.message || '');
  const unlicensed = status === 403
    && (/valid license/i.test(message) || /#3501/.test(message) || body.status === 'PERMISSION_DENIED');
  return { status, unlicensed, message: message.slice(0, 300) };
}


export function humanizeModelId(id) {
  return String(id || '')
    .replace(/-tiered$/, '')
    .split('-')
    .filter(Boolean)
    .map((word) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}




// ── Constants ───────────────────────────────────────────────────────────
const HASH_SEED   = 0x6E52736AC806831En;   // xxHash64 seed (BigInt)
const SIG_SALT    = '59cf53e54c78';         // signature salt
const SIG_INDICES = [4, 7, 20];             // character pick indices
const ENTRYPOINT  = 'cli';


function currentVersion() {
  return getCachedClientVersion('claude-code');
}

// ── Lazy-loaded xxhash instance ─────────────────────────────────────────
let _xxhash = null;

async function getXxhash() {
  if (!_xxhash) {
    _xxhash = await xxhashWasm();
  }
  return _xxhash;
}

// ── Public API ──────────────────────────────────────────────────────────


export function computeSignatureSuffix(firstUserMessage = '', version = currentVersion()) {
  const chars = SIG_INDICES
    .map(i => (i < firstUserMessage.length ? firstUserMessage[i] : '0'))
    .join('');
  const raw = `${SIG_SALT}${chars}${version}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 3);
}


export function buildSigningText(versionSuffix, version = currentVersion()) {
  return `x-anthropic-billing-header: cc_version=${version}.${versionSuffix}; cc_entrypoint=${ENTRYPOINT}; cch=00000;`;
}


export function buildSigningBlock(firstUserMessage = '') {
  // Resolve ONCE and thread it through both calls. The suffix is a hash OVER
  // the version, so reading it twice could pair a suffix with a different
  // version if a background cache refresh landed in between.
  const version = currentVersion();
  const suffix = computeSignatureSuffix(firstUserMessage, version);
  return {
    type: 'text',
    text: buildSigningText(suffix, version),
  };
}


export async function computeSignatureHash(serializedBody) {
  const xxhash = await getXxhash();
  const buf = new TextEncoder().encode(serializedBody);
  // h64Raw returns a BigInt
  const hash = xxhash.h64Raw(buf, HASH_SEED);
  return (hash & 0xFFFFFn).toString(16).padStart(5, '0');
}


export async function applySignatureHash(serializedBody) {
  const hash = await computeSignatureHash(serializedBody);
  return serializedBody.replace('cch=00000', `cch=${hash}`);
}

const STREAM_ERROR_STATUS = Object.freeze({
  overloaded_error: 529,
  rate_limit_error: 429,
});


export class StreamError extends Error {
  constructor(payload, headers) {
    const upstream = payload?.error || {};
    const type = upstream.type || 'stream_error';
    const requestId = payload?.request_id || headers?.get?.('request-id') || null;
    const status = STREAM_ERROR_STATUS[type];
    const message = upstream.message || 'Streaming request failed';
    super(`${status ? `${status} ` : ''}${type}: ${message}${requestId ? ` (request_id: ${requestId})` : ''}`);
    this.name = 'StreamError';
    this.status = status;
    this.type = type;
    this.requestId = requestId;
    this.error = upstream;
    this.headers = headers;
  }
}

function parseStreamErrorFrame(frame) {
  let event = '';
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (event !== 'error' || data.length === 0) return null;
  try {
    return JSON.parse(data.join('\n'));
  } catch {
    return { error: { type: 'stream_error', message: data.join('\n') } };
  }
}


function preserveStreamErrors(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!response?.body || !contentType.includes('text/event-stream')) return response;

  const source = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';

  let pumping = false;
  const stream = new ReadableStream({
    async pull(controller) {
      if (pumping) return;
      pumping = true;
      try {
        while (true) {
          const separator = pending.match(/\r?\n\r?\n/);
          if (separator) {
            const end = separator.index + separator[0].length;
            const frame = pending.slice(0, separator.index);
            const encodedFrame = pending.slice(0, end);
            pending = pending.slice(end);
            const payload = parseStreamErrorFrame(frame);
            if (payload) {
              await source.cancel().catch(() => {});
              controller.error(new StreamError(payload, response.headers));
              return;
            }
            controller.enqueue(encoder.encode(encodedFrame));
            return;
          }

          const { value, done } = await source.read();
          if (!done) {
            pending += decoder.decode(value, { stream: true });
            continue;
          }

          pending += decoder.decode();
          if (pending) {
            const payload = parseStreamErrorFrame(pending);
            if (payload) {
              controller.error(new StreamError(payload, response.headers));
              return;
            }
            controller.enqueue(encoder.encode(pending));
            pending = '';
            return;
          }
          controller.close();
          return;
        }
      } finally {
        pumping = false;
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}


export function createRequestFetch(baseFetch) {
  const _fetch = baseFetch || globalThis.fetch;

  return async function signingFetch(url, init) {
    // Only intercept messages calls that carry the placeholder
    if (typeof url === 'string' && url.includes('/v1/messages') && init?.body) {
      let body = typeof init.body === 'string' ? init.body : init.body.toString();

      if (body.includes('cch=00000')) {
        body = await applySignatureHash(body);
        init = { ...init, body };
      }
    }

    const response = await _fetch(url, init);
    return preserveStreamErrors(response);
  };
}


export function extractFirstUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        const textBlock = msg.content.find(b => b.type === 'text');
        if (textBlock) return textBlock.text || '';
      }
      return '';
    }
  }
  return '';
}


/** One gateway adapter, parameterized by the connection's wire contract. */
export function createGatewayClient(id, authClient, projectId) {
  const profile = connectionProfiles[id], gateway = profile?.gateway;
  if (!gateway) throw new Error(`Connection ${id} has no gateway capability`);
  function requestBody(params) {
    const inner = { contents: params.contents }, config = params.config;
    if (config) {
      if (config.systemInstruction) inner.systemInstruction = config.systemInstruction;
      for (const key of ['temperature', 'maxOutputTokens', 'topP', 'topK']) if (config[key] != null) (inner.generationConfig ||= {})[key] = config[key];
      for (const key of ['thinkingConfig', 'responseMimeType']) if (config[key]) (inner.generationConfig ||= {})[key] = config[key];
      for (const key of ['tools', 'toolConfig']) if (config[key]) inner[key] = config[key];
    }
    return { model: params.model.replace(/^models\//, ''), project: projectId, request: inner, ...gateway.requestFields };
  }
  function responseBody(data) {
    const response = data?.response || data;
    response.text = response.candidates?.[0]?.content?.parts?.filter(part => part.text != null).map(part => part.text).join('') || '';
    response.functionCalls = response.candidates?.[0]?.content?.parts?.filter(part => part.functionCall).map(part => part.functionCall) || undefined;
    return response;
  }
  async function* streamResponses(source) {
    // Preserve the gateway's historical event semantics, including its EOF
    // flush and recoverable malformed frames, while bounding partial buffers.
    const decoder = new TextDecoder(); let pending = '', frame = '';
    const parse = content => {
      if (!content.trim() || content.trim() === '[DONE]') return null;
      try { const result = responseBody(JSON.parse(content)); if (result.functionCalls?.length === 0) result.functionCalls = undefined; return result; }
      catch (error) { console.warn(`[connection:${id}] SSE parse error: ${error.message}`); return null; }
    };
    try {
      for await (const chunk of source) {
        pending += decoder.decode(chunk instanceof Buffer ? chunk : new Uint8Array(chunk), { stream: true });
        const lines = pending.split('\n'); pending = lines.pop() || '';
        for (const line of lines) {
          const text = line.replace(/\r$/, '');
          if (text.startsWith('data: ')) frame += text.slice(6);
          else if (text === '' && frame) { const event = parse(frame); frame = ''; if (event) yield event; }
          if (Buffer.byteLength(frame, 'utf8') > 16 * 1024 * 1024) throw new Error('Gateway event exceeded buffer limit');
        }
        if (Buffer.byteLength(pending, 'utf8') > 16 * 1024 * 1024) throw new Error('Gateway event exceeded buffer limit');
      }
      if (frame.trim()) { const event = parse(frame); if (event) yield event; }
    } finally { if (!source.readableEnded) source.destroy?.(); }
  }
  async function generate(params, streaming) {
    const operation = streaming ? 'streamGenerateContent' : 'generateContent';
    const headers = await buildGatewayHeaders(id, 'inference');
    try {
      const response = await authClient.request({ url: `${gateway.modelBase}:${operation}${streaming ? '?alt=sse' : ''}`, method: 'POST', data: requestBody(params),
        ...(Object.keys(headers).length ? { headers } : {}), ...(streaming ? { responseType: 'stream' } : {}) });
      return streaming ? streamResponses(response.data) : responseBody(response.data);
    } catch (error) {
      if (gateway.cooldownMs) {
        const status = error.response?.status;
        if (status === 403 || status === 429) getConnection(id).tripCooldown(`${operation} HTTP ${status}`);
        const message = formatGatewayError(error, profile.name);
        if (message) throw new Error(message);
      }
      throw error;
    }
  }
  return { models: { generateContent: params => generate(params, false), generateContentStream: params => generate(params, true) } };
}

function formatGatewayError(error, name) {
  const status = error.response?.status;
  const upstream = error.response?.data?.error || error.response?.data?.[0]?.error;
  const reason = upstream?.status || upstream?.details?.find?.(detail => detail.reason)?.reason;
  const model = upstream?.details?.find?.(detail => detail.metadata?.model)?.metadata?.model;
  if (status === 429 || reason === 'QUOTA_EXHAUSTED' || reason === 'RESOURCE_EXHAUSTED') {
    const delay = upstream?.details?.find?.(detail => detail.metadata?.quotaResetDelay)?.metadata?.quotaResetDelay || upstream?.details?.find?.(detail => detail.retryDelay)?.retryDelay;
    let when = '';
    if (delay) {
      const text = String(delay), compound = text.match(/(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/);
      const seconds = compound && (compound[1] || compound[2] || compound[3]) && /[hm]/.test(text)
        ? parseInt(compound[1] || 0, 10) * 3600 + parseInt(compound[2] || 0, 10) * 60 + Math.floor(parseFloat(compound[3] || 0))
        : Math.round(parseFloat(text.replace(/s$/, '')));
      if (Number.isFinite(seconds) && seconds > 0) {
        const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), days = Math.floor(hours / 24);
        when = days > 0 ? ` Resets in ${days}d ${hours % 24}h.` : hours > 0 ? ` Resets in ${hours}h ${minutes}m.` : ` Resets in ${minutes}m.`;
      }
    }
    return `${name} quota reached${model ? ` for ${model}` : ''}.${when} Try another model or your API-key provider meanwhile.`;
  }
  if (status === 403 || reason === 'PERMISSION_DENIED') return `${name} access was denied. Your Google account may not have access, or usage was restricted.`;
  if (status === 401) return `${name} authentication expired. Please reconnect your Google account.`;
  if (status === 400) return `${name} rejected the request (400). This model may not be available on your plan.`;
  return upstream?.message ? `${name}: ${upstream.message}` : null;
}

export const CATALOG_CONNECTIONS = Object.freeze(['antigravity', 'gemini-cli']);
export async function listConnectionModels(id, { forceRefresh = false } = {}) {
  const profile = connectionProfiles[id];
  if (!profile?.gateway) return null;
  const connection = getConnection(id);
  if (connection.isUsingApiKey()) return null;
  const status = await connection.checkApiUsable({ forceRefresh });
  if (!status.available) return { status: 400, body: { success: false, error: `${profile.name} is not connected. Use Google OAuth${profile.apiKeyFile ? ' or paste an API key' : ''} to connect.` } };
  if (status.coolingDown) return { status: 429, body: { success: false, coolingDown: true, retryAfterMs: status.retryAfterMs, error: status.hint } };
  if (status.unlicensed || status.deprecated) return { status: 400, body: { success: false, error: status.hint, deprecated: !!status.deprecated, unlicensed: !!status.unlicensed } };
  const [{ getProviderConfig, registerDynamicPricingFromModels }, { persistLastModels }, { LISTING_SOURCE, listing, provenanceFields }] = await Promise.all([
    import('./providerConfigs.js'), import('./lastModelsCache.js'), import('./modelListing.js'),
  ]);
  let models, dynamic = false;
  if (profile.gateway.catalog === 'picker') {
    if (!await connection.getAccessToken()) return { status: 400, body: { success: false, error: `${profile.name} token not found.` } };
    const client = connection.getOAuth2Client(), live = client ? await connection.fetchAvailableModels(client) : [];
    if (live.length) {
      registerDynamicPricingFromModels(id, modelMetadataRecords(live));
      persistLastModels(id, live.map(model => ({ id: model.id, name: model.name })));
      models = live.map(model => model.id); dynamic = true;
    }
  } else if (status.entitledModels?.length) {
    models = [...status.entitledModels]; dynamic = true; persistLastModels(id, models.map(model => ({ id: model, name: model })));
  }
  const reason = profile.gateway.catalog === 'picker' ? 'Google did not return the Antigravity model catalog' : 'Google did not return the Gemini CLI entitlement list';
  if (!dynamic) {
    models = [...(getProviderConfig(id)?.fallbackModels || [])];
    if (profile.gateway.upgradeTier && connection.hasPaidTier() && !models.includes('gemini-3.1-pro-preview')) models.unshift('gemini-3.1-pro-preview');
    console.warn(`[connection:${id}] Live catalog unavailable; serving the static fallback list`);
  }
  return { status: 200, body: { success: true, models, cached: false, count: models.length, dynamic,
    ...provenanceFields(dynamic ? listing(LISTING_SOURCE.LIVE, { fetchedAt: Date.now() }) : listing(LISTING_SOURCE.FALLBACK, { error: reason })) } };
}

export const VOICE_CREDENTIAL_SOURCE = Object.freeze({ PLATFORM: 'openai', CHATGPT: 'openai-codex' });
export async function resolveVoiceCredentials(userId, dependencies = {}) {
  const connection = dependencies.connection || getConnection('openai-codex');
  const isDisconnected = dependencies.isLocalProviderDisconnected || isLocalProviderDisconnected;
  const codexDisconnected = userId ? await isDisconnected(userId, 'openai-codex') : false;
  const candidates = [], seen = new Set();
  const add = candidate => { if (!seen.has(candidate.token)) { seen.add(candidate.token); candidates.push(candidate); } };
  // Resolve once: callers retain this snapshot for their fallback attempt.
  try {
    const token = codexDisconnected ? '' : tokenText(await connection.ensureValidOAuthToken());
    if (token) {
      let accountId = null;
      try { accountId = connection.getChatGptAccountId() || null; } catch { /* Optional claim. */ }
      add(token.startsWith('sk-') ? { token, source: VOICE_CREDENTIAL_SOURCE.PLATFORM, accountId: null } : { token, source: VOICE_CREDENTIAL_SOURCE.CHATGPT, accountId });
    }
  } catch { /* Discovery is optional; the platform candidate remains usable. */ }
  try {
    const manager = dependencies.authManager || (await import('../auth/AuthManager.js')).default;
    const token = tokenText(await manager.getValidAccessToken(userId, 'openai'));
    if (token) add({ token, source: VOICE_CREDENTIAL_SOURCE.PLATFORM, accountId: null });
  } catch { /* Unavailable vaults do not make a capability probe fatal. */ }
  return candidates;
}
export async function resolveVoiceCredential(userId) { return (await resolveVoiceCredentials(userId))[0] ?? null; }
export async function hasVoiceCredential(userId) { return (await resolveVoiceCredentials(userId)).length > 0; }
export function isBorrowedCredential(source) { return source === VOICE_CREDENTIAL_SOURCE.CHATGPT; }

export function describeConnectionError(error) {
  if (!error || typeof error !== 'object') return { summary: String(error) };
  const out = {
    status: error.status ?? error.response?.status ?? null,
    code: error.code ?? null,
    message: error.message ?? null,
  };
  if (error.error !== undefined) out.error = error.error;
  if (error.body !== undefined) out.body = error.body;
  if (error.response?.data !== undefined) out.responseData = error.response.data;
  if (error.headers) {
    const interesting = ['x-request-id', 'x-codex-request-id', 'cf-ray', 'content-type', 'retry-after'];
    out.headers = {};
    for (const h of interesting) {
      const v = typeof error.headers.get === 'function' ? error.headers.get(h) : error.headers[h];
      if (v) out.headers[h] = v;
    }
    if (Object.keys(out.headers).length === 0) delete out.headers;
  }
  return out;
}

export function buildConnectionErrorGuidance(error, model) {
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || '').toLowerCase();

  if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('forbidden')) {
    return `This model (${model}) uses the Codex Responses API. The Codex OAuth authorization was rejected; reconnect your OAuth account or try a different model.`;
  }

  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 529 ||
    message.includes('overloaded') ||
    message.includes('temporarily unavailable')
  ) {
    return `This model (${model}) uses the Codex Responses API. The upstream Codex service is rate-limited, overloaded, or temporarily unavailable; retry later or try a different model.`;
  }

  if (status === 400) {
    return `This model (${model}) uses the Codex Responses API. The request could not be accepted; try a different model or reduce the active tool/context surface.`;
  }

  return `This model (${model}) uses the Codex Responses API. Try again or switch models; reconnect OAuth only if provider status shows the Codex connection is expired.`;
}


/** Connection-specific Responses semantics; public API adapters keep their own policy. */
export function getResponsePolicy(id) {
  if (id !== 'openai-codex') return null;
  return Object.freeze({ provider: id, promptCachePolicy: null, maxRetries: 5, maxContextShrinkRetries: 8, strict: null });
}
export function getConnectionAffinity(id, conversationId) {
  if (id !== 'openai-codex' || !conversationId) return null;
  const value = `agnt-${conversationId}`.slice(0, 256);
  return { body: { prompt_cache_key: value }, headers: { session_id: value } };
}
export function buildRequestHeaders(id, { purpose = 'inference', token, accountId } = {}) {
  if (id !== 'openai-codex') throw new Error(`Unsupported header profile: ${id}`);
  const headers = purpose === 'inference' ? { 'OpenAI-Beta': 'responses=experimental', originator: 'codex_cli_rs' } : { Authorization: `Bearer ${token}`, originator: 'codex_cli_rs' };
  if (accountId) headers[purpose === 'inference' ? 'chatgpt-account-id' : 'ChatGPT-Account-ID'] = accountId;
  return headers;
}
export async function createConnectionFetch(id, baseFetch = globalThis.fetch) {
  if (id === 'claude-code') {
    const signedFetch = createRequestFetch(baseFetch);
    return async (url, init) => {
      const token = await getConnection(id).getAccessToken();
      if (token) { const headers = new Headers(init?.headers || {}); headers.set('Authorization', `Bearer ${token}`); init = { ...init, headers }; }
      return signedFetch(url, init);
    };
  }
  if (id === 'openai-codex') {
    const version = await getClientVersion(id);
    return (url, init) => { const target = new URL(url); if (!target.searchParams.has('client_version')) target.searchParams.set('client_version', version); return baseFetch(target.toString(), init); };
  }
  throw new Error(`Unsupported fetch profile: ${id}`);
}
