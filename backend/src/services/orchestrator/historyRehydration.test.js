import { describe, it, expect } from 'vitest';
import { rehydrateHistory, canRehydrateFor, assistantToolCalls, ATTACHED_FILES_HEADER } from './historyRehydration.js';
import { clientNextTurn } from './clientHistoryBuilder.testkit.js';
import { USER_AFTER_TOOL_RESULT_LABEL } from './turnContinuity.js';
import { AnthropicAdapter, OpenAIResponsesAdapter } from './llmAdapters.js';
import { BaseAdapter } from './transports/BaseAdapter.js';
import { markTurnContent } from './turnRegister.js';

// ── The bug, end to end ──────────────────────────────────────────────────────
// Turn N's last request carried the server's native transcript. Turn N+1 is
// rebuilt by the CLIENT from its UI (the real frontend builder runs here). The
// cached prefix survives only if turn N's last request is a byte prefix of
// turn N+1's request AT THE PROVIDER WIRE.

const LONG = 'line of tool output\n'.repeat(400); // > the client's 2,000-char cap
const SYSTEM = { role: 'system', content: 'You are Annie.' };

/** A finished Anthropic turn: thinking + text + call, then a text-free call, then the answer. */
function anthropicLedger() {
  return [
    SYSTEM,
    { role: 'user', content: 'find the bug' },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'SIG-1' },
      { type: 'text', text: 'Reading the file first.' },
      { type: 'tool_use', id: 'toolu_A', name: 'read_file', input: { path: 'src/a.js' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: LONG }] },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'SIG-2' },
      { type: 'tool_use', id: 'toolu_B', name: 'grep_files', input: { pattern: 'bug', path: 'src' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_B', content: 'src/a.js:3: bug' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Line 3 is the bug.' }] },
  ];
}

/** The same turn on an OpenAI-shaped ledger (Chat Completions). */
function chatCompletionsLedger() {
  const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  return [
    SYSTEM,
    { role: 'user', content: 'find the bug' },
    { role: 'assistant', content: 'Reading the file first.', tool_calls: [call('call_A', 'read_file', { path: 'src/a.js' })] },
    { role: 'tool', tool_call_id: 'call_A', content: LONG },
    { role: 'assistant', content: 'Line 3 is the bug.' },
  ];
}

/** The same turn on the Responses API, with an encrypted reasoning item to replay. */
function responsesLedger() {
  const args = JSON.stringify({ path: 'src/a.js' });
  return [
    SYSTEM,
    { role: 'user', content: 'find the bug' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_A', type: 'function', function: { name: 'read_file', arguments: args } }],
      _responsesOutputItems: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC', summary: [] },
        { type: 'function_call', call_id: 'call_A', name: 'read_file', arguments: args },
      ] },
    { role: 'tool', tool_call_id: 'call_A', content: LONG },
    { role: 'assistant', content: 'Line 3 is the bug.' },
  ];
}

const previousRequestOf = (ledger) => ledger.slice(0, -1); // the final answer was the response, not the request
const anthropicWire = (messages) => new AnthropicAdapter({ messages: { create: async () => ({}) } }, 'claude-opus-5-5')
  ._normalizeHistoryMessages(structuredClone(messages.filter((m) => m.role !== 'system')));
const chatCompletionsWire = (messages) => BaseAdapter._sanitizeOutbound(structuredClone(messages), 'openai-like');
const responsesWire = (messages) => {
  const out = new OpenAIResponsesAdapter({}, 'gpt-6', { provider: 'openai-codex' })._transformMessagesToInput(structuredClone(messages));
  return (Array.isArray(out) ? out : out.input).flat();
};
const isPrefix = (previous, next) => JSON.stringify(next.slice(0, previous.length)) === JSON.stringify(previous);

describe.each([
  ['anthropic', anthropicLedger, anthropicWire, 'claude-code'],
  ['chat completions', chatCompletionsLedger, chatCompletionsWire, 'openai'],
  ['responses', responsesLedger, responsesWire, 'openai-codex'],
])('%s: the previous turn stays a cached prefix of the next', (_name, ledgerOf, wireOf, provider) => {
  it('negative control: the client rebuild alone breaks the prefix', () => {
    const ledger = ledgerOf();
    const next = clientNextTurn(ledger, provider, 'and the fix?');
    expect(isPrefix(wireOf(previousRequestOf(ledger)), wireOf([SYSTEM, ...next]))).toBe(false);
  });

  it('rehydrated, the next turn starts with the previous request byte-for-byte', () => {
    const ledger = ledgerOf();
    const { messages, roundsRestored } = rehydrateHistory(clientNextTurn(ledger, provider, 'and the fix?'), ledger);
    expect(roundsRestored).toBeGreaterThan(0);
    expect(isPrefix(wireOf(previousRequestOf(ledger)), wireOf([SYSTEM, ...messages]))).toBe(true);
  });

  it('is idempotent: rehydrating a rehydrated history changes nothing', () => {
    const ledger = ledgerOf();
    const once = rehydrateHistory(clientNextTurn(ledger, provider, 'q'), ledger).messages;
    expect(rehydrateHistory(once, ledger).messages).toEqual(once);
  });
});

