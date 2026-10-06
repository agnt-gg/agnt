import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startSubChat, createHeadlessTransport, buildReport, subChatTitle, runningSubChatCount, isSubChatRunning, MAX_RUNNING_SUB_CHATS,
} from './subChats.js';
import { _resetReportsForTests } from './subChatReports.js';

/**
 * A sub-chat is a real saved conversation, run headlessly through the normal
 * chat turn, whose outcome is reported to the conversation that started it
 * (as a report TURN there; subChatReports.test.js covers batching, texting
 * and recovery). Every collaborator is injected.
 */
function makeDeps({ parent = null, parentRole = null, answer = 'Done: found 3 competitors.', busyPolls = 0, execute, phone = false } = {}) {
  const rows = new Map();
  const calls = { reports: [], segments: [], broadcasts: [], moves: [], subs: [], states: [], texts: [], busyChecks: 0 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const reportTurn = (input) => {
    const message = input.body.messages.at(-1);
    calls.reports.push({ conversationId: input.body.conversationId, message, textMode: input.body.textMode });
    input.transport.send('final_content', { content: 'Relayed to the user.' });
  };
  const deps = {
    ContentOutputModel: {
      findMetaByConversationId: vi.fn(async (conversationId) => (parent && parent.conversation_id === conversationId ? parent : null)),
      createOrUpdate: vi.fn(async (id, userId, _w, _t, content, _s, type, conversationId, title) => { rows.set(id, { id, userId, content, type, conversationId, title }); }),
      moveToGroup: vi.fn(async (id, userId, groupId) => { calls.moves.push({ id, groupId }); }),
      findMetaById: vi.fn(async (id) => ({ id, title: rows.get(id)?.title })),
    },
    ConversationRoleModel: {
      roleOf: vi.fn(async () => parentRole),
      addSub: vi.fn(async (userId, id, parentId) => { calls.subs.push({ userId, id, parentId }); }),
      setTaskState: vi.fn(async (userId, ids, state) => { calls.states.push({ ids, state, running: ids.map(isSubChatRunning) }); }),
    },
    serializeTranscript: (payload) => JSON.stringify(payload),
    broadcastToUser: (userId, event, data) => calls.broadcasts.push({ userId, event, data }),
    RealtimeEvents: { CONTENT_CREATED: 'content:created' },
    executeChatSegment: async (input) => {
      if (input.body.messages) return reportTurn(input);
      calls.segments.push(input);
      if (execute) return execute(input);
      await gate;
      input.transport.send('final_content', { content: answer });
    },
    isConversationBusy: async () => { calls.busyChecks += 1; return calls.busyChecks <= busyPolls; },
    loadHistory: async () => [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }],
    hasLinkedPhone: async () => phone,
    textUser: async (input) => { calls.texts.push(input); return { sent: true, id: 'm1' }; },
    sleep: async () => {},
    batchMs: 0,
  };
  return { deps, rows, calls, finishRun: () => release() };
}

const PARENT = { id: 'out-main', conversation_id: 'conv-main', group_id: 'grp-1' };

beforeEach(() => _resetReportsForTests());

