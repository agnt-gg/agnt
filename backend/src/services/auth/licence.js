/**
 * The signed licence, verified HERE, by the backend.
 *
 * api.agnt.gg signs a licence with its Ed25519 private key
 * (LicenseController.generateLicense). Until this module the only check was
 * in the frontend, and that one never ran: it called a preload bridge that
 * does not exist and fell through to `return true`. So nothing on the desktop
 * knew the plan with any authority. This is that authority.
 *
 * What the signature covers, exactly: the server signs
 * `JSON.stringify(license, Object.keys(license).sort())`. A replacer ARRAY
 * filters keys at every depth, so nested objects (`features`, `rateLimits`)
 * serialise without their contents. Only the top-level fields are signed:
 * userId, email, planType, planStatus, planName, issuedAt, expiresAt,
 * refreshBefore, machineId, minAppVersion, licenseVersion. This module trusts
 * those and nothing else. A plan's features are derived from `planType`.
 *
 * Two halves:
 *   - verifySignedLicence: pure, offline. Any process can run it.
 *   - fetch/cache: the main backend asks /license/validate with the user's
 *     session token and keeps the signed answer on disk. The workflow process
 *     reads that file and verifies it itself; a file it cannot verify is
 *     worth nothing, so the cache needs no protection of its own.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import pathManager from '../../utils/PathManager.js';
import { getSessionToken } from './sessionTokenCache.js';

/** Same key as frontend/src/services/LicenseValidator.js and GET /license/public-key. */
export const LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+1T5wZnQ9vQhD/Sd9g+Cio5lQRFffehBpoAJhDhE+yM=
-----END PUBLIC KEY-----`;

export const PAID_PLANS = Object.freeze(new Set(['personal', 'always_on', 'business', 'enterprise']));
const CLOCK_SKEW_S = 300;
const FETCH_TIMEOUT_MS = 6000;
/** Ask the server again this often even while the cached licence is valid. */
const REFETCH_AFTER_MS = 6 * 60 * 60 * 1000;

let publicKey = null;
const keyObject = () => (publicKey ||= crypto.createPublicKey(LICENCE_PUBLIC_KEY));

/** Exactly what the server signs. */
export function licenceSigningInput(license) {
  return JSON.stringify(license, Object.keys(license).sort());
}

/**
 * @param {{license: object, signature: string}} signed
 * @param {{userId?: string, now?: number, key?: crypto.KeyObject}} [options]
 * @returns {{valid: true, planType: string, paid: boolean, userId: string, expiresAt: number, refreshBefore: number} | {valid: false, reason: string}}
 */
export function verifySignedLicence(signed, { userId, now = Date.now(), key } = {}) {
  const license = signed?.license;
  const signature = signed?.signature;
  if (!license || typeof license !== 'object' || typeof signature !== 'string') return { valid: false, reason: 'missing' };
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(licenceSigningInput(license)), key || keyObject(), Buffer.from(signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'bad_signature' };
  const nowS = Math.floor(now / 1000);
  if (!Number.isFinite(license.expiresAt) || license.expiresAt + CLOCK_SKEW_S < nowS) return { valid: false, reason: 'expired' };
  // A licence is someone's: a paid licence copied onto another account proves nothing.
  if (userId && String(license.userId) !== String(userId)) return { valid: false, reason: 'other_user' };
  const planType = license.planStatus === 'active' ? String(license.planType || 'free') : 'free';
  return { valid: true, planType, paid: PAID_PLANS.has(planType), userId: String(license.userId), expiresAt: license.expiresAt, refreshBefore: license.refreshBefore };
}

// ── cache ────────────────────────────────────────────────────────────────────

function cacheFile(userId) {
  const name = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32);
  return pathManager.getDataPath('licences', `${name}.json`);
}

export function readCachedLicence(userId) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(userId), 'utf8'));
  } catch {
    return null;
  }
}

function writeCachedLicence(userId, signed) {
  const file = cacheFile(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...signed, fetchedAt: Date.now() }));
  fs.renameSync(temp, file);
}

/**
 * Ask api.agnt.gg for a fresh signed licence and keep it. Never throws.
 * `token`: the requesting user's own bearer token. Without it the session
 * cache is used, which only holds tokens that came through authenticateToken;
 * a route behind another guard (pairing) would otherwise find none and deny a
 * paying user. The server issues the licence for the token's own user, and
 * the binding to `userId` is checked on the signed result either way.
 */
export async function fetchLicence(userId, { appVersion = process.env.npm_package_version, token: explicitToken } = {}) {
  const remote = String(process.env.REMOTE_URL || 'https://api.agnt.gg').replace(/\/+$/, '');
  const token = explicitToken || getSessionToken(userId);
  if (!token) return null;
  try {
    const { data } = await axios.post(`${remote}/license/validate`, { appVersion: appVersion || null }, { headers: { Authorization: `Bearer ${token}` }, timeout: FETCH_TIMEOUT_MS });
    const verdict = verifySignedLicence(data, { userId });
    if (!verdict.valid) {
      console.warn(`[licence] server answer did not verify (${verdict.reason}); keeping the previous licence`);
      return null;
    }
    writeCachedLicence(userId, data);
    return verdict;
  } catch (error) {
    console.warn('[licence] could not fetch a licence:', error.message);
    return null;
  }
}

const inFlight = new Map();

/**
 * The plan a VERIFIED licence proves for this user, or null when none does.
 *
 * null never means paid. Callers that sell something deny on null.
 *
 * @param {string} userId
 * @param {{ network?: boolean }} [options] network: false reads only the
 *   cached file (the workflow process has no session to fetch with).
 */
/**
 * A hosted instance's plan, set by the fleet when it created the container,
 * or '' on a desktop. On a hosted instance this IS everyone's plan: a member
 * of a Business team works under the team's plan, not their own.
 */
export function hostedPlan() {
  return process.env.AGNT_TENANT_SLUG ? String(process.env.AGNT_TENANT_PLAN || '').trim() : '';
}

export async function verifiedPlan(userId, { network = true, token } = {}) {
  if (!userId) return null;
  const tenantPlan = hostedPlan();
  if (tenantPlan) return tenantPlan;

  const cached = readCachedLicence(userId);
  const verdict = cached ? verifySignedLicence(cached, { userId }) : { valid: false };
  const stale = !cached || !verdict.valid || Date.now() - (cached.fetchedAt || 0) > REFETCH_AFTER_MS
    || (verdict.refreshBefore && Date.now() / 1000 >= verdict.refreshBefore);
  if (network && stale) {
    if (!inFlight.has(userId)) inFlight.set(userId, fetchLicence(userId, { token }).finally(() => inFlight.delete(userId)));
    const fresh = await inFlight.get(userId);
    if (fresh?.valid) return fresh.planType;
  }
  return verdict.valid ? verdict.planType : null;
}

export async function hasPaidLicence(userId, options) {
  return PAID_PLANS.has(await verifiedPlan(userId, options));
}
