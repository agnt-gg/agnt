/**
 * A turn survives the process that was generating it.
 *
 * WHAT IS BEING PROTECTED
 * ───────────────────────
 * activeRuns keeps its replay log in memory, and conversation_logs is written
 * at turn END. Between those two facts, killing the backend mid-turn did not
 * merely make the answer unreachable — it destroyed it. Nothing anywhere held
 * the tokens that had already been produced.
 *
 * These tests pin the journal that closes that hole, and they are careful to
 * pin the LIMIT as well: recovery restores work already done, and does not and
 * cannot resume generation, because the provider connection died with the
 * process. A test suite that quietly implied otherwise would be worse than none.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../../utils/realtimeSync.js', () => ({
  broadcastToUser: () => {},
  RealtimeEvents: { CONTENT_CREATED: 'content_created', CONTENT_UPDATED: 'content_updated' },
}));

let db;
let ContentOutputModel;
let runJournal;
let recovery;
let activeRuns;
let TMP;
const savedEnv = {};

const USER = 'user-journal-1';

/** A run object shaped exactly as activeRuns builds one. */
const makeRun = (conversationId, events, extra = {}) => ({
  conversationId,
  userId: USER,
  chatType: 'orchestrator',
  startedAt: Date.now(),
  userMessage: 'run something long',
  truncated: false,
  bytes: 100,
  ended: false,
  events,
  latest: new Map(),
  subscribers: new Set(),
  ...extra,
});

/** The event sequence a real streaming turn produces. */
const streamingEvents = (text = 'Half an answer') => ([
  { eventName: 'conversation_started', data: { conversationId: 'x' } },
  { eventName: 'assistant_message', data: { id: 'a1', role: 'assistant', content: '' } },
  { eventName: 'content_delta', data: { assistantMessageId: 'a1', delta: text } },
]);

const seedRow = (id, conversationId, content, opts = {}) => ContentOutputModel.createOrUpdate(
  id, USER, null, null, content, false,
  opts.contentType || 'conversation', conversationId, opts.title || 'a title',
);

const storedTranscript = (messages) => JSON.stringify({ conversationId: 'x', title: 't', messages });

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r)));
});

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-journal-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  ContentOutputModel = (await import('../../models/ContentOutputModel.js')).default;
  runJournal = await import('./runJournal.js');
  recovery = await import('./recoverJournaledRuns.js');
  activeRuns = await import('./activeRuns.js');

  await new Promise((resolve, reject) => {
    db.run('INSERT INTO users (id, email) VALUES (?, ?)', [USER, 'j@test.local'], (e) => (e ? reject(e) : resolve()));
  });
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  runJournal._resetForTests();
  // Clear any journals a previous test left behind.
  for (const j of await runJournal.listJournals()) await runJournal.removeJournalFile(j.file);
});

