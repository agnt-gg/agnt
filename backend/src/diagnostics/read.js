/**
 * Query surface.
 *
 * Persisting records is half the job — they have to be reachable. This backs
 * the CLI and the `read_diagnostics` agent tool, so "AGNT broke" becomes a
 * question answerable from disk instead of a request to paste a terminal buffer.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { levelValue } from './levels.js';

function parseSince(since) {
  if (!since) return 0;
  if (since instanceof Date) return since.getTime();
  if (typeof since === 'number') return since;
  const rel = /^(\d+)\s*([smhd])$/i.exec(String(since).trim());
  if (rel) {
    const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2].toLowerCase()];
    return Date.now() - Number(rel[1]) * mult;
  }
  const t = Date.parse(since);
  return Number.isNaN(t) ? 0 : t;
}

function readMaybeGzip(file) {
  const raw = fs.readFileSync(file);
  return file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
}

/** Log files overlapping the window, oldest first. */
function candidateFiles(dir, sinceMs) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^agnt-\d{4}-\d{2}-\d{2}(\.\d+)?\.jsonl(\.gz)?$/.test(n))
    .map((n) => ({ name: n, file: path.join(dir, n) }))
    .filter(({ file }) => {
      if (!sinceMs) return true;
      try {
        // +1 day of slack: a file's mtime is its LAST write, so a file that
        // starts before the window can still contain records inside it.
        return fs.statSync(file).mtimeMs >= sinceMs - 86_400_000;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {object}  q
 * @param {string}  q.dir
 * @param {string|number|Date} [q.since]  ISO, epoch ms, or relative ('15m','2h','7d')
 * @param {string}  [q.until]
 * @param {string}  [q.level]   minimum level, e.g. 'ERROR'
 * @param {string}  [q.proc]
 * @param {string}  [q.src]
 * @param {string}  [q.boot]    'last' resolves to the most recent boot id
 * @param {string}  [q.grep]    substring match over msg/err/src
 * @param {object}  [q.ctx]     e.g. { workflowId: '5c29…' }
 * @param {number}  [q.limit=500]
 */
export function readRecords(q = {}) {
  const dir = q.dir;
  const sinceMs = parseSince(q.since);
  const untilMs = q.until ? parseSince(q.until) : Infinity;
  const minLevel = q.level ? levelValue(q.level) : 0;
  const limit = q.limit ?? 500;
  const needle = q.grep ? String(q.grep).toLowerCase() : null;

  const files = candidateFiles(dir, sinceMs);
  const matched = [];
  let scanned = 0;
  let boot = q.boot;

  // Resolve 'last' by scanning backwards for the newest boot id.
  if (boot === 'last') {
    boot = null;
    outer: for (let i = files.length - 1; i >= 0; i--) {
      let lines;
      try {
        lines = readMaybeGzip(files[i].file).split('\n');
      } catch {
        continue;
      }
      for (let j = lines.length - 1; j >= 0; j--) {
        if (!lines[j]) continue;
        try {
          const rec = JSON.parse(lines[j]);
          if (rec.boot) {
            boot = rec.boot;
            break outer;
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  for (const { file } of files) {
    let text;
    try {
      text = readMaybeGzip(file);
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      scanned += 1;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // a torn line must never abort the query
      }

      const t = Date.parse(rec.t);
      if (t < sinceMs || t > untilMs) continue;
      if (minLevel && levelValue(rec.lvl) < minLevel) continue;
      if (q.proc && rec.proc !== q.proc) continue;
      if (q.src && rec.src !== q.src) continue;
      if (boot && rec.boot !== boot) continue;
      if (q.ctx) {
        let ok = true;
        for (const [k, v] of Object.entries(q.ctx)) {
          if (!rec.ctx || rec.ctx[k] !== v) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      if (needle) {
        const hay = `${rec.msg || ''} ${rec.src || ''} ${rec.err?.msg || ''} ${rec.err?.code || ''}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      matched.push(rec);
    }
  }

  matched.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const records = matched.slice(-limit);

  const byLevel = {};
  const bySrc = {};
  for (const rec of matched) {
    byLevel[rec.lvl] = (byLevel[rec.lvl] || 0) + (rec.repeat?.n || 1);
    if (rec.src) bySrc[rec.src] = (bySrc[rec.src] || 0) + (rec.repeat?.n || 1);
  }
  const topSrc = Object.entries(bySrc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    records,
    summary: {
      scanned,
      matched: matched.length,
      returned: records.length,
      files: files.length,
      boot: boot || null,
      byLevel,
      topSources: Object.fromEntries(topSrc),
      window: {
        from: records[0]?.t || null,
        to: records[records.length - 1]?.t || null,
      },
    },
  };
}

/** Crash records, newest first. `full: false` omits the ring for a cheap list. */
export function readCrashes(dir, { limit = 10, full = false } = {}) {
  const crashDir = path.join(dir, 'crashes');
  let names;
  try {
    names = fs.readdirSync(crashDir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => {
      const file = path.join(crashDir, name);
      try {
        const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!full) {
          const { ring, ...rest } = rec;
          return { ...rest, file, ringSize: Array.isArray(ring) ? ring.length : 0 };
        }
        return { ...rec, file };
      } catch (err) {
        return { file, error: err.message };
      }
    });
}

export default readRecords;
