/**
 * A recovered turn is merged into the conversation, not written over it.
 *
 * WHY THIS EXISTS
 * ---------------
 * writeTranscript has two callers that hand it different KINDS of input, and
 * nothing in an array of messages says which kind it is:
 *
 *   - turn end passes the whole provider history. That is always a superset of
 *     what is stored, so replacing the row with it is correct.
 *   - journal recovery passes ONE TURN — the user's message and the answer
 *     that was in flight when the process died.
 *
 * The never-shrink guard was derived for the first case and inherited by the
 * second. It compares SUBSTANCE, which is one number for the whole transcript,
 * so it cannot tell "a whole conversation" from "one big turn": a 16KB
 * interrupted answer outscores several short earlier turns and takes the row.
 * Measured against the unfixed code, a six-message conversation came back as
 * two and four user/assistant pairs were gone.
 *
 * conversation_logs still held the history, so this was recoverable by hand —
 * but recoverInterruptedStream only runs on live stream death in an OPEN TAB,
 * never on a plain conversation open. In the exact case a journal exists for
 * (process killed, app restarted, no client alive) nothing re-reads it, so the
 * truncated row is what the user sees and what the next autosave promotes to
 * canonical.
 *
 * Every test below therefore asserts the DATABASE, not the return value.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { vi } from 'vitest';

vi.mock('../../utils/realtimeSync.js', () => ({
  broadcastToUser: () => {},
  RealtimeEvents: { CONTENT_CREATED: 'content_created', CONTENT_UPDATED: 'content_updated' },
}));

let db;
let ContentOutputModel;
let writeTranscript;
let preservesUserTurns;
let messagesFromJournal;
let TMP;
const savedEnv = {};

const USER = 'user-merge-1';

/** ~16KB of code, the shape of answer that made the aggregate count lose. */
const BIG_ANSWER = 'export async function runMigrations(db) { /* ... */ }\n'.repeat(300);

/**
 * A real conversation, several turns deep, with the last user message
 * unanswered — the client autosaved and then died mid-answer.
 */
const priorConversation = () => ([
  { role: 'user', content: 'hey, can you help me with the deploy script?' },
  { role: 'assistant', content: 'Sure. What is it doing wrong right now?' },
  { role: 'user', content: 'it fails on the sqlite rebuild step in CI' },
  { role: 'assistant', content: 'That is --ignore-scripts skipping the native build. Add npm rebuild sqlite3.' },
  { role: 'user', content: 'perfect that worked. now write me the full migration runner' },
  { role: 'assistant', content: 'Sure — starting on that now.' },
]);

const storedTranscript = (messages, title = 'deploy script') =>
  JSON.stringify({ conversationId: 'x', title, messages });

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r)));
});

/** The messages actually on disk for a row. */
const savedMessages = async (id) => JSON.parse((await getRow(id)).content).messages;

/** A journal as runJournal writes it: one turn's worth of SSE events. */
const journalFor = (userMessage, answer) => ({
  conversationId: 'c',
  userId: USER,
  userMessage,
  events: [
    { eventName: 'assistant_message', data: { id: 'a1', timestamp: 1 } },
    { eventName: 'content_delta', data: { delta: answer } },
  ],
});

