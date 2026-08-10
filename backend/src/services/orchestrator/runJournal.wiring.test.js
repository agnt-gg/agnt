/**
 * The journal must be WIRED, at both ends, or it is a feature that exists only
 * in its own unit tests.
 *
 * Two call sites carry the whole thing, and both live inside server.js's boot
 * and shutdown paths — code no unit test drives end to end. Same approach as
 * OrchestratorService.streamLifetime and .runAnnouncement: assert on source,
 * and say precisely why each property matters.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SERVER = fs.readFileSync(fileURLToPath(new URL('../../../server.js', import.meta.url)), 'utf8');
const RUNS = fs.readFileSync(fileURLToPath(new URL('./activeRuns.js', import.meta.url)), 'utf8');

describe('shutdown flush', () => {
  it('flushes in-flight runs from the shutdown drain', () => {
    // SIGTERM is the ORDINARY restart — launchctl kickstart, systemd, Ctrl-C,
    // quitting the app. The process is alive and holds the only copy of a turn
    // that has not reached conversation_logs. Not saving here would leave the
    // common case relying on the last throttled snapshot.
    expect(SERVER).toMatch(/drain:\s*async\s*\(\)\s*=>/);
    expect(SERVER).toMatch(/flushAllSync\(liveRuns\(\)\)/);
  });

  it('flushes BEFORE the workflow drain, not after', () => {
    // The shutdown path has a hard deadline (gracefulShutdown's hardDeadlineMs).
    // Anything after a slow drain risks losing the race to process.exit.
    const drain = SERVER.slice(SERVER.indexOf('drain: async'));
    expect(drain.indexOf('flushAllSync')).toBeLessThan(drain.indexOf('WorkflowProcessBridge.shutdown'));
  });

  it('cannot break shutdown if journalling fails', () => {
    // A backend that will not exit because its insurance threw is a far worse
    // bug than the one being insured against.
    const drain = SERVER.slice(SERVER.indexOf('drain: async'), SERVER.indexOf('process.on(\'SIGTERM\''));
    expect(drain).toMatch(/try\s*\{/);
    expect(drain).toMatch(/catch/);
  });
});

describe('boot recovery', () => {
  it('runs recovery once the database is ready', () => {
    expect(SERVER).toMatch(/recoverJournaledRuns/);
    expect(SERVER.indexOf('dbReady.then')).toBeLessThan(SERVER.indexOf('recoverJournaledRuns'));
  });

  it('does not run in the workflow child process', () => {
    // The child sets AGNT_SKIP_DB_INIT=1 and owns no runs. Recovering there
    // would race the main process for the same journals.
    const idx = SERVER.indexOf('recoverJournaledRuns');
    expect(SERVER.slice(Math.max(0, idx - 1200), idx)).toMatch(/AGNT_SKIP_DB_INIT/);
  });

  it('cannot stop the server booting', () => {
    const idx = SERVER.indexOf('recoverJournaledRuns');
    expect(SERVER.slice(idx - 400, idx + 400)).toMatch(/catch/);
  });
});

describe('heartbeat wiring', () => {
  it('is started at boot, after recovery', () => {
    // Recovery consumes journals left by the dead process; the heartbeat looks
    // after journals for runs starting now. Recovery first keeps those two
    // concerns from overlapping on the same files.
    expect(SERVER).toMatch(/startJournalHeartbeat\(liveRuns\)/);
    expect(SERVER.indexOf('recoverJournaledRuns()')).toBeLessThan(SERVER.indexOf('startJournalHeartbeat'));
  });

  it('is not started in the workflow child process', () => {
    // Same reasoning as recovery: the child owns no runs, and a second
    // heartbeat over the same directory is pure contention.
    const idx = SERVER.indexOf('startJournalHeartbeat');
    expect(SERVER.slice(Math.max(0, idx - 2000), idx)).toMatch(/AGNT_SKIP_DB_INIT/);
  });

  it('cannot stop the server booting', () => {
    const idx = SERVER.indexOf('startJournalHeartbeat');
    expect(SERVER.slice(idx - 300, idx + 400)).toMatch(/catch/);
  });

  it('is stopped BEFORE the synchronous shutdown flush', () => {
    // An async write the heartbeat started could still be in flight. Letting
    // it run alongside flushAllSync is the one way to get two writers for the
    // same run at once.
    const drain = SERVER.slice(SERVER.indexOf('drain: async'));
    expect(drain).toMatch(/stopJournalHeartbeat\(\)/);
    // Compared by CALL SITE, not by name: both are named together in the
    // import destructuring a few lines above, where flushAllSync happens to
    // come first — so a plain indexOf would compare the imports and pass
    // whatever the real order turned out to be.
    expect(drain.indexOf('stopJournalHeartbeat()')).toBeLessThan(drain.indexOf('flushAllSync(liveRuns())'));
  });
});

describe('the registry', () => {
  it('journals on publish, after the log is appended', () => {
    const publish = RUNS.slice(RUNS.indexOf('export function publish'));
    const body = publish.slice(0, publish.indexOf('\n}'));
    expect(body).toMatch(/journalRun\(run\)/);
    // A snapshot must never describe a log the in-memory copy does not have.
    expect(body.indexOf('appendToLog')).toBeLessThan(body.indexOf('journalRun'));
  });

  it('discards the journal when a run is finalized', () => {
    const finalize = RUNS.slice(RUNS.indexOf('function finalizeRun'));
    expect(finalize.slice(0, finalize.indexOf('\n}'))).toMatch(/discardJournal\(run\.conversationId\)/);
  });

  it('exposes only the LIVE runs to the flush', () => {
    // Flushing ended runs would rewrite journals that were just discarded, and
    // resurrect them on the next boot.
    expect(RUNS).toMatch(/export function liveRuns\(\)/);
    expect(RUNS.slice(RUNS.indexOf('export function liveRuns'))).toMatch(/filter\(\(run\) => !run\.ended\)/);
  });
});
