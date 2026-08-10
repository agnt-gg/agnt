/**
 * The saved row finishes the turn even when nobody is watching.
 *
 * WHY THIS EXISTS
 * ---------------
 * The run already outlives its socket. The SAVED row did not: content_outputs
 * has one writer, an HTTP handler a client must call, so a conversation
 * abandoned mid-answer stayed frozen at whatever the last attached browser
 * managed to report. Measured on a real install: a sidebar row stuck at 5,107
 * bytes while conversation_logs for the same conversation reached 74,471.
 *
 * The write is deliberately narrow, and the narrowness is the interesting
 * part — each guard below prevents a bug that would be worse than the one
 * being fixed:
 *   - creating rows would enrol conversations no client chose to save;
 *   - a full-row upsert silently nulls every column not passed, including the
 *     user's own title;
 *   - a projection that says less than the saved copy must never win.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

const broadcasts = [];
vi.mock('../../utils/realtimeSync.js', () => ({
  broadcastToUser: (...args) => { broadcasts.push(args); },
  RealtimeEvents: { CONTENT_CREATED: 'content_created', CONTENT_UPDATED: 'content_updated' },
}));

let db;
let ContentOutputModel;
let persistTurnTranscript;
let TMP;
const savedEnv = {};

const USER = 'user-turn-1';
const OTHER_USER = 'user-turn-2';

/** A tool-using turn, in the provider's own shape (what full_history holds). */
const providerHistory = (closingLine = 'All ten minutes of work are done.') => ([
  { role: 'user', content: 'run some long running task' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Starting now.' },
      { type: 'tool_use', id: 'call_1', name: 'shell', input: { cmd: 'long-job' } },
    ],
  },
  // Protocol bookkeeping: a tool's OUTPUT arrives on a synthetic user turn.
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'exit 0' }] },
  { role: 'assistant', content: [{ type: 'text', text: closingLine }] },
]);

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (e, r) => (e ? reject(e) : resolve(r)));
});

const countRows = (conversationId) => new Promise((resolve, reject) => {
  db.get('SELECT COUNT(*) n FROM content_outputs WHERE conversation_id = ?', [conversationId],
    (e, r) => (e ? reject(e) : resolve(r.n)));
});

