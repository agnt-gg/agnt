import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  migrateLegacyDatabase,
  buildLegacyLocations,
  formatBytes,
  freeBytesAt,
  MIGRATION_LIMITS,
  OPT_IN_ENV,
} from './legacyMigration.js';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

let ROOT;
let SRC;
let DST;

/** A file that passes SQLite's header check, padded to `size`. */
function writeFakeDb(file, size = 4096) {
  const buf = Buffer.alloc(Math.max(size, 16), 0);
  SQLITE_HEADER.copy(buf, 0);
  fs.writeFileSync(file, buf);
}

const srcDb = () => path.join(SRC, 'agnt.db');
const dstDb = () => path.join(DST, 'agnt.db');
const silent = { info() {}, warn() {}, error() {} };

/** Any leftover scratch from an aborted migration. */
function tempArtifacts() {
  return fs.readdirSync(DST).filter((n) => n.includes('.migrating-'));
}

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-dbmig-'));
  SRC = path.join(ROOT, 'legacy');
  DST = path.join(ROOT, 'canonical');
  fs.mkdirSync(SRC, { recursive: true });
  fs.mkdirSync(DST, { recursive: true });
});

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('migrateLegacyDatabase — happy path', () => {
  it('copies the database and its WAL into the canonical location', () => {
    writeFakeDb(srcDb(), 8192);
    fs.writeFileSync(`${srcDb()}-wal`, Buffer.alloc(2048, 7));
    // Deliberately stale: SQLite rebuilds -shm from the WAL, so copying one is
    // strictly worse than letting it regenerate.
    fs.writeFileSync(`${srcDb()}-shm`, Buffer.alloc(512, 9));

    const res = migrateLegacyDatabase({
      dbDir: DST,
      legacyLocations: [SRC],
      logger: silent,
      now: Date.now() + 10 * 60_000, // WAL is cold
    });

    expect(res).toMatchObject({ migrated: true, reason: 'ok', bytes: 8192 + 2048 });
    expect(fs.statSync(dstDb()).size).toBe(8192);
    expect(fs.statSync(`${dstDb()}-wal`).size).toBe(2048);
    expect(fs.existsSync(`${dstDb()}-shm`)).toBe(false);
    expect(tempArtifacts()).toEqual([]);
    // Copy, never move — the original must survive for manual recovery.
    expect(fs.existsSync(srcDb())).toBe(true);
  });

  it('handles a database with no WAL', () => {
    writeFakeDb(srcDb(), 4096);
    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });
    expect(res.migrated).toBe(true);
    expect(fs.existsSync(`${dstDb()}-wal`)).toBe(false);
  });

  it('creates the destination directory when it does not exist yet', () => {
    writeFakeDb(srcDb());
    const fresh = path.join(ROOT, 'brand-new');
    const res = migrateLegacyDatabase({ dbDir: fresh, legacyLocations: [SRC], logger: silent });
    expect(res.migrated).toBe(true);
    expect(fs.existsSync(path.join(fresh, 'agnt.db'))).toBe(true);
  });
});

