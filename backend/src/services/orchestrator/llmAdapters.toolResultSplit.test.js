/**
 * Regression guard: Anthropic payloads must never carry content after
 * tool_result blocks — and must never repair that shape by fabricating an
 * assistant turn.
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
 * is mandatory).
 *
 * The first repair re-split the turn behind a synthetic assistant bridge,
 * "(Continuing.)". The model imitated it: real tool rounds started ending on
 * that exact status line with no tool call, which exits the tool loop and
 * stops the work mid-task. The persisted imitation then re-taught the pattern
 * on every later request.
 *
 * `BaseAdapter._foldTextAfterToolResults` now folds the trailing content INTO
 * the last tool_result behind a user-input label. These tests pin: identity
 * when the shape is absent, idempotence, pairing + alternation, unchanged
 * message count, no fabricated assistant turn, and that a history already
 * poisoned with the old bridge is scrubbed at the wire.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicAdapter, BaseAdapter } from './llmAdapters.js';
import { applySteerAsUserTurn } from '../OrchestratorService.js';
import { USER_AFTER_TOOL_RESULT_LABEL } from './turnContinuity.js';

const LEGACY_BRIDGE = '(Continuing.)';
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

/** Assistant turns that are a single short text block and nothing else. */
function findTextOnlyAssistantTurns(msgs) {
  return msgs.filter(
    (m) => m?.role === 'assistant' && Array.isArray(m.content) &&
      m.content.length === 1 && m.content[0]?.type === 'text',
  );
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

describe('BaseAdapter._foldTextAfterToolResults', () => {
  it('folds [tool_result, text] into the tool_result behind a user-input label', () => {
    const input = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: 'actually, stop' }] },
    ];
    const out = BaseAdapter._foldTextAfterToolResults(input);

    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
    expect(out[0].content).toHaveLength(1);
    expect(out[0].content[0].tool_use_id).toBe('t1');
    expect(out[0].content[0].content).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'text', text: USER_AFTER_TOOL_RESULT_LABEL },
      { type: 'text', text: 'actually, stop' },
    ]);
    expect(findTextAfterToolResult(out)).toEqual([]);
  });

  it('folds into the LAST tool_result when several are batched', () => {
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
    const out = BaseAdapter._foldTextAfterToolResults(input);
    expect(out[0].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(out[0].content[0].content).toBe('a');
    expect(out[0].content[1].content.at(-1)).toEqual({ type: 'text', text: 'steer' });
  });

  it('is identity when no user message carries content after a tool_result', () => {
    const clean = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      { role: 'user', content: 'thanks' },
    ];
    const out = BaseAdapter._foldTextAfterToolResults(clean);
    expect(out).toEqual(clean);
    // Untouched messages must pass through by reference - a rebuilt array here
    // would silently defeat any upstream cache-marker identity checks.
    out.forEach((m, i) => expect(m).toBe(clean[i]));
  });

  it('is idempotent', () => {
    const input = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: 'steer' }] },
    ];
    const once = BaseAdapter._foldTextAfterToolResults(input);
    const twice = BaseAdapter._foldTextAfterToolResults(once);
    expect(twice).toEqual(once);
  });

  it('drops whitespace-only trailing text without touching the tool_result', () => {
    const input = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: '   ' }] },
    ];
    const out = BaseAdapter._foldTextAfterToolResults(input);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]);
  });

  it('leaves non-user, string-content, and empty histories alone', () => {
    expect(BaseAdapter._foldTextAfterToolResults([])).toEqual([]);
    expect(BaseAdapter._foldTextAfterToolResults(null)).toBeNull();
    const misc = [
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: 'plain string' },
    ];
    expect(BaseAdapter._foldTextAfterToolResults(misc)).toEqual(misc);
  });

  it('never fabricates an assistant turn', () => {
    const input = [
      ...toolRound(),
    ];
    input[2] = { ...input[2], content: [...input[2].content, { type: 'text', text: 'follow-up' }] };
    const out = BaseAdapter._foldTextAfterToolResults(input);
    expect(out.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain(LEGACY_BRIDGE);
  });
});

