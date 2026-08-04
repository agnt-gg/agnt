/**
 * Attention columns on content_outputs: last_read_at + archived_at.
 *
 * Unread is DERIVED (updated_at > last_read_at, or last_read_at NULL), never
 * stored — so the invariants that matter here are the write-shape ones:
 *
 *   1. setReadState/setArchived must NOT touch updated_at. Reading is not a
 *      change; bumping updated_at on read would immediately un-read the read,
 *      and bumping it on archive would teleport the conversation to the top
 *      of the recency sort when unarchived.
 *   2. Both writes are ownership-scoped (WHERE user_id) and report
 *      changes: 0 for a foreign or missing row so the route can 404.
 *   3. The list endpoint's column set includes both new columns — the
 *      frontend derives everything from the list payload alone.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let ContentOutputModel;
let TMP;
const savedEnv = {};

const USER = 'user-attention-1';
const OTHER_USER = 'user-attention-2';
const OUT = 'out-attention-1';
const BULK_A = 'out-attention-bulk-a';
const BULK_B = 'out-attention-bulk-b';

function getRow(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-attention-'));
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

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  ContentOutputModel = (await import('./ContentOutputModel.js')).default;

  // FK enforcement is on — content_outputs.user_id references users(id).
  for (const uid of [USER, OTHER_USER]) {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`], (err) => (err ? reject(err) : resolve()));
    });
  }

  await ContentOutputModel.createOrUpdate(
    OUT, USER, null, null, '{"messages":[]}', false, 'conversation', 'conv-attn-1', 'Attention test'
  );
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('content_outputs attention columns', () => {
  it('fresh schema has last_read_at and archived_at, both NULL on create', async () => {
    const row = await getRow(OUT);
    expect(row).toBeTruthy();
    expect(row.last_read_at).toBeNull();
    expect(row.archived_at).toBeNull();
  });

  it('the list column set includes both columns', async () => {
    const { outputs } = await ContentOutputModel.findAllByUserId(USER);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toHaveProperty('last_read_at');
    expect(outputs[0]).toHaveProperty('archived_at');
  });

  it('setReadState(true) stamps last_read_at without touching updated_at', async () => {
    const before = await getRow(OUT);

    const result = await ContentOutputModel.setReadState(OUT, USER, true);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    expect(after.last_read_at).not.toBeNull();
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('setReadState(false) clears the watermark (manual mark-unread)', async () => {
    const result = await ContentOutputModel.setReadState(OUT, USER, false);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    expect(after.last_read_at).toBeNull();
  });

  it('setArchived(true) stamps archived_at without touching updated_at', async () => {
    const before = await getRow(OUT);

    const result = await ContentOutputModel.setArchived(OUT, USER, true);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    expect(after.archived_at).not.toBeNull();
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('setArchived(false) restores the conversation', async () => {
    const result = await ContentOutputModel.setArchived(OUT, USER, false);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    expect(after.archived_at).toBeNull();
  });

  it('both writes are ownership-scoped: foreign user gets changes 0 and no write', async () => {
    const readResult = await ContentOutputModel.setReadState(OUT, OTHER_USER, true);
    expect(readResult.changes).toBe(0);

    const archiveResult = await ContentOutputModel.setArchived(OUT, OTHER_USER, true);
    expect(archiveResult.changes).toBe(0);

    const row = await getRow(OUT);
    expect(row.last_read_at).toBeNull();
    expect(row.archived_at).toBeNull();
  });

  it('missing rows report changes 0 (route 404 path)', async () => {
    expect((await ContentOutputModel.setReadState('no-such-id', USER, true)).changes).toBe(0);
    expect((await ContentOutputModel.setArchived('no-such-id', USER, true)).changes).toBe(0);
  });

  it('markAllRead clears every unread row the user owns, in one statement', async () => {
    await ContentOutputModel.createOrUpdate(BULK_A, USER, null, null, '{}', false, 'conversation', 'conv-bulk-a', 'Bulk A');
    await ContentOutputModel.createOrUpdate(BULK_B, USER, null, null, '{}', false, 'conversation', 'conv-bulk-b', 'Bulk B');
    await ContentOutputModel.setReadState(OUT, USER, false);

    const result = await ContentOutputModel.markAllRead(USER);
    expect(result.changes).toBe(3);

    for (const id of [OUT, BULK_A, BULK_B]) {
      const row = await getRow(id);
      expect(row.last_read_at).not.toBeNull();
      expect(row.updated_at <= row.last_read_at).toBe(true);
    }
  });

  it('markAllRead reports 0 when nothing is unread (clearing a clear rail is not an error)', async () => {
    expect((await ContentOutputModel.markAllRead(USER)).changes).toBe(0);
  });

  it('markAllRead scoped to ids touches only those rows', async () => {
    await ContentOutputModel.setReadState(BULK_A, USER, false);
    await ContentOutputModel.setReadState(BULK_B, USER, false);

    const result = await ContentOutputModel.markAllRead(USER, [BULK_A]);
    expect(result.changes).toBe(1);
    expect((await getRow(BULK_A)).last_read_at).not.toBeNull();
    expect((await getRow(BULK_B)).last_read_at).toBeNull();
  });

  it('markAllRead with an EMPTY id list is a no-op, never a mass update', async () => {
    // [] means "these zero conversations". Widening it to "everything" would
    // turn a scoping bug in any caller into silent data loss of unread state.
    const result = await ContentOutputModel.markAllRead(USER, []);
    expect(result.changes).toBe(0);
    expect((await getRow(BULK_B)).last_read_at).toBeNull();
  });

  it('markAllRead is ownership-scoped and skips archived rows', async () => {
    expect((await ContentOutputModel.markAllRead(OTHER_USER)).changes).toBe(0);
    expect((await getRow(BULK_B)).last_read_at).toBeNull();

    await ContentOutputModel.setArchived(BULK_B, USER, true);
    // Archived is never unread, so there is nothing left to clear.
    expect((await ContentOutputModel.markAllRead(USER)).changes).toBe(0);
    expect((await getRow(BULK_B)).last_read_at).toBeNull();
    await ContentOutputModel.setArchived(BULK_B, USER, false);
  });

  it('markAllRead does not touch updated_at', async () => {
    const before = await getRow(BULK_B);
    // SQLite CURRENT_TIMESTAMP is second-resolution: without this wait an
    // accidental `updated_at = CURRENT_TIMESTAMP` writes the SAME string and
    // the assertion passes vacuously. Verified — the negative control for
    // that mutation was green until this line existed.
    await new Promise((r) => setTimeout(r, 1100));
    await ContentOutputModel.markAllRead(USER, [BULK_B]);
    const after = await getRow(BULK_B);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.last_read_at).not.toBeNull();
  });

  it('a save (createOrUpdate) bumps updated_at but preserves the attention columns', async () => {
    await ContentOutputModel.setReadState(OUT, USER, true);
    const before = await getRow(OUT);

    // SQLite CURRENT_TIMESTAMP is second-resolution; force a visible bump.
    await new Promise((r) => setTimeout(r, 1100));
    await ContentOutputModel.createOrUpdate(
      OUT, USER, null, null, '{"messages":["new"]}', false, 'conversation', 'conv-attn-1', 'Attention test'
    );

    const after = await getRow(OUT);
    expect(after.last_read_at).toBe(before.last_read_at);
    expect(after.updated_at > before.updated_at).toBe(true);
    // The derived-unread relation now holds: this is what makes a background
    // save light the sidebar dot with no event bookkeeping at all.
    expect(after.updated_at > after.last_read_at).toBe(true);
  });
});