describe('writing the journal', () => {
  it('flushes an in-flight run to disk, synchronously', async () => {
    const run = makeRun('conv-flush', streamingEvents());

    expect(runJournal.flushAllSync([run])).toBe(1);

    const journals = await runJournal.listJournals();
    expect(journals).toHaveLength(1);
    expect(journals[0].conversationId).toBe('conv-flush');
    expect(journals[0].userMessage).toBe('run something long');
    // The replay log itself, not a summary of it.
    expect(journals[0].events.map((e) => e.eventName))
      .toEqual(['conversation_started', 'assistant_message', 'content_delta']);
  });

  it('does not journal a run that has produced nothing yet', async () => {
    // conversation_started carries no answer. Writing a file for every turn the
    // instant it opens would be a lot of I/O to insure nothing.
    const run = makeRun('conv-empty', [{ eventName: 'conversation_started', data: {} }]);

    expect(runJournal.flushAllSync([run])).toBe(0);
    expect(await runJournal.listJournals()).toHaveLength(0);
  });

  it('does not journal a run that has already ended', async () => {
    const run = makeRun('conv-ended', streamingEvents(), { ended: true });
    expect(runJournal.flushAllSync([run])).toBe(0);
  });

  it('keeps the newest snapshot when a run is flushed repeatedly', async () => {
    const run = makeRun('conv-grow', streamingEvents('first'));
    runJournal.flushAllSync([run]);
    run.events.push({ eventName: 'content_delta', data: { assistantMessageId: 'a1', delta: ' and more' } });
    runJournal.flushAllSync([run]);

    const journals = await runJournal.listJournals();
    expect(journals).toHaveLength(1); // one file per conversation, not one per write
    expect(journals[0].events).toHaveLength(4);
  });

  it('leaves no temp files behind — a half-written journal must never be recovered', async () => {
    runJournal.flushAllSync([makeRun('conv-atomic', streamingEvents())]);

    const dir = path.join(TMP, '.agnt', 'data', 'run-journal');
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('discards the journal when the turn ends', async () => {
    runJournal.flushAllSync([makeRun('conv-discard', streamingEvents())]);
    expect(await runJournal.listJournals()).toHaveLength(1);

    runJournal.discardJournal('conv-discard');
    await new Promise((r) => setTimeout(r, 50)); // rm is async, fire-and-forget

    expect(await runJournal.listJournals()).toHaveLength(0);
  });
});

describe('reducing a journal back into messages', () => {
  it('rebuilds the assistant turn with the client\'s own reducer', () => {
    const messages = recovery.messagesFromJournal({
      userMessage: 'do the thing',
      events: streamingEvents('Half an answer'),
    });

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('do the thing');
    expect(messages[1].content).toBe('Half an answer');
  });

  it('rebuilds tool calls, so a turn cut off mid-tool still shows its work', () => {
    // The payload shape here is the SERVER'S, copied from the sendEvent calls in
    // OrchestratorService — `{ assistantMessageId, toolCall: {...} }`, not a
    // flattened one. Worth stating because the first version of this test
    // invented a flatter shape, passed nothing through the reducer, and would
    // have certified a recovery path that silently dropped every tool call.
    const messages = recovery.messagesFromJournal({
      userMessage: 'check the disk',
      events: [
        ...streamingEvents('Looking now'),
        { eventName: 'tool_start', data: { assistantMessageId: 'a1', toolCall: { id: 't1', name: 'shell', args: { cmd: 'df' } } } },
        { eventName: 'tool_end', data: { assistantMessageId: 'a1', toolCall: { id: 't1', name: 'shell', result: '80% used' } } },
      ],
    });

    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant.toolCalls.map((t) => t.name)).toEqual(['shell']);
    expect(assistant.toolCalls[0].result).toBe('80% used');
    expect(assistant.toolCalls[0].status).toBe('completed');
    // The interleave marker, so a recovered turn renders its tool card in the
    // right place rather than after all the prose.
    expect(assistant.contentParts.some((p) => p.type === 'tool_call' && p.toolCallId === 't1')).toBe(true);
  });

  it('surfaces a tool that was still RUNNING when the process died', () => {
    // The whole point of the feature: the turn was cut off mid-tool.
    const messages = recovery.messagesFromJournal({
      userMessage: 'long job',
      events: [
        ...streamingEvents('Starting'),
        { eventName: 'tool_start', data: { assistantMessageId: 'a1', toolCall: { id: 't1', name: 'shell' } } },
      ],
    });

    const tool = messages.find((m) => m.role === 'assistant').toolCalls[0];
    expect(tool).toMatchObject({ name: 'shell', status: 'running' });
  });

  it('marks the turn as interrupted, so a partial answer never reads as complete', () => {
    const messages = recovery.messagesFromJournal({ userMessage: 'x', events: streamingEvents() });
    expect(messages.at(-1).metadata).toContain(recovery.INTERRUPTED_NOTE);
  });

  it('returns nothing when the turn produced nothing a user would recognise', () => {
    // An empty bubble written over a real saved conversation would be a
    // regression dressed as a recovery.
    expect(recovery.messagesFromJournal({ events: [] })).toEqual([]);
    expect(recovery.messagesFromJournal({
      events: [{ eventName: 'assistant_message', data: { id: 'a1', content: '' } }],
    })).toEqual([]);
  });

  it('survives a malformed event rather than losing the whole answer', () => {
    const messages = recovery.messagesFromJournal({
      userMessage: 'x',
      events: [
        ...streamingEvents('kept'),
        { eventName: 'content_delta', data: null },
        { /* no eventName at all */ },
        { eventName: 'tool_end', data: { toolCallId: 'nope' } },
      ],
    });
    expect(messages.find((m) => m.role === 'assistant').content).toBe('kept');
  });
});

describe('recovering at boot', () => {
  it('restores an interrupted turn into the saved conversation', async () => {
    const conversationId = 'conv-recover';
    // What the client managed to save before the process died: the question only.
    await seedRow('out-recover', conversationId, storedTranscript([
      { role: 'user', content: 'run something long' },
    ]));
    runJournal.flushAllSync([makeRun(conversationId, streamingEvents('the partial answer'))]);

    const summary = await recovery.recoverJournaledRuns();

    expect(summary).toMatchObject({ found: 1, recovered: 1 });
    const saved = JSON.parse((await getRow('out-recover')).content);
    expect(saved.messages.find((m) => m.role === 'assistant').content).toBe('the partial answer');
    // ...and the journal is gone, so the next boot does no work.
    expect(await runJournal.listJournals()).toHaveLength(0);
  });

  it('never CREATES a conversation that no client had saved', async () => {
    // Update-only, inherited from writeTranscript. A turn abandoned before its
    // first autosave has no row, and inventing one would enrol conversations
    // the user never chose to keep.
    runJournal.flushAllSync([makeRun('conv-never-saved', streamingEvents())]);

    const summary = await recovery.recoverJournaledRuns();

    expect(summary).toMatchObject({ recovered: 0, skipped: 1 });
    const rows = await new Promise((res, rej) => db.all(
      'SELECT id FROM content_outputs WHERE conversation_id = ?', ['conv-never-saved'],
      (e, r) => (e ? rej(e) : res(r)),
    ));
    expect(rows).toHaveLength(0);
  });

  it('never shrinks a saved copy that says more', async () => {
    const conversationId = 'conv-richer';
    const richer = storedTranscript([
      { role: 'user', content: 'run something long' },
      { role: 'assistant', content: 'A far more complete answer. '.repeat(40) },
    ]);
    await seedRow('out-richer', conversationId, richer);
    runJournal.flushAllSync([makeRun(conversationId, streamingEvents('tiny'))]);

    await recovery.recoverJournaledRuns();

    expect((await getRow('out-richer')).content).toBe(richer);
  });

  it('is idempotent — a second pass cannot damage the first', async () => {
    const conversationId = 'conv-idempotent';
    await seedRow('out-idem', conversationId, storedTranscript([{ role: 'user', content: 'q' }]));
    runJournal.flushAllSync([makeRun(conversationId, streamingEvents('answer'))]);

    await recovery.recoverJournaledRuns();
    const first = JSON.parse((await getRow('out-idem')).content);

    // Re-journal the same turn and recover again, as a crash between write and
    // discard would produce.
    runJournal.flushAllSync([makeRun(conversationId, streamingEvents('answer'))]);
    await recovery.recoverJournaledRuns();
    const second = JSON.parse((await getRow('out-idem')).content);

    // Compared by what the user would SEE, not byte-for-byte: the recovered
    // user bubble is stamped with Date.now(), so two passes a millisecond apart
    // legitimately differ in their ids and timestamps while being the same
    // conversation. Asserting raw equality would pin the clock, not the
    // behaviour.
    const shape = (t) => t.messages.map((m) => ({ role: m.role, content: m.content, metadata: m.metadata }));
    expect(shape(second)).toEqual(shape(first));
  });

  it('expires a journal too old to be a turn anyone is waiting for', async () => {
    await seedRow('out-old', 'conv-old', storedTranscript([{ role: 'user', content: 'q' }]));
    runJournal.flushAllSync([makeRun('conv-old', streamingEvents('stale'))]);

    // A day and a half later.
    const summary = await recovery.recoverJournaledRuns({
      now: Date.now() + runJournal.MAX_JOURNAL_AGE_MS + 60_000,
    });

    expect(summary).toMatchObject({ expired: 1, recovered: 0 });
    expect(await runJournal.listJournals()).toHaveLength(0);
    // The saved conversation is untouched.
    expect(JSON.parse((await getRow('out-old')).content).messages).toHaveLength(1);
  });

  it('discards an unreadable journal instead of failing every future boot', async () => {
    const dir = path.join(TMP, '.agnt', 'data', 'run-journal');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'corrupt-abcdef12.json'), '{ this is not json');

    await expect(recovery.recoverJournaledRuns()).resolves.toMatchObject({ found: 0 });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
  });

  it('does nothing, quietly, when there is nothing to recover', async () => {
    await expect(recovery.recoverJournaledRuns()).resolves.toEqual({
      found: 0, recovered: 0, skipped: 0, expired: 0,
    });
  });
});

