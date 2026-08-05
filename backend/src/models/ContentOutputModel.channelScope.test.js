/**
 * channel_key on content_outputs — who owns a saved transcript.
 *
 * WHY THIS EXISTS
 * ---------------
 * Embedded chats (workspace, artifact, widget, workflow, tool) got durable
 * transcripts, written to content_outputs with content_type 'conversation'.
 * The main chat sidebar has NO type filter — it lists every row a user owns —
 * so every workspace chat immediately appeared among their real conversations.
 *
 * Scope is not a property of the content (they are all genuinely
 * conversations), so it could not be expressed as a content_type. It is a
 * property of WHO THE ROW BELONGS TO, which is what channel_key says:
 *   NULL      -> an item in the user's main conversation list
 *   non-NULL  -> owned by the surface it was typed into
 *
 * The invariants that matter:
 *   1. The list query excludes scoped rows — in SQL, so the COUNT and the
 *      pagination agree with the rows returned.
 *   2. Scope is STICKY. A save that does not mention a channel must never
 *      un-scope a row, or the bug returns silently on the next turn.
 *   3. Scoping is bookkeeping, not activity: it must not move updated_at.
 *   4. A scoped row is still reachable by conversation id — that is how the
 *      chat it belongs to loads itself.
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

const USER = 'user-scope-1';
const OTHER_USER = 'user-scope-2';

const MAIN = 'out-scope-main';          // a real main-chat conversation
const WORKSPACE = 'out-scope-workspace'; // typed into a workspace
const WIDGET = 'out-scope-widget';       // typed into a widget builder

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
});

const setUpdatedAt = (id, value) => new Promise((resolve, reject) => {
  db.run('UPDATE content_outputs SET updated_at = ? WHERE id = ?', [value, id], (err) => (err ? reject(err) : resolve()));
});

const save = (id, { channelKey = null, content = '{"messages":[]}', conversationId = null, title = 't' } = {}) =>
  ContentOutputModel.createOrUpdate(
    id, USER, null, null, content, false, 'conversation', conversationId, title, { channelKey },
  );

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-scope-'));
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

  for (const uid of [USER, OTHER_USER]) {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`], (err) => (err ? reject(err) : resolve()));
    });
  }

  await save(MAIN, { conversationId: 'conv-main', title: 'A real conversation' });
  await save(WORKSPACE, { channelKey: 'workspace:ws-1', conversationId: 'conv-ws', title: 'make the sim bigger' });
  await save(WIDGET, { channelKey: 'widget:w-1', conversationId: 'conv-widget', title: 'build me a card' });
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('the column', () => {
  it('defaults to NULL — a plain save is a main-chat conversation', async () => {
    expect((await getRow(MAIN)).channel_key).toBeNull();
  });

  it('records the owning channel when one is given', async () => {
    expect((await getRow(WORKSPACE)).channel_key).toBe('workspace:ws-1');
    expect((await getRow(WIDGET)).channel_key).toBe('widget:w-1');
  });

  it('rides on the list metadata payload, so clients can apply the same rule', async () => {
    // The save response and the realtime broadcast carry this shape. Without
    // channel_key here, a workspace chat inserts itself into the sidebar live
    // even though the list query excludes it.
    const meta = await ContentOutputModel.findMetaById(WORKSPACE);
    expect(meta.channel_key).toBe('workspace:ws-1');
    expect(meta.content).toBeUndefined();
  });
});

describe('the main chat list shows conversations, not embedded chats', () => {
  it('excludes every channel-scoped row', async () => {
    const { outputs } = await ContentOutputModel.findAllByUserId(USER);
    const ids = outputs.map((o) => o.id);

    expect(ids).toContain(MAIN);
    expect(ids).not.toContain(WORKSPACE);
    expect(ids).not.toContain(WIDGET);
  });

  it('excludes them from the COUNT too, not just the page', async () => {
    // Filtered client-side this would still say 3 and silently shrink pages.
    const { totalCount } = await ContentOutputModel.findAllByUserId(USER);
    expect(totalCount).toBe(1);
  });

  it('keeps paginating correctly with scoped rows present', async () => {
    const { outputs, totalCount } = await ContentOutputModel.findAllByUserId(USER, 10, 0);
    expect(outputs).toHaveLength(1);
    expect(totalCount).toBe(1);
  });
});

describe('scope is sticky', () => {
  it('a save that does not mention a channel cannot un-scope a row', async () => {
    // The exact regression path: any later save without the channelKey would
    // drop the transcript straight back into the user's conversation list.
    await save(WORKSPACE, { conversationId: 'conv-ws', title: 'later turn' });

    expect((await getRow(WORKSPACE)).channel_key).toBe('workspace:ws-1');
    const { outputs } = await ContentOutputModel.findAllByUserId(USER);
    expect(outputs.map((o) => o.id)).not.toContain(WORKSPACE);
  });

  it('still writes the rest of the row on that save', async () => {
    // Stickiness must not be achieved by ignoring the save.
    expect((await getRow(WORKSPACE)).title).toBe('later turn');
  });
});

describe('setChannelKey — the one-time repair path', () => {
  it('scopes an existing row and removes it from the list', async () => {
    const stray = 'out-scope-stray';
    await save(stray, { conversationId: 'conv-stray', title: 'a workspace chat saved before scope existed' });
    expect((await ContentOutputModel.findAllByUserId(USER)).outputs.map((o) => o.id)).toContain(stray);

    const changes = await ContentOutputModel.setChannelKey(stray, USER, 'workspace:ws-2');

    expect(changes).toBe(1);
    expect((await ContentOutputModel.findAllByUserId(USER)).outputs.map((o) => o.id)).not.toContain(stray);
  });

  it('does NOT move updated_at — repairing ownership is not user activity', async () => {
    const row = 'out-scope-timestamps';
    await save(row, { conversationId: 'conv-ts' });
    await setUpdatedAt(row, '2020-01-01 00:00:00');

    await ContentOutputModel.setChannelKey(row, USER, 'workspace:ws-3');

    // Bumping it would reorder the sidebar and light unread dots for every
    // row the sweep touches.
    const after = await getRow(row);
    expect(after.updated_at).toBe('2020-01-01 00:00:00');
    expect(after.last_read_at).toBeNull();
  });

  it('reports 0 changes for a row owned by someone else', async () => {
    expect(await ContentOutputModel.setChannelKey(WORKSPACE, OTHER_USER, 'workspace:evil')).toBe(0);
    expect((await getRow(WORKSPACE)).channel_key).toBe('workspace:ws-1');
  });

  it('reports 0 changes for a row that does not exist', async () => {
    expect(await ContentOutputModel.setChannelKey('nope', USER, 'workspace:x')).toBe(0);
  });
});

describe('a scoped transcript is hidden, never lost', () => {
  it('is still reachable by conversation id — that is how its chat reloads', async () => {
    const found = await ContentOutputModel.findByConversationId('conv-ws', USER);
    expect(found?.id).toBe(WORKSPACE);
    expect(found.channel_key).toBe('workspace:ws-1');
  });

  it('is still reachable by its own id', async () => {
    expect((await ContentOutputModel.findOne(WORKSPACE))?.id).toBe(WORKSPACE);
  });

  it('is still scoped to its owner', async () => {
    expect(await ContentOutputModel.findByConversationId('conv-ws', OTHER_USER)).toBeFalsy();
  });
});
