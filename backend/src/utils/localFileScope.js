/**
 * Path-scope policy for `/api/local-file/*`.
 *
 * Two independent controls, in order of importance:
 *
 *  1. `isSecretPath` — an ALWAYS-ON refusal for credential-shaped paths.
 *     This is a deliberate, narrow blocklist, and it is not the security
 *     boundary (authentication is). Its job is to close one specific pivot:
 *     LLM- or plugin-authored HTML rendered inside the app is same-origin, so
 *     an <img src="/api/local-file/C:/…/.env"> carries the user's own media
 *     cookie. Auth cannot distinguish that from a legitimate image load, so
 *     the file class is refused outright. There is no legitimate reason for a
 *     rendered document to load a private key.
 *
 *  2. `assertWithinRoots` — an OPT-IN allow-list via `AGNT_LOCAL_FILE_ROOTS`.
 *     Unset by default because users legitimately render artifacts from
 *     anywhere on their own disk; a default-on allow-list would break more
 *     than it protects. Users who expose their instance more widely can set it
 *     and get a hard containment boundary, symlink-escape included.
 */

import fs from 'fs';
import path from 'path';

/**
 * Basenames (case-insensitive) that are refused outright.
 * Exact names first, then extension/prefix rules in `isSecretPath`.
 */
const SECRET_BASENAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '_netrc',
  '.git-credentials',
  '.htpasswd',
  '.pgpass',
  'credentials',
  'credentials.json',
  'secrets.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.dockercfg',
  '.docker/config.json',
]);

/** Directory names that are refused anywhere in the path. */
const SECRET_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.azure', '.kube']);

/** Extensions that carry private key material. */
const SECRET_EXTS = new Set(['.pem', '.key', '.pfx', '.p12', '.jks', '.keystore', '.asc', '.ppk']);

/**
 * @param {string} absPath - Already-resolved absolute path.
 * @returns {boolean} true when the path must never be served.
 */
export function isSecretPath(absPath) {
  const normalized = String(absPath || '').replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const base = path.posix.basename(lower);

  if (SECRET_BASENAMES.has(base)) return true;
  // `.env.local`, `.env.production`, … but NOT `environment.js`.
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (SECRET_EXTS.has(path.posix.extname(base))) return true;
  // `id_rsa`, `id_rsa.pub`, `id_ed25519_work`
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(base)) return true;

  const segments = lower.split('/');
  for (const seg of segments) {
    if (SECRET_DIRS.has(seg)) return true;
  }
  return false;
}

/** @returns {string[]} configured roots, resolved and normalised. Empty = unrestricted. */
export function getRoots() {
  const raw = process.env.AGNT_LOCAL_FILE_ROOTS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return fs.realpathSync(path.resolve(s));
      } catch {
        return path.resolve(s);
      }
    });
}

export function describeRoots() {
  const roots = getRoots();
  return roots.length ? roots.join(path.delimiter) : '(unrestricted)';
}

/**
 * Containment check with symlink resolution, so a symlink inside an allowed
 * root cannot be used to read outside it.
 *
 * @param {string} absPath - Already-resolved absolute path.
 * @returns {{ ok: boolean, root?: string }}
 */
export function assertWithinRoots(absPath) {
  const roots = getRoots();
  if (roots.length === 0) return { ok: true };

  let real;
  try {
    real = fs.realpathSync(absPath);
  } catch {
    real = path.resolve(absPath);
  }

  const caseFold = process.platform === 'win32';
  const cmp = (s) => (caseFold ? s.toLowerCase() : s);
  const target = cmp(real);

  for (const root of roots) {
    const r = cmp(root);
    // Separator-boundary comparison: `/data` must not match `/database`.
    if (target === r || target.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) {
      return { ok: true, root };
    }
  }
  return { ok: false };
}

export default { isSecretPath, assertWithinRoots, getRoots, describeRoots };
