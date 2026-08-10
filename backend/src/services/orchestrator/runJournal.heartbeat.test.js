/**
 * The heartbeat: a safety net for the journal, not a second mechanism.
 *
 * WHAT IT IS FOR, AND WHAT IT IS DELIBERATELY NOT FOR
 * ──────────────────────────────────────────────────
 * The event-driven throttle already bounds staleness. Measured before writing
 * any of this: a run that publishes three events and then falls silent for
 * twelve seconds — which is exactly what a long synchronous tool call looks
 * like — has its LAST event on disk three seconds in. Nothing is stranded, and
 * an unconditional periodic flush would rewrite byte-identical files forever.
 *
 * What the throttle cannot do is RETRY. `pending` is cleared before the write
 * is attempted, so a failed write leaves nothing scheduled, and the next
 * attempt waits for the next event. During a long tool call none arrives.
 * Measured too: a run whose write failed stayed absent from disk indefinitely.
 *
 * So the tests below are mostly about restraint — the heartbeat must do
 * nothing when there is nothing to do — and about the one case where it must
 * act.
 *
 * Runs against a throwaway AGNT_HOME.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import os from 'os';

let journal;
let TMP;
let DIR;
const savedEnv = {};

/** Poll until `probe` is truthy — never a bare sleep, which makes flaky gates. */
async function until(probe, { timeout = 5000, interval = 25, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

const makeRun = (conversationId, extra = {}) => ({
  conversationId,
  userId: 'hb-user',
  chatType: 'orchestrator',
  startedAt: Date.now(),
  userMessage: 'heartbeat test',
  truncated: false,
  bytes: 100,
  ended: false,
  events: [
    { eventName: 'conversation_started', data: {} },
    { eventName: 'assistant_message', data: { id: 'a1', role: 'assistant', content: '' } },
    { eventName: 'content_delta', data: { assistantMessageId: 'a1', delta: 'partial answer' } },
  ],
  latest: new Map(),
  subscribers: new Set(),
  ...extra,
});

const journalFor = async (id) => (await journal.listJournals()).find((j) => j.conversationId === id);

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-hb-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  await fsp.mkdir(path.join(TMP, '.agnt', 'data'), { recursive: true });
  journal = await import('./runJournal.js');
  DIR = path.join(TMP, '.agnt', 'data', 'run-journal');
}, 60000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  journal._resetForTests();
  await fsp.rm(DIR, { recursive: true, force: true }).catch(() => {});
});

afterEach(() => {
  journal.stopJournalHeartbeat();
  // Never leave a directory unwritable behind — the next test would fail for
  // a reason that has nothing to do with what it is checking.
  try { fs.chmodSync(DIR, 0o700); } catch { /* may not exist */ }
});

describe('what the heartbeat is FOR: retrying a write that failed', () => {
  it('recovers a run whose write failed, with no further events', async () => {
    // The gap, exactly: a transient disk error, then a long tool call during
    // which nothing publishes. Before the heartbeat this run stayed uninsured
    // until the turn produced its next event — potentially minutes later.
    const run = makeRun('hb-retry');
    await fsp.mkdir(DIR, { recursive: true });
    await fsp.chmod(DIR, 0o500); // writes fail

    journal.journalRun(run);
    await new Promise((r) => setTimeout(r, 3200)); // let the throttled write fail
    expect(await journalFor('hb-retry')).toBeUndefined();

    // The disk recovers. No new event will ever arrive.
    await fsp.chmod(DIR, 0o700);
    journal.startJournalHeartbeat(() => [run], { intervalMs: 50 });

    const found = await until(() => journalFor('hb-retry'), { what: 'the heartbeat to retry' });
    expect(found.events).toHaveLength(3);
  }, 20000);

  it('keeps retrying while the failure persists, then succeeds', async () => {
    const run = makeRun('hb-persistent');
    await fsp.mkdir(DIR, { recursive: true });
    await fsp.chmod(DIR, 0o500);

    journal.journalRun(run);
    journal.startJournalHeartbeat(() => [run], { intervalMs: 40 });

    // Several heartbeat cycles pass with the directory still unwritable.
    await new Promise((r) => setTimeout(r, 300));
    expect(await journalFor('hb-persistent')).toBeUndefined();

    await fsp.chmod(DIR, 0o700);
    const found = await until(() => journalFor('hb-persistent'), { what: 'recovery once writable' });
    expect(found.conversationId).toBe('hb-persistent');
  }, 20000);
});

