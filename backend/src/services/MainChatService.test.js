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

  it('a stale named autosave cannot restore the transcript after clear', async () => {
    const before = await MainChat.ensureMainChat(USER);
    const after = await MainChat.clearMainChat(USER);
    const service = (await import('./RunService.js')).default;
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await service.saveOrUpdateContentOutput({ user: { id: USER, userId: USER }, body: {
      id: before.id, conversationId: before.conversation_id, contentType: 'conversation',
      content: JSON.stringify({ conversationId: before.conversation_id, messages: [{ role: 'user', content: 'old history' }] }),
    } }, response);
    expect(response.statusCode).toBe(409);
    expect(response.body.error).toBe('conversation_reset');
    const stored = await ContentOutputModel.findOne(after.id);
    expect(stored.conversation_id).toBe(after.conversation_id);
    expect(JSON.parse(stored.content).messages).toEqual([]);
  });

  it('keeps sub-chats linked to the Main chat across a clear', async () => {
    const main = await MainChat.ensureMainChat(USER);
    await ContentOutputModel.createOrUpdate('sub-a', USER, null, null, '{"messages":[]}', false, 'conversation', 'conv-sub-a', 'Task A');
    await ConversationRoleModel.addSub(USER, 'sub-a', main.id);

    await MainChat.clearMainChat(USER);
    expect(await ConversationRoleModel.listSubChats(USER)).toContainEqual({ id: 'sub-a', parentId: main.id });
  });
});

// The sidebar pins the Main chat again (texts land in it). The Oct 3 bug was
// ordinary conversations ending up in it while its row was hidden; these pin
// that the pin and "a new chat is its own conversation" both hold.
describe('the pinned Main chat', () => {
  const PIN_USER = 'user-main-pin';
  beforeAll(async () => {
    await run('INSERT INTO users (id, email) VALUES (?, ?)', [PIN_USER, `${PIN_USER}@test.local`]);
  });

  it('the sidebar state creates the Main chat once and returns it with sub-chat links', async () => {
    const [first, second] = await Promise.all([MainChat.getMainChatState(PIN_USER), MainChat.getMainChatState(PIN_USER)]);
    expect(first.main.id).toBe(second.main.id);
    expect(first.main.title).toBe(MainChat.MAIN_CHAT_TITLE);
    expect(await ConversationRoleModel.findMainOutputId(PIN_USER)).toBe(first.main.id);
    expect(Array.isArray(first.subChats)).toBe(true);
    expect(await all(`SELECT id FROM content_outputs WHERE user_id = ?`, [PIN_USER])).toHaveLength(1);
  });

  // Reported: a second "Main chat" showed up as an ordinary conversation. The
  // first one's marker write failed, so the next ask created another.
  it('a failed marker write leaves no orphan row, and the next ask still finds one Main chat', async () => {
    const uid = 'user-main-marker-fails';
    await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);
    const { vi } = await import('vitest');
    const spy = vi.spyOn(ConversationRoleModel, 'setMain').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    await expect(MainChat.ensureMainChat(uid)).rejects.toThrow('SQLITE_BUSY');
    spy.mockRestore();
    expect(await all(`SELECT id FROM content_outputs WHERE user_id = ?`, [uid])).toEqual([]);
    const main = await MainChat.ensureMainChat(uid);
    expect(await all(`SELECT id FROM content_outputs WHERE user_id = ?`, [uid])).toEqual([{ id: main.id }]);
  });

  it('an unmarked Main chat row already in the list is adopted, never duplicated', async () => {
    const uid = 'user-main-orphan';
    await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);
    // The state the bug left behind: a system "Main chat" with no marker.
    await ContentOutputModel.createOrUpdate('orphan-main', uid, null, null, JSON.stringify({ messages: [] }), false, 'conversation', 'conv-orphan', MainChat.MAIN_CHAT_TITLE, { titleSource: 'system' });
    // A conversation the user merely named "Main chat" is theirs, not adopted.
    await ContentOutputModel.createOrUpdate('named-by-user', uid, null, null, JSON.stringify({ messages: [] }), false, 'conversation', 'conv-named', MainChat.MAIN_CHAT_TITLE, { titleSource: 'user' });
    const main = await MainChat.ensureMainChat(uid);
    expect(main.id).toBe('orphan-main');
    expect(await ConversationRoleModel.findMainOutputId(uid)).toBe('orphan-main');
    expect((await all(`SELECT id FROM content_outputs WHERE user_id = ? ORDER BY id`, [uid])).map((r) => r.id)).toEqual(['named-by-user', 'orphan-main']);
  });

  it('replacing the Main chat swaps the marker in one write', async () => {
    const uid = 'user-main-replace';
    await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);
    const first = await MainChat.ensureMainChat(uid);
    await ContentOutputModel.createOrUpdate('second-main', uid, null, null, JSON.stringify({ messages: [] }), false, 'conversation', 'conv-second', 'x', { titleSource: 'system' });
    await ConversationRoleModel.setMain(uid, 'second-main');
    expect(await ConversationRoleModel.findMainOutputId(uid)).toBe('second-main');
    expect(await all(`SELECT output_id FROM conversation_roles WHERE user_id = ? AND role = 'main'`, [uid])).toEqual([{ output_id: 'second-main' }]);
    expect(first.id).not.toBe('second-main');
  });

  it('a new conversation saved alongside it is its own row, never the Main chat', async () => {
    const { main } = await MainChat.getMainChatState(PIN_USER);
    const service = (await import('./RunService.js')).default;
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await service.saveOrUpdateContentOutput({ user: { id: PIN_USER, userId: PIN_USER }, body: {
      conversationId: 'conv-a-new-chat', contentType: 'conversation', title: 'A new chat',
      content: JSON.stringify({ conversationId: 'conv-a-new-chat', messages: [{ role: 'user', content: 'hello' }] }),
    } }, response);
    expect(response.statusCode).toBe(200);
    const rows = await all(`SELECT id, conversation_id FROM content_outputs WHERE user_id = ?`, [PIN_USER]);
    expect(rows).toHaveLength(2);
    const created = rows.find((r) => r.conversation_id === 'conv-a-new-chat');
    expect(created.id).not.toBe(main.id);
    expect(await ConversationRoleModel.findMainOutputId(PIN_USER)).toBe(main.id);
    expect(JSON.parse((await ContentOutputModel.findOne(main.id)).content).messages).toEqual([]);
  });
});