describe('the registry writes the journal itself', () => {
  it('journals a live run and clears it when the turn ends', async () => {
    const run = activeRuns.startRun({
      conversationId: 'conv-wired', userId: USER, chatType: 'orchestrator', userMessage: 'hello',
    });
    activeRuns.publish(run, 'conversation_started', { conversationId: 'conv-wired' });
    activeRuns.publish(run, 'assistant_message', { id: 'a1', role: 'assistant', content: '' });
    activeRuns.publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'live text' });

    // The throttle means the disk write is scheduled, not immediate — the
    // shutdown flush is what makes it certain.
    expect(runJournal.flushAllSync(activeRuns.liveRuns())).toBe(1);
    const [journal] = await runJournal.listJournals();
    expect(journal.conversationId).toBe('conv-wired');

    activeRuns.endRun('conv-wired', 'completed');
    await new Promise((r) => setTimeout(r, 50));

    expect(await runJournal.listJournals()).toHaveLength(0);
  });

  it('liveRuns excludes runs that have ended', () => {
    activeRuns.startRun({ conversationId: 'conv-live-a', userId: USER });
    const b = activeRuns.startRun({ conversationId: 'conv-live-b', userId: USER });
    activeRuns.publish(b, 'assistant_message', { id: 'a1', content: '' });
    activeRuns.endRun('conv-live-a', 'completed');

    const ids = activeRuns.liveRuns().map((r) => r.conversationId);
    expect(ids).toContain('conv-live-b');
    expect(ids).not.toContain('conv-live-a');
  });
});
