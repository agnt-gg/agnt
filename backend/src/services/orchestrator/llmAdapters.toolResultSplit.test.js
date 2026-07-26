/**
 * Regression guard: Anthropic payloads must never carry content after
 * tool_result blocks.
 *
 * Anthropic's guidance is explicit -- "never add text blocks immediately after
 * tool results" -- because it teaches the model to expect user input after
 * every tool use, and is a documented cause of degenerate 2-3 token end_turn
 * responses (PRD-082).
 *
 * The shape is produced by `_normalizeHistoryMessages`' own alternation merge:
 * Anthropic rejects consecutive same-role messages, so a user follow-up landing
 * immediately after a tool-result carrier gets folded into it as
 * `[tool_result, ..., text]`. The merge cannot simply be dropped (alternation
 * is mandatory), so `BaseAdapter._splitTextAfterToolResults` runs after it and
 * re-splits the turn behind a minimal synthetic assistant bridge.
 *
 * This was left open in the source as "a fully correct fix is non-trivial ...
 * Left as a follow-up". Mid-run steering silently inherited it: the steer
 * reached the wire, correctly labelled, in a shape the model is trained to
 * ignore. It rendered but did not steer.
 *
 * These tests pin the three properties the repair must have -- identity when
 * the shape is absent, idempotence, and preservation of tool_use/tool_result
 * pairing plus strict alternation -- so a future refactor can't reopen it.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicAdapter, BaseAdapter } from './llmAdapters.js';
import { applySteerAsUserTurn } from '../OrchestratorService.js';

const BRIDGE = BaseAdapter.TOOL_RESULT_BRIDGE_TEXT;
const stubClient = { messages: { create: async () => ({}) } };
const newAdapter = () => new AnthropicAdapter(stubClient, 'claude-opus-5', 'claude-code', {});

/** Any user message whose content continues past its last tool_result block. */
function findTextAfterToolResult(msgs) {
  const bad = [];
  msgs.forEach((m, i) => {
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) return;
    const kinds = m.content.map((b) => b?.type);
    const last = kinds.lastIndexOf('tool_result');
    if (last > -1 && last < kinds.length - 1) bad.push({ index: i, kinds });
  });
  return bad;
}

function findConsecutiveSameRole(msgs) {
  const bad = [];
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i]?.role === msgs[i - 1]?.role) bad.push({ index: i, role: msgs[i].role });
  }
  return bad;
}

/** tool_result blocks must sit in the message immediately after their tool_use. */
function findBrokenPairing(msgs) {
  const bad = [];
  msgs.forEach((m, i) => {
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) return;
    const results = m.content.filter((b) => b && b.type === 'tool_result');
    if (results.length === 0) return;
    const prev = msgs[i - 1];
    const ids = prev && prev.role === 'assistant' && Array.isArray(prev.content)
      ? prev.content.filter((b) => b && b.type === 'tool_use').map((b) => b.id)
      : [];
    for (const r of results) if (!ids.includes(r.tool_use_id)) bad.push({ index: i, id: r.tool_use_id });
  });
  return bad;
}

/** One completed tool round, followed by whatever the caller appends. */
function toolRound(id = 'toolu_1') {
  return [
    { role: 'user', content: 'Research the pricing page.' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        { type: 'tool_use', id, name: 'web_scrape', input: { url: 'https://x.com' } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '{"plans":3}' }] },
  ];
}

