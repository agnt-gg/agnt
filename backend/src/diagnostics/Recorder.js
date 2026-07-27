/**
 * Recorder — the flight recorder.
 *
 * One append-only JSONL file per UTC day that ALL FOUR AGNT processes write to
 * directly (main, renderer-relay, backend, workflow child). No broker process,
 * because the broker's own death is exactly the event we most need recorded.
 *
 * Direct concurrent append is safe here: a single write() to a file opened
 * O_APPEND is atomic below the pipe-buffer threshold. Verified empirically on
 * this platform — 4 OS processes x 3000 variable-length appends to one file
 * produced 12000 parseable lines, 0 torn. That 4096-byte threshold is why
 * MAX_LINE_BYTES exists and why oversized payloads spill to the blob store.
 *
 * Two write paths, deliberately different:
 *   HOT   — writeSync, no fsync.        ~3.2us p50 / 8.5us mean.
 *   FATAL — writeSync + fsyncSync, once. ~6.8ms for a 500-record ring dump.
 *
 * The hot path is synchronous ON PURPOSE. fs.write() is ~3x faster per call but
 * dispatches to the threadpool, so two in-flight writes from the same process
 * have no ordering guarantee — a log whose lines can transpose is a log that
 * lies about causality. Batching would restore order but merges records into
 * one >4096B write, forfeiting cross-process atomicity. writeSync keeps both
 * guarantees for 3.2us, which at AGNT's busiest observed rate (1,145 records/day)
 * totals under 4ms of blocking per day.
 *
 * Depends on node builtins only, so main.js, the backend, and the workflow
 * child can all construct one without dragging in any AGNT module.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash, randomUUID } from 'crypto';
import { LEVELS, levelValue, levelName } from './levels.js';
import { redact } from './redact.js';
import { currentContext } from './context.js';

const RING_SIZE = 500;
const MAX_LINE_BYTES = 3584; // headroom under the 4096B atomic-append limit
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_KEYS = 2048;

/** Only these env vars may ever appear in a crash record. */
const ENV_ALLOW = [
  'NODE_ENV',
  'PORT',
  'AGNT_BOOT_ID',
  'AGNT_LOG_LEVEL',
  'AGNT_HOME',
  'USER_DATA_PATH',
  'IS_WORKFLOW_PROCESS',
  'AGNT_SKIP_DB_INIT',
];

function snapshotSystem() {
  const mem = process.memoryUsage();
  const round = (n) => Math.round(n / 1048576);
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions?.node,
    electron: process.versions?.electron,
    v8: process.versions?.v8,
    uptimeSec: Math.round(process.uptime()),
    memMB: {
      rss: round(mem.rss),
      heapUsed: round(mem.heapUsed),
      heapTotal: round(mem.heapTotal),
      external: round(mem.external),
      arrayBuffers: round(mem.arrayBuffers || 0),
    },
    freeMemMB: round(os.freemem()),
    totalMemMB: round(os.totalmem()),
    cpus: os.cpus()?.length,
    loadAvg: os.loadavg().map((n) => +n.toFixed(2)),
  };
}

function snapshotEnv() {
  const out = {};
  for (const key of ENV_ALLOW) {
    if (process.env[key] !== undefined) out[key] = process.env[key];
  }
  return out;
}

