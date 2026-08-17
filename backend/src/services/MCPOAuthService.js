/**
 * MCPOAuthService
 * ---------------
 * OAuth 2.1 for remote MCP servers, per the MCP authorization spec
 * (revision 2025-06-18). Lets AGNT connect to any OAuth-protected MCP server
 * — Upwork, Linear, Notion, Sentry, Atlassian — with no pre-registered API
 * key and no manual client setup, because the whole handshake is discovered
 * and registered at runtime:
 *
 *   1. RFC 9728  protected-resource metadata  -> which authorization server?
 *   2. RFC 8414  authorization-server metadata -> which endpoints?
 *   3. RFC 7591  dynamic client registration   -> get a client_id
 *   4. RFC 7636  authorization code + PKCE S256
 *   5. RFC 8707  `resource` parameter binds the token to this MCP server
 *
 * WHY TOKENS ARE NOT IN mcp.json
 *   mcp.json is a config file users open, diff, screenshot and paste into
 *   support threads. Refresh tokens are long-lived credentials. They live in
 *   a separate 0600 file so a shared config can never leak an account.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import PathManager from '../utils/PathManager.js';

const TOKEN_FILE = PathManager.getPath('mcp-oauth-tokens.json');
const USER_AGENT = 'AGNT-MCP/1.0';
const PENDING_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

const base64url = (buf) => buf.toString('base64url');

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(options.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

class MCPOAuthService {
  constructor() {
    /** state -> { serverName, verifier, authServer, client, resource, redirectUri, createdAt } */
    this._pending = new Map();
  }

  // ------------------------------------------------------------- storage

  _readAll() {
    try {
      if (!fs.existsSync(TOKEN_FILE)) return {};
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    } catch (err) {
      console.warn('[MCPOAuthService] Token store unreadable, treating as empty:', err.message);
      return {};
    }
  }

  async _writeAll(data) {
    const dir = path.dirname(TOKEN_FILE);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(TOKEN_FILE, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    // mkdir/writeFile mode is a no-op on Windows ACLs but correct on POSIX;
    // chmod explicitly so an existing file created earlier is tightened too.
    try {
      await fsp.chmod(TOKEN_FILE, 0o600);
    } catch {
      /* not supported on this platform */
    }
  }

  /** True when a server has stored credentials. */
  isConnected(serverName) {
    return Boolean(this._readAll()[serverName]?.session?.access_token);
  }

  /** Credential status for the UI. Never returns token material. */
  status(serverName) {
    const entry = this._readAll()[serverName];
    if (!entry) return { connected: false };
    const { session, client, resource } = entry;
    const expiresAt = session.obtained_at && session.expires_in
      ? session.obtained_at + session.expires_in * 1000
      : null;
    return {
      connected: true,
      resource,
      clientId: client?.client_id ?? null,
      scope: session.scope ?? null,
      hasRefreshToken: Boolean(session.refresh_token),
      expiresAt,
      expired: expiresAt ? Date.now() >= expiresAt : false,
    };
  }

  async disconnect(serverName) {
    const all = this._readAll();
    const entry = all[serverName];
    delete all[serverName];
    await this._writeAll(all);

    // Best-effort remote revocation so the token dies server-side too.
    if (entry?.authServer?.revocation_endpoint && entry?.session?.refresh_token) {
      try {
        const body = new URLSearchParams({
          token: entry.session.refresh_token,
          token_type_hint: 'refresh_token',
          client_id: entry.client.client_id,
        });
        if (entry.client.client_secret) body.set('client_secret', entry.client.client_secret);
        await fetch(entry.authServer.revocation_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: body.toString(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        console.warn(`[MCPOAuthService] Remote revocation failed for ${serverName}:`, err.message);
      }
    }
    return { success: true };
  }

  // ----------------------------------------------------------- discovery

  /** Resolve the authorization server protecting an MCP endpoint. */
  async discover(resourceUrl) {
    const url = new URL(resourceUrl);
    const origin = url.origin;

    let protectedResource = null;
    for (const candidate of [
      `${origin}/.well-known/oauth-protected-resource${url.pathname}`,
      `${origin}/.well-known/oauth-protected-resource`,
    ]) {
      try {
        const body = await fetchJson(candidate);
        if (body?.authorization_servers?.length) {
          protectedResource = body;
          break;
        }
      } catch {
        /* try the next well-known location */
      }
    }

    const issuer = protectedResource?.authorization_servers?.[0] ?? origin;

    let authServer = null;
    let lastError = null;
    for (const candidate of [
      `${issuer}/.well-known/oauth-authorization-server`,
      `${issuer}/.well-known/openid-configuration`,
    ]) {
      try {
        const body = await fetchJson(candidate);
        if (body?.authorization_endpoint && body?.token_endpoint) {
          authServer = body;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!authServer) {
      throw new Error(
        `${resourceUrl} is protected but no OAuth metadata was found at ${issuer}` +
        (lastError ? ` (${lastError.message})` : ''),
      );
    }

    return {
      authServer,
      protectedResource,
      resource: protectedResource?.resource ?? resourceUrl,
    };
  }

  /** RFC 7591 dynamic client registration. */
  async registerClient(authServer, { clientName, redirectUri }) {
    if (!authServer.registration_endpoint) {
      throw new Error(
        'This server requires OAuth but does not support dynamic client registration. ' +
        'A client_id must be configured manually.',
      );
    }
    const authMethods = authServer.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
    const tokenEndpointAuthMethod = authMethods.includes('none') ? 'none' : 'client_secret_post';

    const registered = await fetchJson(authServer.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: tokenEndpointAuthMethod,
        application_type: 'native',
      }),
    });

    if (!registered.client_id) {
      throw new Error('Dynamic client registration returned no client_id');
    }
    return { ...registered, token_endpoint_auth_method: tokenEndpointAuthMethod };
  }

  // ------------------------------------------------------- authorization

  /**
   * Step 1 of connecting a server: discover, register, and return the URL the
   * user must open. The PKCE verifier is held in memory only — it never
   * touches disk and dies with the process, which is correct for a one-shot
   * authorization.
   */
  async beginAuthorization({ serverName, endpoint, redirectUri, clientName = 'AGNT' }) {
    const { authServer, resource } = await this.discover(endpoint);
    const client = await this.registerClient(authServer, { clientName, redirectUri });

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(24));

    this._sweepPending();
    this._pending.set(state, {
      serverName, verifier, authServer, client, resource, redirectUri, createdAt: Date.now(),
    });

    const authUrl = new URL(authServer.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('resource', resource);

    return { authorizationUrl: authUrl.toString(), state, clientId: client.client_id };
  }

  /** Step 2: exchange the returned code for tokens and persist them. */
  async completeAuthorization({ state, code }) {
    const pending = this._pending.get(state);
    // Consume before validating: an entry gets exactly one attempt, so a
    // replayed callback cannot retry against the same state.
    this._pending.delete(state);

    if (!pending) {
      // Unknown state means replay, expiry, or CSRF — all reasons to refuse.
      throw new Error('Unknown or expired authorization state. Start the connection again.');
    }
    // Enforce the TTL here rather than relying on the sweep, which only runs
    // when a new authorization begins. Without this an abandoned state stays
    // redeemable for as long as the process lives.
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new Error('Authorization request expired. Start the connection again.');
    }

    const session = await this._token(pending.authServer, pending.client, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      resource: pending.resource,
    });
    session.obtained_at = Date.now();

    const all = this._readAll();
    all[pending.serverName] = {
      resource: pending.resource,
      authServer: pending.authServer,
      client: pending.client,
      session,
    };
    await this._writeAll(all);

    return { success: true, serverName: pending.serverName, ...this.status(pending.serverName) };
  }

  _sweepPending() {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [state, entry] of this._pending) {
      if (entry.createdAt < cutoff) this._pending.delete(state);
    }
  }

  // ------------------------------------------------------------- tokens

  async _token(authServer, client, params) {
    const body = new URLSearchParams(params);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    if (client.token_endpoint_auth_method === 'client_secret_basic' && client.client_secret) {
      headers.Authorization =
        'Basic ' + Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64');
    } else {
      body.set('client_id', client.client_id);
      if (client.client_secret) body.set('client_secret', client.client_secret);
    }

    const json = await fetchJson(authServer.token_endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (json.error) throw new Error(`${json.error}: ${json.error_description ?? ''}`);
    if (!json.access_token) throw new Error('Token response contained no access_token');
    return json;
  }

  /** Refresh in place. Returns true when a new access token was stored. */
  async refresh(serverName) {
    const all = this._readAll();
    const entry = all[serverName];
    if (!entry?.session?.refresh_token) return false;

    try {
      const next = await this._token(entry.authServer, entry.client, {
        grant_type: 'refresh_token',
        refresh_token: entry.session.refresh_token,
        resource: entry.resource,
      });
      // Providers may rotate or omit the refresh token; keep the old one when
      // omitted or the account silently disconnects an hour later.
      entry.session = {
        ...next,
        refresh_token: next.refresh_token ?? entry.session.refresh_token,
        obtained_at: Date.now(),
      };
      all[serverName] = entry;
      await this._writeAll(all);
      return true;
    } catch (err) {
      console.warn(`[MCPOAuthService] Refresh failed for ${serverName}:`, err.message);
      return false;
    }
  }

  /**
   * Current access token, refreshed proactively when close to expiry.
   * Returns null when the server has no stored credentials.
   */
  async getAccessToken(serverName) {
    const entry = this._readAll()[serverName];
    if (!entry?.session?.access_token) return null;

    const { obtained_at: obtainedAt, expires_in: expiresIn } = entry.session;
    const expiringSoon = obtainedAt && expiresIn
      && Date.now() >= obtainedAt + expiresIn * 1000 - REFRESH_SKEW_MS;

    if (expiringSoon) {
      await this.refresh(serverName);
      return this._readAll()[serverName]?.session?.access_token ?? null;
    }
    return entry.session.access_token;
  }

  /**
   * Callbacks a transport needs to authenticate and recover from a 401.
   * Returns null when the server isn't OAuth-connected, so callers can fall
   * through to static-header auth without branching on config shape.
   */
  authProviderFor(serverName) {
    if (!this.isConnected(serverName)) return null;
    return {
      getAuthHeader: async () => {
        const token = await this.getAccessToken(serverName);
        return token ? `Bearer ${token}` : null;
      },
      onUnauthorized: async () => this.refresh(serverName),
    };
  }
}

export default new MCPOAuthService();
export { TOKEN_FILE };
