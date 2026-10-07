/**
 * A blocked sub-chat asks the user through the Main chat, and the answer goes
 * back into the SAME sub-chat (requested 2026-10-07: "can the main chat ask a
 * question if the sub chat has a blocker?").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startSubChat, continueSubChat, waitingSubChat, reportDirectAnswer, needsInputOf, classifyOutcome } from './subChats.js';
import { _resetReportsForTests, recoverSubChatReports, SUB_CHAT_MARKER } from './subChatReports.js';

const MAIN = { id: 'out-main', conversation_id: 'conv-main', title: 'Main chat' };
const decodeMarker = (content) => {
  const m = new RegExp(`<!-- ${SUB_CHAT_MARKER}:([A-Za-z0-9_-]+) -->`).exec(content);
  return m ? JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) : null;
};

/** A world with a Main chat, a phone, and a worker whose replies the test scripts. */
function world({ workerReplies = [], roles = {}, phone = true } = {}) {
  const rows = new Map([[MAIN.id, { ...MAIN }]]);
  const roleRows = new Map([[MAIN.id, { role: 'main', parent_output_id: null, task_state: null }], ...Object.entries(roles)]);
  const calls = { reports: [], workerTurns: [], texts: [], states: [] };
  const replies = [...workerReplies];
  const deps = {
    ContentOutputModel: {
      findMetaByConversationId: vi.fn(async (cid) => [...rows.values()].find((r) => r.conversation_id === cid) || null),
      findMetaById: vi.fn(async (id) => rows.get(id) || null),
      findOne: vi.fn(async (id) => rows.get(id) || null),
      createOrUpdate: vi.fn(async (id, _u, _w, _t, content, _s, _type, conversationId, title) => { rows.set(id, { id, content, conversation_id: conversationId, title }); }),
      moveToGroup: vi.fn(async () => {}),
    },
    ConversationRoleModel: {
      roleOf: vi.fn(async (id) => roleRows.get(id) || null),
      addSub: vi.fn(async (_u, id, parentId) => { roleRows.set(id, { role: 'sub', parent_output_id: parentId, task_state: 'running' }); }),
      setTaskState: vi.fn(async (_u, ids, state) => { for (const id of ids) { calls.states.push([id, state]); const r = roleRows.get(id); if (r) r.task_state = state; } }),
    },
    serializeTranscript: (p) => JSON.stringify(p),
    broadcastToUser: () => {},
    RealtimeEvents: { CONTENT_CREATED: 'content:created' },
    executeChatSegment: async (input) => {
      const isReport = input.body.conversationId === MAIN.conversation_id;
      if (isReport) {
        calls.reports.push({ message: input.body.messages.at(-1), textMode: input.body.textMode });
        input.transport.send('final_content', { content: `Relay ${calls.reports.length}` });
        return;
      }
      calls.workerTurns.push(input.body);
      input.transport.send('final_content', { content: replies.shift() ?? 'Done.' });
    },
    isConversationBusy: async () => false,
    loadHistory: async () => [{ role: 'user', content: 'the task' }, { role: 'assistant', content: 'earlier work' }],
    hasLinkedPhone: async () => phone,
    textUser: async (input) => { calls.texts.push(input); return { sent: true }; },
    freshToken: () => null,
    sleep: async () => {},
    batchMs: 0,
  };
  return { deps, rows, roleRows, calls };
}

beforeEach(() => _resetReportsForTests());

describe('needsInputOf', () => {
  it('reads the last NEEDS INPUT line, tolerating light markdown', () => {
    expect(needsInputOf('Did the setup.\n\nNEEDS INPUT: Which Stripe account should I use?')).toBe('Which Stripe account should I use?');
    expect(needsInputOf('x\n**NEEDS INPUT:** First?\nmore\n> NEEDS INPUT: Second?')).toBe('Second?');
  });
  it('ignores prose that merely mentions it, and non-strings', () => {
    expect(needsInputOf('I could say NEEDS INPUT: here but I will not.')).toBe(null);
    expect(needsInputOf(null)).toBe(null);
  });
  it('only a successful run can ask', () => {
    expect(classifyOutcome({ ok: false, content: 'NEEDS INPUT: x?' }).needsInput).toBeUndefined();
  });
});

describe('a blocked sub-chat asks through the Main chat', () => {
  it('reports a question (not a failure), texts it, and waits for the answer', async () => {
    const w = world({ workerReplies: ['Drafted the email.\n\nNEEDS INPUT: Who should it be addressed to?'] });
    const started = await startSubChat({ userId: 'u1', parentConversationId: 'conv-main', title: 'Landlord email', prompt: 'Write it.' }, w.deps);
    expect(await started.finished).toMatchObject({ delivered: true, texted: true });

    const report = w.calls.reports[0].message.content;
    expect(report).toMatch(/^\[System: Sub-chat needs your input\]/);
    expect(report).toContain('Its question for the user: Who should it be addressed to?');
    expect(report).toContain(`continue_chat with chat "${started.outputId}"`);
    expect(decodeMarker(report)).toEqual([{ outputId: started.outputId, title: 'Landlord email', ok: true, needsInput: true, question: 'Who should it be addressed to?' }]);
    // Texting works as always: the phone gets the Main chat's own reply.
    expect(w.calls.reports[0].textMode).toBe(true);
    expect(w.calls.texts[0].text).toBe('Relay 1');
    // needs_input until delivered, then waiting (never 'reported').
    expect(w.calls.states.map(([, s]) => s)).toEqual(['needs_input', 'waiting']);
  });
});