describe('startSubChat', () => {
  it('creates a linked conversation, runs the task in it, and reports back to the parent', async () => {
    const { deps, rows, calls, finishRun } = makeDeps({ parent: PARENT });
    const result = await startSubChat({ userId: 'u1', authToken: 'Bearer t', parentConversationId: 'conv-main', title: 'Pricing research', prompt: 'Research competitor pricing.' }, deps);

    expect(result.success).toBe(true);
    expect(result.title).toBe('Pricing research');
    expect(result.parentOutputId).toBe('out-main');

    const row = rows.get(result.outputId);
    expect(row.type).toBe('conversation');
    expect(row.conversationId).toBe(result.conversationId);
    const transcript = JSON.parse(row.content);
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0]).toMatchObject({ role: 'user', content: 'Research competitor pricing.' });

    expect(calls.subs).toEqual([{ userId: 'u1', id: result.outputId, parentId: 'out-main' }]);
    expect(calls.moves).toEqual([{ id: result.outputId, groupId: 'grp-1' }]);
    expect(calls.broadcasts[0].event).toBe('content:created');

    expect(calls.segments[0]).toMatchObject({
      userId: 'u1', authToken: 'Bearer t', chatType: 'orchestrator',
      body: { message: 'Research competitor pricing.', conversationId: result.conversationId, history: [] },
    });
    expect(calls.segments[0].body.userMessageId).toBe(transcript.messages[0].id);
    expect(runningSubChatCount('u1')).toBe(1);
    expect(isSubChatRunning(result.outputId)).toBe(true);

    finishRun();
    await result.finished;

    expect(runningSubChatCount('u1')).toBe(0);
    expect(isSubChatRunning(result.outputId)).toBe(false);
    // The report is a turn in the PARENT, on its persisted history.
    expect(calls.reports).toHaveLength(1);
    expect(calls.reports[0].conversationId).toBe('conv-main');
    expect(calls.reports[0].message.content).toContain('Pricing research');
    expect(calls.reports[0].message.content).toContain('Done: found 3 competitors.');
    expect(calls.reports[0].message.content).toContain('Status: completed');
    // running -> done (recorded while the slot was still held) -> reported.
    expect(calls.states.map((s) => s.state)).toEqual(['done', 'reported']);
    expect(calls.states[0].running).toEqual([true]);
    // No phone linked: nothing texted, and the turn is not a text turn.
    expect(calls.reports[0].textMode).toBe(false);
    expect(calls.texts).toEqual([]);
  });

  it('texts the parent\'s relay when a phone is linked', async () => {
    const { deps, calls, finishRun } = makeDeps({ parent: PARENT, phone: true });
    const result = await startSubChat({ userId: 'u-phone', parentConversationId: 'conv-main', title: 'Pricing research', prompt: 'p' }, deps);
    finishRun();
    expect(await result.finished).toMatchObject({ delivered: true, texted: true });
    expect(calls.reports[0].textMode).toBe(true);
    expect(calls.texts).toHaveLength(1);
    expect(calls.texts[0].text).toBe('Relayed to the user.');
  });

  it('waits until the parent is between turns before reporting', async () => {
    const { deps, calls, finishRun } = makeDeps({ parent: PARENT, busyPolls: 3 });
    const result = await startSubChat({ userId: 'u-wait', parentConversationId: 'conv-main', title: 'x', prompt: 'y' }, deps);
    finishRun();
    await result.finished;
    expect(calls.busyChecks).toBe(4);
    expect(calls.reports).toHaveLength(1);
  });

  it('reports a failed run honestly', async () => {
    const { deps, calls } = makeDeps({
      parent: PARENT,
      execute: async () => { throw new Error('provider down'); },
    });
    const result = await startSubChat({ userId: 'u-fail', parentConversationId: 'conv-main', title: 'x', prompt: 'y' }, deps);
    await result.finished;
    expect(calls.reports[0].message.content).toContain('Status: failed');
    expect(calls.reports[0].message.content).toContain('provider down');
    expect(calls.reports[0].message.content).toContain('Do NOT claim success');
  });

  it('still runs when the parent conversation is not saved yet, without a sidebar link', async () => {
    const { deps, calls, finishRun } = makeDeps({ parent: null });
    const result = await startSubChat({ userId: 'u-new', parentConversationId: 'conv-unsaved', title: 'x', prompt: 'y' }, deps);
    expect(result.success).toBe(true);
    expect(calls.subs[0].parentId).toBe(null);
    expect(calls.moves).toEqual([]);
    finishRun();
    await result.finished;
    expect(calls.reports[0].conversationId).toBe('conv-unsaved');
  });

  it('with no parent at all, records the work as finished and reports nowhere', async () => {
    const { deps, calls, finishRun } = makeDeps();
    const result = await startSubChat({ userId: 'u-orphan', parentConversationId: null, title: 'x', prompt: 'y' }, deps);
    finishRun();
    await result.finished;
    expect(calls.states.map((s) => s.state)).toEqual(['expired']);
    expect(calls.reports).toEqual([]);
  });

  it('refuses to start a sub-chat from a sub-chat', async () => {
    const { deps, calls } = makeDeps({ parent: PARENT, parentRole: { role: 'sub', parent_output_id: 'out-root' } });
    const result = await startSubChat({ userId: 'u2', parentConversationId: 'conv-main', title: 'x', prompt: 'y' }, deps);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sub-chat/);
    expect(calls.segments).toEqual([]);
    expect(deps.ContentOutputModel.createOrUpdate).not.toHaveBeenCalled();
  });

  it('caps concurrent sub-chats per user, and frees the slot when the work ends', async () => {
    const { deps, finishRun } = makeDeps({ parent: PARENT });
    const started = [];
    for (let i = 0; i < MAX_RUNNING_SUB_CHATS; i++) {
      started.push(await startSubChat({ userId: 'u-cap', parentConversationId: 'conv-main', title: `t${i}`, prompt: 'work' }, deps));
    }
    expect(started.every((r) => r.success)).toBe(true);
    const refused = await startSubChat({ userId: 'u-cap', parentConversationId: 'conv-main', title: 'one more', prompt: 'work' }, deps);
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(/already running/);
    expect((await startSubChat({ userId: 'u-other', parentConversationId: null, title: 't', prompt: 'w' }, deps)).success).toBe(true);

    finishRun();
    await Promise.all(started.map((r) => r.finished));
    expect(runningSubChatCount('u-cap')).toBe(0);
  });

  it('validates its input', async () => {
    const { deps } = makeDeps();
    expect((await startSubChat({ userId: null, prompt: 'x' }, deps)).success).toBe(false);
    expect((await startSubChat({ userId: 'u', prompt: '   ' }, deps)).error).toMatch(/prompt is required/);
    expect((await startSubChat({ userId: 'u', prompt: 'x'.repeat(20001) }, deps)).error).toMatch(/too long/);
  });
});

