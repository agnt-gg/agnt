/**
 * The model's transcript must show the order that actually happened.
 *
 * A turn with two tool rounds streams as:
 *   text₁ → tool_call₁ → tool_result₁ → text₂ → tool_call₂ → tool_result₂
 *
 * Flattening that to ONE assistant message (all prose, then all tool_calls)
 * teaches the model, by its own example, to narrate every outcome before it
 * has run anything. Claude is a few-shot imitator (see turnContinuity.js), so
 * the history is the strongest instruction in the request. These tests pin
 * that the wire shape preserves round order.
 */
import { describe, it, expect } from 'vitest';
import { buildChatHistory } from './chat.js';
import { createAssistantMessage, applyStreamEvent } from '@/services/chatStreamReducer.js';

function streamTwoRoundTurn() {
  const message = createAssistantMessage('asst-1');
  applyStreamEvent(message, 'content_delta', { delta: 'Checking the test.' });
  applyStreamEvent(message, 'tool_start', { toolCall: { id: 'c1', name: 'run_tests', args: {} } });
  applyStreamEvent(message, 'tool_end', { toolCall: { id: 'c1', name: 'run_tests', result: '43 passed' } });
  applyStreamEvent(message, 'content_delta', { delta: '43 passed. Now the build.' });
  applyStreamEvent(message, 'tool_start', { toolCall: { id: 'c2', name: 'vite_build', args: {} } });
  applyStreamEvent(message, 'tool_end', { toolCall: { id: 'c2', name: 'vite_build', result: 'built' } });
  applyStreamEvent(message, 'content_delta', { delta: 'Build passed.' });
  return message;
}

describe('history preserves the round order the model actually produced', () => {
  it('emits one assistant turn per round, prose placed after the results it reports on', () => {
    const history = buildChatHistory([{ role: 'user', content: 'run and build' }, streamTwoRoundTurn()]);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);

    const [, round1, result1, round2, result2, closing] = history;
    expect(round1.content).toBe('Checking the test.');
    expect(round1.tool_calls.map((tc) => tc.id)).toEqual(['c1']);
    expect(result1.tool_call_id).toBe('c1');

    // THE regression: this prose must come AFTER c1's result, not before c1.
    expect(round2.content).toBe('43 passed. Now the build.');
    expect(round2.tool_calls.map((tc) => tc.id)).toEqual(['c2']);
    expect(result2.tool_call_id).toBe('c2');

    expect(closing.content).toBe('Build passed.');
    expect(closing.tool_calls).toBeUndefined();
  });

  it('no round-2 prose appears in the message that carries round-1 tool calls', () => {
    const history = buildChatHistory([{ role: 'user', content: 'go' }, streamTwoRoundTurn()]);
    const withC1 = history.find((m) => m.tool_calls?.some((tc) => tc.id === 'c1'));
    expect(withC1.content).not.toContain('43 passed');
    expect(withC1.content).not.toContain('Build passed');
  });

  it('two calls in one round stay in one assistant message', () => {
    const message = createAssistantMessage('asst-1');
    applyStreamEvent(message, 'content_delta', { delta: 'Reading both.' });
    applyStreamEvent(message, 'tool_start', { toolCall: { id: 'c1', name: 'read_file', args: {} } });
    applyStreamEvent(message, 'tool_start', { toolCall: { id: 'c2', name: 'read_file', args: {} } });
    applyStreamEvent(message, 'tool_end', { toolCall: { id: 'c1', name: 'read_file', result: 'a' } });
    applyStreamEvent(message, 'tool_end', { toolCall: { id: 'c2', name: 'read_file', result: 'b' } });
    applyStreamEvent(message, 'content_delta', { delta: 'Both read.' });
    const history = buildChatHistory([{ role: 'user', content: 'q' }, message]);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    expect(history[1].tool_calls.map((tc) => tc.id)).toEqual(['c1', 'c2']);
    expect(history[4].content).toBe('Both read.');
  });

  it('a turn that ends on a tool result emits no empty trailing assistant message', () => {
    const message = createAssistantMessage('asst-1');
    applyStreamEvent(message, 'content_delta', { delta: 'Looking.' });
    applyStreamEvent(message, 'tool_start', { toolCall: { id: 'c1', name: 'read_file', args: {} } });
    applyStreamEvent(message, 'tool_end', { toolCall: { id: 'c1', name: 'read_file', result: 'x' } });
    const history = buildChatHistory([{ role: 'user', content: 'q' }, message]);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('a prose-only turn is a single assistant message', () => {
    const message = createAssistantMessage('asst-1');
    applyStreamEvent(message, 'content_delta', { delta: 'Just an answer.' });
    const history = buildChatHistory([{ role: 'user', content: 'q' }, message]);
    expect(history).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'Just an answer.' },
    ]);
  });

  it('a persisted message with no contentParts falls back to the legacy single-turn shape', () => {
    const legacy = {
      role: 'assistant',
      content: 'I did things.',
      toolCalls: [{ id: 'c1', name: 'x', args: {}, result: 'r' }],
    };
    const history = buildChatHistory([{ role: 'user', content: 'q' }, legacy]);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(history[1].tool_calls.map((tc) => tc.id)).toEqual(['c1']);
    expect(history[1].content).toBe('I did things.');
  });

  it('a tool error is reported in its own round, not merged into the next', () => {
    const message = createAssistantMessage('asst-1');
    applyStreamEvent(message, 'content_delta', { delta: 'Trying.' });
    applyStreamEvent(message, 'tool_start', { toolCall: { id: 'c1', name: 'x', args: {} } });
    applyStreamEvent(message, 'tool_end', { toolCall: { id: 'c1', name: 'x', error: 'boom' } });
    applyStreamEvent(message, 'content_delta', { delta: 'That failed; retrying.' });
    applyStreamEvent(message, 'tool_start', { toolCall: { id: 'c2', name: 'x', args: {} } });
    applyStreamEvent(message, 'tool_end', { toolCall: { id: 'c2', name: 'x', result: 'ok' } });
    const history = buildChatHistory([{ role: 'user', content: 'q' }, message]);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
    expect(history[2].content).toBe(JSON.stringify({ error: 'boom' }));
    expect(history[3].content).toBe('That failed; retrying.');
  });
});
