import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chatModule, { buildChatHistory, speakerOfMessage, handleScopedStreamEvent, findTextMentions } from './chat.js';

/**
 * Group chat contract:
 *  1. buildChatHistory renders the shared transcript from each speaker's
 *     point of view — own turns as 'assistant', everyone else attributed as
 *     'user', foreign tool_calls flattened to prose (never replayed ids).
 *  2. Solo conversations render BYTE-IDENTICAL to the pre-group-chat output
 *     (regression pin — this is what keeps existing prompt caches alive).
 *  3. The floor queue is bounded: budget, self-repeat cycle guard, and
 *     human-preemption reset.
 */

// ---------------------------------------------------------------------------
// buildChatHistory rendering matrix
// ---------------------------------------------------------------------------

const human = (content, extra = {}) => ({ id: `u-${content.slice(0, 8)}`, role: 'user', content, timestamp: 1, ...extra });
const annie = (content, extra = {}) => ({ id: `a-${content.slice(0, 8)}`, role: 'assistant', content, timestamp: 2, ...extra });
const agentMsg = (name, content, extra = {}) => ({
  id: `ag-${content.slice(0, 8)}`, role: 'assistant', content, timestamp: 3,
  agentId: `id-${name}`, agentName: name, ...extra,
});

describe('buildChatHistory — solo regression pin', () => {
  it('renders a solo conversation exactly as before (no viewer, no agents)', () => {
    const messages = [
      human('hello'),
      annie('hi there'),
      human('run a search'),
      annie('done', {
        toolCalls: [{ id: 'call_1', name: 'web_search', args: { query: 'x' }, result: 'found' }],
      }),
    ];
    const out = buildChatHistory(messages, 'anthropic');
    expect(out).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'run a search' },
      {
        role: 'assistant',
        content: 'done',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'x' }) } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'found' },
    ]);
  });
});

describe('buildChatHistory — Annie viewer (viewer = null)', () => {
  it('renders agent turns as attributed user messages with tools flattened', () => {
    const messages = [
      human('research this'),
      annie('passing to the researcher'),
      agentMsg('Researcher', 'I found three papers', {
        toolCalls: [{ id: 'call_9', name: 'web_search', args: {}, result: 'papers' }],
      }),
    ];
    const out = buildChatHistory(messages, 'anthropic');
    expect(out).toEqual([
      { role: 'user', content: 'research this' },
      { role: 'assistant', content: 'passing to the researcher' },
      {
        role: 'user',
        content: '[@Researcher]: I found three papers\n[used tools: web_search]',
        speaker: { type: 'agent', name: 'Researcher' },
      },
    ]);
    // The foreign tool_call id must NEVER survive into the rendered view.
    expect(JSON.stringify(out)).not.toContain('call_9');
  });

  it('skips empty foreign turns', () => {
    const out = buildChatHistory([human('q'), agentMsg('Researcher', '')], 'openai');
    expect(out).toEqual([{ role: 'user', content: 'q' }]);
  });
});

