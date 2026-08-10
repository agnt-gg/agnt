/**
 * One conversation is one row — no matter how many clients are saving it.
 *
 * WHY THIS EXISTS
 * ---------------
 * A conversation's saved row was identified by the output `id` alone. That id
 * is minted on the FIRST save and then remembered only in the saving tab's
 * memory (`savedOutputId` in the chat store). So the same conversation open in
 * a second browser, or in the Mac app, had no id to send — the save looked
 * "new", minted another row, and the sidebar listed one chat three times.
 *
 * Observed on a real install: conversation 5f8b5337 had FOUR rows, two of them
 * created one second apart by two clients autosaving at once, and a fourth
 * carrying a DIFFERENT title because the client that wrote it joined midway
 * and derived the name from the middle of the conversation.
 *
 * The fix keys identity on the conversation, which is the thing that is
 * actually durable. These tests pin the rules that follow from that:
 *
 *   1. A save naming a conversation with no id ADOPTS that conversation's row.
 *   2. Adoption is scoped to the caller — it can never touch another user's row.
 *   3. Rows that already exist resolve DETERMINISTICALLY to the fullest one,
 *      so a client can't open a 1KB stub of a 74KB conversation.
 *   4. Non-conversation outputs (no conversationId) keep the old behaviour.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

// The save path broadcasts to connected clients; irrelevant here and it would
// reach for a socket server that does not exist in this process.
vi.mock('../utils/realtimeSync.js', () => ({
  broadcastToUser: () => {},
  RealtimeEvents: { CONTENT_CREATED: 'content_created', CONTENT_UPDATED: 'content_updated' },
}));

let db;
let RunService;
let ContentOutputModel;
let TMP;
const savedEnv = {};

const USER = 'user-identity-1';
const OTHER_USER = 'user-identity-2';

const countRows = (conversationId) => new Promise((resolve, reject) => {
  db.get(
    'SELECT COUNT(*) AS n FROM content_outputs WHERE conversation_id = ?',
    [conversationId],
    (err, row) => (err ? reject(err) : resolve(row.n)),
  );
});

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
});

/** Drive the real Express handler and capture what it answered. */
const save = (body, userId = USER) => new Promise((resolve, reject) => {
  const res = {
    json: (payload) => resolve(payload),
    status: () => ({ json: (payload) => reject(new Error(`save failed: ${JSON.stringify(payload)}`)) }),
  };
  RunService.saveOrUpdateContentOutput({ body, user: { userId } }, res).catch(reject);
});