describe('migrateLegacyDatabase — refusals', () => {
  it('does nothing when the canonical database already exists', () => {
    writeFakeDb(srcDb(), 8192);
    writeFakeDb(dstDb(), 111);
    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });
    expect(res).toEqual({ migrated: false, reason: 'target-exists' });
    expect(fs.statSync(dstDb()).size).toBe(111); // untouched
  });

  it('does nothing when there is no legacy database', () => {
    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });
    expect(res).toEqual({ migrated: false, reason: 'no-legacy-db' });
  });

  it('refuses a source with a live writer, rather than copying a torn page', () => {
    writeFakeDb(srcDb(), 4096);
    fs.writeFileSync(`${srcDb()}-wal`, Buffer.alloc(1024, 1)); // mtime = now

    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });

    expect(res.reason).toBe('source-hot');
    expect(res.migrated).toBe(false);
    expect(fs.existsSync(dstDb())).toBe(false);
  });

  it('proceeds once the WAL has gone cold', () => {
    writeFakeDb(srcDb(), 4096);
    const wal = `${srcDb()}-wal`;
    fs.writeFileSync(wal, Buffer.alloc(1024, 1));
    const old = (Date.now() - 10 * 60_000) / 1000;
    fs.utimesSync(wal, old, old);

    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });
    expect(res.migrated).toBe(true);
  });

  it('refuses a large database without explicit opt-in', () => {
    writeFakeDb(srcDb(), 4096);
    const res = migrateLegacyDatabase({
      dbDir: DST,
      legacyLocations: [SRC],
      limits: { ...MIGRATION_LIMITS, LARGE_DB_BYTES: 1024 },
      logger: silent,
      env: {},
    });
    expect(res.reason).toBe('too-large');
    expect(fs.existsSync(dstDb())).toBe(false);
  });

  it('migrates a large database when opted in', () => {
    writeFakeDb(srcDb(), 4096);
    const res = migrateLegacyDatabase({
      dbDir: DST,
      legacyLocations: [SRC],
      limits: { ...MIGRATION_LIMITS, LARGE_DB_BYTES: 1024 },
      logger: silent,
      env: { [OPT_IN_ENV]: '1' },
    });
    expect(res.migrated).toBe(true);
  });

  it('refuses when the destination volume lacks headroom', () => {
    writeFakeDb(srcDb(), 10_000);
    const res = migrateLegacyDatabase({
      dbDir: DST,
      legacyLocations: [SRC],
      freeBytes: () => 10_500, // less than 10_000 * 1.15
      logger: silent,
    });
    expect(res.reason).toBe('insufficient-space');
    expect(res.required).toBe(11_500);
    expect(fs.existsSync(dstDb())).toBe(false);
  });

  it('proceeds when free space is unknowable rather than blocking boot', () => {
    writeFakeDb(srcDb(), 4096);
    const res = migrateLegacyDatabase({
      dbDir: DST,
      legacyLocations: [SRC],
      freeBytes: () => null, // unsupported platform
      logger: silent,
    });
    expect(res.migrated).toBe(true);
  });

  it('picks only the first legacy location that has a database', () => {
    const other = path.join(ROOT, 'other');
    fs.mkdirSync(other);
    writeFakeDb(path.join(other, 'agnt.db'), 2048);
    writeFakeDb(srcDb(), 4096);

    const res = migrateLegacyDatabase({
      dbDir: DST,
      legacyLocations: [path.join(ROOT, 'missing'), other, SRC],
      logger: silent,
    });
    expect(res.source).toBe(path.join(other, 'agnt.db'));
    expect(fs.statSync(dstDb()).size).toBe(2048);
  });
});

/**
 * The core regression. A partial copy that survives at the canonical path is
 * adopted as the real database on the next boot, because the only guard is
 * `existsSync(target)`. Silent, permanent data loss produced by the recovery
 * mechanism itself. No failure mode may ever leave a file at `target`.
 */
