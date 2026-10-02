/**
 * title_source on content_outputs — who named a conversation, and who may
 * rename it.
 *
 * Every writer goes through one full-row upsert, and a client autosave sends a
 * first-message title on EVERY save. Before ranking, that meant an auto-title
 * lived for ~5 seconds and a rename made in one tab was undone by the next
 * autosave from another. The invariants:
 *
 *   1. A plain save is 'derived' (NULL) and keeps today's behaviour.
 *   2. An upsert never replaces a higher-ranked title (user = system > auto >
 *      derived), and never downgrades the source either.
 *   3. A rename is 'user' and survives every later autosave.
 *   4. setGeneratedTitle only writes over the ranks it was given, is a no-op
 *      against a rename that raced it, and does not move updated_at (a label
 *      appearing is not activity: no re-sort, no unread dot).
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
const USER = 'user-title-1';

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
});
const setUpdatedAt = (id, value) => new Promise((resolve, reject) => {
  db.run('UPDATE content_outputs SET updated_at = ? WHERE id = ?', [value, id], (err) => (err ? reject(err) : resolve()));
});
const save = (id, title, titleSource = null) =>
  ContentOutputModel.createOrUpdate(id, USER, null, null, '{"messages":[]}', false, 'conversation', `conv-${id}`, title, { titleSource });

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-title-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  ContentOutputModel = (await import('./ContentOutputModel.js')).default;
  await new Promise((resolve, reject) => {
    db.run('INSERT INTO users (id, email) VALUES (?, ?)', [USER, `${USER}@test.local`], (err) => (err ? reject(err) : resolve()));
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

describe('a plain save', () => {
  it('is derived, and a later derived save still replaces it (unchanged behaviour)', async () => {
    await save('t-plain', 'first words');
    expect((await getRow('t-plain')).title_source).toBeNull();
    await save('t-plain', 'other words');
    expect((await getRow('t-plain')).title).toBe('other words');
  });

  it("an unknown or explicit 'derived' source stores NULL", async () => {
    await save('t-junk', 'x', 'bogus');
    await save('t-explicit', 'x', 'derived');
    expect((await getRow('t-junk')).title_source).toBeNull();
    expect((await getRow('t-explicit')).title_source).toBeNull();
  });
});

describe('an auto-title survives the autosaves that follow it', () => {
  it('a derived save cannot replace it', async () => {
    await save('t-auto', 'hey can you help me with my react app');
    expect((await ContentOutputModel.setGeneratedTitle('t-auto', USER, 'React App State Bug')).changes).toBe(1);
    await save('t-auto', 'hey can you help me with my react app');
    const row = await getRow('t-auto');
    expect(row.title).toBe('React App State Bug');
    expect(row.title_source).toBe('auto');
  });
});

describe('a rename is final', () => {
  it('survives autosaves and the auto-titler', async () => {
    await save('t-user', 'first words');
    await ContentOutputModel.updateTitle('t-user', USER, 'My Project');
    expect((await getRow('t-user')).title_source).toBe('user');

    await save('t-user', 'first words');
    expect((await ContentOutputModel.setGeneratedTitle('t-user', USER, 'Generated', { over: ['derived', 'auto'] })).changes).toBe(0);
    expect((await getRow('t-user')).title).toBe('My Project');
  });

  it('a rename beats an auto-title', async () => {
    await save('t-rename-auto', 'first');
    await ContentOutputModel.setGeneratedTitle('t-rename-auto', USER, 'Auto');
    await ContentOutputModel.updateTitle('t-rename-auto', USER, 'Mine');
    expect((await getRow('t-rename-auto')).title).toBe('Mine');
  });
});

describe('system titles', () => {
  it('Main chat keeps its name through autosaves; a system re-save may restate it', async () => {
    await save('t-main', 'Main chat', 'system');
    await save('t-main', 'something the client derived');
    expect((await getRow('t-main')).title).toBe('Main chat');
    await save('t-main', 'Main chat', 'system');
    expect((await getRow('t-main')).title_source).toBe('system');
  });

  it('the auto-titler cannot touch them', async () => {
    expect((await ContentOutputModel.setGeneratedTitle('t-main', USER, 'Nope', { over: ['derived', 'auto'] })).changes).toBe(0);
  });
});

describe('setGeneratedTitle', () => {
  it("initial titling ('derived' only) does not replace an existing auto-title", async () => {
    await save('t-twice', 'first');
    await ContentOutputModel.setGeneratedTitle('t-twice', USER, 'One');
    expect((await ContentOutputModel.setGeneratedTitle('t-twice', USER, 'Two')).changes).toBe(0);
    expect((await ContentOutputModel.setGeneratedTitle('t-twice', USER, 'Two', { over: ['derived', 'auto'] })).changes).toBe(1);
    expect((await getRow('t-twice')).title).toBe('Two');
  });

  it('refuses to be told it may overwrite user or system titles', async () => {
    expect((await ContentOutputModel.setGeneratedTitle('t-user', USER, 'x', { over: ['user', 'system'] })).changes).toBe(0);
  });

  it("is scoped to the owner", async () => {
    await save('t-owner', 'first');
    expect((await ContentOutputModel.setGeneratedTitle('t-owner', 'someone-else', 'x')).changes).toBe(0);
  });

  it('does not move updated_at or the read watermark', async () => {
    await save('t-quiet', 'first');
    await setUpdatedAt('t-quiet', '2020-01-01 00:00:00');
    const before = await getRow('t-quiet');
    await ContentOutputModel.setGeneratedTitle('t-quiet', USER, 'Quiet Title');
    const after = await getRow('t-quiet');
    expect(after.title).toBe('Quiet Title');
    expect(after.updated_at).toBe('2020-01-01 00:00:00');
    expect(after.last_read_at).toBe(before.last_read_at);
  });
});