describe('AnthropicAdapter wire payload — no content after tool results, no fabricated turns', () => {
  it('a follow-up typed during a tool round rides inside the tool result', () => {
    const adapter = newAdapter();
    const history = [...toolRound(), { role: 'user', content: 'actually, just the plan names' }];

    const wire = adapter._normalizeHistoryMessages(history);

    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(findBrokenPairing(wire)).toEqual([]);
    expect(wire).toHaveLength(3);
    expect(findTextOnlyAssistantTurns(wire)).toEqual([]);
    const carrier = wire.at(-1);
    expect(carrier.role).toBe('user');
    expect(JSON.stringify(carrier)).toContain('actually, just the plan names');
    expect(JSON.stringify(carrier)).toContain(USER_AFTER_TOOL_RESULT_LABEL);
  });

  it('normalizing twice is stable', () => {
    const adapter = newAdapter();
    const history = [...toolRound(), { role: 'user', content: 'follow-up' }];
    const once = adapter._normalizeHistoryMessages(history);
    const twice = adapter._normalizeHistoryMessages(once);
    expect(twice).toEqual(once);
  });

  it('an OpenAI-shaped role:"tool" history converts and folds correctly', () => {
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
    expect(findTextOnlyAssistantTurns(wire)).toEqual([]);
    expect(JSON.stringify(wire.at(-1))).toContain('stop and summarize');
  });

  it('THE REGRESSION: a history poisoned by the legacy bridge is scrubbed before it can be imitated', () => {
    const adapter = newAdapter();
    // What production persisted once the bridge had been imitated: the
    // fabricated bridge, the steer it carried, the model's own copy of the
    // bridge ending a round, and the user's manual "continue".
    const history = [
      ...toolRound('toolu_1'),
      { role: 'assistant', content: [{ type: 'text', text: LEGACY_BRIDGE }] },
      { role: 'user', content: 'just the plan names' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_2', name: 'web_scrape', input: { url: 'https://x.com/pricing' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'Starter, Pro, Enterprise' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Continuing.' }] },
      { role: 'user', content: 'why did you stop? continue' },
    ];

    const wire = adapter._normalizeHistoryMessages(history);

    expect(JSON.stringify(wire)).not.toContain(LEGACY_BRIDGE);
    expect(findTextOnlyAssistantTurns(wire)).toEqual([]);
    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(findBrokenPairing(wire)).toEqual([]);
    // Nothing the user said was lost.
    const text = JSON.stringify(wire);
    expect(text).toContain('just the plan names');
    expect(text).toContain('why did you stop? continue');
  });
});

describe('mid-run steering composes with the adapter repair', () => {
  it('delivers the steer inside the tool result, labelled exactly once', () => {
    const adapter = newAdapter();
    const messages = toolRound();

    expect(applySteerAsUserTurn(messages, 'just give me the 3 plan names')).toBe('anthropic-tool-result');
    expect(messages).toHaveLength(3);

    const wire = adapter._normalizeHistoryMessages(messages);

    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(findBrokenPairing(wire)).toEqual([]);
    expect(findTextOnlyAssistantTurns(wire)).toEqual([]);
    expect(wire).toHaveLength(3);

    const carrier = wire.at(-1);
    expect(carrier.role).toBe('user');
    const serialized = JSON.stringify(carrier);
    expect(serialized).toContain('just give me the 3 plan names');
    expect(serialized.split('USER STEER').length - 1).toBe(1);
    // The steer carries its own label; the generic fold label must not stack on it.
    expect(serialized).not.toContain(USER_AFTER_TOOL_RESULT_LABEL);
  });

  it('still lands correctly if the orchestrator layer is bypassed entirely', () => {
    const adapter = newAdapter();
    const messages = [...toolRound(), { role: 'user', content: 'raw push, no shape awareness' }];

    const wire = adapter._normalizeHistoryMessages(messages);

    expect(findTextAfterToolResult(wire)).toEqual([]);
    expect(findConsecutiveSameRole(wire)).toEqual([]);
    expect(findTextOnlyAssistantTurns(wire)).toEqual([]);
    expect(JSON.stringify(wire.at(-1))).toContain('raw push, no shape awareness');
  });
});
