/**
 * secretStore — READ-ONLY access to the operating system's secret store.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every coding CLI eventually moves its session out of a plaintext dotfile and
 * into the OS secret store. That migration is a one-way ratchet, it is never
 * announced, and it breaks AGNT silently: the provider reports "not connected"
 * while the CLI reports "logged in", and no amount of re-running `<cli> login`
 * fixes it because the CLI keeps writing to the store we never read.
 *
 * Claude Code 2.1.x did exactly this (issue #82). Antigravity shipped
 * keychain-native from day one. Assume the rest will follow.
 *
 * CONTRACT — deliberately narrow, so this can never make a working install worse
 * ------------------------------------------------------------------------------
 *   · READ ONLY. We never create, update or delete a secret store item. The
 *     user's CLI owns its own credential; we are a guest with a library card.
 *   · EVERY failure path returns null. Missing binary, non-zero exit, timeout,
 *     empty output, unparseable payload, unsupported platform — all null. A
 *     caller that gets null behaves exactly as it did before this file existed.
 *   · BOUNDED. spawnSync with a hard timeout, so a wedged keychain daemon
 *     degrades to "disconnected" instead of hanging every token read. These
 *     reads sit behind getAccessTokenSync(), which cannot await — sync spawn is
 *     forced, which makes the timeout load-bearing rather than decorative.
 *   · CACHED. A macOS keychain ACL can raise a GUI authorization prompt. An
 *     uncached read means one prompt per token read, i.e. a prompt storm. The
 *     TTL cache turns that into at most one prompt per TTL per item.
 *   · SILENT about values. We log that a lookup happened, never what it found.
 *
 * OPT-OUT: AGNT_DISABLE_SECRET_STORE=1 disables every lookup process-wide, for
 * anyone who would rather AGNT not shell out to their keychain at all.
 *
 * TESTABILITY: platform, env, spawn and clock are all injectable. The macOS and
 * Linux paths are therefore both exercised from the Windows dev box and from a
 * Linux CI runner. Redirecting HOME does NOT relocate the real keychain, so
 * there is no way to integration-test this against a live store in CI — the
 * injected spawn is the only honest option.
 */

import { spawnSync as nodeSpawnSync } from 'child_process';

const LOOKUP_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 32;

/** @type {Map<string, { at: number, value: string | null }>} */
const cache = new Map();

function cacheKey(platform, service, account) {
  return `${platform}\u0000${service}\u0000${account || ''}`;
}

/**
 * `security -w` prints binary payloads as lowercase hex rather than raw bytes.
 * A JSON credential blob stored as binary data therefore arrives unreadable.
 * Decode only when the whole string is plausible hex — a real JSON payload
 * starts with `{` and can never match.
 */
function decodeIfHex(raw) {
  const text = raw.trim();
  if (text.length < 2 || text.length % 2 !== 0) return text;
  if (!/^[0-9a-f]+$/i.test(text)) return text;
  try {
    const decoded = Buffer.from(text, 'hex').toString('utf8');
    return decoded.includes('\uFFFD') ? text : decoded;
  } catch {
    return text;
  }
}

function runLookup(spawnSync, command, args) {
  let result;
  try {
    result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: LOOKUP_TIMEOUT_MS,
      // Never inherit stdio: a prompt on stderr must not pollute AGNT's console.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // ENOENT (binary absent) and EACCES both land here on some platforms.
    return null;
  }

  if (!result || result.error) return null;
  if (result.status !== 0) return null;

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const value = decodeIfHex(stdout);
  return value.length > 0 ? value : null;
}

/**
 * macOS: /usr/bin/security is present on every install and needs no entitlement
 * to read a same-user generic password item.
 *
 * The account-scoped lookup is tried first because it is the precise one, then
 * retried without `-a`. CLIs disagree about whether the account attribute holds
 * the OS username, the signed-in email, or nothing at all, and an item written
 * with a different account than we guessed is still ours to read by service.
 */
function readDarwin(spawnSync, env, service, account) {
  const bin = (env.AGNT_SECURITY_BIN || '').trim() || '/usr/bin/security';

  if (account) {
    const scoped = runLookup(spawnSync, bin, [
      'find-generic-password', '-s', service, '-a', account, '-w',
    ]);
    if (scoped !== null) return scoped;
  }

  return runLookup(spawnSync, bin, ['find-generic-password', '-s', service, '-w']);
}

/**
 * Linux: secret-tool (libsecret) is the closest equivalent, but it is NOT
 * guaranteed installed and a headless box often has no keyring daemon at all.
 * Absent binary → null → caller falls through to whatever it did before.
 */
function readLinux(spawnSync, env, service, account) {
  const bin = (env.AGNT_SECRET_TOOL_BIN || '').trim() || 'secret-tool';

  const args = ['lookup', 'service', service];
  if (account) args.push('account', account);

  return runLookup(spawnSync, bin, args);
}

/**
 * Read one secret from the OS store.
 *
 * @param {object} options
 * @param {string} options.service   Service name of the generic-password item.
 * @param {string} [options.account] Account attribute, when known.
 * @param {string} [options.platform] Override for tests. Defaults to process.platform.
 * @param {object} [options.env]      Override for tests. Defaults to process.env.
 * @param {Function} [options.spawnSync] Override for tests.
 * @param {Function} [options.now]    Override for tests.
 * @returns {string | null} Raw secret text, or null on ANY failure.
 */
export function readSecret({
  service,
  account = null,
  platform = process.platform,
  env = process.env,
  spawnSync = nodeSpawnSync,
  now = Date.now,
} = {}) {
  if (!service || typeof service !== 'string') return null;
  if (String(env.AGNT_DISABLE_SECRET_STORE || '') === '1') return null;

  // Windows has no user-level generic secret store readable from a plain child
  // process; CLIs there use DPAPI-encrypted files, which the file tier covers.
  if (platform !== 'darwin' && platform !== 'linux') return null;

  const key = cacheKey(platform, service, account);
  const hit = cache.get(key);
  const nowMs = now();
  if (hit && nowMs - hit.at < CACHE_TTL_MS) return hit.value;

  const value = platform === 'darwin'
    ? readDarwin(spawnSync, env, service, account)
    : readLinux(spawnSync, env, service, account);

  // Bound the cache. These keys are provider-derived, not user-derived, so the
  // map is small by construction — the cap is belt-and-braces against a caller
  // that starts generating service names.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: nowMs, value });

  return value;
}

/**
 * Read a secret and parse it as JSON. Returns null if absent or unparseable —
 * a store item whose payload is not the JSON we expect is treated as "no
 * credential here", never as an error worth surfacing.
 */
export function readSecretJson(options) {
  const raw = readSecret(options);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Drop cached lookups. Call after any connect/disconnect so the next read
 * reflects the change immediately instead of serving a stale TTL window.
 */
export function clearSecretCache() {
  cache.clear();
}

/** True when this platform has a secret store we know how to read. */
export function secretStoreSupported(platform = process.platform, env = process.env) {
  if (String(env.AGNT_DISABLE_SECRET_STORE || '') === '1') return false;
  return platform === 'darwin' || platform === 'linux';
}

export const __testing = { CACHE_TTL_MS, LOOKUP_TIMEOUT_MS, MAX_CACHE_ENTRIES };