describe('buildChatHistory — agent viewer', () => {
  const thread = [
    human('compare approaches'),
    annie('Researcher, take a look', { toolCalls: [{ id: 'call_m', name: 'mention_agent', args: { agentId: 'id-Researcher' }, result: '{"success":true}' }] }),
    agentMsg('Researcher', 'approach A is faster'),
    agentMsg('Reviewer', 'but approach B is safer'),
  ];

  it("renders the viewer's own turns as assistant and everyone else attributed", () => {
    const out = buildChatHistory(thread, 'anthropic', { id: 'id-Researcher', name: 'Researcher' });
    expect(out[0]).toEqual({ role: 'user', content: 'compare approaches' }); // human raw
    expect(out[1].role).toBe('user'); // Annie is foreign for the agent
    expect(out[1].content).toContain('[Annie]: Researcher, take a look');
    expect(out[1].content).toContain('[used tools: mention_agent]');
    expect(out[2]).toEqual({ role: 'assistant', content: 'approach A is faster' }); // own turn
    expect(out[3].role).toBe('user'); // the OTHER agent is foreign
    expect(out[3].content).toContain('[@Reviewer]: but approach B is safer');
    // No foreign tool ids anywhere.
    expect(JSON.stringify(out)).not.toContain('call_m');
  });

  it('matches own messages by id first, name as legacy fallback', () => {
    const legacy = [{ role: 'assistant', content: 'old reply', agentName: 'Researcher' }]; // no agentId
    const out = buildChatHistory(legacy, 'openai', { id: 'id-Researcher', name: 'Researcher' });
    expect(out).toEqual([{ role: 'assistant', content: 'old reply' }]);
  });

  it('id mismatch wins over name match', () => {
    const msgs = [{ role: 'assistant', content: 'imposter', agentId: 'other-id', agentName: 'Researcher' }];
    const out = buildChatHistory(msgs, 'openai', { id: 'id-Researcher', name: 'Researcher' });
    expect(out[0].role).toBe('user');
    expect(out[0].content).toContain('[@Researcher]: imposter');
  });

  it('assumeOwnAssistant attributes unlabelled legacy turns to the agent (dedicated conversations)', () => {
    const legacy = [human('hi'), { role: 'assistant', content: 'agent reply, pre-attribution era' }];
    const out = buildChatHistory(legacy, 'openai', { id: 'id-X', name: 'X' }, { assumeOwnAssistant: true });
    expect(out[1]).toEqual({ role: 'assistant', content: 'agent reply, pre-attribution era' });
    // ...and WITHOUT the flag the same message is Annie's (shared conversations).
    const shared = buildChatHistory(legacy, 'openai', { id: 'id-X', name: 'X' });
    expect(shared[1].role).toBe('user');
    expect(shared[1].content).toContain('[Annie]:');
  });
});

describe('speakerOfMessage', () => {
  it('classifies human / agent / orchestrator', () => {
    expect(speakerOfMessage({ role: 'user', content: 'x' }).type).toBe('human');
    expect(speakerOfMessage({ role: 'assistant', content: 'x' }).type).toBe('orchestrator');
    expect(speakerOfMessage({ role: 'assistant', content: 'x', agentName: 'R' })).toEqual({ type: 'agent', id: null, name: 'R' });
    expect(speakerOfMessage({ role: 'assistant', content: 'x', agentId: 'i', agentName: 'R' }).id).toBe('i');
  });
});

// ---------------------------------------------------------------------------
// Floor queue: budget, cycle guard, preemption
// ---------------------------------------------------------------------------