describe('createHeadlessTransport', () => {
  it('keeps the final answer', () => {
    const t = createHeadlessTransport();
    t.start();
    t.send('content_delta', { delta: 'partial' });
    t.send('final_content', { content: 'The answer.' });
    expect(t.outcome()).toEqual({ ok: true, content: 'The answer.', error: null, imageIds: [] });
  });

  it('keeps the ids of images the turn generated', () => {
    const t = createHeadlessTransport();
    t.send('image_generated', { imageId: 'img-1' });
    t.send('final_content', { content: 'Here it is.' });
    expect(t.outcome().imageIds).toEqual(['img-1']);
  });

  it('marks a run that errored as failed even when it produced text', () => {
    const t = createHeadlessTransport();
    t.send('error', { error: 'rate limited' });
    t.send('final_content', { content: 'I hit a problem.', recovered_from_error: true });
    expect(t.outcome()).toMatchObject({ ok: false, content: 'I hit a problem.', error: 'rate limited' });
  });

  it('fails a run that never answered or was rejected', () => {
    expect(createHeadlessTransport().outcome().ok).toBe(false);
    const rejected = createHeadlessTransport();
    rejected.reject(400, 'Could not determine AI provider/model.');
    expect(rejected.outcome()).toMatchObject({ ok: false, error: 'Could not determine AI provider/model.' });
  });
});

describe('helpers', () => {
  it('titles from the task when no title is given, and trims long ones', () => {
    expect(subChatTitle('', 'Research pricing\nmore detail')).toBe('Research pricing');
    expect(subChatTitle('x'.repeat(200), '')).toHaveLength(80);
    expect(subChatTitle('', '')).toBe('Task');
  });

  it('clips a long answer in the report', () => {
    const report = buildReport({ title: 't', outputId: 'o', outcome: { ok: true, content: 'a'.repeat(10000), error: null } });
    expect(report.content).toContain('truncated');
    expect(report.content.length).toBeLessThan(7500);
  });
});
