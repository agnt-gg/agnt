/**
 * Deleting a chat closes the browser tab that chat was driving.
 *
 * Each conversation has its own tab in the launched browser (browserLanes.js).
 * Idle tabs close on a timer; this closes them the moment the chat is deleted.
 *
 * Rules pinned here, against a real (throwaway) database:
 *   - only when the conversation's LAST saved row is deleted — older installs
 *     can hold several rows for one chat, and deleting a stale duplicate must
 *     not close the tab of a chat that is still listed;
 *   - only for the caller's own rows;
 *   - never for outputs that are not chats;
 *   - never able to fail the delete itself.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('../utils/realtimeSync.js', () => ({
  broadcastToUser: () => {},
  RealtimeEvents: { CONTENT_CREATED: 'content_created', CONTENT_UPDATED: 'content_updated', CONTENT_DELETED: 'content_deleted' },
}));

const closeConversationLane = vi.fn();
vi.mock('./browserLanes.js', () => ({
  closeConversationLane: (...a) => closeConversationLane(...a),
}));

let db;
let RunService;
let releaseDeletedConversationBrowser;
let TMP;
const savedEnv = {};
const USER = 'user-delete-browser-1';
const OTHER = 'user-delete-browser-2';

const insertOutput = (id, { userId = USER, conversationId = null } = {}) => new Promise((resolve, reject) => {
  db.run(
    'INSERT INTO content_outputs (id, user_id, content, conversation_id) VALUES (?, ?, ?, ?)',
    [id, userId, '{"messages":[]}', conversationId],
    (err) => (err ? reject(err) : resolve()),
  );
});

/** Drive the real handler; resolves with { status, body }. */
const del = (id, userId = USER) => new Promise((resolve, reject) => {
  let status = 200;
  const res = {
    status: (code) => { status = code; return res; },
    json: (body) => resolve({ status, body }),
  };
  RunService.deleteContentOutput({ params: { id }, user: { userId } }, res).catch(reject);
});

/** The release runs after the response; let it finish. */
const settle = () => new Promise((r) => { setTimeout(r, 50); });

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-delete-browser-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;
  // An empty agnt.db, so bootstrap does not adopt the developer's real database.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  const mod = await import('./RunService.js');
  RunService = mod.default;
  releaseDeletedConversationBrowser = mod.releaseDeletedConversationBrowser;

  for (const uid of [USER, OTHER]) {
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

beforeEach(() => {
  closeConversationLane.mockReset().mockResolvedValue(true);
});

describe('deleting a chat closes its browser tab', () => {
  it('closes the conversation\'s tab when its row is deleted', async () => {
    await insertOutput('out-1', { conversationId: 'conv-1' });
    const { status } = await del('out-1');
    await settle();
    expect(status).toBe(200);
    expect(closeConversationLane).toHaveBeenCalledWith(USER, 'conv-1');
  });

  it('waits for the LAST row: a stale duplicate going away leaves the chat\'s tab open', async () => {
    await insertOutput('dup-a', { conversationId: 'conv-dup' });
    await insertOutput('dup-b', { conversationId: 'conv-dup' });
    await del('dup-a');
    await settle();
    expect(closeConversationLane).not.toHaveBeenCalled();
    await del('dup-b');
    await settle();
    expect(closeConversationLane).toHaveBeenCalledWith(USER, 'conv-dup');
  });

  it('another user\'s row: refused, and nothing is closed', async () => {
    await insertOutput('theirs', { userId: OTHER, conversationId: 'conv-x' });
    const { status } = await del('theirs', USER);
    await settle();
    expect(status).toBe(404);
    expect(closeConversationLane).not.toHaveBeenCalled();
  });

  it('an output that is not a chat closes nothing', async () => {
    await insertOutput('report-1');
    await del('report-1');
    await settle();
    expect(closeConversationLane).not.toHaveBeenCalled();
  });

  it('a browser that will not close never fails the delete', async () => {
    closeConversationLane.mockRejectedValue(new Error('browser gone'));
    await insertOutput('out-2', { conversationId: 'conv-2' });
    const { status } = await del('out-2');
    await settle();
    expect(status).toBe(200);
    await expect(releaseDeletedConversationBrowser(USER, 'conv-2')).resolves.toBe(false);
  });
});