describe('what the heartbeat must NOT do: churn', () => {
  it('does not rewrite a journal that is already current', async () => {
    // An unconditional periodic flush would rewrite byte-identical files. For
    // an 8MB run on a 30s timer that is megabytes a minute of pointless I/O,
    // on the same disk as the database, to save data that is already saved.
    const run = makeRun('hb-clean');
    expect(journal.flushAllSync([run])).toBe(1);

    const file = path.join(DIR, fs.readdirSync(DIR).find((f) => f.startsWith('hb-clean')));
    const before = fs.statSync(file).mtimeMs;

    journal.startJournalHeartbeat(() => [run], { intervalMs: 30 });
    await new Promise((r) => setTimeout(r, 400)); // ~13 cycles

    expect(fs.statSync(file).mtimeMs).toBe(before);
  }, 20000);

  it('goes clean after a write and dirty again on the next event', async () => {
    // The full cycle, exercised through the only route that can reach the
    // heartbeat: write, go quiet, take a new event, have THAT write fail, and
    // watch the heartbeat carry it. If `written` were recorded before the
    // write instead of after, the retry here would never happen.
    const run = makeRun('hb-cycle');
    journal.flushAllSync([run]);
    expect((await journalFor('hb-cycle')).events).toHaveLength(3);

    await fsp.chmod(DIR, 0o500); // the next write will fail
    run.events.push({ eventName: 'content_delta', data: { assistantMessageId: 'a1', delta: ' more' } });
    journal.journalRun(run);
    await new Promise((r) => setTimeout(r, 3200)); // throttle fires and fails

    // Still the three-event version: the failed write changed nothing.
    expect((await journalFor('hb-cycle')).events).toHaveLength(3);

    await fsp.chmod(DIR, 0o700);
    journal.startJournalHeartbeat(() => [run], { intervalMs: 40 });

    const found = await until(
      async () => {
        const j = await journalFor('hb-cycle');
        return j && j.events.length === 4 ? j : null;
      },
      { what: 'the heartbeat to carry the fourth event' },
    );
    expect(found.events).toHaveLength(4);
  }, 25000);

  it('leaves a run alone while its throttled write is still scheduled', async () => {
    // Two writers for one run is the situation the temp-path sequence makes
    // harmless; there is still no reason to cause it.
    const run = makeRun('hb-pending');
    journal.journalRun(run); // schedules a write ~3s out
    journal.startJournalHeartbeat(() => [run], { intervalMs: 20 });

    await new Promise((r) => setTimeout(r, 300)); // many cycles, throttle still pending
    expect(await journalFor('hb-pending')).toBeUndefined();

    // ...and the throttle still delivers on its own schedule.
    const found = await until(() => journalFor('hb-pending'), { timeout: 6000, what: 'the throttled write' });
    expect(found.events).toHaveLength(3);
  }, 20000);

  it('ignores runs with nothing worth saving, and ended runs', async () => {
    const empty = makeRun('hb-empty', { events: [{ eventName: 'conversation_started', data: {} }] });
    const ended = makeRun('hb-ended', { ended: true });

    journal.startJournalHeartbeat(() => [empty, ended], { intervalMs: 20 });
    await new Promise((r) => setTimeout(r, 250));

    expect(await journal.listJournals()).toHaveLength(0);
  }, 20000);
});

describe('lifecycle', () => {
  it('starting twice does not create a second interval', async () => {
    const first = journal.startJournalHeartbeat(() => [], { intervalMs: 50 });
    const second = journal.startJournalHeartbeat(() => [], { intervalMs: 50 });
    expect(second).toBe(first);
  });

  it('stops cleanly, and stopping twice is safe', async () => {
    const run = makeRun('hb-stop');
    journal.startJournalHeartbeat(() => [run], { intervalMs: 20 });
    journal.stopJournalHeartbeat();
    journal.stopJournalHeartbeat();

    await new Promise((r) => setTimeout(r, 200));
    expect(await journalFor('hb-stop')).toBeUndefined();
  }, 20000);

  it('refuses to start without a run source rather than throwing', () => {
    expect(journal.startJournalHeartbeat(undefined)).toBeNull();
  });

  it('survives a run source that throws', async () => {
    journal.startJournalHeartbeat(() => { throw new Error('registry exploded'); }, { intervalMs: 20 });
    await new Promise((r) => setTimeout(r, 150));
    // Still running, still harmless.
    expect(journal.startJournalHeartbeat(() => [], { intervalMs: 20 })).toBeTruthy();
  }, 20000);
});

describe('temp files', () => {
  it('gives every write its own temp path', async () => {
    // Was `${target}.${pid}.tmp` — unique per process, not per write, so the
    // shutdown flush and a throttled write could target the same file.
    const a = makeRun('hb-tmp-a');
    const b = makeRun('hb-tmp-b');
    journal.flushAllSync([a, b, a]);

    const src = fs.readFileSync(new URL('./runJournal.js', import.meta.url), 'utf8');
    expect(src).toMatch(/\$\{target\}\.\$\{process\.pid\}\.\$\{writeSeq\}\.tmp/);
  });

  it('sweeps orphaned temp files, but not fresh ones', async () => {
    await fsp.mkdir(DIR, { recursive: true });
    const stale = path.join(DIR, 'gone-12345678.json.999.1.tmp');
    const fresh = path.join(DIR, 'live-87654321.json.999.2.tmp');
    await fsp.writeFile(stale, '{}');
    await fsp.writeFile(fresh, '{}');
    // Backdate the stale one past the 5-minute grace period.
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await fsp.utimes(stale, old, old);

    await journal.listJournals();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true); // a write in flight must survive
  });
});

describe('bookkeeping', () => {
  it('releases tracking state when a run is discarded', async () => {
    // Otherwise the Maps grow by one entry per conversation for the life of
    // the process and never shrink.
    const run = makeRun('hb-leak');
    journal.journalRun(run);
    journal.discardJournal('hb-leak');

    const src = fs.readFileSync(new URL('./runJournal.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function discardJournal'));
    const fn = body.slice(0, body.indexOf('\n}'));
    expect(fn).toMatch(/revisions\.delete/);
    expect(fn).toMatch(/written\.delete/);
    expect(fn).toMatch(/failures\.delete/);
  });
});
