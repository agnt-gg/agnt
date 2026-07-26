/**
 * Legacy database migration (PRD-060 §6.3), made safe.
 *
 * The original shim was four lines of `fs.copyFileSync` guarded only by
 * "does the destination exist yet". On this machine that meant ANY process
 * booted with a non-canonical USER_DATA_PATH silently started a 31.9 GB copy
 * with no free-space check, no size check, and no atomicity.
 *
 * The disk filling up is the obvious hazard. It is not the dangerous one.
 *
 * The dangerous one: a copy that dies partway through — out of disk, killed
 * process, power loss — leaves a TRUNCATED `agnt.db` at the canonical path.
 * On the next boot `fs.existsSync(target)` is true, so the shim skips, and
 * SQLite opens the truncated remnant as the real database. Silent, permanent
 * data loss produced by a recovery mechanism.
 *
 * Guards, cheapest and most decisive first:
 *   1. hot source   — a WAL modified seconds ago means a live writer; a raw
 *                     byte copy of a database being written to can capture a
 *                     torn page or a main/WAL pair that disagree.
 *   2. size gate    — above LARGE_DB_BYTES, require explicit opt-in. Nobody
 *                     should discover a 30 GB copy by watching their disk.
 *   3. free space   — require size × FREE_SPACE_MULTIPLIER.
 *   4. atomic swap  — copy to `.migrating-<pid>` temp files, fsync, verify
 *                     byte length, then rename. Rename is atomic within a
 *                     filesystem, so the canonical path only ever holds a
 *                     complete file.
 *   5. commit order — the WAL is renamed FIRST, the main DB LAST. The main DB
 *                     appearing IS the commit point, which is exactly what the
 *                     `!existsSync(target)` gate already tests. Interrupted
 *                     halfway you get an orphaned `-wal` with no `agnt.db`;
 *                     SQLite validates WAL headers against the DB and ignores
 *                     a mismatch, so the remnant is inert.
 *
 * Every refusal is non-destructive: the legacy file is never touched, and the
 * app boots against a fresh database at the canonical path.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** SQLite file header — first 16 bytes of every valid database. */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');

export const MIGRATION_LIMITS = {
  /** A WAL touched inside this window means something is actively writing. */
  HOT_WAL_WINDOW_MS: 60_000,
  /** Above this, migration requires AGNT_ALLOW_LARGE_DB_MIGRATION=1. */
  LARGE_DB_BYTES: 2 * 1024 * 1024 * 1024,
  /** Free space required, as a multiple of the payload. */
  FREE_SPACE_MULTIPLIER: 1.15,
};

export const OPT_IN_ENV = 'AGNT_ALLOW_LARGE_DB_MIGRATION';

/** Human-readable byte size. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Free bytes available to an unprivileged user at `dir`, or null if unknowable. */
export function freeBytesAt(dir) {
  try {
    // statfs reports for the filesystem containing the path, so walk up to the
    // nearest directory that actually exists — the target dir may be new.
    let probe = path.resolve(dir);
    for (let i = 0; i < 64 && !fs.existsSync(probe); i += 1) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const st = fs.statfsSync(probe);
    return st.bavail * st.bsize;
  } catch {
    return null; // unsupported platform / permission — treated as "unknown"
  }
}