describe('migrateLegacyDatabase — never leaves a corrupt database behind', () => {
  it('leaves nothing at the canonical path when the copy runs out of disk', () => {
    writeFakeDb(srcDb(), 8192);
    // Faithful ENOSPC: the kernel writes what fits and THEN fails. A mock that
    // throws without writing is not a regression test at all — the original
    // unguarded code passes it too, because there is nothing left behind to
    // find. The partial file is the entire hazard.
    vi.spyOn(fs, 'copyFileSync').mockImplementation((_src, dest) => {
      const partial = Buffer.alloc(3000, 0);
      SQLITE_HEADER.copy(partial, 0);
      fs.writeFileSync(dest, partial);
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    });

    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });

    expect(res.migrated).toBe(false);
    expect(res.reason).toBe('copy-failed');
    expect(fs.existsSync(dstDb())).toBe(false);
    expect(tempArtifacts()).toEqual([]);
    expect(fs.statSync(srcDb()).size).toBe(8192); // source untouched
  });

  it('detects a SILENTLY truncated copy and discards it', () => {
    writeFakeDb(srcDb(), 65_536);
    // The nastier failure: the OS reports success but the file is short.
    vi.spyOn(fs, 'copyFileSync').mockImplementation((_src, dest) => {
      const short = Buffer.alloc(4096, 0);
      SQLITE_HEADER.copy(short, 0); // header is intact, so only a length check catches it
      fs.writeFileSync(dest, short);
    });

    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });

    expect(res.migrated).toBe(false);
    expect(res.error).toMatch(/truncated: 4096 of 65536/);
    expect(fs.existsSync(dstDb())).toBe(false);
    expect(tempArtifacts()).toEqual([]);
  });

  it('rejects a source that is not a SQLite database', () => {
    fs.writeFileSync(srcDb(), Buffer.from('this is not a database, it is a text file'));

    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });

    expect(res.migrated).toBe(false);
    expect(res.error).toMatch(/not a valid SQLite database/);
    expect(fs.existsSync(dstDb())).toBe(false);
    expect(tempArtifacts()).toEqual([]);
  });

  it('cleans up the main copy when the WAL copy fails', () => {
    writeFakeDb(srcDb(), 8192);
    const wal = `${srcDb()}-wal`;
    fs.writeFileSync(wal, Buffer.alloc(2048, 3));
    const old = (Date.now() - 10 * 60_000) / 1000;
    fs.utimesSync(wal, old, old);

    const real = fs.copyFileSync;
    vi.spyOn(fs, 'copyFileSync').mockImplementation((src, dest) => {
      if (String(src).endsWith('-wal')) throw new Error('EIO while copying WAL');
      return real(src, dest);
    });

    const res = migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });

    expect(res.migrated).toBe(false);
    // A database without its WAL is missing its most recent commits — worse
    // than no database at all, because it looks complete.
    expect(fs.existsSync(dstDb())).toBe(false);
    expect(fs.existsSync(`${dstDb()}-wal`)).toBe(false);
    expect(tempArtifacts()).toEqual([]);
  });

  it('names temp files per-pid so two processes cannot corrupt each other', () => {
    writeFakeDb(srcDb(), 8192);
    let seen = null;
    const real = fs.copyFileSync;
    vi.spyOn(fs, 'copyFileSync').mockImplementation((src, dest) => {
      seen = dest;
      return real(src, dest);
    });
    migrateLegacyDatabase({ dbDir: DST, legacyLocations: [SRC], logger: silent });
    expect(seen).toContain(`.migrating-${process.pid}`);
  });
});

describe('buildLegacyLocations', () => {
  it('never returns the destination directory itself', () => {
    for (const dir of buildLegacyLocations(path.join(os.homedir(), 'AGNT_Data'))) {
      expect(path.resolve(dir).toLowerCase()).not.toBe(path.join(os.homedir(), 'AGNT_Data').toLowerCase());
    }
  });

  it('excludes the destination even when spelled with different case', () => {
    // Windows and macOS paths are case-insensitive, so a plain !== comparison
    // would let the SAME directory through under a different spelling and the
    // migration would try to copy a file onto itself.
    if (process.platform === 'linux') return;
    const base = process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir();
    const target = path.join(base, 'AGNT', 'Data');
    const locations = buildLegacyLocations(target.toUpperCase());
    expect(locations.map((p) => p.toLowerCase())).not.toContain(target.toLowerCase());
  });

  it('returns no duplicates', () => {
    const locs = buildLegacyLocations(path.join(os.tmpdir(), 'nowhere'));
    const keys = locs.map((p) => (process.platform === 'linux' ? p : p.toLowerCase()));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('helpers', () => {
  it('formats byte counts readably', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(31_909_974_016)).toBe('29.7 GB');
    expect(formatBytes(NaN)).toBe('unknown');
  });

  it('reports free space for a real directory', () => {
    const free = freeBytesAt(ROOT);
    expect(free === null || free > 0).toBe(true);
  });

  it('walks up to an existing parent for a path that does not exist yet', () => {
    const free = freeBytesAt(path.join(ROOT, 'does', 'not', 'exist', 'yet'));
    expect(free === null || free > 0).toBe(true);
  });
});
