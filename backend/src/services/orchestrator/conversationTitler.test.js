import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/ContentOutputModel.js', () => ({ default: {} }));
vi.mock('../../models/ConversationRoleModel.js', () => ({ default: {} }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: { CONTENT_UPDATED: 'content:updated' } }));

const {
  parseTitle,
  parseRefinement,
  firstExchange,
  maybeTitleConversation,
  __resetTitlerState,
  MAX_USER_TURNS_FOR_INITIAL,
} = await import('./conversationTitler.js');

describe('parseTitle — strict, because null means "try the next model"', () => {
  it.each([
    ['{"title": "React State Bug"}', 'React State Bug'],
    ['```json\n{"title":"Tax Filing Deadlines"}\n```', 'Tax Filing Deadlines'],
    ['"Kubernetes Ingress Setup."', 'Kubernetes Ingress Setup'],
    ['Title: **Weekly Meal Plan**', 'Weekly Meal Plan'],
    ['<think>the user wants...</think>{"title":"Rust Borrow Checker"}', 'Rust Borrow Checker'],
    ['Auto-Rename Conversations\nbecause the user asked', 'Auto-Rename Conversations'],
    ['{"title":"Fehler beim Login"}', 'Fehler beim Login'],
    ["I Can't Log Into Gmail", "I Can't Log Into Gmail"],
  ])('accepts %j', (input, expected) => {
    expect(parseTitle(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['{"title": ""}'],
    ['Untitled'],
    ['New Chat'],
    ['KEEP'],
    ["I'm sorry, but I can't help with that"],
    ['I cannot help with that request'],
    ['As an AI I do not name things'],
    ['one two three four five six seven eight nine ten eleven'],
    ['x'.repeat(81)],
    ['!!!'],
  ])('rejects %j', (input) => {
    expect(parseTitle(input)).toBeNull();
  });
});

describe('parseRefinement', () => {
  it('KEEP in any shape keeps', () => {
    for (const input of ['KEEP', '{"title":"KEEP"}', '"keep"']) expect(parseRefinement(input)).toEqual({ keep: true });
  });
  it('a new title replaces', () => {
    expect(parseRefinement('{"title":"Router Health Design"}')).toEqual({ title: 'Router Health Design' });
  });
  it('garbage is unusable', () => {
    expect(parseRefinement('I am sorry, I cannot do that')).toBeNull();
  });
});

describe('firstExchange', () => {
  it('needs a user message AND a non-empty answer after it', () => {
    expect(firstExchange([{ role: 'user', content: 'hi' }])).toBeNull();
    expect(firstExchange([{ role: 'user', content: 'hi' }, { role: 'assistant', content: '' }])).toBeNull();
    expect(firstExchange([{ role: 'assistant', content: 'welcome' }, { role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]))
      .toEqual({ user: 'q', assistant: 'a' });
  });
  it('replaces code with a marker and caps length', () => {
    const exchange = firstExchange([
      { role: 'user', content: 'fix this ```js\nconst a = 1;\n``` please' },
      { role: 'assistant', content: 'y'.repeat(5000) },
    ]);
    expect(exchange.user).toBe('fix this [code] please');
    expect(exchange.assistant.length).toBeLessThanOrEqual(1501);
  });
});

// ── maybeTitleConversation ────────────────────────────────────────────────

const transcript = (messages) => JSON.stringify({ messages });
const firstTurn = [
  { role: 'user', content: 'hey can you help me debug my react useEffect loop' },
  { role: 'assistant', content: 'Sure — the dependency array is missing...' },
];

function deps(over = {}) {
  const row = {
    id: 'out-1',
    content_type: 'conversation',
    channel_key: null,
    title: 'hey can you help me debug my react useEffect loop',
    title_source: null,
    content: transcript(firstTurn),
    ...over.row,
  };
  return {
    row,
    findRow: vi.fn(async () => (over.noRow ? null : row)),
    roleOf: vi.fn(async () => over.role || null),
    setTitle: vi.fn(async () => ({ changes: over.changes ?? 1 })),
    findMeta: vi.fn(async () => ({ id: row.id, title: 'meta' })),
    broadcast: vi.fn(),
    complete: vi.fn(async () => over.served || { text: '{"title":"React useEffect Loop"}', provider: 'groq', model: 'llama' }),
    now: () => 1_000_000,
  };
}

describe('maybeTitleConversation', () => {
  beforeEach(() => __resetTitlerState());

  it('titles a fresh conversation after its first exchange, through the router as origin title', async () => {
    const d = deps();
    const out = await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d);
    expect(out).toMatchObject({ status: 'titled', title: 'React useEffect Loop', provider: 'groq' });
    const call = d.complete.mock.calls[0][0];
    expect(call).toMatchObject({ userId: 'u', origin: 'title', originId: 'out-1' });
    expect(typeof call.validate).toBe('function');
    expect(call.validate('{"title":"Fine Title"}')).toBe(true);
    expect(call.validate('Untitled')).not.toBe(true);
    expect(d.setTitle).toHaveBeenCalledWith('out-1', 'u', 'React useEffect Loop', { over: ['derived'] });
    expect(d.broadcast).toHaveBeenCalledWith('u', expect.objectContaining({ id: 'out-1', title: 'React useEffect Loop' }));
  });

  it('never attaches the conversation id to the call (it would poison chat cache affinity)', async () => {
    const d = deps();
    await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d);
    expect(d.complete.mock.calls[0][0].conversationId).toBeUndefined();
  });

  it.each([
    ['a user rename', { row: { title_source: 'user' } }, 'skipped:user_title'],
    ['a system title', { row: { title_source: 'system' } }, 'skipped:system_title'],
    ['an existing auto-title (initial mode)', { row: { title_source: 'auto' } }, 'skipped:already_titled'],
    ['an embedded channel transcript', { row: { channel_key: 'workspace:1' } }, 'skipped:channel'],
    ['a non-conversation output', { row: { content_type: 'html' } }, 'skipped:not_a_conversation'],
    ['the Main chat or a sub-chat (by role)', { role: { role: 'main' } }, 'skipped:has_role'],
  ])('leaves %s alone', async (_label, over, status) => {
    const d = deps(over);
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe(status);
    expect(d.complete).not.toHaveBeenCalled();
    expect(d.setTitle).not.toHaveBeenCalled();
  });

  it('does not retitle conversations past their first exchange', async () => {
    const many = [];
    for (let i = 0; i <= MAX_USER_TURNS_FOR_INITIAL; i++) many.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
    const d = deps({ row: { content: transcript(many) } });
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe('skipped:past_first_exchange');
  });

  it('waits for an answer before titling', async () => {
    const d = deps({ row: { content: transcript([{ role: 'user', content: 'hi' }]) } });
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe('skipped:no_exchange_yet');
  });

  it('reports no_row so the scheduler can retry, and does not burn the attempt', async () => {
    const d = deps({ noRow: true });
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe('no_row');
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe('no_row');
  });

  it('a rename that races the call wins (zero rows changed), and nothing is broadcast', async () => {
    const d = deps({ changes: 0 });
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe('superseded');
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it('every model failing leaves the derived title and resolves', async () => {
    const d = deps();
    d.complete.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ALL_TIERS_FAILED' }));
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe('failed');
    expect(d.setTitle).not.toHaveBeenCalled();
  });

  it('a repeat trigger within the cooldown is a no-op', async () => {
    const d = deps();
    await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d);
    expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d)).status).toBe('busy');
    expect(d.complete).toHaveBeenCalledTimes(1);
  });

  it("keeps an agent chat's [Agent] prefix", async () => {
    const d = deps({ row: { title: '[Researcher] find me papers on x' } });
    const out = await maybeTitleConversation({ userId: 'u', conversationId: 'c' }, d);
    expect(out.title).toBe('[Researcher] React useEffect Loop');
  });

  describe("mode 'refine'", () => {
    it('may replace an auto-title', async () => {
      const d = deps({ row: { title_source: 'auto', title: 'Old Subject' }, served: { text: '{"title":"New Subject"}', provider: 'groq', model: 'm' } });
      const out = await maybeTitleConversation({ userId: 'u', conversationId: 'c', mode: 'refine' }, d);
      expect(out.status).toBe('titled');
      expect(d.setTitle).toHaveBeenCalledWith('out-1', 'u', 'New Subject', { over: ['derived', 'auto'] });
    });

    it('KEEP writes nothing', async () => {
      const d = deps({ row: { title_source: 'auto', title: 'Old Subject' }, served: { text: '{"title":"KEEP"}', provider: 'groq', model: 'm' } });
      expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c', mode: 'refine' }, d)).status).toBe('kept');
      expect(d.setTitle).not.toHaveBeenCalled();
    });

    it('still never touches a user rename', async () => {
      const d = deps({ row: { title_source: 'user' } });
      expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c', mode: 'refine' }, d)).status).toBe('skipped:user_title');
    });

    it('works on long conversations (the point of refining)', async () => {
      const many = [];
      for (let i = 0; i < 20; i++) many.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
      const d = deps({ row: { content: transcript(many) }, served: { text: '{"title":"Long Thread"}', provider: 'groq', model: 'm' } });
      expect((await maybeTitleConversation({ userId: 'u', conversationId: 'c', mode: 'refine' }, d)).status).toBe('titled');
    });
  });
});