/** Candidate locations a previous or buggy install may have left agnt.db in. */
export function buildLegacyLocations(dbDir) {
  const locs = [];
  const home = os.homedir();

  if (process.platform === 'win32') {
    // Benny's bug: a false /app/data hit on Windows resolved to C:\app\data
    locs.push('C:\\app\\data');
    if (process.env.APPDATA) locs.push(path.join(process.env.APPDATA, 'AGNT', 'Data'));
    // System-wide installs and Electron localappdata variants
    if (process.env.PROGRAMDATA) locs.push(path.join(process.env.PROGRAMDATA, 'AGNT', 'Data'));
    if (process.env.LOCALAPPDATA) locs.push(path.join(process.env.LOCALAPPDATA, 'AGNT', 'Data'));
    // Pre-PRD-060 emergency fallbacks
    if (process.env.USERPROFILE) {
      locs.push(path.join(process.env.USERPROFILE, 'Documents', 'AGNT_Data'));
      locs.push(path.join(process.env.USERPROFILE, 'AGNT_Data'));
    }
  }
  if (process.platform === 'darwin' && home) {
    locs.push(path.join(home, 'Library', 'Application Support', 'AGNT', 'Data'));
    locs.push(path.join(home, 'Documents', 'AGNT_Data'));
  }
  if (process.platform === 'linux' && home) {
    locs.push(path.join(home, '.config', 'AGNT', 'Data'));
    locs.push(path.join(home, 'AGNT_Data'));
  }

  // Never treat the destination as a source. Windows and macOS paths are
  // case-insensitive, so a plain !== comparison would let a differently-cased
  // spelling of the SAME directory through.
  const canonical = (p) => {
    const resolved = path.resolve(p);
    return process.platform === 'linux' ? resolved : resolved.toLowerCase();
  };
  const target = canonical(dbDir);
  const seen = new Set();
  return locs.filter((p) => {
    if (!p) return false;
    const key = canonical(p);
    if (key === target || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Copy one file through a temp path with an fsync, and verify its length. */
function copyVerified(src, tmp) {
  fs.copyFileSync(src, tmp);

  // copyFileSync returns once the data is handed to the OS, not once it is on
  // the platter. Without this an interrupted machine can leave a temp file that
  // passed the length check but has unwritten tail blocks.
  const fd = fs.openSync(tmp, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  const expected = fs.statSync(src).size;
  const actual = fs.statSync(tmp).size;
  if (actual !== expected) {
    throw new Error(`copy truncated: ${actual} of ${expected} bytes for ${path.basename(src)}`);
  }
  return actual;
}

/** Cheap O(1) sanity check that a file is a SQLite database. */
function hasSqliteHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    return read === 16 && buf.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Migrate an orphaned agnt.db into `dbDir`, or refuse for a stated reason.
 *
 * @param {object}   opts
 * @param {string}   opts.dbDir             canonical data directory
 * @param {string[]} [opts.legacyLocations] defaults to buildLegacyLocations(dbDir)
 * @param {object}   [opts.env]             defaults to process.env
 * @param {object}   [opts.limits]          override MIGRATION_LIMITS
 * @param {Function} [opts.freeBytes]       injectable for tests
 * @param {number}   [opts.now]             injectable clock
 * @param {object}   [opts.logger]          {info, warn, error}
 * @returns {{migrated:boolean, reason:string, source?:string, bytes?:number, required?:number, free?:number}}
 */
export function migrateLegacyDatabase({
  dbDir,
  legacyLocations,
  env = process.env,
  limits = MIGRATION_LIMITS,
  freeBytes = freeBytesAt,
  now = Date.now(),
  logger = console,
} = {}) {
  const target = path.join(dbDir, 'agnt.db');

  if (fs.existsSync(target)) {
    return { migrated: false, reason: 'target-exists' };
  }

  const sources = legacyLocations || buildLegacyLocations(dbDir);
  const legacyDir = sources.find((dir) => fs.existsSync(path.join(dir, 'agnt.db')));
  if (!legacyDir) {
    return { migrated: false, reason: 'no-legacy-db' };
  }

  const srcDb = path.join(legacyDir, 'agnt.db');
  const srcWal = `${srcDb}-wal`;
  const dbBytes = sizeOf(srcDb);
  const walBytes = sizeOf(srcWal);
  const totalBytes = dbBytes + walBytes;
  const pretty = formatBytes(totalBytes);

  // -- 1. Hot source -------------------------------------------------------
  // A raw byte copy of a database with a live writer can capture a torn page,
  // or a main/WAL pair from two different instants.
  if (fs.existsSync(srcWal)) {
    const walAge = now - fs.statSync(srcWal).mtimeMs;
    if (walAge < limits.HOT_WAL_WINDOW_MS) {
      logger.warn(
        `[db-migration] REFUSED: ${srcDb} is in active use ` +
          `(WAL written ${Math.max(0, Math.round(walAge / 1000))}s ago). ` +
          'Copying a live database can produce a corrupt one. ' +
          'Close the other AGNT instance and restart.'
      );
      return { migrated: false, reason: 'source-hot', source: srcDb, bytes: totalBytes };
    }
  }

  // -- 2. Size gate --------------------------------------------------------
  const optedIn = env[OPT_IN_ENV] === '1' || env[OPT_IN_ENV] === 'true';
  if (totalBytes > limits.LARGE_DB_BYTES && !optedIn) {
    logger.warn(
      `[db-migration] REFUSED: ${srcDb} is ${pretty}, above the ` +
        `${formatBytes(limits.LARGE_DB_BYTES)} automatic limit. ` +
        `Set ${OPT_IN_ENV}=1 to allow it, or copy the file manually to ${target}. ` +
        'AGNT will start with an empty database; the original is untouched.'
    );
    return { migrated: false, reason: 'too-large', source: srcDb, bytes: totalBytes };
  }

  // -- 3. Free space -------------------------------------------------------
  const required = Math.ceil(totalBytes * limits.FREE_SPACE_MULTIPLIER);
  const available = freeBytes(dbDir);
  if (available !== null && available < required) {
    logger.error(
      `[db-migration] REFUSED: need ${formatBytes(required)} free to copy ${pretty}, ` +
        `but only ${formatBytes(available)} is available on the volume holding ${dbDir}. ` +
        'The original is untouched.'
    );
    return { migrated: false, reason: 'insufficient-space', source: srcDb, bytes: totalBytes, required, free: available };
  }

  // -- 4. Copy through temp files, verify, then swap atomically ------------
  const tmpDb = `${target}.migrating-${process.pid}`;
  const tmpWal = `${target}-wal.migrating-${process.pid}`;
  const cleanup = () => {
    for (const f of [tmpDb, tmpWal]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        /* best effort */
      }
    }
  };

  try {
    logger.warn(`[db-migration] migrating orphaned DB (${pretty}) from ${legacyDir} -> ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });

    copyVerified(srcDb, tmpDb);
    if (!hasSqliteHeader(tmpDb)) {
      throw new Error('copied file is not a valid SQLite database (bad header)');
    }
    if (walBytes > 0) copyVerified(srcWal, tmpWal);

    // The `-shm` sidecar is deliberately NOT copied: it is scratch state that
    // SQLite rebuilds from the WAL on open, and a stale one is worse than none.

    // Commit. WAL first — an interrupted swap then leaves an orphaned WAL with
    // no database, which SQLite rejects on header mismatch. The main database
    // landing last is the atomic commit point for the whole migration.
    if (walBytes > 0) fs.renameSync(tmpWal, `${target}-wal`);
    fs.renameSync(tmpDb, target);

    logger.warn(`[db-migration] completed successfully (${pretty})`);
    return { migrated: true, reason: 'ok', source: srcDb, bytes: totalBytes };
  } catch (error) {
    cleanup();
    logger.error(
      `[db-migration] FAILED: ${error.message}. ` +
        `Partial copies removed; ${srcDb} is untouched. AGNT will start with an empty database.`
    );
    return { migrated: false, reason: 'copy-failed', source: srcDb, bytes: totalBytes, error: error.message };
  }
}

export default migrateLegacyDatabase;