export class Recorder {
  /**
   * @param {object}  opts
   * @param {string}  opts.dir            diagnostics directory
   * @param {string}  opts.proc           'main' | 'renderer' | 'backend' | 'workflow'
   * @param {string} [opts.bootId]        shared across every process of one app launch
   * @param {string} [opts.level='INFO']  minimum level persisted to disk
   * @param {number} [opts.ringSize=500]  flight-recorder depth
   */
  constructor({
    dir,
    proc,
    bootId,
    level = process.env.AGNT_LOG_LEVEL || 'INFO',
    ringSize = RING_SIZE,
    maxFileBytes = MAX_FILE_BYTES,
    dedupWindowMs = DEDUP_WINDOW_MS,
    now = () => Date.now(),
  }) {
    this.dir = dir;
    this.proc = proc;
    this.bootId = bootId || process.env.AGNT_BOOT_ID || randomUUID();
    this.minLevel = levelValue(level);
    this.maxFileBytes = maxFileBytes;
    this.dedupWindowMs = dedupWindowMs;
    this._now = now;

    this.ring = new Array(ringSize);
    this.ringSize = ringSize;
    this.ringPos = 0;

    this._fd = null;
    this._day = null;
    this._part = 0;
    this._bytes = 0;
    this._sinceStat = 0;
    this._dedup = new Map();
    this._closed = false;

    /** Set while emitting, so a failure inside the recorder can't recurse. */
    this._inside = false;
    this.dropped = 0;
  }

  /* ------------------------------------------------------------------ *
   * File handling
   * ------------------------------------------------------------------ */

  _fileName(day, part) {
    return part === 0 ? `agnt-${day}.jsonl` : `agnt-${day}.${part}.jsonl`;
  }

  /** Lazily (re)open on UTC day boundary or size roll. Returns fd or null. */
  _handle() {
    const day = new Date(this._now()).toISOString().slice(0, 10);

    if (this._fd !== null && day === this._day) {
      // Our byte counter is a lower bound: other processes append too.
      // Re-stat occasionally rather than syscalling on every single write.
      if (this._bytes < this.maxFileBytes) {
        if (++this._sinceStat < 1000) return this._fd;
        this._sinceStat = 0;
        try {
          this._bytes = fs.fstatSync(this._fd).size;
        } catch {
          /* fall through to reopen */
        }
        if (this._bytes < this.maxFileBytes) return this._fd;
      }
      this._part += 1; // rolled by size
    } else {
      this._part = 0; // new day
    }

    if (this._fd !== null) {
      try {
        fs.closeSync(this._fd);
      } catch {
        /* ignore */
      }
      this._fd = null;
    }

    fs.mkdirSync(this.dir, { recursive: true });

    // Skip past any part already at capacity. Two processes racing to roll is
    // benign — they either pick the same part (and both append, which is fine)
    // or adjacent ones.
    let part = this._part;
    let file = path.join(this.dir, this._fileName(day, part));
    let size = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      try {
        size = fs.statSync(file).size;
      } catch {
        size = 0;
      }
      if (size < this.maxFileBytes) break;
      file = path.join(this.dir, this._fileName(day, ++part));
    }