/** Seed a saved row for a conversation, as a client's autosave would. */
async function seedRow(id, conversationId, messages, title = 'deploy script') {
  await ContentOutputModel.createOrUpdate(
    id, USER, null, null, storedTranscript(messages, title),
    false, 'conversation', conversationId, title,
  );
}

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-recovmerge-'));
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
  ({ writeTranscript, preservesUserTurns } = await import('./persistTurnTranscript.js'));
  ({ messagesFromJournal } = await import('./recoverJournaledRuns.js'));

  await new Promise((resolve, reject) => {
    db.run('INSERT INTO users (id, email) VALUES (?, ?)', [USER, `${USER}@test.local`],
      (e) => (e ? reject(e) : resolve()));
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

describe('recovering an interrupted turn into a conversation that already has history', () => {
  it('keeps every earlier turn AND lands the recovered answer — the defect', async () => {
    const prior = priorConversation();
    await seedRow('out-defect', 'conv-defect', prior);

    const turn = messagesFromJournal(
      journalFor('perfect that worked. now write me the full migration runner', BIG_ANSWER),
    );
    // The fragment on its own is worth far more than the whole conversation,
    // which is exactly why substance alone could not defend this.
    expect(turn).toHaveLength(2);

    const result = await writeTranscript({
      conversationId: 'conv-defect', userId: USER, messages: turn, mode: 'appendTurn',
    });
    expect(result.written).toBe(true);

    const after = await savedMessages('out-defect');
    expect(after).toHaveLength(prior.length);
    expect(after.map((m) => m.content)).toEqual([
      prior[0].content,
      prior[1].content,
      prior[2].content,
      prior[3].content,
      prior[4].content,
      // the stub the client saved is replaced by what was really generated
      expect.stringContaining('runMigrations'),
    ]);
  });

  it('appends a turn the saved row never saw, without disturbing the ones it has', async () => {
    const prior = priorConversation();
    await seedRow('out-append', 'conv-append', prior);

    const turn = messagesFromJournal(journalFor('a brand new question nobody saved', BIG_ANSWER));
    const result = await writeTranscript({
      conversationId: 'conv-append', userId: USER, messages: turn, mode: 'appendTurn',
    });
    expect(result.written).toBe(true);

    const after = await savedMessages('out-append');
    expect(after).toHaveLength(prior.length + 2);
    expect(after.slice(0, prior.length).map((m) => m.content))
      .toEqual(prior.map((m) => m.content));
    expect(after[prior.length].content).toBe('a brand new question nobody saved');
  });

  it('declines when the saved copy already holds a longer answer for that turn', async () => {
    const prior = priorConversation();
    prior[5] = { role: 'assistant', content: `${BIG_ANSWER}${BIG_ANSWER}` };
    await seedRow('out-richer', 'conv-richer', prior);
    const before = (await getRow('out-richer')).content;

    const turn = messagesFromJournal(
      journalFor('perfect that worked. now write me the full migration runner', BIG_ANSWER),
    );
    const result = await writeTranscript({
      conversationId: 'conv-richer', userId: USER, messages: turn, mode: 'appendTurn',
    });

    expect(result).toEqual({ written: false, reason: 'saved_copy_is_richer' });
    expect((await getRow('out-richer')).content).toBe(before);
  });

  it('is idempotent — recovering the same journal twice changes nothing', async () => {
    await seedRow('out-idem', 'conv-idem', priorConversation());
    const turn = messagesFromJournal(
      journalFor('perfect that worked. now write me the full migration runner', BIG_ANSWER),
    );
    const args = { conversationId: 'conv-idem', userId: USER, messages: turn, mode: 'appendTurn' };

    await writeTranscript(args);
    const afterFirst = await savedMessages('out-idem');
    await writeTranscript(args);
    const afterSecond = await savedMessages('out-idem');

    expect(afterSecond.map((m) => m.content)).toEqual(afterFirst.map((m) => m.content));
  });

  it('does not rename an untitled conversation after the recovered turn', async () => {
    // No title: the row was saved before the client got round to deriving one.
    await ContentOutputModel.createOrUpdate(
      'out-untitled', USER, null, null, storedTranscript(priorConversation(), ''),
      false, 'conversation', 'conv-untitled', '',
    );

    const turn = messagesFromJournal(
      journalFor('perfect that worked. now write me the full migration runner', BIG_ANSWER),
    );
    await writeTranscript({
      conversationId: 'conv-untitled', userId: USER, messages: turn, mode: 'appendTurn',
    });

    // Derived from the whole conversation, so it is the FIRST thing the user
    // said — not the first thing they said in the turn that was interrupted.
    expect((await getRow('out-untitled')).title)
      .toBe('hey, can you help me with the deploy script?');
  });
});

describe('the structural guard, for a journal that anchors into a moved-on conversation', () => {
  it('refuses a stale journal rather than replacing everything after its turn', async () => {
    // A journal whose write THROWS is deliberately kept and retried on the next
    // boot (see recoverJournaledRuns — an exception is not a decision). By then
    // the user can have reopened the conversation and carried on, so the turn
    // the journal describes is no longer the last one.
    const movedOn = [
      ...priorConversation(),
      { role: 'user', content: 'actually never mind, do it in python instead' },
      { role: 'assistant', content: 'Sure — here is the Python version.' },
    ];
    await seedRow('out-stale', 'conv-stale', movedOn);
    const before = (await getRow('out-stale')).content;

    // Anchors on the FIFTH message, so a naive replace-from-there would take
    // the two later turns with it — and its size gets it past the substance
    // rule.
    const turn = messagesFromJournal(
      journalFor('perfect that worked. now write me the full migration runner', BIG_ANSWER),
    );

    const result = await writeTranscript({
      conversationId: 'conv-stale', userId: USER, messages: turn, mode: 'appendTurn',
    });

    expect(result).toEqual({ written: false, reason: 'would_drop_user_turns' });
    expect((await getRow('out-stale')).content).toBe(before);
  });

  it('states the invariant directly: stored user turns are a prefix of incoming', () => {
    const stored = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'two' },
    ];

    // Superset — the turn-end case.
    expect(preservesUserTurns(stored, [...stored, { role: 'assistant', content: 'b' }])).toBe(true);
    expect(preservesUserTurns(stored, [...stored, { role: 'user', content: 'three' }])).toBe(true);
    // Same conversation, assistant turns rewritten — legitimate, must pass.
    expect(preservesUserTurns(stored, [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'REWRITTEN, merged across provider rows' },
      { role: 'user', content: 'two' },
    ])).toBe(true);

    // A user turn dropped, and a user turn changed.
    expect(preservesUserTurns(stored, [{ role: 'user', content: 'one' }])).toBe(false);
    expect(preservesUserTurns(stored, [
      { role: 'user', content: 'one' },
      { role: 'user', content: 'CHANGED' },
    ])).toBe(false);

    // Nothing stored yet — anything may be written.
    expect(preservesUserTurns([], stored)).toBe(true);
  });
});

