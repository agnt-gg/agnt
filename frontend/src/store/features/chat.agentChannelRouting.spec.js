// An agent chat chooses its own model, and cannot redefine anyone else's.
//
// WHY THIS FILE EXISTS
// --------------------
// The Agents-screen chat tab was the last chat surface in the app with no
// per-channel configuration. It read `store.state.aiProvider` directly — which
// IS the orchestrator's model popover — and sent that pair on every agent turn.
// Three separate defects fell out of one shared variable:
//
//   1. THE MAIN CHAT'S PICKER CHOSE THE AGENT'S MODEL. Any agent without its
//      own provider/model columns inherited whatever the orchestrator was last
//      set to.
//
//   2. THE REVERSE, AND THE ONE YOU CAN SEE. The handler's default write-back
//      keeps users.selected_provider in step with "what the frontend is using".
//      Correct for the main chat, where the value came from the user's own
//      picker; wrong here, where it is the AGENT'S. Chatting with a Claude
//      agent rewrote the account-wide default to Claude, and the main chat came
//      back on it — as did every background job that reads that setting.
//
//   3. DYNAMIC ROUTING COULD NEVER RUN IN AN AGENT CHAT. Always sending a
//      concrete pair made `requestHasPin` permanently true, so
//      resolveRoutingMode read every agent turn as an explicit pin. The
//      `agents.routing_mode` column was unreachable dead code.
//
// The fix is mostly subtraction, and the SUBTRACTION IS THE MECHANISM: with no
// pair on the wire, AgentService injects the agent's own provider/model before
// the handler runs, so an agent that names a pair still reads as pinned (its
// owner chose it) and one that names none falls through the ladder.
//
// Every assertion below therefore has a NEGATIVE CONTROL: proving the right
// value was sent is worthless without proving the global one was not.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));
vi.mock('@/services/chatService.js', () => ({
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: vi.fn(),
}));
vi.mock('@/services/voiceTurn.js', () => ({ consumeVoiceTurn: () => false }));

const AGENT_ID = 'agent-42';
const AGENT_CONV = 'conv-agent-uuid';

/** The orchestrator's popover — the value that must never leak onto the wire. */
const GLOBAL_AI = {
  selectedProvider: 'GLOBAL-PROVIDER',
  selectedModel: 'GLOBAL-MODEL',
  reasoningValue: 'high',
  reasoningEnabled: true,
};

let chat;
let state;
let commit;
let dispatch;

const makeState = () => ({
  activeConversationId: null,
  currentConversationId: null,
  unreadOutputIds: {},
  pendingSteer: '',
  messages: [],
  conversations: {},
  agentConversations: {},
  activeSkillByConv: {},
  activeGoalByConv: {},
  aiByConv: {},
  streamEventCallbacks: [],
  autosaveEnabled: true,
  currentAgentId: null,
  currentAgentName: null,
  currentAgentAvatar: null,
  savedMainConversationId: null,
});

/** Run one agent turn and return the parsed request body. */
async function sendAgentTurn(payload = {}) {
  await chat.actions.startAgentStreamingConversation(
    { commit, state, dispatch, rootState: { aiProvider: { ...GLOBAL_AI } } },
    { agentId: AGENT_ID, userInput: 'hi', conversationId: AGENT_CONV, ...payload },
  );
  expect(global.fetch).toHaveBeenCalled();
  return JSON.parse(global.fetch.mock.calls[0][1].body);
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 't');
  // ok:true + no body ends the turn in the catch after the request is built,
  // which is all these tests need and keeps them independent of the SSE reducer.
  global.fetch = vi.fn(async () => ({ ok: true, body: null }));

  chat = (await import('./chat.js')).default;

  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
  dispatch = vi.fn(() => Promise.resolve());

  chat.mutations.ENSURE_CONVERSATION(state, AGENT_CONV);
  chat.mutations.SCOPED_SET_AGENT(state, {
    conversationId: AGENT_CONV, agentId: AGENT_ID, agentName: 'Scout', agentAvatar: null,
  });
});

// ---------------------------------------------------------------------------

describe('the agent turn does not carry the main chat\'s model', () => {
  it('omits provider and model entirely when the channel is not pinned', async () => {
    const body = await sendAgentTurn();

    // ABSENCE, not null: `requestHasPin` is !!(provider && model), and a key
    // present-but-null would still be falsy — but the server also treats an
    // explicitly-sent pair as a caller opinion elsewhere, so the honest wire
    // shape for "no opinion" is no key at all.
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('model');
  });

  it('NEGATIVE CONTROL: the global pair appears nowhere in the request', async () => {
    const body = await sendAgentTurn();
    const wire = JSON.stringify(body);

    expect(wire).not.toContain('GLOBAL-PROVIDER');
    expect(wire).not.toContain('GLOBAL-MODEL');
  });

  it('sends the pair when — and only when — the channel pinned one', async () => {
    const body = await sendAgentTurn({
      provider: 'anthropic', model: 'claude-x', routingMode: 'pinned',
    });

    expect(body.provider).toBe('anthropic');
    expect(body.model).toBe('claude-x');
    expect(body.routingMode).toBe('pinned');
  });

  it('carries a dynamic routing mode without a pair', async () => {
    const body = await sendAgentTurn({ routingMode: 'dynamic' });

    expect(body.routingMode).toBe('dynamic');
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('model');
  });

  it('says nothing about routing when the channel has no opinion', async () => {
    // Sending 'default' would suppress resolveRoutingMode's backward-compat
    // rule, and this is the one endpoint whose pin is injected server-side —
    // so a global 'dynamic' could then re-route an agent whose owner had
    // chosen a specific model. Silence is what protects that pin.
    const body = await sendAgentTurn();
    expect(body).not.toHaveProperty('routingMode');
  });
});