describe('rehydrateHistory — what it will and will not restore', () => {
  const stored = anthropicLedger();
  const client = () => clientNextTurn(stored, 'claude-code', 'next');

  it('restores thinking blocks and full tool results the client dropped', () => {
    const { messages } = rehydrateHistory(client(), stored);
    const restored = messages.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'thinking'));
    expect(restored.content[0].signature).toBe('SIG-1');
    const result = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === 'tool_result' && b.tool_use_id === 'toolu_A');
    expect(result.content).toBe(LONG); // whole, not the client's 2,000-char cut
  });

  it('restores two stored rounds the client merged into one (text-free second round)', () => {
    const merged = client().find((m) => assistantToolCalls(m).length === 2);
    expect(merged).toBeDefined(); // the client really does merge them
    const { roundsRestored } = rehydrateHistory(client(), stored);
    expect(roundsRestored).toBe(2);
  });

  it('leaves a round alone when its arguments differ (an edited or regenerated call)', () => {
    const edited = client().map((m) => (m.tool_calls ? { ...m, tool_calls: m.tool_calls.map((c, i) => (i === 0
      ? { ...c, function: { ...c.function, arguments: JSON.stringify({ path: 'src/OTHER.js' }) } } : c)) } : m));
    expect(rehydrateHistory(edited, stored).roundsRestored).toBe(0);
  });

  it('leaves a round alone when its text differs', () => {
    const edited = client().map((m) => (m.tool_calls ? { ...m, content: 'Something else.' } : m));
    expect(rehydrateHistory(edited, stored).roundsRestored).toBe(0);
  });

  it('does not reuse a span with user text folded into a tool result (it would be sent twice)', () => {
    const steered = structuredClone(stored);
    steered[3].content[0].content = `${LONG}\n${USER_AFTER_TOOL_RESULT_LABEL}\nstop and check b.js`;
    expect(rehydrateHistory(clientNextTurn(steered, 'claude-code', 'q'), steered).roundsRestored).toBe(0);
  });

  it('returns the client history untouched when there is no stored transcript', () => {
    const history = client();
    expect(rehydrateHistory(history, null).messages).toBe(history);
    expect(rehydrateHistory(history, []).messages).toBe(history);
  });

  it('never mutates its inputs', () => {
    const history = client();
    const before = JSON.stringify([history, stored]);
    const { messages } = rehydrateHistory(history, stored);
    messages.forEach((m) => { if (Array.isArray(m.content)) m.content.push({ type: 'text', text: 'MUTATED' }); });
    expect(JSON.stringify([history, stored])).toBe(before);
  });

  it('restores the uploaded-files block on the turn it belongs to, in order', () => {
    const upload = `${ATTACHED_FILES_HEADER}\nThe user uploaded 1 file(s)...\n[/ATTACHED FILES]\n\n\n\ncontinue`;
    const transcript = [SYSTEM, { role: 'user', content: 'continue' }, { role: 'assistant', content: 'ok' },
      { role: 'user', content: upload }, { role: 'assistant', content: 'read it' }];
    const history = [{ role: 'user', content: 'continue' }, { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'continue' }, { role: 'assistant', content: 'read it' }, { role: 'user', content: 'next' }];
    const { messages, userMessagesRestored } = rehydrateHistory(history, transcript);
    expect(userMessagesRestored).toBe(1);
    expect(messages[0].content).toBe('continue'); // the identical earlier message keeps its own bytes
    expect(messages[2].content).toBe(upload);
  });
});

// ── Voice / text-message turns ───────────────────────────────────────────────
// The server marks a spoken or texted turn on its user message (turnRegister).
// The CLIENT never has the marker: its UI holds the user's own words. So the
// client's view below is built from the UNMARKED ledger, while the server's
// transcript is the marked one — exactly the split that exists in production.
const voiced = (ledger, index, flags = { voiceMode: true }) => {
  const marked = structuredClone(ledger);
  marked[index] = { ...marked[index], content: markTurnContent(marked[index].content, flags) };
  return marked;
};

