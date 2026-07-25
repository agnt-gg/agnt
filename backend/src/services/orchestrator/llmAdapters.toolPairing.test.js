/**
 * Regression guard: adapters must never ship an unpaired tool_use / tool_result.
 *
 * History of this bug (three separate 400s, same invariant):
 *   1. contextManager Strategy 4 kept [system, lastUserMessage] and orphaned a
 *      tool_result carrier -> "unexpected tool_use_id found in tool_result blocks".
 *   2. Non-orchestrator call sites built history independently and shipped it
 *      unsanitized -> "tool_use ids were found without tool_result blocks".
 *   3. The orchestrator sanitized its message LEDGER, but handed the adapter a
 *      DERIVED array (compactMessageHistory + manageContext run AFTER the
 *      sanitize). A dangling tool_use from an aborted/capped tool round still
 *      reached the wire -> "messages.20: tool_use ids were found without
 *      tool_result blocks immediately after: toolu_...".
 *
 * Fix #3 installs BaseAdapter._sanitizeOutbound at every adapter entry point --
 * the single choke point where a message array becomes an HTTP request. These
 * tests pin that behaviour so a future refactor can't quietly reopen the gap.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicAdapter, BaseAdapter } from './llmAdapters.js';
import { manageContext } from '../../utils/contextManager.js';

/** Every tool_use must have a matching tool_result in the following message. */
function findOrphanToolUse(msgs) {
  const orphans = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || m.role !== 'assistant') continue;

    const uses = Array.isArray(m.content) ? m.content.filter((b) => b && b.type === 'tool_use') : [];
    const legacy = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    if (uses.length === 0 && legacy.length === 0) continue;

    const satisfied = new Set();
    const next = msgs[i + 1];
    if (next && Array.isArray(next.content)) {
      for (const b of next.content) {
        if (b && b.type === 'tool_result') satisfied.add(b.tool_use_id);
      }
    }
    let j = i + 1;
    while (j < msgs.length && msgs[j] && msgs[j].role === 'tool') {
      satisfied.add(msgs[j].tool_call_id);
      j++;
    }

    for (const u of uses) if (!satisfied.has(u.id)) orphans.push({ index: i, id: u.id });
    for (const tc of legacy) if (!satisfied.has(tc.id)) orphans.push({ index: i, id: tc.id });
  }
  return orphans;
}

/** Every tool_result must have its tool_use in the IMMEDIATELY previous message. */
function findOrphanToolResult(msgs) {
  const orphans = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
    const results = m.content.filter((b) => b && b.type === 'tool_result');
    if (results.length === 0) continue;

    const prev = msgs[i - 1];
    const ids = prev && prev.role === 'assistant' && Array.isArray(prev.content)
      ? prev.content.filter((b) => b && b.type === 'tool_use').map((b) => b.id)
      : [];
    for (const r of results) if (!ids.includes(r.tool_use_id)) orphans.push({ index: i, id: r.tool_use_id });
  }
  return orphans;
}

/**
 * Build a tool-loop history. When `abortedRound` is >= 0 that round's
 * assistant tool_use gets no tool_result -- exactly what happens when the user
 * hits Stop, a tool throws, or the round cap trips mid-flight.
 */
function buildToolLoopHistory({ rounds, abortedRound = -1 }) {
  const msgs = [{ role: 'system', content: 'You are Annie.' }];
  for (let r = 0; r < rounds; r++) {
    const id = `toolu_round_${r}`;
    msgs.push({
      role: 'assistant',
      content: [
        { type: 'text', text: `Round ${r}` },
        { type: 'tool_use', id, name: 'execute_shell_command', input: { command: 'git status' } },
      ],
    });
    if (r === abortedRound) continue;
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] });
  }
  msgs.push({ role: 'user', content: 'carry on' });
  return msgs;
}

const stubClient = { messages: { create: async () => ({}) } };
const newAnthropicAdapter = () => new AnthropicAdapter(stubClient, 'claude-opus-5');

