// Mid-run steering: the assistant-turn split contract (backend half).
//
// A turn used to stream into exactly ONE assistant bubble for its entire life.
// The client renders an ordered transcript, so a steer surfaced at the tail sat
// BELOW a bubble that was still receiving deltas -- every word the agent said
// in RESPONSE to the steer rendered ABOVE the steer that caused it.
//
// The fix: at the steer seam the orchestrator seals the outgoing bubble (by
// carrying its id on `steering_applied`) and mints a fresh assistant bubble, so
// all later content_delta / tool_start / tool_end / final_content events
// address the continuation. These tests pin the backend half of that contract.
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stashSteer, clearSteer, openSteerContinuation, applySteerAsUserTurn } from './OrchestratorService.js';
import { AnthropicAdapter, OpenAiLikeAdapter, GeminiAdapter } from './orchestrator/llmAdapters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(__dirname, 'OrchestratorService.js'), 'utf8');

describe('openSteerContinuation', () => {
  it('emits a fresh assistant_message and returns its id', () => {
    const sendEvent = vi.fn();

    const id = openSteerContinuation(sendEvent, { round: 1 });

    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [eventName, payload] = sendEvent.mock.calls[0];
    expect(eventName).toBe('assistant_message');
    expect(payload.id).toBe(id);
    expect(payload.assistantMessageId).toBe(id);
    expect(payload.role).toBe('assistant');
    // Must open EMPTY. Any seed content would duplicate pre-steer output into
    // the continuation bubble.
    expect(payload.content).toBe('');
    expect(payload.toolCalls).toEqual([]);
    expect(payload.steerContinuation).toBe(true);
  });

  it('mints an id distinct from the pre-steer bubble even within the same millisecond', () => {
    // Date.now() is frozen, so a naive `msg-asst-${Date.now()}` would collide
    // with the turn's original id and every post-steer delta would flow back
    // into the sealed bubble -- silently reintroducing the exact bug.
    const now = 1785000000000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const originalTurnId = `msg-asst-${now}`;
      const id = openSteerContinuation(vi.fn(), { round: 1 });
      expect(id).not.toBe(originalTurnId);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps ids unique across successive steers in one turn', () => {
    const now = 1785000000000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const ids = [1, 2, 3].map((round) => openSteerContinuation(vi.fn(), { round }));
      expect(new Set(ids).size).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('propagates agent identity so the continuation bubble keeps its avatar/name', () => {
    const sendEvent = vi.fn();
    openSteerContinuation(sendEvent, { round: 2, agentMeta: { agentName: 'Annie', agentIcon: 'x.png' } });

    const [, payload] = sendEvent.mock.calls[0];
    expect(payload.agentName).toBe('Annie');
    expect(payload.agentIcon).toBe('x.png');
  });

  it('tolerates a missing options object', () => {
    expect(() => openSteerContinuation(vi.fn())).not.toThrow();
  });
});

describe('steer queue', () => {
  it('coalesces multiple steers in one round instead of dropping earlier ones', () => {
    const conv = `test-conv-${Math.random()}`;
    expect(stashSteer(conv, 'first')).toBe(true);
    expect(stashSteer(conv, 'second')).toBe(true);
    // No public drain, so assert via clearSteer: a stash must exist to clear.
    expect(clearSteer(conv)).toBe(true);
    expect(clearSteer(conv)).toBe(false);
  });

  it('ignores empty and non-string steers', () => {
    const conv = `test-conv-${Math.random()}`;
    expect(stashSteer(conv, '   ')).toBe(false);
    expect(stashSteer(conv, null)).toBe(false);
    expect(stashSteer(conv, 42)).toBe(false);
    expect(stashSteer(null, 'text')).toBe(false);
    expect(clearSteer(conv)).toBe(false);
  });
});

// Source-level invariants. The split only works if the LIVE assistantMessageId
// is reassigned at the seam -- a unit test cannot observe that without booting
// the whole orchestrator, so pin it structurally. These are cheap and they fail
// loudly if someone "cleans up" the mutation.
describe('tool-loop wiring invariants', () => {
  it('declares assistantMessageId as reassignable', () => {
    expect(SOURCE).toMatch(/let assistantMessageId = `msg-asst-\$\{Date\.now\(\)\}`/);
    expect(SOURCE).not.toMatch(/const assistantMessageId = `msg-asst-\$\{Date\.now\(\)\}`/);
  });

  it('reassigns the live id from openSteerContinuation at the seam', () => {
    expect(SOURCE).toMatch(/assistantMessageId = openSteerContinuation\(sendEvent, \{ round: currentRound, agentMeta \}\)/);
  });

  it('carries the outgoing bubble id on steering_applied so the client can seal it', () => {
    const evt = SOURCE.match(/sendEvent\('steering_applied',\s*\{[\s\S]*?\}\);/);
    expect(evt).not.toBeNull();
    expect(evt[0]).toContain('assistantMessageId');
    expect(evt[0]).toContain('content: steerText');
  });

  it('opens the continuation AFTER tool_executions so that round summary stays on its own bubble', () => {
    const toolExec = SOURCE.indexOf("sendEvent('tool_executions', { assistantMessageId, tool_executions: toolExecutionDetails");
    const split = SOURCE.indexOf('assistantMessageId = openSteerContinuation(');
    expect(toolExec).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(toolExec);
  });
});


// ---------------------------------------------------------------------------
// Mid-run steering: the DELIVERY contract.
//
// The turn-split above fixed how a steer RENDERS. This block covers whether it
// actually reaches the model. The original implementation appended the steer to
// the last role:'tool' message — a shape only OpenAI-style adapters produce.
// AnthropicAdapter emits { role:'user', content:[tool_result] } and GeminiAdapter
// emits { role:'user', parts:[functionResponse] }, so on those providers the scan
// found no anchor, pushed a bare user message, and Anthropic's consecutive-role
// merge folded it into [tool_result, text] — the shape Anthropic documents as
// "never add text blocks immediately after tool results", and which
// llmAdapters.js:1570-1584 already flags as a cause of degenerate end_turn
// responses. The steer rendered in the UI but never steered the model.
// ---------------------------------------------------------------------------
const STEER = 'stop researching, just give me the 3 plan names';
const toolResults = () => [
  { tool_call_id: 'call_1', role: 'tool', name: 'web_scrape', content: '{"plans":3}' },
];

describe('applySteerAsUserTurn — reaches the model on every provider shape', () => {
  it('Anthropic: bridges so the steer is its own user turn, not a trailing text block', () => {
    const adapter = new AnthropicAdapter({}, 'claude-opus-5', 'claude-code', {});
    const messages = [
      { role: 'user', content: 'Research the pricing page.' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 'call_1', name: 'web_scrape', input: {} },
        ],
      },
      ...adapter.formatToolResults(toolResults()),
    ];

    expect(applySteerAsUserTurn(messages, STEER)).toBe('anthropic-bridged');

    const wire = adapter._normalizeHistoryMessages(messages);

    // THE REGRESSION: a text block must never trail tool_result blocks.
    for (const msg of wire) {
      if (!Array.isArray(msg.content)) continue;
      const kinds = msg.content.map((b) => b.type);
      const lastToolResult = kinds.lastIndexOf('tool_result');
      if (lastToolResult === -1) continue;
      expect(kinds.slice(lastToolResult + 1)).not.toContain('text');
    }

    // Anthropic requires strict alternation; the bridge must preserve it.
    const roles = wire.map((m) => m.role);
    for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1]);

    const carriers = wire.filter((m) => JSON.stringify(m).includes('USER STEER'));
    expect(carriers).toHaveLength(1);
    expect(carriers[0].role).toBe('user');
  });

  it('OpenAI-style: steer becomes a user turn, never appended to tool output', () => {
    const adapter = new OpenAiLikeAdapter({}, 'x', { provider: 'groq' });
    const messages = [
      { role: 'user', content: 'Research the pricing page.' },
      { role: 'assistant', content: 'On it.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_scrape', arguments: '{}' } }] },
      ...adapter.formatToolResults(toolResults()),
    ];

    expect(applySteerAsUserTurn(messages, STEER)).toBe('user-turn');

    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    // The old implementation mutated this content in place.
    expect(toolMsgs[0].content).not.toContain('USER STEER');
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user' });
    expect(messages[messages.length - 1].content).toContain(STEER);
  });

  it('Gemini: appends a text part, never a content field the converter would drop', () => {
    const adapter = new GeminiAdapter({}, 'gemini-3-pro', {});
    const messages = [
      { role: 'user', content: 'Research the pricing page.' },
      { role: 'assistant', content: 'On it.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_scrape', arguments: '{}' } }] },
      ...adapter.formatToolResults(toolResults()),
    ];

    expect(applySteerAsUserTurn(messages, STEER)).toBe('gemini-parts');

    const tail = messages[messages.length - 1];
    expect(tail.content).toBeUndefined();
    expect(Array.isArray(tail.parts)).toBe(true);
    expect(tail.parts.at(-1).text).toContain(STEER);
    // Must not be smuggled into the functionResponse payload.
    const fn = tail.parts.find((p) => p.functionResponse);
    expect(JSON.stringify(fn)).not.toContain('USER STEER');
  });

  it('labels the steer as user input so the model cannot read it as tool output', () => {
    const messages = [{ role: 'user', content: 'go' }, { role: 'tool', tool_call_id: 'c', content: '{}' }];
    applySteerAsUserTurn(messages, STEER);
    expect(messages.at(-1).content).toContain('not tool output');
  });
});
