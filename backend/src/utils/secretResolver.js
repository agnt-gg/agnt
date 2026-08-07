import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pathManager from './PathManager.js';

/**
 * The single source of truth for "where does this secret come from".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * AGNT shipped a committed `backend/.env` containing ENCRYPTION_KEY,
 * SESSION_SECRET and JWT_SECRET. It was published to a public repository for
 * 197 days and is baked into every installed copy of the app, so every install
 * on earth shared one encryption key: anyone holding a user's database file
 * could decrypt that user's stored API keys and OAuth tokens.
 *
 * There were also TWO ways a secret got read, and they had drifted:
 *   - `dotenv` populated process.env for most things;
 *   - `utils/encryption.js` did its own fs.readFileSync of ../../.env at module
 *     scope, bypassing process.env entirely — which is why ENCRYPTION_KEY had
 *     zero `process.env` reads while being very much in use, and why no
 *     operator could override it.
 *
 * That second path also made the file a BOOT DEPENDENCY: it threw at import
 * time if the file was missing, so the file could not simply be deleted.
 *
 * One resolver, one cascade, no module-scope I/O.
 *
 * ---------------------------------------------------------------------------
 * THE CASCADE
 * ---------------------------------------------------------------------------
 *   1. process.env  — operator override. Docker `-e`, CI, systemd, a shell.
 *                     Always wins, so nothing here removes anyone's control.
 *   2. keyfile      — <dataDir>/secrets/<NAME>, mode 0600.
 *   3. generate     — CSPRNG, persisted atomically, then returned.
 *
 * ---------------------------------------------------------------------------
 * WHY <dataDir> AND NOT <rootDir>
 * ---------------------------------------------------------------------------
 * PathManager offers both, and its own docs put config-style files in rootDir,
 * which is where a key arguably belongs. It goes in dataDir anyway, alongside
 * agnt.db, for one reason: THE KEY MUST NEVER BECOME SEPARATED FROM THE
 * CIPHERTEXT IT PROTECTS.
 *
 * On Electron rootDir is %APPDATA%/AGNT and dataDir is %APPDATA%/AGNT/Data.
 * A user who copies only `Data/` to a new machine — a completely ordinary way
 * to migrate — would carry the database and leave the key behind, and every
 * stored credential would be permanently unreadable. With both in dataDir that
 * failure mode does not exist. Security-wise the two locations are equivalent
 * (same volume, same permissions, same attacker reach), so availability wins.
 *
 * On Docker, rootDir and dataDir both collapse to /app/data, which all three
 * compose files mount to ~/.agnt/data on the host — so the keyfile survives
 * container restarts. A key regenerated on every restart would orphan every
 * credential encrypted before it.
 */

/** Subdirectory under the data dir. One file per secret — see persist(). */
const SECRETS_DIRNAME = 'secrets';

/** Resolved values, memoised per process. */
const cache = new Map();

/** A secret name must be a bare identifier: it becomes a filename. */
const SAFE_NAME = /^[A-Z][A-Z0-9_]*$/;

function secretsDir() {
  return pathManager.getDataPath(SECRETS_DIRNAME);
}

function secretPath(name) {
  return path.join(secretsDir(), name);
}

function readFromDisk(name) {
  try {
    const raw = fs.readFileSync(secretPath(name), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    // Missing, unreadable, or a directory — all mean "no secret here yet".
    return null;
  }
}

/**
 * Persist a freshly generated secret, atomically.
 *
 * ONE FILE PER SECRET, created with the `wx` flag (exclusive create), rather
 * than one JSON file holding all of them. A shared JSON file needs
 * read-modify-write, and two processes booting concurrently on the same data
 * directory could then each generate a key, each write, and each return the
 * value it generated — while only one survived on disk. The loser would
 * encrypt rows with a key that no longer exists anywhere, and those rows would
 * be unreadable forever.
 *
 * `wx` makes the race impossible to lose silently: exactly one process can
 * create the file, and everyone else gets EEXIST and adopts the winner's value.
 *
 * @returns {string} the value now on disk — NOT necessarily the one passed in
 */
function persist(name, value) {
  const file = secretPath(name);
  try {
    fs.mkdirSync(secretsDir(), { recursive: true });
    fs.writeFileSync(file, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return value;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const winner = readFromDisk(name);
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Resolve a secret, generating and persisting one if it does not exist.
 *
 * @param {string} name                       e.g. 'ENCRYPTION_KEY'
 * @param {object} [options]
 * @param {number} [options.bytes=32]         entropy for a generated value
 * @param {'throw'|'ephemeral'} [options.onPersistFailure='throw']
 *   What to do when a secret cannot be written to disk (read-only volume,
 *   permissions, full disk). This is a real decision, not a detail:
 *
 *   'throw'     — for anything that encrypts data at rest. A secret we cannot
 *                 persist is one we will regenerate on the next boot, so
 *                 continuing would write ciphertext that becomes unreadable
 *                 the moment the process restarts. Silent, permanent data
 *                 loss. Failing loudly is strictly better.
 *
 *   'ephemeral' — for anything that only protects transient state, i.e.
 *                 SESSION_SECRET. Losing express sessions on restart logs
 *                 people out of a 24-hour cookie they will transparently
 *                 re-establish. Refusing to boot over that would be a much
 *                 worse outcome than the harm it prevents.
 * @returns {string}
 */
export function resolveSecret(name, options = {}) {
  const { bytes = 32, onPersistFailure = 'throw' } = options;

  if (!SAFE_NAME.test(name)) {
    throw new Error(`Invalid secret name '${name}': expected /^[A-Z][A-Z0-9_]*$/`);
  }

  if (cache.has(name)) return cache.get(name);

  // 1. Operator override.
  const fromEnv = process.env[name];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const value = fromEnv.trim();
    cache.set(name, value);
    return value;
  }

  // 2. Existing per-install keyfile.
  const fromDisk = readFromDisk(name);
  if (fromDisk) {
    cache.set(name, fromDisk);
    return fromDisk;
  }

  // 3. Generate and persist.
  const generated = crypto.randomBytes(bytes).toString('hex');
  let value;
  try {
    value = persist(name, generated);
  } catch (error) {
    if (onPersistFailure === 'ephemeral') {
      console.warn(
        `[secretResolver] Could not persist ${name} (${error?.code || error?.message}). ` +
          'Using an ephemeral value for this process; it will change on restart.'
      );
      value = generated;
    } else {
      throw new Error(
        `[secretResolver] Could not persist ${name} to ${secretPath(name)}: ${error?.message}. ` +
          'Refusing to continue with a key that would not survive a restart — ' +
          'anything encrypted with it would become permanently unreadable. ' +
          `Fix the directory permissions, or set ${name} in the environment.`
      );
    }
  }

  cache.set(name, value);
  return value;
}

/** Absolute path of a secret's keyfile. For diagnostics and tests. */
export function secretFilePath(name) {
  return secretPath(name);
}

/** True when this secret is already materialised (env or disk). */
export function secretExists(name) {
  const fromEnv = process.env[name];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return true;
  return readFromDisk(name) !== null;
}

/** Test seam: drop memoised values so a test can change env or data dir. */
export function __resetSecretCacheForTests() {
  cache.clear();
}