describe('floor queue', () => {
  let store;
  // chatModule.state is a plain object shared by every createStore() — a
  // fresh conversation id per test is what actually isolates them.
  let convCounter = 0;
  let CONV;

  beforeEach(() => {
    CONV = `conv-floor-${++convCounter}`;
    localStorage.setItem('token', 't');
    store = createStore({
      modules: {
        chat: chatModule,
        aiProvider: {
          namespaced: false,
          state: { selectedProvider: 'anthropic', selectedModel: 'claude', reasoningValue: 'default', reasoningEnabled: false },
        },
      },
    });
    store.commit('chat/ENSURE_CONVERSATION', CONV);
    store.commit('chat/SET_ACTIVE_CONVERSATION', CONV);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const conv = () => store.state.chat.conversations[CONV];

  it('QUEUE_FLOOR_PASS queues and dedups by agent id', () => {
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a1', name: 'A' } });
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a1', name: 'A' } });
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a2', name: 'B' } });
    expect(conv().floorQueue.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('RESET_FLOOR clears queue and counters', () => {
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a1', name: 'A' } });
    store.commit('chat/SCOPED_FLOOR_DISPATCHED', { conversationId: CONV, agentId: 'a1' });
    store.commit('chat/SCOPED_RESET_FLOOR', { conversationId: CONV });
    expect(conv().floorQueue).toEqual([]);
    expect(conv().floorTurnsUsed).toBe(0);
    expect(conv().lastFloorAgentId).toBe(null);
  });

  it('processFloorQueue dispatches the next agent as a floor dispatch', async () => {
    const dispatched = [];
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a1', name: 'Researcher', note: 'check the numbers' } });
    // Intercept the downstream dispatch — we're testing the scheduler, not the stream.
    const origDispatch = store.dispatch.bind(store);
    vi.spyOn(store, 'dispatch').mockImplementation((type, payload) => {
      if (type === 'chat/startStreamingConversation') { dispatched.push(payload); return Promise.resolve(); }
      return origDispatch(type, payload);
    });
    await store.dispatch('chat/processFloorQueue', { conversationId: CONV });
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].mentionedAgent.id).toBe('a1');
    expect(dispatched[0].isFloorDispatch).toBe(true);
    expect(dispatched[0].userInput).toContain('check the numbers');
    expect(conv().floorTurnsUsed).toBe(1);
    expect(conv().lastFloorAgentId).toBe('a1');
    expect(conv().floorQueue).toEqual([]);
  });

  it('budget: refuses dispatch after 6 agent-initiated turns', async () => {
    conv().floorTurnsUsed = 6;
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a1', name: 'A' } });
    const spy = vi.spyOn(store, 'dispatch');
    await store.dispatch('chat/processFloorQueue', { conversationId: CONV });
    expect(spy).not.toHaveBeenCalledWith('chat/startStreamingConversation', expect.anything());
    expect(conv().floorQueue).toEqual([]); // dropped, floor returns to the user
  });

  it('cycle guard: an agent can never immediately follow itself', async () => {
    conv().lastFloorAgentId = 'a1';
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a1', name: 'A' } });
    const spy = vi.spyOn(store, 'dispatch');
    await store.dispatch('chat/processFloorQueue', { conversationId: CONV });
    expect(spy).not.toHaveBeenCalledWith('chat/startStreamingConversation', expect.anything());
    expect(conv().floorQueue).toEqual([]);
  });

  it('does nothing while the conversation is still streaming', async () => {
    conv().isStreaming = true;
    store.commit('chat/SCOPED_QUEUE_FLOOR_PASS', { conversationId: CONV, agent: { id: 'a1', name: 'A' } });
    const spy = vi.spyOn(store, 'dispatch');
    await store.dispatch('chat/processFloorQueue', { conversationId: CONV });
    expect(spy).not.toHaveBeenCalledWith('chat/startStreamingConversation', expect.anything());
    expect(conv().floorQueue.length).toBe(1); // still queued for when the stream ends
  });

  it("a successful mention_agent tool_end queues the floor pass", () => {
    const commit = (type, payload) => store.commit(`chat/${type}`, payload);
    handleScopedStreamEvent({ commit, state: store.state.chat, dispatch: null }, 'tool_end', {
      assistantMessageId: 'm1',
      toolCall: {
        id: 'c1', name: 'mention_agent',
        result: JSON.stringify({ success: true, agentId: 'a9', agentName: 'Scout', agentIcon: null, note: 'go' }),
      },
    }, CONV);
    expect(conv().floorQueue.map((a) => a.id)).toEqual(['a9']);
    expect(conv().floorQueue[0].note).toBe('go');
  });

  it('a FAILED mention_agent queues nothing', () => {
    const commit = (type, payload) => store.commit(`chat/${type}`, payload);
    handleScopedStreamEvent({ commit, state: store.state.chat, dispatch: null }, 'tool_end', {
      assistantMessageId: 'm1',
      toolCall: { id: 'c1', name: 'mention_agent', error: 'no such agent' },
    }, CONV);
    expect(conv().floorQueue).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Text @-mentions pass the floor (no tool call needed)
// ---------------------------------------------------------------------------

describe('findTextMentions', () => {
  const roster = [
    { id: 'id-sol', name: 'Sol', icon: '🔥' },
    { id: 'id-solar', name: 'Solar', icon: null },
    { id: 'id-rex', name: 'Rex (v2)', icon: '🤖' },
  ];

  it('matches a plain mention and carries id/name/icon', () => {
    expect(findTextMentions('Over to you, @Sol!', roster)).toEqual([
      { id: 'id-sol', name: 'Sol', icon: '🔥', note: null },
    ]);
  });

  it('returns mentions in order of first appearance, deduped by the queue later', () => {
    const out = findTextMentions('@Solar first, then @Sol.', roster);
    expect(out.map((a) => a.id)).toEqual(['id-solar', 'id-sol']);
  });

  it('boundary: @Solar does NOT also match Sol', () => {
    const out = findTextMentions('ping @Solar please', roster);
    expect(out.map((a) => a.id)).toEqual(['id-solar']);
  });

  it('no match mid-word or without boundary punctuation', () => {
    expect(findTextMentions('email me@Solve.com', roster)).toEqual([]);
  });

  it('escapes regex metacharacters in agent names', () => {
    expect(findTextMentions('ask @Rex (v2), he knows', roster).map((a) => a.id)).toEqual(['id-rex']);
  });

  it('excludes the speaker itself by id or name', () => {
    expect(findTextMentions('as @Sol I agree with @Solar', roster, { type: 'agent', id: 'id-sol', name: 'Sol' }).map((a) => a.id)).toEqual(['id-solar']);
  });

  it('empty content / empty roster / malformed agents → no mentions', () => {
    expect(findTextMentions('', roster)).toEqual([]);
    expect(findTextMentions('hi @Sol', [])).toEqual([]);
    expect(findTextMentions('hi @Sol', [{ name: 'Sol' }, { id: 'x' }, null])).toEqual([]);
  });
});

describe('queueTextMentionFloorPasses (done-event path)', () => {
  let store;
  let convCounter = 100;
  let CONV;

  beforeEach(() => {
    CONV = `conv-textmention-${++convCounter}`;
    localStorage.setItem('token', 't');
    store = createStore({
      modules: {
        chat: chatModule,
        aiProvider: {
          state: { selectedProvider: 'anthropic', selectedModel: 'claude', reasoningValue: 'default', reasoningEnabled: false },
        },
        agents: {
          state: { agents: [{ id: 'id-scout', name: 'Scout', icon: '🔍' }, { id: 'id-sol', name: 'Sol', icon: '🔥' }] },
        },
      },
    });
    store.commit('chat/ENSURE_CONVERSATION', CONV);
    store.commit('chat/SET_ACTIVE_CONVERSATION', CONV);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const conv = () => store.state.chat.conversations[CONV];

  it("queues the agents Annie @-mentioned in her finished reply — no tool call", async () => {
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'u1', role: 'user', content: 'compare notes' } });
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'a1', role: 'assistant', content: 'Good question — @Scout, take the first pass.' } });
    await store.dispatch('chat/queueTextMentionFloorPasses', { conversationId: CONV });
    expect(conv().floorQueue).toEqual([{ id: 'id-scout', name: 'Scout', icon: '🔍', note: null }]);
  });

  it('an agent mentioning ANOTHER agent passes the floor onward; self-mentions never queue', async () => {
    store.commit('chat/SCOPED_ADD_MESSAGE', {
      conversationId: CONV,
      message: { id: 'a2', role: 'assistant', content: 'Speaking as @Sol here — @Scout should verify.', agentId: 'id-sol', agentName: 'Sol' },
    });
    await store.dispatch('chat/queueTextMentionFloorPasses', { conversationId: CONV });
    expect(conv().floorQueue.map((a) => a.id)).toEqual(['id-scout']);
  });

  it('only the LAST assistant message is scanned — old mentions never re-fire', async () => {
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'a3', role: 'assistant', content: 'earlier: @Scout' } });
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'u2', role: 'user', content: 'ok' } });
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'a4', role: 'assistant', content: 'no mentions this time' } });
    await store.dispatch('chat/queueTextMentionFloorPasses', { conversationId: CONV });
    expect(conv().floorQueue).toEqual([]);
  });

  it('REGRESSION: a floor pass NEVER follows the user into another chat', async () => {
    // Nathan's bug: mention fires in conv A, user switches to conv B before
    // the dispatch runs — the agent's reply appeared in B. The dispatch must
    // carry conv A's id explicitly, not resolve the active conversation.
    const OTHER = `${CONV}-other`;
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'a9', role: 'assistant', content: 'over to @Sol' } });
    await store.dispatch('chat/queueTextMentionFloorPasses', { conversationId: CONV });
    // User switches chats BEFORE the queue drains — the race in the wild.
    store.commit('chat/ENSURE_CONVERSATION', OTHER);
    store.commit('chat/SET_ACTIVE_CONVERSATION', OTHER);
    const dispatched = [];
    const origDispatch = store.dispatch.bind(store);
    vi.spyOn(store, 'dispatch').mockImplementation((type, payload) => {
      if (type === 'chat/startStreamingConversation') { dispatched.push(payload); return Promise.resolve(); }
      return origDispatch(type, payload);
    });
    await store.dispatch('chat/processFloorQueue', { conversationId: CONV });
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].conversationId).toBe(CONV); // the address travels with the pass
  });

  it('startStreamingConversation honours an explicit conversationId over the active one', () => {
    // Source contract — the resolver must consult the explicit id FIRST.
    const src = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), './chat.js'),
      'utf8',
    );
    expect(src).toMatch(/let convId = conversationId \|\| state\.activeConversationId/);
    // And the floor dispatch supplies it.
    const floorBlock = src.slice(src.indexOf('async processFloorQueue'), src.indexOf('async reattachConversation'));
    expect(floorBlock).toMatch(/isFloorDispatch: true,[\s\S]*?conversationId,/);
  });

  it("the 'done' event queues text mentions and hands them to the floor scheduler", async () => {
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'a5', role: 'assistant', content: 'Handing off — @Sol, your take?' } });
    const dispatched = [];
    const origDispatch = store.dispatch.bind(store);
    vi.spyOn(store, 'dispatch').mockImplementation((type, payload) => {
      if (type === 'chat/startStreamingConversation') { dispatched.push(payload); return Promise.resolve(); }
      return origDispatch(type, payload);
    });
    const commit = (type, payload) => store.commit(`chat/${type}`, payload);
    const dispatch = (type, payload) => store.dispatch(`chat/${type}`, payload);
    handleScopedStreamEvent({ commit, state: store.state.chat, dispatch }, 'done', {}, CONV);
    // queueTextMentionFloorPasses is synchronous; processFloorQueue awaits the
    // stream dispatch — flush microtasks before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].mentionedAgent).toEqual({ id: 'id-sol', name: 'Sol', avatar: '🔥' });
    expect(dispatched[0].isFloorDispatch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Emoji avatar (source contract — the agent's icon must render as the avatar
// for agent-attributed messages instead of falling back to Annie's image)
// ---------------------------------------------------------------------------

describe('MessageItem agent avatar', () => {
  const miPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue',
  );
  const src = fs.readFileSync(miPath, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('renders an emoji avatar branch ahead of the default image', () => {
    const emojiIdx = code.indexOf('emoji-avatar');
    const imgIdx = code.indexOf(':src="assistantAvatar"');
    expect(emojiIdx).toBeGreaterThan(-1);
    expect(imgIdx).toBeGreaterThan(emojiIdx); // emoji branch first, img is the v-else-if
    expect(code).toContain('emojiAvatar');
  });

  it('URL-ish icons are NOT treated as emoji (they render via <img>)', () => {
    expect(code).toMatch(/https\?:\|data:/);
  });
});

// ---------------------------------------------------------------------------
// Sequential mention dispatch (source contract — the defect was WIRING:
// Promise.all ran mentioned agents against identical history snapshots so
// they could never hear each other)
// ---------------------------------------------------------------------------

describe('Chat.vue sequential mention dispatch', () => {
  const chatVuePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../views/Terminal/CenterPanel/screens/Chat/Chat.vue',
  );
  const src = fs.readFileSync(chatVuePath, 'utf8');
  // Strip comments so prose can never satisfy an assertion.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('mentioned agents are dispatched sequentially, not with Promise.all', () => {
    const sendIdx = code.indexOf('const agents = mentionedAgents && mentionedAgents.length > 0');
    expect(sendIdx).toBeGreaterThan(-1);
    const dispatchBlock = code.slice(sendIdx, sendIdx + 800);
    expect(dispatchBlock).not.toContain('Promise.all');
    expect(dispatchBlock).toMatch(/for \(const agent of agents\) \{\s*await store\.dispatch\('chat\/startStreamingConversation'/);
  });

  it('the floor state + roster are wired into the template', () => {
    expect(src).toContain('chat-roster');
    expect(src).toContain('floor-queue-row');
    expect(src).toContain('floorState');
    expect(src).toContain('chatParticipants');
  });
});
