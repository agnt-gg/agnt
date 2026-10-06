/**
 * conversation_roles.task_state against a real database: the migration adds
 * the column, a new sub-chat starts 'running', and listUnreported returns
 * exactly the sub-chats whose work never reached their parent, with the
 * parent's CURRENT conversation id (clearing the Main chat mints a new one).
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
let TMP;
const savedEnv = {};
const USER = 'user-taskstate-1';
const OTHER = 'user-taskstate-2';

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-taskstate-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;
  // An empty agnt.db, so the bootstrap does not adopt the developer's real one.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');
  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  ContentOutputModel = (await import('./ContentOutputModel.js')).default;
  ConversationRoleModel = (await import('./ConversationRoleModel.js')).default;
  for (const uid of [USER, OTHER]) await run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`]);
  const conversation = (id, user, conversationId, title, content = '{"messages":[]}') =>
    ContentOutputModel.createOrUpdate(id, user, null, null, content, false, 'conversation', conversationId, title);
  await conversation('main', USER, 'conv-main-2', 'Main');
  await conversation('sub-running', USER, 'conv-sub-1', 'Long build');
  await conversation('sub-done', USER, 'conv-sub-2', 'Pricing', '{"messages":[{"role":"assistant","content":"Found 3."}]}');
  await conversation('sub-reported', USER, 'conv-sub-3', 'Old news');
  await conversation('sub-legacy', USER, 'conv-sub-4', 'Before the column');
  await conversation('sub-other', OTHER, 'conv-sub-5', 'Someone else');
  await ConversationRoleModel.addSub(USER, 'sub-running', 'main');
  await ConversationRoleModel.addSub(USER, 'sub-done', 'main');
  await ConversationRoleModel.addSub(USER, 'sub-reported', 'main');
  await ConversationRoleModel.addSub(OTHER, 'sub-other', null);
  await run(`INSERT INTO conversation_roles (output_id, user_id, role, parent_output_id) VALUES ('sub-legacy', ?, 'sub', 'main')`, [USER]);
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('conversation_roles.task_state', () => {
  it('moves states for the owner only, and lists exactly the unreported work', async () => {
    await ConversationRoleModel.setTaskState(USER, ['sub-done'], 'done');
    await ConversationRoleModel.setTaskState(USER, ['sub-reported'], 'reported');
    // Another account cannot move this user's rows.
    expect((await ConversationRoleModel.setTaskState(OTHER, ['sub-running'], 'reported')).changes).toBe(0);

    const rows = await ConversationRoleModel.listUnreported();
    const byId = Object.fromEntries(rows.map((r) => [r.outputId, r]));
    expect(Object.keys(byId).sort()).toEqual(['sub-done', 'sub-other', 'sub-running']);
    expect(byId['sub-running']).toMatchObject({ userId: USER, taskState: 'running', title: 'Long build', parentConversationId: 'conv-main-2' });
    expect(byId['sub-done'].content).toContain('Found 3.');
    expect(byId['sub-done'].conversationId).toBe('conv-sub-2');
    // No parent: listed, so boot recovery can expire it.
    expect(byId['sub-other'].parentConversationId).toBe(null);
    expect(typeof byId['sub-running'].createdAt).toBe('string');
  });

  it('a cleared Main chat (new conversation id, same row) is still the parent', async () => {
    await run(`UPDATE content_outputs SET conversation_id = 'conv-main-3' WHERE id = 'main'`);
    const row = (await ConversationRoleModel.listUnreported()).find((r) => r.outputId === 'sub-running');
    expect(row.parentConversationId).toBe('conv-main-3');
  });

  it('the production report wiring loads and reads a parent\'s persisted history', async () => {
    const { defaultReportDeps } = await import('../services/orchestrator/subChatReports.js');
    const deps = await defaultReportDeps();
    for (const name of ['executeChatSegment', 'isConversationBusy', 'loadHistory', 'hasLinkedPhone', 'textUser', 'freshToken', 'sleep']) {
      expect(typeof deps[name], name).toBe('function');
    }
    expect(deps.ConversationRoleModel).toBe(ConversationRoleModel);
    expect(await deps.loadHistory('conv-none', USER)).toEqual([]);
    expect(await deps.isConversationBusy('conv-main-3', USER)).toBe(false);
    // No session in a test process: recovery must wait for one, not run.
    expect(deps.freshToken(USER)).toBe(null);
  });

  it('an empty id list is a no-op', async () => {
    expect((await ConversationRoleModel.setTaskState(USER, [], 'reported')).changes).toBe(0);
  });
});
