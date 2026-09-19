/**
 * turnContinuity: the contract that keeps a tool loop alive without teaching
 * the model to stop.
 *
 * Reproduces the production failure end to end at the unit level: a history
 * carrying the legacy "(Continuing.)" bridge is what the model imitated, so
 * (a) that bridge and its imitations must be scrubbed from outbound history,
 * (b) no repair path may ever fabricate an assistant turn again, and (c) a
 * round that ends on a bare status line must be recognised as a pause.
 */

import { describe, it, expect } from 'vitest';
import {
  foldBlocksIntoLastToolResult,
  isImitableStatusTurn,
  isNonTerminalStatus,
  USER_AFTER_TOOL_RESULT_LABEL,
  CONTINUATION_NUDGE_TEXT,
  MAX_CONTINUATION_NUDGES,
} from './turnContinuity.js';

const assistantText = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] });

describe('isImitableStatusTurn — scrub predicate', () => {
  it('matches both legacy fabricated bridges exactly', () => {
    expect(isImitableStatusTurn(assistantText('(Continuing.)'))).toBe(true);
    expect(isImitableStatusTurn(assistantText('(Mid-run instruction received from the user.)'))).toBe(true);
  });

  it('matches the model’s imitations of the bridge', () => {
    for (const text of ['Continuing.', 'Continuing now.', '(Continuing)', 'Proceeding.', 'Moving on.', 'On it.', 'continuing…']) {
      expect(isImitableStatusTurn(assistantText(text)), text).toBe(true);
      expect(isImitableStatusTurn({ role: 'assistant', content: text }), `string ${text}`).toBe(true);
    }
  });

  it('never matches a real answer, a tool call, or a user turn', () => {
    expect(isImitableStatusTurn(assistantText('Continuing the analysis: the build fails because vite is missing.'))).toBe(false);
    expect(isImitableStatusTurn(assistantText('Done. Three files changed.'))).toBe(false);
    expect(isImitableStatusTurn({ role: 'assistant', content: 'Continuing.', tool_calls: [{ id: 'c1' }] })).toBe(false);
    expect(isImitableStatusTurn({ role: 'assistant', content: [{ type: 'text', text: 'Continuing.' }, { type: 'tool_use', id: 't1', name: 'x', input: {} }] })).toBe(false);
    expect(isImitableStatusTurn({ role: 'user', content: 'Continuing.' })).toBe(false);
    expect(isImitableStatusTurn(assistantText(''))).toBe(false);
    expect(isImitableStatusTurn(null)).toBe(false);
  });
});

describe('isNonTerminalStatus — pause detection', () => {
  it('recognises a bare status line as a pause', () => {
    for (const text of ['(Continuing.)', 'Continuing.', 'Continuing now...', 'Proceeding with the task.', 'Resuming.']) {
      expect(isNonTerminalStatus(text), text).toBe(true);
    }
  });

  it('treats substantive text, empty text, and multi-line text as terminal', () => {
    expect(isNonTerminalStatus('')).toBe(false);
    expect(isNonTerminalStatus('   ')).toBe(false);
    expect(isNonTerminalStatus('Continuing.\nHere is the summary.')).toBe(false);
    expect(isNonTerminalStatus('Fixed and verified: the test controls its environment.')).toBe(false);
    expect(isNonTerminalStatus('Next steps: none, the task is complete.')).toBe(false);
    expect(isNonTerminalStatus(undefined)).toBe(false);
  });

  it('exposes a bounded nudge that keeps tools available', () => {
    expect(MAX_CONTINUATION_NUDGES).toBeGreaterThan(0);
    expect(MAX_CONTINUATION_NUDGES).toBeLessThanOrEqual(3);
    expect(CONTINUATION_NUDGE_TEXT).toMatch(/tool call/);
    expect(CONTINUATION_NUDGE_TEXT).toMatch(/not finished/);
  });
});

describe('foldBlocksIntoLastToolResult — the only legal repair', () => {
  const carrier = () => ({
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'a' },
      { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'b' }] },
    ],
  });

  it('folds text into the LAST tool_result behind the user-input label', () => {
    const out = foldBlocksIntoLastToolResult(carrier(), [{ type: 'text', text: 'actually, stop' }]);
    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: 'a' });
    expect(out.content[1].content).toEqual([
      { type: 'text', text: 'b' },
      { type: 'text', text: USER_AFTER_TOOL_RESULT_LABEL },
      { type: 'text', text: 'actually, stop' },
    ]);
  });

  it('normalizes a string tool_result content to the array form', () => {
    const single = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'raw' }] };
    const out = foldBlocksIntoLastToolResult(single, [{ type: 'text', text: 'steer' }]);
    expect(out.content[0].content).toEqual([
      { type: 'text', text: 'raw' },
      { type: 'text', text: USER_AFTER_TOOL_RESULT_LABEL },
      { type: 'text', text: 'steer' },
    ]);
  });

  it('omits the label when the caller already labelled the text', () => {
    const out = foldBlocksIntoLastToolResult(carrier(), [{ type: 'text', text: '[USER STEER]\nx' }], { label: false });
    expect(out.content[1].content.map((b) => b.text)).toEqual(['b', '[USER STEER]\nx']);
  });

  it('keeps image blocks and stringifies anything tool_result cannot carry', () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
    const odd = { type: 'document', source: { type: 'text', data: 'x' } };
    const out = foldBlocksIntoLastToolResult(carrier(), [image, odd]);
    const folded = out.content[1].content;
    expect(folded[2]).toBe(image);
    expect(folded[3]).toEqual({ type: 'text', text: JSON.stringify(odd) });
  });

  it('does not mutate the input and returns the carrier untouched for no blocks', () => {
    const input = carrier();
    const snapshot = JSON.stringify(input);
    const out = foldBlocksIntoLastToolResult(input, [{ type: 'text', text: 'x' }]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);
    expect(foldBlocksIntoLastToolResult(input, [])).toBe(input);
  });

  it('refuses a carrier with no tool_result rather than inventing one', () => {
    expect(() => foldBlocksIntoLastToolResult({ role: 'user', content: [{ type: 'text', text: 'hi' }] }, [{ type: 'text', text: 'x' }]))
      .toThrow(/no tool_result/);
  });
});