describe('BaseAdapter._sanitizeOutbound', () => {
  it('repairs a dangling Anthropic tool_use by injecting a synthetic tool_result', () => {
    const history = buildToolLoopHistory({ rounds: 4, abortedRound: 2 });
    expect(findOrphanToolUse(history).length).toBe(1);

    const out = BaseAdapter._sanitizeOutbound(history, 'test');
    expect(findOrphanToolUse(out)).toEqual([]);
  });

  it('repairs a dangling OpenAI-style tool_calls entry', () => {
    const history = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: 'working',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell', arguments: '{}' } }],
      },
      { role: 'user', content: 'carry on' },
    ];
    expect(findOrphanToolUse(history).length).toBe(1);

    const out = BaseAdapter._sanitizeOutbound(history, 'test');
    expect(findOrphanToolUse(out)).toEqual([]);
    expect(out.some((m) => m.role === 'tool' && m.tool_call_id === 'call_1')).toBe(true);
  });

  it('is a no-op on an already-valid history', () => {
    const history = buildToolLoopHistory({ rounds: 3 });
    const out = BaseAdapter._sanitizeOutbound(history, 'test');
    expect(out).toEqual(history);
  });

  it('is idempotent', () => {
    const history = buildToolLoopHistory({ rounds: 4, abortedRound: 1 });
    const once = BaseAdapter._sanitizeOutbound(history, 'test');
    const twice = BaseAdapter._sanitizeOutbound(once, 'test');
    expect(twice).toEqual(once);
  });

  it('tolerates empty and non-array input', () => {
    expect(BaseAdapter._sanitizeOutbound([], 'test')).toEqual([]);
    expect(BaseAdapter._sanitizeOutbound(null, 'test')).toBeNull();
  });
});

describe('AnthropicAdapter wire payload', () => {
  it('never emits an orphan tool_use, even when the derived array carries one', () => {
    // The exact production shape: orchestrator sanitizes the LEDGER, then
    // manageContext derives the array the adapter actually receives.
    const ledger = buildToolLoopHistory({ rounds: 12, abortedRound: 9 });
    const derived = manageContext(ledger, 'claude-opus-5', [], 'claude-code').messages;

    // Precondition: the orphan really does survive into the derived array.
    expect(findOrphanToolUse(derived).length).toBeGreaterThan(0);

    const adapter = newAnthropicAdapter();
    const wire = adapter._normalizeHistoryMessages(derived.filter((m) => m.role !== 'system'));

    expect(findOrphanToolUse(wire)).toEqual([]);
    expect(findOrphanToolResult(wire)).toEqual([]);
  });

  it('produces a stable payload when normalized twice', () => {
    const ledger = buildToolLoopHistory({ rounds: 6, abortedRound: 3 });
    const adapter = newAnthropicAdapter();

    const once = adapter._normalizeHistoryMessages(ledger.filter((m) => m.role !== 'system'));
    const twice = adapter._normalizeHistoryMessages(once);

    expect(twice).toEqual(once);
    expect(findOrphanToolUse(twice)).toEqual([]);
  });

  it('converts OpenAI-shaped history and still guarantees pairing', () => {
    const history = [
      {
        role: 'assistant',
        content: 'calling a tool',
        tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'shell', arguments: '{"a":1}' } }],
      },
      { role: 'user', content: 'never got a result' },
    ];

    const adapter = newAnthropicAdapter();
    const wire = adapter._normalizeHistoryMessages(history);

    expect(findOrphanToolUse(wire)).toEqual([]);
    expect(findOrphanToolResult(wire)).toEqual([]);
  });

  it('leaves a clean history structurally intact', () => {
    const ledger = buildToolLoopHistory({ rounds: 3 });
    const adapter = newAnthropicAdapter();
    const wire = adapter._normalizeHistoryMessages(ledger.filter((m) => m.role !== 'system'));

    expect(findOrphanToolUse(wire)).toEqual([]);
    expect(findOrphanToolResult(wire)).toEqual([]);
    // 3 rounds -> 3 assistant + 3 tool_result carriers, with the trailing
    // "carry on" merged into the final user message by the alternation pass.
    expect(wire.filter((m) => m.role === 'assistant').length).toBe(3);
  });
});
