import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Recorder } from './Recorder.js';
import { redact, isSecretKey, redactString } from './redact.js';
import { installConsoleBridge } from './consoleBridge.js';
import { withContext } from './context.js';
import { sweep, purgeLegacyLogs } from './retention.js';
import { readRecords, readCrashes } from './read.js';
import {
  isBenignPipeError,
  shouldDumpCrash,
  _resetDiagnosticsInstallForTests,
} from './install.js';

let DIR;

function lines(dir = DIR) {
  const file = fs.readdirSync(dir).find((n) => /^agnt-.*\.jsonl$/.test(n));
  if (!file) return [];
  return fs
    .readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-diag-'));
});

afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
  _resetDiagnosticsInstallForTests();
});

/* ------------------------------------------------------------------ *
 * Fatal handling — EPIPE must not produce crash-file storms
 * ------------------------------------------------------------------ */
describe('fatal pipe / crash dedupe', () => {
  it('treats EPIPE / broken pipe / destroyed stream as benign', () => {
    expect(isBenignPipeError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true);
    expect(isBenignPipeError(Object.assign(new Error('x'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(true);
    expect(isBenignPipeError(new Error('write broken pipe after parent exit'))).toBe(true);
    expect(isBenignPipeError(new Error('something else blew up'))).toBe(false);
    expect(isBenignPipeError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false);
  });

  it('dedupes identical crash dumps within the window', () => {
    _resetDiagnosticsInstallForTests();
    const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    // shouldDumpCrash is for non-benign dumps; use a real app error
    const boom = new Error('kaboom');
    expect(shouldDumpCrash('uncaughtException', boom, 1000)).toBe(true);
    expect(shouldDumpCrash('uncaughtException', boom, 2000)).toBe(false);
    expect(shouldDumpCrash('uncaughtException', boom, 3000)).toBe(false);
    // After window elapses, dump again
    expect(shouldDumpCrash('uncaughtException', boom, 1000 + 60_000 + 1)).toBe(true);
  });

  it('does not dedupe different errors', () => {
    _resetDiagnosticsInstallForTests();
    expect(shouldDumpCrash('uncaughtException', new Error('a'), 1)).toBe(true);
    expect(shouldDumpCrash('uncaughtException', new Error('b'), 2)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Redaction — the highest-stakes component. A leaked key is worse than
 * a lost log, and this machine has nsec/OAuth/provider keys on disk.
 * ------------------------------------------------------------------ */
describe('redact', () => {
  it('replaces values under secret-looking keys, whatever the value is', () => {
    const out = redact({
      authorization: 'Basic Zm9vOmJhcg==',
      apiKey: 'totally-innocuous-looking',
      api_key: 'x',
      refreshToken: 'abc',
      nested: { clientSecret: 'shh' },
      keep: 'visible',
    });
    expect(out.authorization).toMatch(/^\[REDACTED:/);
    expect(out.apiKey).toMatch(/^\[REDACTED:/);
    expect(out.api_key).toMatch(/^\[REDACTED:/);
    expect(out.refreshToken).toMatch(/^\[REDACTED:/);
    expect(out.nested.clientSecret).toMatch(/^\[REDACTED:/);
    expect(out.keep).toBe('visible');
  });

  it('catches secret-shaped values with innocuous key names', () => {
    const out = redact({
      note: 'use sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA when calling',
      url: 'https://x.dev?k=AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      nostr: 'nsec1abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmn',
      header: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaa',
    });
    expect(out.note).not.toContain('sk-proj-AAAA');
    expect(out.url).not.toContain('AIzaSy');
    expect(out.nostr).not.toContain('nsec1abcdef');
    expect(out.header).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('leaks no raw bytes of the secret, but names its kind', () => {
    const secret = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const out = redactString(`key=${secret}`);
    expect(out).toBe(`key=[REDACTED:google-api-key:${secret.length}chars:sha256=20394653]`);
    expect(out).not.toMatch(/AIza/);
    expect(redactString('tok=nsec1abcdefghijklmnopqrstuvwxyz0123456789')).toContain('nostr-nsec');
    expect(redactString('sk-ant-AAAAAAAAAAAAAAAAAAAA')).toContain('anthropic-key');
  });

  it('preserves shape so two uses of one key are still comparable', () => {
    const a = redactString('sk-AAAAAAAAAAAAAAAAAAAAAAAAAA');
    const b = redactString('sk-AAAAAAAAAAAAAAAAAAAAAAAAAA');
    const c = redactString('sk-BBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/sha256=[0-9a-f]{8}/);
  });

  it('survives circular, deep, and unserializable input', () => {
    const circular = { name: 'root' };
    circular.self = circular;
    expect(() => JSON.stringify(redact(circular))).not.toThrow();
    expect(JSON.stringify(redact(circular))).toContain('[Circular]');

    let deep = { v: 1 };
    for (let i = 0; i < 40; i++) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain('[MaxDepth]');
  });

  it('unwraps AggregateError chains, where the real code always lives', () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const agg = Object.assign(new AggregateError([inner], 'fetch failed'), { code: undefined });
    const out = redact(agg);
    expect(out.errors[0].code).toBe('ECONNREFUSED');
  });

  it('flags secret keys but not innocuous ones', () => {
    expect(isSecretKey('Authorization')).toBe(true);
    expect(isSecretKey('x-api-key')).toBe(true);
    expect(isSecretKey('workflowId')).toBe(false);
    expect(isSecretKey('relayUrl')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe('Recorder', () => {
  it('writes one parseable JSON object per line', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend', bootId: 'boot-1' });
    r.error('buzz-trigger', 'poll failed', {
      err: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      data: { relayUrl: 'http://localhost:3000' },
    });
    r.close();

    const [rec] = lines();
    expect(rec.lvl).toBe('ERROR');
    expect(rec.proc).toBe('backend');
    expect(rec.boot).toBe('boot-1');
    expect(rec.src).toBe('buzz-trigger');
    expect(rec.msg).toBe('poll failed');
    expect(rec.err.code).toBe('ECONNREFUSED');
    expect(rec.data.relayUrl).toBe('http://localhost:3000');
    expect(rec.pid).toBe(process.pid);
  });

  it('honours the disk level but rings EVERY level', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend', level: 'WARN' });
    r.debug('x', 'debug line');
    r.info('x', 'info line');
    r.warn('x', 'warn line');
    r.close();

    expect(lines().map((l) => l.msg)).toEqual(['warn line']);
    // …but the flight recorder kept all three for the crash dump.
    expect(r.snapshotRing().map((l) => l.msg)).toEqual(['debug line', 'info line', 'warn line']);
  });

  it('collapses a repeating error and reports the count', () => {
    let now = 1_000_000;
    const r = new Recorder({ dir: DIR, proc: 'workflow', now: () => now, dedupWindowMs: 60_000 });

    // The Buzz case: identical ECONNREFUSED every 5s, forever.
    for (let i = 0; i < 12; i++) {
      r.error('buzz-trigger', 'poll failed', { err: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
      now += 5_000;
    }
    r.error('buzz-trigger', 'poll failed', { err: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
    r.close();

    const out = lines();
    expect(out[0].repeat).toBeUndefined();
    const summary = out.find((l) => l.repeat);
    expect(summary).toBeDefined();
    expect(summary.repeat.n).toBe(12);
    // 13 raw events -> 3 lines, and the middle one carries the count.
    expect(out.length).toBeLessThan(5);
  });

  it('does not collapse records that differ in context', () => {
    const r = new Recorder({ dir: DIR, proc: 'workflow' });
    withContext({ workflowId: 'wf-a' }, () => r.error('t', 'same message'));
    withContext({ workflowId: 'wf-b' }, () => r.error('t', 'same message'));
    r.close();
    expect(lines()).toHaveLength(2);
  });

  it('auto-injects ambient correlation context', () => {
    const r = new Recorder({ dir: DIR, proc: 'workflow' });
    withContext({ workflowId: 'wf-1', nodeId: 'n-1', userId: 'u-1' }, () => {
      r.info('exec', 'node started');
    });
    r.close();
    const [rec] = lines();
    expect(rec.ctx).toEqual({ userId: 'u-1', workflowId: 'wf-1', nodeId: 'n-1' });
  });

  it('spills oversized payloads to a blob and keeps the line atomic', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend' });
    r.error('big', 'huge payload', {
      err: Object.assign(new Error('boom'), { code: 'E_BIG' }),
      data: { blob: 'y'.repeat(50_000) },
    });
    r.close();

    const [rec] = lines();
    expect(rec.ref).toMatch(/^blob:sha256-[0-9a-f]{64}$/);
    expect(rec.data).toBeUndefined();
    expect(rec.err.code).toBe('E_BIG'); // high-signal fields stay inline
    expect(Buffer.byteLength(JSON.stringify(rec))).toBeLessThan(4096);

    const sha = rec.ref.replace('blob:sha256-', '');
    const blob = JSON.parse(fs.readFileSync(path.join(DIR, 'blobs', `${sha}.json`), 'utf8'));
    // redact() caps any single string at 8 KB before the record is ever built,
    // and records how much it dropped — the blob holds that capped form.
    expect(blob.data.blob).toMatch(/^y{8192}\u2026\[\+41808\]$/);
  });

  it('rolls to a new part when the file exceeds its size cap', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend', maxFileBytes: 2000 });
    for (let i = 0; i < 40; i++) r.info('roll', `line ${i}`);
    r.close();

    const files = fs.readdirSync(DIR).filter((n) => n.endsWith('.jsonl'));
    expect(files.length).toBeGreaterThan(1);
    expect(files.some((n) => /\.\d+\.jsonl$/.test(n))).toBe(true);
  });

  it('never throws when the directory is unwritable', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend' });
    vi.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw new Error('ENOSPC');
    });
    expect(() => r.error('x', 'still fine')).not.toThrow();
    expect(r.dropped).toBeGreaterThan(0);
  });

  it('dumps the whole ring, fsynced, on a crash', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend', level: 'ERROR' });
    for (let i = 0; i < 20; i++) r.debug('trace', `step ${i}`); // never hits disk
    const fsyncSpy = vi.spyOn(fs, 'fsyncSync');

    const file = r.dumpCrash('uncaughtException', new Error('kaboom'), { activeWorkflows: ['wf-1'] });
    expect(file).toBeTruthy();
    expect(fsyncSpy).toHaveBeenCalled();

    const crash = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(crash.kind).toBe('crash');
    expect(crash.reason).toBe('uncaughtException');
    expect(crash.err.msg).toBe('kaboom');
    expect(crash.state.activeWorkflows).toEqual(['wf-1']);
    expect(crash.ring).toHaveLength(20);
    expect(crash.ring[0].msg).toBe('step 0'); // oldest first
    expect(crash.sys.memMB.rss).toBeGreaterThan(0);
    r.close();
  });

  it('keeps only the newest N in the ring and dumps them oldest-first', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend', ringSize: 10, level: 'FATAL' });
    for (let i = 0; i < 25; i++) r.debug('t', `m${i}`);
    const ring = r.snapshotRing();
    expect(ring).toHaveLength(10);
    expect(ring[0].msg).toBe('m15');
    expect(ring[9].msg).toBe('m24');
    r.close();
  });

  it('captures only allow-listed env vars in a crash record', () => {
    process.env.AGNT_SECRET_TEST = 'super-secret-value';
    const r = new Recorder({ dir: DIR, proc: 'backend' });
    const file = r.dumpCrash('test', new Error('x'));
    const crash = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(JSON.stringify(crash.env)).not.toContain('super-secret-value');
    expect(crash.env).not.toHaveProperty('AGNT_SECRET_TEST');
    delete process.env.AGNT_SECRET_TEST;
    r.close();
  });
});

/* ------------------------------------------------------------------ */
describe('consoleBridge', () => {
  function fakeConsole() {
    const seen = [];
    return {
      seen,
      target: {
        log: (...a) => seen.push(['log', a]),
        warn: (...a) => seen.push(['warn', a]),
        error: (...a) => seen.push(['error', a]),
        info: (...a) => seen.push(['info', a]),
        debug: (...a) => seen.push(['debug', a]),
        trace: (...a) => seen.push(['trace', a]),
      },
    };
  }

  it('turns the real buzz-trigger line into a structured record, no call-site edits', () => {
    const r = new Recorder({ dir: DIR, proc: 'workflow' });
    const { target } = fakeConsole();
    const off = installConsoleBridge(r, { target });

    const err = Object.assign(new Error('Cannot reach the Buzz relay at http://localhost:3000'), {
      code: 'ECONNREFUSED',
    });
    target.error('[buzz-trigger] poll error:', err);

    off();
    r.close();

    const [rec] = lines();
    expect(rec.lvl).toBe('ERROR');
    expect(rec.src).toBe('buzz-trigger');
    expect(rec.msg).toBe('poll error:');
    expect(rec.err.code).toBe('ECONNREFUSED');
  });

  it('keeps native console output intact', () => {
    const r = new Recorder({ dir: DIR, proc: 'main' });
    const { seen, target } = fakeConsole();
    const off = installConsoleBridge(r, { target });
    target.log('hello', 42);
    off();
    r.close();
    expect(seen).toEqual([['log', ['hello', 42]]]);
  });

  it('maps each console method to the right level', () => {
    const r = new Recorder({ dir: DIR, proc: 'main', level: 'TRACE' });
    const { target } = fakeConsole();
    const off = installConsoleBridge(r, { target });
    target.trace('t');
    target.debug('d');
    target.log('l');
    target.info('i');
    target.warn('w');
    target.error('e');
    off();
    r.close();
    expect(lines().map((l) => l.lvl)).toEqual(['TRACE', 'DEBUG', 'INFO', 'INFO', 'WARN', 'ERROR']);
  });

  it('cannot recurse when the recorder itself fails', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend' });
    const { target } = fakeConsole();
    vi.spyOn(r, 'raw').mockImplementation(() => {
      target.error('recorder blew up'); // would be infinite without the guard
    });
    const off = installConsoleBridge(r, { target });
    expect(() => target.error('trigger')).not.toThrow();
    off();
    r.close();
  });

  it('restores the original methods on uninstall', () => {
    const r = new Recorder({ dir: DIR, proc: 'main' });
    const { target } = fakeConsole();
    const original = target.error;
    const off = installConsoleBridge(r, { target });
    expect(target.error).not.toBe(original);
    off();
    expect(target.error).toBe(original);
    r.close();
  });
});

/* ------------------------------------------------------------------ */
describe('retention', () => {
  it('deletes aged files, gzips cold ones, and keeps crash records', () => {
    const old = Date.now() - 40 * 86_400_000;
    const cold = Date.now() - 3 * 86_400_000;

    fs.writeFileSync(path.join(DIR, 'agnt-2026-01-01.jsonl'), 'x\n');
    fs.utimesSync(path.join(DIR, 'agnt-2026-01-01.jsonl'), old / 1000, old / 1000);
    fs.writeFileSync(path.join(DIR, 'agnt-2026-07-20.jsonl'), 'y\n');
    fs.utimesSync(path.join(DIR, 'agnt-2026-07-20.jsonl'), cold / 1000, cold / 1000);

    fs.mkdirSync(path.join(DIR, 'crashes'), { recursive: true });
    const crash = path.join(DIR, 'crashes', 'ancient.json');
    fs.writeFileSync(crash, '{}');
    fs.utimesSync(crash, old / 1000, old / 1000);

    const report = sweep(DIR, { maxAgeDays: 30, gzipAfterHours: 24 });

    expect(report.deleted).toContain('agnt-2026-01-01.jsonl');
    expect(report.gzipped).toContain('agnt-2026-07-20.jsonl');
    expect(fs.existsSync(path.join(DIR, 'agnt-2026-07-20.jsonl.gz'))).toBe(true);
    // crashKeepMin protects it even though it is 40 days old
    expect(fs.existsSync(crash)).toBe(true);
  });

  it('enforces the total size ceiling oldest-first', () => {
    for (let i = 1; i <= 5; i++) {
      const f = path.join(DIR, `agnt-2026-07-0${i}.jsonl`);
      fs.writeFileSync(f, 'z'.repeat(1000));
      const t = (Date.now() - (6 - i) * 3_600_000) / 1000;
      fs.utimesSync(f, t, t);
    }
    const report = sweep(DIR, { maxTotalBytes: 2500, gzipAfterHours: 999, maxAgeDays: 999 });
    expect(report.keptBytes).toBeLessThanOrEqual(2500);
    expect(report.deleted[0]).toBe('agnt-2026-07-01.jsonl'); // oldest first
    expect(fs.existsSync(path.join(DIR, 'agnt-2026-07-05.jsonl'))).toBe(true);
  });

  it('purgeLegacyLogs is dry-run by default', () => {
    const legacy = path.join(DIR, '_logs');
    fs.mkdirSync(legacy);
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(legacy, `2026-07-26T0${i}-00-00-000Z.log`), 'x');
    }
    const dry = purgeLegacyLogs(legacy);
    expect(dry.dryRun).toBe(true);
    expect(dry.deleted).toBe(5);
    expect(fs.readdirSync(legacy)).toHaveLength(5); // nothing actually removed

    const real = purgeLegacyLogs(legacy, { dryRun: false });
    expect(real.deleted).toBe(5);
    expect(fs.readdirSync(legacy)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
describe('read', () => {
  it('filters by level, process, source, context and text', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend', bootId: 'boot-A', level: 'DEBUG' });
    r.info('http', 'request ok');
    r.error('db', 'query failed');
    withContext({ workflowId: 'wf-9' }, () => r.error('exec', 'node blew up'));
    r.close();

    expect(readRecords({ dir: DIR, level: 'ERROR' }).records).toHaveLength(2);
    expect(readRecords({ dir: DIR, src: 'db' }).records[0].msg).toBe('query failed');
    expect(readRecords({ dir: DIR, ctx: { workflowId: 'wf-9' } }).records).toHaveLength(1);
    expect(readRecords({ dir: DIR, grep: 'blew' }).records).toHaveLength(1);
    expect(readRecords({ dir: DIR, proc: 'workflow' }).records).toHaveLength(0);
  });

  it('resolves boot=last to the most recent launch', () => {
    const a = new Recorder({ dir: DIR, proc: 'backend', bootId: 'boot-OLD' });
    a.info('x', 'from old boot');
    a.close();
    const b = new Recorder({ dir: DIR, proc: 'backend', bootId: 'boot-NEW' });
    b.info('x', 'from new boot');
    b.close();

    const res = readRecords({ dir: DIR, boot: 'last' });
    expect(res.summary.boot).toBe('boot-NEW');
    expect(res.records.map((r) => r.msg)).toEqual(['from new boot']);
  });

  it('survives a torn line instead of aborting the query', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend' });
    r.info('x', 'good one');
    r.close();
    const file = path.join(DIR, fs.readdirSync(DIR).find((n) => n.endsWith('.jsonl')));
    fs.appendFileSync(file, '{"t":"broken\n');
    fs.appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), lvl: 'INFO', msg: 'after tear' })}\n`);

    const res = readRecords({ dir: DIR });
    expect(res.records.map((r) => r.msg)).toEqual(['good one', 'after tear']);
  });

  it('lists crashes without loading their rings', () => {
    const r = new Recorder({ dir: DIR, proc: 'backend' });
    r.info('x', 'a');
    r.dumpCrash('uncaughtException', new Error('boom'));
    r.close();

    const list = readCrashes(DIR);
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('uncaughtException');
    expect(list[0].ring).toBeUndefined();
    expect(list[0].ringSize).toBeGreaterThan(0);
    expect(readCrashes(DIR, { full: true })[0].ring.length).toBeGreaterThan(0);
  });
});