describe('BaseAdapter._splitTextAfterToolResults', () => {
  it('splits [tool_result, text] into two turns behind a synthetic bridge', () => {
    const input = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: 'actually, stop' }] },
    ];
    const out = BaseAdapter._splitTextAfterToolResults(input);

    expect(out).toHaveLength(3);
    expect(out[0].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]);
    expect(out[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: BRIDGE }] });
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'actually, stop' }] });
    expect(findTextAfterToolResult(out)).toEqual([]);
  });

  it('keeps every tool_result in the leading turn when several are batched', () => {
    const input = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'a' },
          { type: 'tool_result', tool_use_id: 't2', content: 'b' },
          { type: 'text', text: 'steer' },
        ],
      },
    ];
    const out = BaseAdapter._splitTextAfterToolResults(input);
    expect(out[0].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(out[2].content).toEqual([{ type: 'text', text: 'steer' }]);
  });

  it('is identity when no user message carries content after a tool_result', () => {
    const clean = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      { role: 'user', content: 'thanks' },
    ];
    const out = BaseAdapter._splitTextAfterToolResults(clean);
    expect(out).toEqual(clean);
    // Untouched messages must pass through by reference - a rebuilt array here
    // would silently defeat any upstream cache-marker identity checks.
    out.forEach((m, i) => expect(m).toBe(clean[i]));
  });

  it('is idempotent', () => {
    const input = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: 'steer' }] },
    ];
    const once = BaseAdapter._splitTextAfterToolResults(input);
    const twice = BaseAdapter._splitTextAfterToolResults(once);
    expect(twice).toEqual(once);
  });

  it('drops whitespace-only trailing text instead of manufacturing a turn', () => {
    const input = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: '   ' }] },
    ];
    const out = BaseAdapter._splitTextAfterToolResults(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.map((b) => b.type)).toEqual(['tool_result']);
  });

  it('leaves non-user, string-content, and empty histories alone', () => {
    expect(BaseAdapter._splitTextAfterToolResults([])).toEqual([]);
    expect(BaseAdapter._splitTextAfterToolResults(null)).toBeNull();
    const misc = [
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: 'plain string' },
    ];
    expect(BaseAdapter._splitTextAfterToolResults(misc)).toEqual(misc);
  });
});

describe('AnthropicAdapter wire payload — no content after tool results', () => {
  it('a follow-up typed during a tool round no longer merges into the tool result', () => {
    const adapter = newAdapter();
    // The ordinary case: not a steer at all, just a user message that lands
    // after a tool-result carrier. This is what the merge used to fold.
    const history = [...toolRound(), { role: 'user', content: 'actually, just the plan names' }];

    const wire = adapter._normalizeHistoryMessages(history);

    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(findBrokenPairing(wire)).toEqual([]);
    expect(wire.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: 'actually, just the plan names' }] });
  });

  it('normalizing twice is stable', () => {
    const adapter = newAdapter();
    const history = [...toolRound(), { role: 'user', content: 'follow-up' }];
    const once = adapter._normalizeHistoryMessages(history);
    const twice = adapter._normalizeHistoryMessages(once);
    expect(twice).toEqual(once);
  });

  it('an OpenAI-shaped role:"tool" history converts and splits correctly', () => {
    const adapter = newAdapter();
    const history = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'calling', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      { role: 'user', content: 'stop and summarize' },
    ];
    const wire = adapter._normalizeHistoryMessages(history);

    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(findBrokenPairing(wire)).toEqual([]);
  });
});

describe('mid-run steering composes with the adapter repair', () => {
  it('delivers the steer as its own user turn, bridged exactly once', () => {
    const adapter = newAdapter();
    const messages = toolRound();

    // Orchestrator layer bridges for Anthropic...
    expect(applySteerAsUserTurn(messages, 'just give me the 3 plan names')).toBe('anthropic-bridged');

    // ...so the adapter repair must find nothing left to do. Two independently
    // correct layers must not double-bridge.
    const wire = adapter._normalizeHistoryMessages(messages);

    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(findBrokenPairing(wire)).toEqual([]);

    const bridges = wire.filter(
      (m) => m.role === 'assistant' && Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'text' && (b.text === BRIDGE || b.text.startsWith('(Mid-run'))),
    );
    expect(bridges).toHaveLength(1);

    const steer = wire.at(-1);
    expect(steer.role).toBe('user');
    expect(JSON.stringify(steer)).toContain('just give me the 3 plan names');
  });

  it('still lands correctly if the orchestrator layer is bypassed entirely', () => {
    // Defense in depth: even a raw user push (any future call site that does
    // not know about provider shapes) must reach the model as a real turn.
    const adapter = newAdapter();
    const messages = [...toolRound(), { role: 'user', content: 'raw push, no shape awareness' }];

    const wire = adapter._normalizeHistoryMessages(messages);

    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(wire.at(-1).content).toEqual([{ type: 'text', text: 'raw push, no shape awareness' }]);
  });
});
