import { describe, it, expect, beforeEach } from 'vitest';
import {
  queueReport, deliverReports, recoverSubChatReports, startSubChatRecovery, buildBatchReport, reportKey, lastAnswerOf,
  fallbackText, REPORT_WINDOW_MS, INTERRUPTED_ERROR, _resetReportsForTests,
} from './subChatReports.js';

/**
 * Worker outcome -> parent report turn -> text. Both edges (the chat turn and
 * the phone) are fakes that record what they were asked to do.
 */
function makeDeps({ phone = true, answers = ['Both tasks are done.'], busyPolls = 0, textResult = { sent: true, id: 'm1' }, rows = [] } = {}) {
  const calls = { turns: [], texts: [], states: [], busyChecks: 0 };
  let turn = 0;
  const deps = {
    ConversationRoleModel: {
      setTaskState: async (userId, ids, state) => { calls.states.push({ userId, ids: [...ids], state }); },
      listUnreported: async () => rows,
    },
    executeChatSegment: async (input) => {
      calls.turns.push(input);
      const answer = answers[Math.min(turn++, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      if (answer) input.transport.send('final_content', { content: answer });
    },
    isConversationBusy: async () => { calls.busyChecks += 1; return calls.busyChecks <= busyPolls; },
    loadHistory: async () => [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    hasLinkedPhone: async () => phone,
    textUser: async (input) => { calls.texts.push(input); return textResult; },
    freshToken: () => 'Bearer fresh',
    sleep: async () => {},
    batchMs: 5,
  };
  return { deps, calls };
}

const ok = (title, outputId, content = `${title} result`) => ({ title, outputId, outcome: { ok: true, content, error: null } });

beforeEach(() => _resetReportsForTests());

describe('queueReport', () => {
  it('merges workers that finish together into ONE report turn and ONE text', async () => {
    const { deps, calls } = makeDeps();
    const a = queueReport(deps, { userId: 'u1', authToken: 'Bearer old', parentConversationId: 'main', report: ok('Pricing', 'o1') });
    const b = queueReport(deps, { userId: 'u1', authToken: 'Bearer old', parentConversationId: 'main', report: ok('Hiring', 'o2') });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({ delivered: true, texted: true });
    expect(rb).toBe(ra);
    expect(calls.turns).toHaveLength(1);
    const content = calls.turns[0].body.messages.at(-1).content;
    expect(content).toContain('2 sub-chats finished');
    expect(content).toContain('Pricing result');
    expect(content).toContain('Hiring result');
    expect(calls.texts).toHaveLength(1);
    expect(calls.texts[0]).toMatchObject({ text: 'Both tasks are done.', key: reportKey(['o1', 'o2']) });
    expect(calls.states).toEqual([{ userId: 'u1', ids: ['o1', 'o2'], state: 'reported' }]);
  });

  it('runs the report as a real turn in the parent: persisted history, text register, current token', async () => {
    const { deps, calls } = makeDeps();
    await queueReport(deps, { userId: 'u1', authToken: 'Bearer old', parentConversationId: 'main', report: ok('Pricing', 'o1') });
    const input = calls.turns[0];
    expect(input).toMatchObject({ userId: 'u1', authToken: 'Bearer fresh', chatType: 'orchestrator' });
    expect(input.body).toMatchObject({ conversationId: 'main', textMode: true, persistDefault: false });
    expect(input.body.messages.slice(0, 2)).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
    expect(input.body.userMessageId).toMatch(/^msg-report-/);
  });

  it('keeps separate parents separate, and later finishers in a later batch', async () => {
    const { deps, calls } = makeDeps();
    const first = queueReport(deps, { userId: 'u1', parentConversationId: 'main-a', report: ok('A', 'oa') });
    const other = queueReport(deps, { userId: 'u1', parentConversationId: 'main-b', report: ok('B', 'ob') });
    await Promise.all([first, other]);
    await queueReport(deps, { userId: 'u1', parentConversationId: 'main-a', report: ok('C', 'oc') });
    expect(calls.turns.map((t) => t.body.conversationId)).toEqual(['main-a', 'main-b', 'main-a']);
    expect(calls.texts.map((t) => t.key)).toEqual([reportKey(['oa']), reportKey(['ob']), reportKey(['oc'])]);
  });
});

describe('deliverReports', () => {
  it('with no phone linked, reports in the app and texts nothing', async () => {
    const { deps, calls } = makeDeps({ phone: false });
    expect(await deliverReports(deps, 'main', { userId: 'u1', reports: [ok('Pricing', 'o1')] })).toEqual({ delivered: true, texted: false });
    expect(calls.turns[0].body.textMode).toBe(false);
    expect(calls.texts).toEqual([]);
    expect(calls.states.at(-1).state).toBe('reported');
  });

  it('waits for the parent to be idle, and gives up (leaving it for next boot) if it never is', async () => {
    const waited = makeDeps({ busyPolls: 2 });
    await deliverReports(waited.deps, 'main', { userId: 'u1', reports: [ok('P', 'o1')] });
    expect(waited.calls.busyChecks).toBe(3);

    const stuck = makeDeps({ busyPolls: Infinity });
    stuck.deps.idleMaxWaitMs = 0;
    expect(await deliverReports(stuck.deps, 'main', { userId: 'u1', reports: [ok('P', 'o1')] })).toMatchObject({ delivered: false, reason: 'parent_busy' });
    expect(stuck.calls.turns).toEqual([]);
    expect(stuck.calls.states).toEqual([]);
  });

  it('retries a report turn that produced no answer', async () => {
    const { deps, calls } = makeDeps({ answers: [new Error('provider blip'), null, 'Done now.'] });
    expect(await deliverReports(deps, 'main', { userId: 'u1', reports: [ok('P', 'o1')] })).toEqual({ delivered: true, texted: true });
    expect(calls.turns).toHaveLength(3);
    expect(calls.texts[0].text).toBe('Done now.');
  });

  it('when the report turn cannot run at all, still texts a plain fallback and leaves it unreported for next boot', async () => {
    const { deps, calls } = makeDeps({ answers: [new Error('no model')] });
    const result = await deliverReports(deps, 'main', { userId: 'u1', reports: [ok('Pricing', 'o1'), { title: 'Hiring', outputId: 'o2', outcome: { ok: false, content: null, error: 'x' } }] });
    expect(result).toMatchObject({ delivered: false, texted: true, reason: 'report_failed' });
    expect(calls.texts[0].text).toBe('Pricing: finished\nHiring: hit a problem\nThe details are in your AGNT app.');
    expect(calls.states).toEqual([]);
  });

  it('a refused text (allowance used up) does not stop the in-app report', async () => {
    const { deps, calls } = makeDeps({ textResult: { sent: false, reason: 'allowance_exhausted' } });
    expect(await deliverReports(deps, 'main', { userId: 'u1', reports: [ok('P', 'o1')] })).toEqual({ delivered: true, texted: false });
    expect(calls.states.at(-1).state).toBe('reported');
  });

  it('attaches the images the report turn generated', async () => {
    const { deps, calls } = makeDeps();
    deps.executeChatSegment = async (input) => {
      input.transport.send('image_generated', { imageId: 'img-9' });
      input.transport.send('final_content', { content: 'Chart attached.' });
    };
    await deliverReports(deps, 'main', { userId: 'u1', reports: [ok('Chart', 'o1')] });
    expect(calls.texts[0].imageIds).toEqual(['img-9']);
  });
});

describe('recoverSubChatReports (boot)', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const sqlite = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const transcript = (answer) => JSON.stringify({ messages: [{ role: 'user', content: 'task' }, { role: 'assistant', content: answer }] });

  it('reports interrupted workers as failed and unreported finished ones with their saved answer', async () => {
    const rows = [
      { outputId: 'o-run', userId: 'u1', taskState: 'running', createdAt: sqlite(now - 60_000), title: 'Long build', content: transcript('half'), parentConversationId: 'main' },
      { outputId: 'o-done', userId: 'u1', taskState: 'done', createdAt: sqlite(now - 60_000), title: 'Pricing', content: transcript('Found 3 competitors.'), conversationId: 'conv-pricing', parentConversationId: 'main' },
    ];
    const { deps, calls } = makeDeps({ rows });
    const summary = await recoverSubChatReports(deps, { now });
    expect(summary).toMatchObject({ queued: 2, expired: 0, skipped: 0 });
    await Promise.all(summary.deliveries);
    expect(calls.turns).toHaveLength(1);
    const content = calls.turns[0].body.messages.at(-1).content;
    expect(content).toContain(INTERRUPTED_ERROR);
    expect(content).toContain('Found 3 competitors.');
    expect(content).toContain('conversation id conv-pricing');
    expect(content).not.toContain('o-done');
    expect(calls.texts[0].key).toBe(reportKey(['o-run', 'o-done']));
  });

  it('expires workers older than the report window or with no parent; skips live ones and sessionless users', async () => {
    const rows = [
      { outputId: 'o-old', userId: 'u1', taskState: 'done', createdAt: sqlite(now - REPORT_WINDOW_MS - 1000), title: 'Old', content: transcript('x'), parentConversationId: 'main' },
      { outputId: 'o-orphan', userId: 'u1', taskState: 'done', createdAt: sqlite(now - 1000), title: 'Orphan', content: transcript('x'), parentConversationId: null },
      { outputId: 'o-live', userId: 'u1', taskState: 'running', createdAt: sqlite(now - 1000), title: 'Live', content: '', parentConversationId: 'main' },
      { outputId: 'o-nosession', userId: 'u2', taskState: 'done', createdAt: sqlite(now - 1000), title: 'Later', content: transcript('x'), parentConversationId: 'main' },
    ];
    const { deps, calls } = makeDeps({ rows });
    deps.isSubChatRunning = (id) => id === 'o-live';
    deps.freshToken = (userId) => (userId === 'u1' ? 'Bearer t' : null);
    const summary = await recoverSubChatReports(deps, { now });
    expect(summary).toMatchObject({ queued: 0, expired: 2, skipped: 2 });
    expect(calls.states).toEqual([
      { userId: 'u1', ids: ['o-old'], state: 'expired' },
      { userId: 'u1', ids: ['o-orphan'], state: 'expired' },
    ]);
  });

  it('startSubChatRecovery gives up quietly when no one signs in', async () => {
    const { deps } = makeDeps({ rows: [] });
    expect(await startSubChatRecovery({ deps, pollMs: 1, maxWaitMs: 5 })).toMatchObject({ waitedOut: true });
  });
});

describe('helpers', () => {
  it('a single report keeps the single-report wording', () => {
    expect(buildBatchReport([ok('Pricing', 'o1')]).content).toMatch(/^\[System: Sub-chat finished\]/);
  });

  it('the text key is order-independent and distinct per set', () => {
    expect(reportKey(['b', 'a'])).toBe(reportKey(['a', 'b']));
    expect(reportKey(['a'])).not.toBe(reportKey(['a', 'b']));
    expect(reportKey(['a']).length).toBeGreaterThanOrEqual(8);
  });

  it('reads the last answer from a saved transcript, null when unreadable', () => {
    expect(lastAnswerOf(JSON.stringify({ messages: [{ role: 'assistant', content: 'one' }, { role: 'user', content: 'q' }, { role: 'assistant', content: 'two' }] }))).toBe('two');
    expect(lastAnswerOf('not json')).toBe(null);
    expect(lastAnswerOf(JSON.stringify({ messages: [{ role: 'user', content: 'q' }] }))).toBe(null);
  });

  it('fallback text names every task', () => {
    expect(fallbackText([ok('A', 'a')])).toContain('A: finished');
  });
});
