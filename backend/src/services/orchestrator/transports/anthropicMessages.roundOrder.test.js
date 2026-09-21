/**
 * Wire probe: the exact message list Anthropic receives for a two-round turn,
 * after the frontend has split it per round (buildChatHistory) and this
 * adapter has converted it. This is the test that decides whether the fix is
 * real at the provider boundary, not just in the frontend's own data shape.
 *
 * FAILING SHAPE (what the model used to see, and learned to imitate):
 *   assistant: [text "Checking. 43 passed. Now the build. Built."] [tool_use c1] [tool_use c2]
 *   user:      [tool_result c1] [tool_result c2]
 *
 * PASSING SHAPE:
 *   assistant: [text "Checking the test."] [tool_use c1]
 *   user:      [tool_result c1]
 *   assistant: [text "43 passed. Now the build."] [tool_use c2]
 *   user:      [tool_result c2]
 *   assistant: [text "Build passed."]
 */
import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from './anthropicMessages.js';

const perRoundHistory = [
  { role: 'user', content: 'run tests then build' },
  { role: 'assistant', content: 'Checking the test.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_tests', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: '43 passed' },
  { role: 'assistant', content: '43 passed. Now the build.', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'vite_build', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'c2', content: 'built' },
  { role: 'assistant', content: 'Build passed.' },
];

function describeBlock(block) {
  if (block.type === 'text') return block.text;
  if (block.type === 'tool_use') return `[tool_use ${block.id}]`;
  if (block.type === 'tool_result') return `[tool_result ${block.tool_use_id}]`;
  return `[${block.type}]`;
}

function shapeOf(wire) {
  return wire.map((m) => {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
    return `${m.role}: ${blocks.map(describeBlock).join(' ')}`;
  });
}

describe('Anthropic wire shape preserves round order', () => {
  it('each round becomes its own assistant turn followed by its own tool_result turn', () => {
    const adapter = new AnthropicAdapter({}, 'claude-sonnet-4-5', 'anthropic', {});
    const wire = adapter._normalizeHistoryMessages(perRoundHistory);
    expect(shapeOf(wire)).toEqual([
      'user: run tests then build',
      'assistant: Checking the test. [tool_use c1]',
      'user: [tool_result c1]',
      'assistant: 43 passed. Now the build. [tool_use c2]',
      'user: [tool_result c2]',
      'assistant: Build passed.',
    ]);
  });

  it('no assistant block reports a result before the tool_use that produced it', () => {
    const adapter = new AnthropicAdapter({}, 'claude-sonnet-4-5', 'anthropic', {});
    const wire = adapter._normalizeHistoryMessages(perRoundHistory);
    const firstAssistant = wire.find((m) => m.role === 'assistant');
    const text = firstAssistant.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    expect(text).not.toContain('43 passed');
    expect(text).not.toContain('Build passed');
  });

  it('the legacy flattened shape is what the old code produced — pinned so the regression is visible', () => {
    // If buildChatHistory ever regresses to one-message-per-turn, THIS is the
    // input the adapter would receive. Documenting the bad shape makes the
    // difference reviewable in a diff, not just in a failing assertion.
    const flattened = [
      { role: 'user', content: 'run tests then build' },
      { role: 'assistant', content: 'Checking the test.43 passed. Now the build.Build passed.', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'run_tests', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'vite_build', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'c1', content: '43 passed' },
      { role: 'tool', tool_call_id: 'c2', content: 'built' },
    ];
    const adapter = new AnthropicAdapter({}, 'claude-sonnet-4-5', 'anthropic', {});
    const wire = adapter._normalizeHistoryMessages(flattened);
    const firstAssistant = wire.find((m) => m.role === 'assistant');
    const text = firstAssistant.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    // The bad shape: results narrated in the same block as the calls.
    expect(text).toContain('43 passed');
    expect(text).toContain('Build passed');
  });
});
