import { AsyncLocalStorage } from 'node:async_hooks';
import jwt from 'jsonwebtoken';
import { resolveSecret } from '../../utils/secretResolver.js';

const execution = new AsyncLocalStorage();
const PREFIX = 'agnt-tool.';
export const TOOL_TOKEN_TTL_SECONDS = 300;
export const hostedToolBoundaryRequired = () => process.platform === 'linux' && !!process.env.AGNT_TENANT_SLUG;
export const currentToolActor = () => execution.getStore()?.userId;
export const currentToolAuthorization = () => execution.getStore()?.authorization || null;
export const withToolActor = (userId, operation, authorization = null) => execution.run({ userId, authorization }, operation);

// These are instance-local, read-only APIs needed by code tools. No credentials,
// account/session administration, arbitrary SQL, file proxy or tool recursion.
const READ_PATHS = [
  /^\/api\/health\/?$/,
  /^\/api\/agents\/?$/,
  /^\/api\/workflows\/?$/,
  /^\/api\/agnt-services\/(entitlements|usage)\/?$/,
];
export function toolRequestPermitted(method, url) {
  if (method !== 'GET') return false;
  const pathname = String(url).split('?')[0];
  if (/%|\\|\.\./.test(pathname)) return false;
  return READ_PATHS.some((pattern) => pattern.test(pathname));
}
const audience = () => 'agnt-tool:' + process.env.AGNT_TENANT_SLUG;
const signingKey = () => resolveSecret('JWT_SECRET', { bytes: 64, onPersistFailure: 'throw' });
export function issueToolToken(userId, { key = signingKey(), now = Math.floor(Date.now() / 1000) } = {}) {
  if (!userId || typeof userId !== 'string') return null;
  return PREFIX + jwt.sign({ sub: userId, purpose: 'tool-run', scope: 'instance-read', iat: now, exp: now + TOOL_TOKEN_TTL_SECONDS }, key, {
    algorithm: 'HS256', audience: audience(), issuer: 'agnt-tool-execution',
  });
}
export function isToolToken(token) { return typeof token === 'string' && token.startsWith(PREFIX); }
export function verifyToolToken(token, { key = signingKey(), now = Math.floor(Date.now() / 1000) } = {}) {
  if (!isToolToken(token)) throw new Error('Not a tool token');
  const claims = jwt.verify(token.slice(PREFIX.length), key, { algorithms: ['HS256'], audience: audience(), issuer: 'agnt-tool-execution', clockTimestamp: now });
  if (claims.purpose !== 'tool-run' || claims.scope !== 'instance-read' || typeof claims.sub !== 'string' || claims.exp - claims.iat > TOOL_TOKEN_TTL_SECONDS) throw new Error('Invalid tool token scope');
  return claims;
}