/** A transcript of `n` messages — stands in for a conversation growing. */
const transcript = (n) => JSON.stringify({
  messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
});

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-identity-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install that should inherit an orphaned database, and
  // would try to copy the developer's real database into temp.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  RunService = (await import('./RunService.js')).default;
  ContentOutputModel = (await import('../models/ContentOutputModel.js')).default;

  for (const uid of [USER, OTHER_USER]) {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`], (err) => (err ? reject(err) : resolve()));
    });
  }
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('a second client saving the same conversation', () => {
  it('reuses the row instead of creating a duplicate — the reported bug', async () => {
    const conversationId = 'conv-three-clients';

    // Browser A: first save. No id yet, so this one legitimately creates.
    const a = await save({
      content: transcript(2), contentType: 'conversation', conversationId, title: 'run some long running task',
    });

    // Browser B and the Mac app: same conversation, NO id — they never saw A's
    // response. This is exactly the payload that used to mint new rows.
    const b = await save({ content: transcript(4), contentType: 'conversation', conversationId, title: 'run some long running task' });
    const c = await save({ content: transcript(6), contentType: 'conversation', conversationId, title: 'run some long running task' });

    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(await countRows(conversationId)).toBe(1);
  });

  it('reports the adopted row as an UPDATE, not a creation', async () => {
    const conversationId = 'conv-update-semantics';
    const first = await save({ content: transcript(2), contentType: 'conversation', conversationId, title: 't' });
    const second = await save({ content: transcript(3), contentType: 'conversation', conversationId, title: 't' });

    // The message drives which realtime event fires. Announcing CONTENT_CREATED
    // for a row that already exists would make every other tab insert a second
    // sidebar entry for it — the same duplicate, one layer up.
    expect(first.message).toMatch(/created/i);
    expect(second.message).toMatch(/updated/i);
  });

  it('keeps the newest content — the adopting save is a real write', async () => {
    const conversationId = 'conv-content-wins';
    const { id } = await save({ content: transcript(2), contentType: 'conversation', conversationId, title: 't' });
    await save({ content: transcript(9), contentType: 'conversation', conversationId, title: 't' });

    expect(JSON.parse((await getRow(id)).content).messages).toHaveLength(9);
  });

  it('still honours an explicit id when the client has one', async () => {
    const conversationId = 'conv-explicit-id';
    const { id } = await save({ content: transcript(2), contentType: 'conversation', conversationId, title: 't' });
    const again = await save({ id, content: transcript(3), contentType: 'conversation', conversationId, title: 't' });

    expect(again.id).toBe(id);
    expect(await countRows(conversationId)).toBe(1);
  });
});

describe('the blast radius of adopting a row', () => {
  it('never adopts another user\'s row', async () => {
    const conversationId = 'conv-shared-id';
    const mine = await save({ content: transcript(2), contentType: 'conversation', conversationId, title: 'mine' }, USER);
    const theirs = await save({ content: transcript(2), contentType: 'conversation', conversationId, title: 'theirs' }, OTHER_USER);

    // Same conversation id, two users, two rows. Adoption is scoped by user, so
    // one person's autosave can never overwrite another's transcript.
    expect(theirs.id).not.toBe(mine.id);
    expect((await getRow(mine.id)).user_id).toBe(USER);
    expect((await getRow(theirs.id)).user_id).toBe(OTHER_USER);
  });

  it('forks rather than writes when handed an id belonging to someone else', async () => {
    const conversationId = 'conv-foreign-id';
    const theirs = await save({ content: transcript(2), contentType: 'conversation', conversationId: 'conv-theirs-only', title: 'theirs' }, OTHER_USER);

    // Pre-existing behaviour, deliberately preserved: saving onto a row you do
    // not own produces a copy of your own, never a write to theirs.
    const forked = await save({ id: theirs.id, content: transcript(5), contentType: 'conversation', conversationId, title: 'mine now' }, USER);

    expect(forked.id).not.toBe(theirs.id);
    expect(JSON.parse((await getRow(theirs.id)).content).messages).toHaveLength(2);
  });

  it('leaves non-conversation outputs alone — they have no conversation to key on', async () => {
    // Two ordinary outputs with no conversationId must stay two rows; the new
    // lookup must not collapse everything that shares a NULL conversation_id.
    // (No workflowId: content_outputs.workflow_id is a FOREIGN KEY, and this
    // test is about conversation identity, not about workflows existing.)
    const one = await save({ content: '<p>one</p>', contentType: 'html' });
    const two = await save({ content: '<p>two</p>', contentType: 'html' });

    expect(two.id).not.toBe(one.id);
  });
});

describe('resolving a conversation that ALREADY has duplicates', () => {
  // Tom's install has these. New ones are no longer created, but until the old
  // rows are cleared up, "which one do you get?" must not be luck.
  const conversationId = 'conv-legacy-duplicates';
  let stub;
  let full;

  beforeAll(async () => {
    // Written directly through the model to reproduce the pre-fix state.
    stub = 'legacy-stub';
    full = 'legacy-full';
    await ContentOutputModel.createOrUpdate(stub, USER, null, null, transcript(2), false, 'conversation', conversationId, 'stub');
    await ContentOutputModel.createOrUpdate(full, USER, null, null, transcript(40), false, 'conversation', conversationId, 'full');
    // The stub is touched LAST, so "most recent" would pick the wrong row.
    await ContentOutputModel.createOrUpdate(stub, USER, null, null, transcript(2), false, 'conversation', conversationId, 'stub');
  });

  it('returns the fullest transcript, not whichever row SQLite reached first', async () => {
    const row = await ContentOutputModel.findByConversationId(conversationId, USER);
    expect(row.id).toBe(full);
  });

  it('makes the choice stable across repeated reads', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await ContentOutputModel.findByConversationId(conversationId, USER)).id);
    }
    expect(new Set(ids)).toEqual(new Set([full]));
  });

  it('converges further saves onto that same row, so duplicates stop multiplying', async () => {
    const before = await countRows(conversationId);
    const saved = await save({ content: transcript(50), contentType: 'conversation', conversationId, title: 'full' });

    expect(saved.id).toBe(full);
    expect(await countRows(conversationId)).toBe(before);
  });

  it('does not read the content column to decide ownership on the save path', async () => {
    // findMetaByConversationId exists so a ~3s autosave doesn't drag a
    // multi-megabyte transcript off disk just to read two identity columns.
    const meta = await ContentOutputModel.findMetaByConversationId(conversationId, USER);
    expect(meta.id).toBe(full);
    expect(meta).not.toHaveProperty('content');
  });
});
