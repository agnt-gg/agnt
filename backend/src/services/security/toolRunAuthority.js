import { AsyncLocalStorage } from 'node:async_hooks';
import jwt from 'jsonwebtoken';
import { resolveSecret } from '../../utils/secretResolver.js';

const execution = new AsyncLocalStorage();
const PREFIX = 'agnt-tool.';
const SCOPE = 'instance-user';
export const TOOL_TOKEN_TTL_SECONDS = 300;
// A run's proxy key lives as long as the run, and never longer than an hour.
export const TOOL_TOKEN_MAX_TTL_SECONDS = 3600;
export const TOOL_SCOPE_DENIED = 'Tool code cannot call this AGNT API: it mints a lasting credential, changes the security policy, or controls the instance lifecycle.';
export const hostedToolBoundaryRequired = () => process.platform === 'linux' && !!process.env.AGNT_TENANT_SLUG;
export const currentToolActor = () => execution.getStore()?.userId;
export const currentToolAuthorization = () => execution.getStore()?.authorization || null;
export const withToolActor = (userId, operation, authorization = null) => execution.run({ userId, authorization }, operation);

// Tool code drives AGNT through its own API, as its user: that is how Annie and
// plugins work. The proxy key is temporary and only valid on this instance, so
// the only APIs withheld are those that would turn it into a LASTING credential,
// let a run loosen its own guardrails, or stop and destroy the instance.
const DENIED_ANY_METHOD = [
  /^\/api\/auth\/desktop(\/|$)/i, // session handoff
  /^\/api\/users\/sync-token\/?$/i, // stores a session token
  /^\/api\/cluster\/enroll\/?$/i, // mints a long-lived node token
];
const DENIED_WRITES = [
  /^\/api\/users\/security-policy\/?$/i,
  /^\/api\/system(\/|$)/i,
  /^\/api\/tenants(\/|$)/i,
];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const METHODS = new Set([...READ_METHODS, 'POST', 'PUT', 'PATCH', 'DELETE']);

export function toolRequestPermitted(method, url) {
  const verb = String(method || '').toUpperCase();
  if (!METHODS.has(verb)) return false;
  const pathname = String(url || '').split('?')[0];
  // Anything that could make the router see a different path than this check does.
  if (!/^\/api\//i.test(pathname) || /\\|\/\/|%2e|%2f|%5c|\/\.\.?(\/|$)/i.test(pathname)) return false;
  if (DENIED_ANY_METHOD.some((pattern) => pattern.test(pathname))) return false;
  return READ_METHODS.has(verb) || !DENIED_WRITES.some((pattern) => pattern.test(pathname));
}

const audience = () => 'agnt-tool:' + process.env.AGNT_TENANT_SLUG;
const signingKey = () => resolveSecret('JWT_SECRET', { bytes: 64, onPersistFailure: 'throw' });

export function issueToolToken(userId, { key = signingKey(), now = Math.floor(Date.now() / 1000), ttlSeconds = TOOL_TOKEN_TTL_SECONDS } = {}) {
  if (!userId || typeof userId !== 'string') return null;
  const ttl = Math.min(Math.max(Math.ceil(Number(ttlSeconds) || TOOL_TOKEN_TTL_SECONDS), 1), TOOL_TOKEN_MAX_TTL_SECONDS);
  return PREFIX + jwt.sign({ sub: userId, purpose: 'tool-run', scope: SCOPE, iat: now, exp: now + ttl }, key, {
    algorithm: 'HS256', audience: audience(), issuer: 'agnt-tool-execution',
  });
}

export function isToolToken(token) { return typeof token === 'string' && token.startsWith(PREFIX); }

export function verifyToolToken(token, { key = signingKey(), now = Math.floor(Date.now() / 1000) } = {}) {
  if (!isToolToken(token)) throw new Error('Not a tool token');
  const claims = jwt.verify(token.slice(PREFIX.length), key, { algorithms: ['HS256'], audience: audience(), issuer: 'agnt-tool-execution', clockTimestamp: now });
  if (claims.purpose !== 'tool-run' || claims.scope !== SCOPE || typeof claims.sub !== 'string' || claims.exp - claims.iat > TOOL_TOKEN_MAX_TTL_SECONDS) throw new Error('Invalid tool token scope');
  return claims;
}

/** The request identity a valid proxy key stands for, or null. */
export function toolTokenUser(token) {
  try {
    const { sub } = verifyToolToken(token);
    return { isAuthenticated: true, id: sub, userId: sub, auth_type: 'tool-run' };
  } catch {
    return null;
  }
}