describe('the turn-end path is unchanged', () => {
  it('still replaces the row when the whole conversation is handed over', async () => {
    const prior = priorConversation();
    await seedRow('out-turnend', 'conv-turnend', prior);

    // What turn end passes: the same conversation with the answer completed.
    const whole = [...prior.slice(0, 5), { role: 'assistant', content: BIG_ANSWER }];
    const result = await writeTranscript({
      conversationId: 'conv-turnend', userId: USER, messages: whole, mode: 'whole',
    });

    expect(result.written).toBe(true);
    const after = await savedMessages('out-turnend');
    expect(after).toHaveLength(6);
    expect(after[5].content).toContain('runMigrations');
  });

  it('defaults to whole when no mode is given, so existing callers are untouched', async () => {
    const prior = priorConversation();
    await seedRow('out-default', 'conv-default', prior);

    const whole = [...prior.slice(0, 5), { role: 'assistant', content: BIG_ANSWER }];
    const result = await writeTranscript({
      conversationId: 'conv-default', userId: USER, messages: whole,
    });

    expect(result.written).toBe(true);
    expect(await savedMessages('out-default')).toHaveLength(6);
  });

  it('does NOT apply the structural guard — the scoping is deliberate', async () => {
    // The saved row and the turn-end projection can legitimately disagree about
    // user turns: the tool-loop nudge is pushed as a `user` message into the
    // provider history and the client's copy has never seen it. Refusing here
    // would stop the sidebar updating, which is the bug this file exists to
    // fix — so 'whole' trusts its caller and only the substance rule applies.
    await seedRow('out-scoped', 'conv-scoped', [{ role: 'user', content: 'hi' }]);

    const result = await writeTranscript({
      conversationId: 'conv-scoped',
      userId: USER,
      messages: [
        { role: 'user', content: 'a completely different opening line' },
        { role: 'assistant', content: BIG_ANSWER },
      ],
      mode: 'whole',
    });

    expect(result.written).toBe(true);
  });
});