    this._fd = fs.openSync(file, 'a');
    this._day = day;
    this._part = part;
    this._bytes = size;
    this._sinceStat = 0;
    this.file = file;
    return this._fd;
  }

  /** Move an oversized payload into the content-addressed blob store. */
  _spill(record) {
    const payload = JSON.stringify({ err: record.err, data: record.data });
    const sha = createHash('sha256').update(payload).digest('hex');
    const blobDir = path.join(this.dir, 'blobs');
    try {
      fs.mkdirSync(blobDir, { recursive: true });
      const target = path.join(blobDir, `${sha}.json`);
      if (!fs.existsSync(target)) fs.writeFileSync(target, payload);
    } catch {
      /* a failed spill must not lose the record itself */
    }
    const slim = { ...record, ref: `blob:sha256-${sha}` };
    // Keep the highest-signal fields inline so the line stays useful alone.
    if (record.err) slim.err = { name: record.err.name, code: record.err.code, msg: record.err.msg };
    delete slim.data;
    return slim;
  }

  /* ------------------------------------------------------------------ *
   * Dedup
   * ------------------------------------------------------------------ */

  _dedupKey(rec) {
    return `${rec.lvl}\u0000${rec.src || ''}\u0000${rec.msg}\u0000${rec.err?.code || ''}\u0000${rec.ctx?.workflowId || ''}`;
  }

  /**
   * @returns {boolean} true when the caller should SUPPRESS this record.
   *
   * No timers: a repeat summary is emitted lazily when the next duplicate
   * arrives after the window closed, and eagerly on crash/close. A logger that
   * keeps a timer alive can hold the event loop open and change shutdown
   * behaviour, which is a steep price for punctual summaries.
   */
  _shouldSuppress(rec) {
    const key = this._dedupKey(rec);
    const now = this._now();
    const hit = this._dedup.get(key);

    if (!hit) {
      if (this._dedup.size >= DEDUP_MAX_KEYS) {
        const oldest = this._dedup.keys().next().value;
        this._flushRepeat(oldest);
        this._dedup.delete(oldest);
      }
      this._dedup.set(key, { n: 1, firstAt: now, windowStart: now, sample: rec });
      return false;
    }

    if (now - hit.windowStart >= this.dedupWindowMs) {
      this._flushRepeat(key);
      hit.n = 1;
      hit.firstAt = now;
      hit.windowStart = now;
      hit.sample = rec;
      return false;
    }

    hit.n += 1;
    return true;
  }

  /** Emit the "…and N more" summary for one dedup key. */
  _flushRepeat(key) {
    const hit = this._dedup.get(key);
    if (!hit || hit.n <= 1) return;
    const summary = {
      ...hit.sample,
      t: new Date(this._now()).toISOString(),
      repeat: {
        n: hit.n,
        firstAt: new Date(hit.firstAt).toISOString(),
        windowMs: this._now() - hit.windowStart,
      },
    };
    hit.n = 1;
    this._emit(summary);
  }

  /** Flush every pending repeat summary. */
  flushRepeats() {
    for (const key of [...this._dedup.keys()]) this._flushRepeat(key);
  }

  /* ------------------------------------------------------------------ *
   * Write paths
   * ------------------------------------------------------------------ */

  /** Serialize + append one already-built record. Never throws. */
  _emit(record) {
    if (this._closed) return;
    try {
      let line = JSON.stringify(record);
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
        line = JSON.stringify(this._spill(record));
      }
      const buf = Buffer.from(`${line}\n`);
      const fd = this._handle();
      if (fd === null) return;
      fs.writeSync(fd, buf);
      this._bytes += buf.length;
    } catch {
      this.dropped += 1; // disk full / EACCES — degrade silently, never recurse
    }
  }

  /**
   * The primary API.
   * @param {string} level  TRACE|DEBUG|INFO|WARN|ERROR|FATAL
   * @param {string} src    subsystem tag, e.g. 'buzz-trigger'
   * @param {string} msg    STABLE literal — put variables in `data`, not here
   */
  write(level, src, msg, { err, data } = {}) {
    if (this._closed || this._inside) return;
    this._inside = true;
    try {
      const lvl = levelName(level);
      const rec = {
        t: new Date(this._now()).toISOString(),
        lvl,
        proc: this.proc,
        pid: process.pid,
        boot: this.bootId,
      };
      if (src) rec.src = String(src);
      rec.msg = typeof msg === 'string' ? msg : String(msg);
      if (err) rec.err = redact(err);
      const ctx = currentContext();
      if (ctx) rec.ctx = ctx;
      if (data !== undefined) rec.data = redact(data);

      // ALWAYS ring, at every level. This is the whole point: full-fidelity
      // DEBUG for the ~30s before a crash, at zero steady-state disk cost.
      this.ring[this.ringPos++ % this.ringSize] = rec;

      if (LEVELS[lvl] < this.minLevel) return;
      if (this._shouldSuppress(rec)) return;
      this._emit(rec);
    } catch {
      this.dropped += 1;
    } finally {
      this._inside = false;
    }
  }

  trace(src, msg, extra) { this.write('TRACE', src, msg, extra); }
  debug(src, msg, extra) { this.write('DEBUG', src, msg, extra); }
  info(src, msg, extra) { this.write('INFO', src, msg, extra); }
  warn(src, msg, extra) { this.write('WARN', src, msg, extra); }
  error(src, msg, extra) { this.write('ERROR', src, msg, extra); }
  fatal(src, msg, extra) { this.write('FATAL', src, msg, extra); }

  /**
   * Adapter for intercepted console.* calls.
   * Extracts a leading "[tag]" into `src` so thousands of existing call sites
   * become structured with zero edits.
   */
  raw(level, args) {
    if (this._closed || this._inside) return;
    try {
      const list = Array.from(args || []);
      let src;
      let msg = '';
      let err;
      const rest = [];

      for (const arg of list) {
        if (arg instanceof Error || (arg && typeof arg.stack === 'string' && typeof arg.message === 'string')) {
          if (!err) err = arg;
          else rest.push(arg);
          continue;
        }
        if (typeof arg === 'string' && !msg) {
          msg = arg;
          continue;
        }
        rest.push(arg);
      }

      if (!msg && err) msg = err.message || 'error';
      if (!msg && rest.length) msg = typeof rest[0] === 'string' ? rest.shift() : '(no message)';

      const tag = /^\s*\[([^\]]{1,64})\]:?\s*/.exec(msg);
      if (tag) {
        src = tag[1];
        msg = msg.slice(tag[0].length);
      }
      if (msg.length > 400) msg = `${msg.slice(0, 400)}\u2026`;

      this.write(level, src, msg || '(empty)', {
        err,
        data: rest.length ? { args: rest } : undefined,
      });
    } catch {
      this.dropped += 1;
    }
  }

  /* ------------------------------------------------------------------ *
   * Fatal path
   * ------------------------------------------------------------------ */

  /** Oldest-first copy of the ring. */
  snapshotRing() {
    const out = [];
    const start = this.ringPos > this.ringSize ? this.ringPos : 0;
    for (let i = 0; i < this.ringSize; i++) {
      const rec = this.ring[(start + i) % this.ringSize];
      if (rec) out.push(rec);
    }
    return out;
  }

  /**
   * Dump the entire ring plus a system snapshot, synchronously and fsync'd.
   * ~6.8ms for 500 records. Returns the crash file path, or null.
   */
  dumpCrash(reason, err, state = {}) {
    try {
      this.flushRepeats();
      const crash = {
        kind: 'crash',
        v: 1,
        t: new Date(this._now()).toISOString(),
        boot: this.bootId,
        proc: this.proc,
        pid: process.pid,
        reason,
        err: err ? redact(err) : undefined,
        sys: snapshotSystem(),
        env: snapshotEnv(),
        state: redact(state),
        ring: this.snapshotRing(),
      };

      const dir = path.join(this.dir, 'crashes');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = crash.t.replace(/[:.]/g, '-');
      const file = path.join(dir, `${stamp}-${this.proc}-${reason}.json`);

      const fd = fs.openSync(file, 'w');
      try {
        fs.writeSync(fd, JSON.stringify(crash, null, 2)); // one write...
        fs.fsyncSync(fd); // ...one durability barrier
      } finally {
        fs.closeSync(fd);
      }

      // Also drop a one-line marker in the main stream so a plain tail shows it.
      this._emit({
        t: crash.t,
        lvl: 'FATAL',
        proc: this.proc,
        pid: process.pid,
        boot: this.bootId,
        src: 'diagnostics',
        msg: 'crash record written',
        data: { reason, file, ringSize: crash.ring.length },
      });

      return file;
    } catch {
      this.dropped += 1;
      return null;
    }
  }

  /** Flush summaries and release the fd. Safe to call more than once. */
  close() {
    if (this._closed) return;
    try {
      this.flushRepeats();
    } catch {
      /* ignore */
    }
    this._closed = true;
    if (this._fd !== null) {
      try {
        fs.closeSync(this._fd);
      } catch {
        /* ignore */
      }
      this._fd = null;
    }
  }
}

export default Recorder;
