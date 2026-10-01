/**
 * The Main chat: one per user, created on first ask, clearable without
 * losing the row or the sub-chats linked to it.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let ContentOutputModel;
let ConversationRoleModel;
let MainChat;
let TMP;
const savedEnv = {};

const USER = 'user-main-1';
const OTHER_USER = 'user-main-2';

const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-mainchat-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;
  // An empty agnt.db, so the bootstrap does not adopt the developer's real one.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  ContentOutputModel = (await import('../models/ContentOutputModel.js')).default;
  ConversationRoleModel = (await import('../models/ConversationRoleModel.js')).default;
  MainChat = await import('./MainChatService.js');

  for (const uid of [USER, OTHER_USER]) await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('ensureMainChat', () => {
  it('creates one Main chat, even when asked concurrently', async () => {
    const results = await Promise.all([MainChat.ensureMainChat(USER), MainChat.ensureMainChat(USER), MainChat.ensureMainChat(USER)]);
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    const rows = await all(`SELECT id FROM content_outputs WHERE user_id = ?`, [USER]);
    expect(rows).toHaveLength(1);
    expect(results[0].title).toBe(MainChat.MAIN_CHAT_TITLE);
    expect(results[0].content_type).toBe('conversation');
    expect(results[0].conversation_id).toBeTruthy();
  });

  it('returns the same row on later asks', async () => {
    const first = await MainChat.ensureMainChat(USER);
    const again = await MainChat.ensureMainChat(USER);
    expect(again.id).toBe(first.id);
    expect(again.conversation_id).toBe(first.conversation_id);
  });

  it('is per user', async () => {
    const mine = await MainChat.ensureMainChat(USER);
    const theirs = await MainChat.ensureMainChat(OTHER_USER);
    expect(theirs.id).not.toBe(mine.id);
  });

  it('recreates the Main chat if its row was deleted', async () => {
    const before = await MainChat.ensureMainChat(OTHER_USER);
    await ContentOutputModel.delete(before.id, OTHER_USER);
    const after = await MainChat.ensureMainChat(OTHER_USER);
    expect(after.id).not.toBe(before.id);
    expect(await ConversationRoleModel.findMainOutputId(OTHER_USER)).toBe(after.id);
  });

  it('the database refuses a second main role for one user', async () => {
    await expect(run(
      `INSERT INTO conversation_roles (output_id, user_id, role) VALUES ('not-a-second-main', ?, 'main')`, [USER],
    )).rejects.toThrow();
  });
});

describe('clearMainChat', () => {
  it('keeps the row, empties the transcript, and starts a fresh conversation', async () => {
    const main = await MainChat.ensureMainChat(USER);
    // Put something in it, as a client autosave would.
    await ContentOutputModel.createOrUpdate(
      main.id, USER, null, null,
      JSON.stringify({ conversationId: main.conversation_id, title: 'Main chat', messages: [{ id: 'm1', role: 'user', content: 'hello' }] }),
      false, 'conversation', main.conversation_id, 'Main chat',
    );

    const cleared = await MainChat.clearMainChat(USER);
    expect(cleared.id).toBe(main.id);
    expect(cleared.conversation_id).not.toBe(main.conversation_id);

    const row = await ContentOutputModel.findOne(main.id);
    const transcript = JSON.parse(row.content);
    expect(transcript.messages).toEqual([]);
    expect(transcript.conversationId).toBe(cleared.conversation_id);
    // Clearing is the user's own action: it must not read as unread.
    expect(new Date(row.last_read_at + 'Z').getTime()).toBeGreaterThanOrEqual(new Date(row.updated_at + 'Z').getTime());
  });

  it('keeps sub-chats linked to the Main chat across a clear', async () => {
    const main = await MainChat.ensureMainChat(USER);
    await ContentOutputModel.createOrUpdate('sub-a', USER, null, null, '{"messages":[]}', false, 'conversation', 'conv-sub-a', 'Task A');
    await ConversationRoleModel.addSub(USER, 'sub-a', main.id);

    await MainChat.clearMainChat(USER);
    const state = await MainChat.getMainChatState(USER);
    expect(state.main.id).toBe(main.id);
    expect(state.subChats).toContainEqual({ id: 'sub-a', parentId: main.id });
  });
});
