import { describe, expect, it } from 'vitest';
import { createLlmAdapter } from './llmAdapters.js';

/**
 * Regression suite for the "Codex is blind to the conversation" defect.
 *
 * Root cause: CodexResponsesAdapter._buildCodexParamsWithinBudget() estimated
 * the whole serialized request with a single chars/1.6 divisor. Measured against
 * o200k_base the components differ by 3.3x — tool schemas tokenize at 4.75
 * chars/token, prose at 3.91, escaped code at 2.58, random base64 at 1.46 — so
 * a large tool surface was scored at ~2.97x its real cost. The preflight then
 * "recovered" from that phantom overflow the only way it could: by deleting
 * conversation turns. With a 295-tool surface a three-message chat reached the
 * model as a single orphaned sentence.
 */

function makeToolSchemas(count, { descriptionPadding = 1300 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'function',
    function: {
      name: `synthetic_tool_${i}`,
      description: `Synthetic tool ${i}. ${'Performs a well-described operation on structured input. '.repeat(Math.ceil(descriptionPadding / 55))}`,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'The primary target identifier for this operation.' },
          mode: { type: 'string', enum: ['create', 'update', 'delete', 'inspect'], description: 'Operation mode.' },
          limit: { type: 'number', description: 'Maximum number of records to process in one call.' },
          dryRun: { type: 'boolean', description: 'When true, validate without applying any change.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional labels to attach.' },
        },
        required: ['target', 'mode'],
      },
    },
  }));
}

const shortConversation = () => ([
  { role: 'system', content: 'You are a helpful assistant with an extensive toolset.' },
  { role: 'user', content: 'My favourite colour is teal. Remember that.' },
  { role: 'assistant', content: 'Got it — teal. Noted.' },
  { role: 'user', content: 'What is my favourite colour?' },
]);

describe('CodexResponsesAdapter — preflight budget', () => {
  it('keeps every conversation turn when a large tool surface still fits the window', async () => {
    const tools = makeToolSchemas(295);
    // Sanity: this is the real-world scale that triggered the defect.
    expect(JSON.stringify(tools).length).toBeGreaterThan(500_000);

    const adapter = await createLlmAdapter('openai-codex', {}, 'gpt-5.6-sol');
    const result = adapter._buildCodexParamsWithinBudget(shortConversation(), tools, null, 'test');

    // NEGATIVE CONTROL: with the old chars/1.6 estimator this surface scored
    // ~375k against a 175k budget, shrinkAttempts hit its cap of 8, and exactly
    // ONE message survived. Any regression re-collapses these numbers.
    expect(result.shrinkAttempts).toBe(0);
    expect(result.workingMessages.filter((m) => m.role !== 'system')).toHaveLength(3);
    expect(result.params.input).toHaveLength(3);
    expect(result.estimatedTokens).toBeLessThan(result.budget);
  });

  it('preserves history when the fixed overhead alone exceeds the budget (shedding cannot help)', async () => {
    // Tool surface so large that no amount of dropping conversation can bring
    // the request under budget. Shedding here is pure damage for zero benefit.
    const tools = makeToolSchemas(1200);
    const adapter = await createLlmAdapter('openai-codex', {}, 'gpt-5.6-sol');
    const result = adapter._buildCodexParamsWithinBudget(shortConversation(), tools, null, 'test');

    expect(result.estimatedTokens).toBeGreaterThan(result.budget);
    expect(result.shrinkAttempts).toBe(0);
    expect(result.workingMessages.filter((m) => m.role !== 'system')).toHaveLength(3);
  });

  it('still sheds a genuinely oversized replay payload', async () => {
    const tools = makeToolSchemas(5);
    const adapter = await createLlmAdapter('openai-codex', {}, 'gpt-5.6-sol');
    const huge = JSON.stringify({ code: 'const value = compute(index);\n'.repeat(41_500) });
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Old request' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_huge', type: 'function', function: { name: 'synthetic_tool_0', arguments: huge } }],
        _responsesOutputItems: [{ type: 'function_call', call_id: 'call_huge', name: 'synthetic_tool_0', arguments: huge }],
      },
      { role: 'tool', tool_call_id: 'call_huge', name: 'synthetic_tool_0', content: '{"success":true}' },
      { role: 'user', content: 'Current request' },
    ];

    const result = adapter._buildCodexParamsWithinBudget(messages, tools, null, 'test');
    expect(result.shrinkAttempts).toBeGreaterThan(0);
    expect(result.params.input.length).toBeLessThan(4);
  });

  it('estimates schemas, prose and opaque blobs with different ratios', async () => {
    const adapter = await createLlmAdapter('openai-codex', {}, 'gpt-5.6-sol');
    const blob = 'A'.repeat(40_000);

    const asSchema = adapter._estimateCodexRequestTokens({ tools: [{ x: blob }], instructions: '', input: [] });
    const asProse = adapter._estimateCodexRequestTokens({ tools: [], instructions: blob, input: [] });
    const asOpaque = adapter._estimateCodexRequestTokens({
      tools: [], instructions: '', input: [{ type: 'reasoning', encrypted_content: blob }],
    });
    const asMessage = adapter._estimateCodexRequestTokens({
      tools: [], instructions: '', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: blob }] }],
    });

    // Opaque base64-shaped payloads must cost the MOST per character; schemas
    // the least. A single global divisor collapses all four to one number.
    expect(asOpaque).toBeGreaterThan(asMessage);
    expect(asMessage).toBeGreaterThan(asSchema);
    expect(asProse).toBeGreaterThan(asSchema);
    expect(asOpaque / asSchema).toBeGreaterThan(2);
  });

  it('mirrors Responses-API cached_tokens into the Chat-Completions shape', async () => {
    const adapter = await createLlmAdapter('openai-codex', {}, 'gpt-5.6-sol');

    const normalized = adapter._normalizeResponsesUsage({
      input_tokens: 130_000,
      output_tokens: 900,
      input_tokens_details: { cached_tokens: 118_400 },
    });
    // OrchestratorService.accumulateUsage() reads prompt_tokens_details; without
    // this mirror every Codex cache hit was accounted as zero.
    expect(normalized.prompt_tokens_details.cached_tokens).toBe(118_400);
    expect(normalized.input_tokens).toBe(130_000);

    expect(adapter._normalizeResponsesUsage(undefined)).toBeUndefined();
    const untouched = { input_tokens: 10, output_tokens: 2 };
    expect(adapter._normalizeResponsesUsage(untouched)).toBe(untouched);
  });
});