describe('continue_chat: the answer goes back into the same sub-chat', () => {
  it('runs the next turn on its own history and reports back again (texted again)', async () => {
    const w = world({ workerReplies: ['NEEDS INPUT: Who to?', 'Sent the email to Sam.'] });
    const started = await startSubChat({ userId: 'u2', parentConversationId: 'conv-main', title: 'Email', prompt: 'Write it.' }, w.deps);
    await started.finished;

    const next = await continueSubChat({ userId: 'u2', mainConversationId: 'conv-main', outputId: started.outputId, message: 'Address it to Sam.' }, w.deps);
    expect(next).toMatchObject({ success: true, outputId: started.outputId, title: 'Email' });
    expect(await next.finished).toMatchObject({ delivered: true, texted: true });

    const turn = w.calls.workerTurns[1];
    expect(turn.conversationId).toBe(started.conversationId);
    expect(turn.messages.slice(0, 2)).toEqual([{ role: 'user', content: 'the task' }, { role: 'assistant', content: 'earlier work' }]);
    expect(turn.messages.at(-1).content).toContain('Address it to Sam.');
    expect(w.calls.reports[1].message.content).toMatch(/^\[System: Sub-chat finished\]/);
    // A second report on the same chat is a second text, not a deduplicated one.
    expect(w.calls.texts).toHaveLength(2);
    expect(w.calls.texts[0].key).not.toBe(w.calls.texts[1].key);
    expect(w.roleRows.get(started.outputId).task_state).toBe('reported');
  });

  it('only the Main chat, only its own sub-chats, never one still working', async () => {
    const w = world({ roles: { 'out-other-sub': { role: 'sub', parent_output_id: 'out-someone-else', task_state: 'waiting' } } });
    w.rows.set('out-other-sub', { id: 'out-other-sub', conversation_id: 'conv-x', title: 'X' });
    w.rows.set('out-plain', { id: 'out-plain', conversation_id: 'conv-plain', title: 'Plain' });
    const ask = (over) => continueSubChat({ userId: 'u3', mainConversationId: 'conv-main', outputId: 'out-other-sub', message: 'hi', ...over }, w.deps);
    expect((await ask({ mainConversationId: 'conv-plain' })).error).toMatch(/Only the Main chat/);
    expect((await ask({})).error).toMatch(/not one of this chat's sub-chats/);
    expect((await ask({ message: '  ' })).error).toMatch(/message is required/);
    expect(w.calls.workerTurns).toEqual([]);
  });
});

describe('answering in the sub-chat itself', () => {
  it('a waiting sub-chat is recognised, and its next answer is reported to the Main chat', async () => {
    const w = world({ workerReplies: ['NEEDS INPUT: Which city?'] });
    const started = await startSubChat({ userId: 'u4', parentConversationId: 'conv-main', title: 'Trip', prompt: 'Plan it.' }, w.deps);
    await started.finished;
    w.rows.get(started.outputId).content = JSON.stringify({ messages: [{ role: 'assistant', content: 'NEEDS INPUT: Which city?' }] });

    const waiting = await waitingSubChat('u4', started.conversationId, w.deps);
    expect(waiting).toMatchObject({ outputId: started.outputId, parentConversationId: 'conv-main', answerBefore: 'NEEDS INPUT: Which city?' });
    expect(await waitingSubChat('u4', 'conv-main', w.deps)).toBe(null);

    // The user typed "Lisbon" in the sub-chat; that turn saved a new answer.
    w.rows.get(started.outputId).content = JSON.stringify({ messages: [{ role: 'assistant', content: 'Planned 3 days in Lisbon.' }] });
    expect(await reportDirectAnswer(waiting, { userId: 'u4' }, w.deps)).toMatchObject({ delivered: true, texted: true });
    expect(w.calls.reports.at(-1).message.content).toContain('Planned 3 days in Lisbon.');
    expect(w.roleRows.get(started.outputId).task_state).toBe('reported');
  });

  it('a turn that produced no new answer reports nothing', async () => {
    const w = world();
    const waiting = { outputId: 'o', conversationId: 'c', title: 'T', parentConversationId: 'conv-main', answerBefore: 'same' };
    w.rows.set('o', { id: 'o', content: JSON.stringify({ messages: [{ role: 'assistant', content: 'same' }] }) });
    expect(await reportDirectAnswer(waiting, { userId: 'u5' }, w.deps)).toBe(null);
    expect(w.calls.reports).toEqual([]);
  });
});

describe('restart while a question was not yet delivered', () => {
  it('re-reports it as a question', async () => {
    const w = world();
    const result = await recoverSubChatReports({
      ...w.deps,
      freshToken: () => 'Bearer t',
      isSubChatRunning: () => false,
      ConversationRoleModel: {
        ...w.deps.ConversationRoleModel,
        listUnreported: async () => [{ outputId: 'o9', userId: 'u6', taskState: 'needs_input', createdAt: new Date().toISOString(), title: 'Trip', conversationId: 'c9', parentConversationId: 'conv-main', content: JSON.stringify({ messages: [{ role: 'assistant', content: 'NEEDS INPUT: Which city?' }] }) }],
      },
    });
    await Promise.all(result.deliveries);
    expect(w.calls.reports[0].message.content).toMatch(/needs your input/);
    expect(w.calls.reports[0].message.content).toContain('Which city?');
  });
});