describe('the agent turn cannot redefine the account default', () => {
  it('always sends persistDefault false', async () => {
    expect((await sendAgentTurn()).persistDefault).toBe(false);
  });

  it('sends it even when the channel pinned a pair', async () => {
    // A pinned AGENT CHANNEL is still not the user's global choice.
    const body = await sendAgentTurn({ provider: 'anthropic', model: 'claude-x', routingMode: 'pinned' });
    expect(body.persistDefault).toBe(false);
  });
});

describe('reasoning is not inherited from another surface', () => {
  it('does not pick up the main chat composer\'s reasoning toggles', async () => {
    // rootState.aiProvider has reasoningEnabled:true / 'high'. The agent chat
    // has no reasoning control at all, so borrowing one billed every agent turn
    // for a toggle flipped somewhere else.
    const body = await sendAgentTurn();

    expect(body).not.toHaveProperty('reasoningValue');
    expect(body).not.toHaveProperty('reasoningEnabled');
  });

  it('still honours reasoning passed explicitly', async () => {
    const body = await sendAgentTurn({ reasoningValue: 'Medium', reasoningEnabled: true });

    expect(body.reasoningValue).toBe('medium');
    expect(body.reasoningEnabled).toBe(true);
  });
});

describe('history formatting is a separate question from routing', () => {
  const seedReasoningTurn = () => {
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: AGENT_CONV,
      message: { id: 'u1', role: 'user', content: 'earlier question', timestamp: 1 },
    });
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: AGENT_CONV,
      message: {
        id: 'a1', role: 'assistant', content: 'earlier answer',
        reasoning_content: 'CHAIN-OF-THOUGHT', timestamp: 2, agentId: AGENT_ID,
      },
    });
  };

  it('replays reasoning_content for a provider that wants it', async () => {
    // buildChatHistory uses a provider name for exactly one decision. Dropping
    // it along with the wire pin would have quietly changed what deepseek /
    // kimi / zai agents get replayed, which is why historyProvider exists.
    seedReasoningTurn();
    const body = await sendAgentTurn({ historyProvider: 'deepseek' });

    expect(JSON.stringify(body.history)).toContain('CHAIN-OF-THOUGHT');
  });

  it('NEGATIVE CONTROL: drops it for a provider that does not', async () => {
    seedReasoningTurn();
    const body = await sendAgentTurn({ historyProvider: 'openai' });

    expect(JSON.stringify(body.history)).not.toContain('CHAIN-OF-THOUGHT');
  });

  it('never leaks the formatting hint onto the wire as a pin', async () => {
    const body = await sendAgentTurn({ historyProvider: 'deepseek' });

    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('historyProvider');
  });
});

// ---------------------------------------------------------------------------
// Source contract. The store action can only send what its caller hands it, so
// the guarantee above is only real if ChatTab stops reaching for the global.
// ---------------------------------------------------------------------------

describe('ChatTab resolves its model from its own channel', () => {
  const chatTabPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../views/Terminal/CenterPanel/screens/Agents/components/AgentDetails/tabs/ChatTab.vue',
  );
  const src = fs.readFileSync(chatTabPath, 'utf8');
  // Comments stripped so prose can never satisfy an assertion.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('uses the per-channel config', () => {
    expect(code).toContain('resolveChannelRouting');
    expect(code).toMatch(/agent:\$\{props\.selectedAgent\.id\}/);
  });

  it('hands the send the resolved routing, not the global selection', () => {
    const sendIdx = code.indexOf("store.dispatch('chat/startAgentStreamingConversation'");
    expect(sendIdx).toBeGreaterThan(-1);
    const dispatchBlock = code.slice(sendIdx, sendIdx + 700);

    expect(dispatchBlock).toMatch(/provider:\s*routing\.provider/);
    expect(dispatchBlock).toMatch(/model:\s*routing\.model/);
    expect(dispatchBlock).toMatch(/routingMode:/);
  });

  it('THE REGRESSION ITSELF: the old global read is gone from the send', () => {
    const sendIdx = code.indexOf("store.dispatch('chat/startAgentStreamingConversation'");
    const dispatchBlock = code.slice(sendIdx, sendIdx + 700);

    // historyProvider may still consult the global — it only decides whether a
    // reasoning block is replayed. `provider:` may not.
    expect(dispatchBlock).not.toMatch(/provider:\s*props\.selectedAgent\.provider\s*\|\|\s*store\.state\.aiProvider/);
    expect(dispatchBlock).not.toMatch(/model:\s*props\.selectedAgent\.model\s*\|\|\s*store\.state\.aiProvider/);

    // Stronger, and the one that survives a rewrite: inside the dispatch, the
    // global store may be read on the historyProvider line and NOWHERE else.
    // A shape-specific "not.toMatch" only bans the exact line that was there;
    // this bans the coupling.
    const globalReads = dispatchBlock
      .split('\n')
      .filter((line) => line.includes('store.state.aiProvider'));
    for (const line of globalReads) {
      expect(line, `"${line.trim()}" reads the orchestrator's picker inside the agent send`)
        .toMatch(/historyProvider:/);
    }
  });
});