/** A transcript in the STORED (UI) shape, as a client's autosave would write it. */
const storedTranscript = (messages) => JSON.stringify({ conversationId: 'x', title: 't', messages });

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-turnsave-'));
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
  ({ persistTurnTranscript } = await import('./persistTurnTranscript.js'));

  for (const uid of [USER, OTHER_USER]) {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`],
        (e) => (e ? reject(e) : resolve()));
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

beforeEach(() => { broadcasts.length = 0; });

describe('finishing the row a departed client left behind', () => {
  it('replaces a transcript truncated mid-answer — the reported bug', async () => {
    const conversationId = 'conv-abandoned';
    // What the browser managed to save before it went away: the question, and
    // the first few words of the reply.
    await ContentOutputModel.createOrUpdate(
      'out-abandoned', USER, null, null,
      storedTranscript([
        { role: 'user', content: 'run some long running task' },
        { role: 'assistant', content: 'Starting now.' },
      ]),
      false, 'conversation', conversationId, 'run some long running task',
    );

    const result = await persistTurnTranscript({
      conversationId, userId: USER, providerMessages: providerHistory(),
    });

    expect(result).toMatchObject({ written: true, outputId: 'out-abandoned' });

    const saved = JSON.parse((await getRow('out-abandoned')).content);
    const assistant = saved.messages.find((m) => m.role === 'assistant');
    expect(assistant.content).toContain('All ten minutes of work are done.');
    // The tool card survives the round trip: a transcript that loses its tool
    // calls is the failure this projection exists to avoid.
    expect(assistant.toolCalls.map((t) => t.name)).toEqual(['shell']);
    expect(assistant.contentParts.some((p) => p.type === 'tool_call')).toBe(true);
  });

  it('merges the whole answer into ONE assistant turn, not one per provider row', async () => {
    const conversationId = 'conv-merge';
    await ContentOutputModel.createOrUpdate('out-merge', USER, null, null,
      storedTranscript([{ role: 'user', content: 'hi' }]), false, 'conversation', conversationId, 'hi');

    await persistTurnTranscript({ conversationId, userId: USER, providerMessages: providerHistory() });

    const saved = JSON.parse((await getRow('out-merge')).content);
    // user + one merged assistant. The synthetic tool-result turn must not
    // render as an empty user bubble.
    expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('tells other tabs, so an open sidebar stops showing the stale preview', async () => {
    const conversationId = 'conv-broadcast';
    await ContentOutputModel.createOrUpdate('out-broadcast', USER, null, null,
      storedTranscript([{ role: 'user', content: 'hi' }]), false, 'conversation', conversationId, 'hi');

    await persistTurnTranscript({ conversationId, userId: USER, providerMessages: providerHistory() });

    const [userId, event, payload] = broadcasts.at(-1);
    expect(userId).toBe(USER);
    expect(event).toBe('content_updated');
    expect(payload).toMatchObject({ id: 'out-broadcast', contentType: 'conversation' });
  });
});

describe('what it refuses to do', () => {
  it('never CREATES a row — a conversation no client saved stays unlisted', async () => {
    // Agent chats, suggestion calls and embedded surfaces all deliberately
    // avoid the main list. Creating rows here would enrol every one of them.
    const result = await persistTurnTranscript({
      conversationId: 'conv-never-saved', userId: USER, providerMessages: providerHistory(),
    });

    expect(result).toEqual({ written: false, reason: 'no_saved_row' });
    expect(await countRows('conv-never-saved')).toBe(0);
  });

  it('never shrinks a saved copy that says more', async () => {
    const conversationId = 'conv-richer';
    const richer = storedTranscript([
      { role: 'user', content: 'run some long running task' },
      { role: 'assistant', content: 'A far longer answer than the projection, '.repeat(40) },
    ]);
    await ContentOutputModel.createOrUpdate('out-richer', USER, null, null, richer,
      false, 'conversation', conversationId, 'title');

    const result = await persistTurnTranscript({
      conversationId, userId: USER, providerMessages: providerHistory(),
    });

    expect(result).toEqual({ written: false, reason: 'saved_copy_is_richer' });
    expect((await getRow('out-richer')).content).toBe(richer);
  });

  it('keeps a title the user chose', async () => {
    const conversationId = 'conv-renamed';
    await ContentOutputModel.createOrUpdate('out-renamed', USER, null, null,
      storedTranscript([{ role: 'user', content: 'hi' }]), false, 'conversation',
      conversationId, 'My carefully chosen name');

    await persistTurnTranscript({ conversationId, userId: USER, providerMessages: providerHistory() });

    // createOrUpdate assigns title from `excluded` — passing a derived one
    // would rename the user's conversation behind their back.
    expect((await getRow('out-renamed')).title).toBe('My carefully chosen name');
  });

  it('keeps a scoped row scoped, out of the main conversation list', async () => {
    const conversationId = 'conv-scoped';
    await ContentOutputModel.createOrUpdate('out-scoped', USER, null, null,
      storedTranscript([{ role: 'user', content: 'hi' }]), false, 'conversation',
      conversationId, 'in a workspace', { channelKey: 'workspace:ws-1' });

    await persistTurnTranscript({ conversationId, userId: USER, providerMessages: providerHistory() });

    expect((await getRow('out-scoped')).channel_key).toBe('workspace:ws-1');
  });

  it('does not blank the columns it was never asked to change', async () => {
    // createOrUpdate is a FULL-ROW upsert: is_shareable and tool_id are
    // assigned from `excluded`, so a background write that omits them wipes
    // them.
    const conversationId = 'conv-columns';
    await ContentOutputModel.createOrUpdate('out-columns', USER, null, 'tool-9',
      storedTranscript([{ role: 'user', content: 'hi' }]), true, 'conversation', conversationId, 'kept');

    await persistTurnTranscript({ conversationId, userId: USER, providerMessages: providerHistory() });

    const row = await getRow('out-columns');
    expect(row.tool_id).toBe('tool-9');
    expect(row.is_shareable).toBe(1);
  });

  it('leaves the read watermark alone, so a finished run still shows as unread', async () => {
    const conversationId = 'conv-unread';
    await ContentOutputModel.createOrUpdate('out-unread', USER, null, null,
      storedTranscript([{ role: 'user', content: 'hi' }]), false, 'conversation', conversationId, 'hi');
    await ContentOutputModel.setReadState('out-unread', USER, true);
    const readAt = (await getRow('out-unread')).last_read_at;

    await persistTurnTranscript({ conversationId, userId: USER, providerMessages: providerHistory() });

    // Unread is "updated_at later than last_read_at". Moving the watermark
    // here would silently mark the very answer the user has not seen as read.
    expect((await getRow('out-unread')).last_read_at).toBe(readAt);
  });

  it('ignores a row that is not a transcript', async () => {
    const conversationId = 'conv-not-chat';
    await ContentOutputModel.createOrUpdate('out-not-chat', USER, null, null, '<p>a report</p>',
      false, 'html', conversationId, 'report');

    const result = await persistTurnTranscript({
      conversationId, userId: USER, providerMessages: providerHistory(),
    });

    expect(result).toEqual({ written: false, reason: 'not_a_transcript' });
    expect((await getRow('out-not-chat')).content).toBe('<p>a report</p>');
  });

  it('cannot reach another user\'s row', async () => {
    const conversationId = 'conv-theirs';
    await ContentOutputModel.createOrUpdate('out-theirs', OTHER_USER, null, null,
      storedTranscript([{ role: 'user', content: 'private' }]), false, 'conversation',
      conversationId, 'theirs');

    const result = await persistTurnTranscript({
      conversationId, userId: USER, providerMessages: providerHistory(),
    });

    expect(result).toEqual({ written: false, reason: 'no_saved_row' });
    expect(JSON.parse((await getRow('out-theirs')).content).messages).toHaveLength(1);
  });
});

describe('it can never break the turn that produced it', () => {
  it('resolves rather than throws when the turn is unidentified', async () => {
    await expect(persistTurnTranscript({})).resolves.toEqual({ written: false, reason: 'not_identified' });
    await expect(persistTurnTranscript({ conversationId: 'c' }))
      .resolves.toEqual({ written: false, reason: 'not_identified' });
  });

  it('resolves on an empty history rather than storing an empty transcript', async () => {
    await expect(persistTurnTranscript({ conversationId: 'c', userId: USER, providerMessages: [] }))
      .resolves.toEqual({ written: false, reason: 'no_history' });
  });

  it('reports a database failure instead of raising it into the run', async () => {
    const original = ContentOutputModel.findByConversationId;
    ContentOutputModel.findByConversationId = () => Promise.reject(new Error('disk on fire'));
    try {
      await expect(persistTurnTranscript({
        conversationId: 'c', userId: USER, providerMessages: providerHistory(),
      })).resolves.toEqual({ written: false, reason: 'error' });
    } finally {
      ContentOutputModel.findByConversationId = original;
    }
  });

  it('replaces content that will not parse — unparseable renders as nothing', async () => {
    const conversationId = 'conv-corrupt';
    await ContentOutputModel.createOrUpdate('out-corrupt', USER, null, null, 'not json at all',
      false, 'conversation', conversationId, 'corrupt');

    const result = await persistTurnTranscript({
      conversationId, userId: USER, providerMessages: providerHistory(),
    });

    expect(result.written).toBe(true);
    expect(JSON.parse((await getRow('out-corrupt')).content).messages).toHaveLength(2);
  });
});
