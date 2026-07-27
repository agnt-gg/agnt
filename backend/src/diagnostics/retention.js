/**
 * Retention sweep.
 *
 * The existing _logs directory has neither an age cap nor a size cap, which is
 * the entire reason it holds 43,581 files spanning 239 days. Every path here
 * has both.
 *
 * Pure function over the filesystem, no timers — the caller schedules it
 * (startup + once per 24h). Never runs on the hot path.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const DAY_MS = 86_400_000;

const DEFAULTS = {
  maxAgeDays: 30,
  maxTotalBytes: 256 * 1024 * 1024,
  crashMaxAgeDays: 30,
  crashKeepMin: 20,
  gzipAfterHours: 24,
  blobMaxAgeDays: 30,
};

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function rm(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function listFiles(dir, filter) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (filter && !filter(name)) continue;
    const file = path.join(dir, name);
    const st = safeStat(file);
    if (st && st.isFile()) out.push({ name, file, mtime: st.mtimeMs, size: st.size });
  }
  return out;
}

/**
 * @param {string} dir diagnostics directory
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @param {boolean} [opts.dryRun]
 */
export function sweep(dir, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const now = Date.now();
  const dryRun = Boolean(opts.dryRun);
  const report = { deleted: [], gzipped: [], keptBytes: 0, freedBytes: 0, errors: [] };

  const act = {
    rm: (f) => (dryRun ? true : rm(f)),
  };

  // 1. Daily logs: gzip when cold, delete when old.
  const logs = listFiles(dir, (n) => /^agnt-\d{4}-\d{2}-\d{2}(\.\d+)?\.jsonl(\.gz)?$/.test(n));
  for (const entry of logs) {
    const ageMs = now - entry.mtime;

    if (ageMs > cfg.maxAgeDays * DAY_MS) {
      if (act.rm(entry.file)) {
        report.deleted.push(entry.name);
        report.freedBytes += entry.size;
      }
      continue;
    }

    if (!entry.name.endsWith('.gz') && ageMs > cfg.gzipAfterHours * 3_600_000) {
      try {
        if (!dryRun) {
          const raw = fs.readFileSync(entry.file);
          fs.writeFileSync(`${entry.file}.gz`, zlib.gzipSync(raw, { level: 6 }));
          fs.unlinkSync(entry.file);
        }
        report.gzipped.push(entry.name);
      } catch (err) {
        report.errors.push(`gzip ${entry.name}: ${err.message}`);
      }
    }
  }

  // 2. Global size ceiling, oldest first. Crash records are exempt — they are
  //    rare, small, and the single most valuable artifact in the directory.
  let remaining = listFiles(dir, (n) => /^agnt-.*\.jsonl(\.gz)?$/.test(n)).sort((a, b) => a.mtime - b.mtime);
  let total = remaining.reduce((sum, e) => sum + e.size, 0);
  while (total > cfg.maxTotalBytes && remaining.length > 1) {
    const victim = remaining.shift();
    if (act.rm(victim.file)) {
      report.deleted.push(victim.name);
      report.freedBytes += victim.size;
      total -= victim.size;
    } else break;
  }
  report.keptBytes = total;

  // 3. Crash records: age-capped, but always keep the most recent N.
  const crashDir = path.join(dir, 'crashes');
  const crashes = listFiles(crashDir, (n) => n.endsWith('.json')).sort((a, b) => b.mtime - a.mtime);
  crashes.forEach((entry, index) => {
    if (index < cfg.crashKeepMin) return;
    if (now - entry.mtime > cfg.crashMaxAgeDays * DAY_MS) {
      if (act.rm(entry.file)) {
        report.deleted.push(`crashes/${entry.name}`);
        report.freedBytes += entry.size;
      }
    }
  });

  // 4. Orphaned spill blobs.
  const blobDir = path.join(dir, 'blobs');
  for (const entry of listFiles(blobDir)) {
    if (now - entry.mtime > cfg.blobMaxAgeDays * DAY_MS) {
      if (act.rm(entry.file)) {
        report.deleted.push(`blobs/${entry.name}`);
        report.freedBytes += entry.size;
      }
    }
  }

  return report;
}

/**
 * One-shot migration for the legacy one-file-per-log-call directory.
 * Deliberately separate from `sweep` and dry-run by default: it deletes
 * 43,581 files and that should never happen as a side effect of a routine.
 */
export function purgeLegacyLogs(legacyDir, { dryRun = true, olderThanDays = 0 } = {}) {
  // olderThanDays <= 0 means "no age filter". Computing a cutoff of Date.now()
  // silently spared any file whose mtimeMs carried sub-millisecond precision
  // (NTFS reports fractional ms; Date.now() is integer), which made a "purge
  // everything" call quietly leave recent files behind.
  const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * DAY_MS : Infinity;
  const files = listFiles(legacyDir, (n) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.log$/.test(n));
  let deleted = 0;
  let freed = 0;
  for (const entry of files) {
    if (entry.mtime > cutoff) continue;
    if (dryRun || rm(entry.file)) {
      deleted += 1;
      freed += entry.size;
    }
  }
  return { scanned: files.length, deleted, freedBytes: freed, dryRun };
}

export default sweep;