describe.each([
  ['anthropic', anthropicLedger, anthropicWire, 'claude-code'],
  ['chat completions', chatCompletionsLedger, chatCompletionsWire, 'openai'],
  ['responses', responsesLedger, responsesWire, 'openai-codex'],
])('%s: a spoken turn stays a cached prefix of the next turn', (_name, ledgerOf, wireOf, provider) => {
  it('negative control: without the restore, the unmarked client copy breaks the prefix', () => {
    const uiLedger = ledgerOf();
    const serverLedger = voiced(uiLedger, 1);
    const next = clientNextTurn(uiLedger, provider, 'and the fix?');
    expect(isPrefix(wireOf(previousRequestOf(serverLedger)), wireOf([SYSTEM, ...next]))).toBe(false);
  });

  it('rehydrated, the next (typed) turn starts with the spoken turn byte-for-byte', () => {
    const uiLedger = ledgerOf();
    const serverLedger = voiced(uiLedger, 1);
    const { messages, userMessagesRestored } = rehydrateHistory(clientNextTurn(uiLedger, provider, 'and the fix?'), serverLedger);
    expect(userMessagesRestored).toBe(1);
    expect(isPrefix(wireOf(previousRequestOf(serverLedger)), wireOf([SYSTEM, ...messages]))).toBe(true);
  });

  it('a text-message turn, and a turn with both markers, are restored the same way', () => {
    for (const flags of [{ textMode: true }, { voiceMode: 'true', textMode: 'true' }]) {
      const uiLedger = ledgerOf();
      const serverLedger = voiced(uiLedger, 1, flags);
      const { messages } = rehydrateHistory(clientNextTurn(uiLedger, provider, 'q'), serverLedger);
      expect(isPrefix(wireOf(previousRequestOf(serverLedger)), wireOf([SYSTEM, ...messages]))).toBe(true);
    }
  });
});

describe('turn markers across a typed / spoken / typed conversation', () => {
  it('every turn replays all earlier turns byte-for-byte, markers in place', () => {
    // Turn 1 typed, turn 2 spoken, turn 3 typed. Each turn's request must be
    // a byte prefix of the next one at the Anthropic wire.
    const ui = [SYSTEM, { role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];
    const server1 = structuredClone(ui);

    const client2 = rehydrateHistory(clientNextTurn(ui, 'claude-code', 'what broke?'), server1).messages;
    client2[client2.length - 1].content = markTurnContent(client2.at(-1).content, { voiceMode: true });
    const request2 = [SYSTEM, ...client2];
    expect(isPrefix(anthropicWire(server1), anthropicWire(request2))).toBe(true);

    const server2 = [...request2, { role: 'assistant', content: 'the cache' }];
    const ui2 = [...ui, { role: 'user', content: 'what broke?' }, { role: 'assistant', content: 'the cache' }];
    const client3 = rehydrateHistory(clientNextTurn(ui2, 'claude-code', 'fix it'), server2).messages;
    expect(client3[2].content).toBe('[VOICE TURN]\n\nwhat broke?');
    expect(client3.at(-1).content).toBe('fix it');
    expect(isPrefix(anthropicWire(request2), anthropicWire([SYSTEM, ...client3]))).toBe(true);
  });

  it('a retried turn whose stored copy is already marked is restored, not re-marked', () => {
    const marked = markTurnContent('again', { voiceMode: true });
    const transcript = [SYSTEM, { role: 'user', content: marked }];
    const { messages } = rehydrateHistory([{ role: 'user', content: 'again' }], transcript);
    expect(messages[0].content).toBe(marked);
    // The request path marks only a message the client sent fresh: this one is
    // a different object now, so OrchestratorService leaves it alone.
  });

  it('the user typing the marker text themselves is not mistaken for a decoration', () => {
    const transcript = [SYSTEM, { role: 'user', content: '[VOICE TURN] is a literal string' }];
    const { userMessagesRestored } = rehydrateHistory([{ role: 'user', content: '[VOICE TURN] is a literal string' }], transcript);
    expect(userMessagesRestored).toBe(0);
  });
});

describe('canRehydrateFor — native blocks only go back to the transport that made them', () => {
  it('requires the same provider and model', () => {
    expect(canRehydrateFor({ provider: 'claude-code', model: 'claude-opus-5-5' }, 'claude-code', 'claude-opus-5-5')).toBe(true);
    expect(canRehydrateFor({ provider: 'claude-code', model: 'claude-opus-5-5' }, 'anthropic', 'claude-opus-5-5')).toBe(false);
    expect(canRehydrateFor({ provider: 'claude-code', model: 'claude-opus-5-5' }, 'claude-code', 'claude-sonnet-5')).toBe(false);
    expect(canRehydrateFor(null, 'claude-code', 'claude-opus-5-5')).toBe(false);
  });
});
