import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, getTokenLimit, manageContext } from './contextManager.js';
import {
  registerDynamicPricing,
  registerDynamicPricingFromModels,
  getModelMetadata,
} from '../services/ai/providerConfigs.js';

describe('contextManager', () => {
  it('counts assistant tool call arguments when estimating message tokens', () => {
    const small = [{ role: 'assistant', content: '', tool_calls: [] }];
    const large = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'large_tool',
              arguments: 'x'.repeat(100_000),
            },
          },
        ],
      },
    ];

    expect(estimateMessagesTokens(large)).toBeGreaterThan(estimateMessagesTokens(small) + 20_000);
  });

  it('compresses oversized histories by evicting whole old units, keeping recent turns verbatim', () => {
    // BEHAVIOUR CHANGE (deliberate): this used to assert Strategy 2's
    // "[Previous conversation summary]" message. That summary was REGENERATED
    // on every over-budget turn, which rewrote the cached prompt prefix per
    // request — the exact money leak the chunked-eviction watermark fixes.
    // The new contract: whole oldest units are dropped cleanly (watermark
    // reported for persistence), the recent turns survive VERBATIM (the old
    // path truncated them), and the request fits the window.
    const hugePayload = 'x'.repeat(700_000);
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Start' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'large_tool', arguments: hugePayload },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'large_tool',
        content: JSON.stringify({ success: true, data: hugePayload }),
      },
      { role: 'user', content: 'Continue' },
    ];

    const result = manageContext(messages, 'unknown-model', [], null);

    expect(result.wasManaged).toBe(true);
    expect(result.totalRequestTokens).toBeLessThan(result.contextWindow);
    expect(result.evictedUnits).toBeGreaterThan(0);
    // The system prompt survives untouched and the most recent user turn
    // survives VERBATIM (not truncated, not summarized).
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('System prompt');
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toBe('Continue');
    // No orphaned tool messages: the giant unit travelled out atomically.
    expect(result.messages.some((m) => m.role === 'tool')).toBe(false);
  });
});

describe('getTokenLimit — provider-agnostic resolution', () => {
  // Mirrors the buffers + safety margin in contextManager.js. Reasoning models
  // (gpt-5.x, o3/o4) and openai-codex reserve a larger output buffer because
  // hidden chain-of-thought consumes far more than the 8k default. openai-codex
  // also gets a 0.93 safety margin to offset Responses-API tokenization undercounts.
  const RESPONSE_BUFFER = 8000;
  const REASONING_RESPONSE_BUFFER = 32_000;
  const CODEX_SAFETY_MARGIN = 0.93;

  // Originally pinned 'gpt-5.5' and required that NO metadata resolve for it.
  // Both halves of that premise are now false: gpt-5.5 is catalogued, and
  // providerConfigs grew inferGenericGpt5Metadata, which synthesises 400k
  // metadata for ANY uncatalogued gpt-5.x on openai/openai-codex (so vision and
  // tool support are not silently reported as false). The window it yields is
  // the same 400k the old family-prefix heuristic produced, so the number below
  // is unchanged — only the path that supplies it is. The guard now asserts the
  // resolution really is INFERRED, which keeps the test from passing vacuously
  // against a hardcoded entry.
  const UNCATALOGUED_GPT5 = 'gpt-5.99';

  it('resolves an uncatalogued Codex gpt-5.x model to the generic 400k gpt-5 window', () => {
    const meta = getModelMetadata('openai-codex', UNCATALOGUED_GPT5);
    expect(meta?.inferred, `precondition: ${UNCATALOGUED_GPT5} must resolve by inference, not a catalogue entry`).toBe(true);
    expect(meta.contextWindow).toBe(400_000);

    // 400k window, Codex reasoning buffer = 32k, Codex margin = 0.93
    expect(getTokenLimit(UNCATALOGUED_GPT5, 'openai-codex')).toBe(
      Math.floor((400_000 - REASONING_RESPONSE_BUFFER) * CODEX_SAFETY_MARGIN),
    );
  });

  it('honors registered dynamic metadata over the family heuristic', () => {
    registerDynamicPricing('openai-codex', 'heuristic-test-model', { contextWindow: 200_000 });
    // openai-codex routes always go through the reasoning Responses API, so
    // the 32k reasoning buffer + 0.93 margin apply regardless of model name.
    expect(getTokenLimit('heuristic-test-model', 'openai-codex')).toBe(
      Math.floor((200_000 - REASONING_RESPONSE_BUFFER) * CODEX_SAFETY_MARGIN),
    );
  });

  it('registers contextWindow for non-OpenRouter providers (provider-agnostic path)', () => {
    registerDynamicPricingFromModels('groq', [
      { id: 'groq-test-foo', contextWindow: 64_000 },
    ]);
    const fooMeta = getModelMetadata('groq', 'groq-test-foo');
    expect(fooMeta).toBeTruthy();
    expect(fooMeta.contextWindow).toBe(64_000);
    expect(fooMeta.dynamic).toBe(true);
  });

  it('still registers OpenRouter pricing.prompt/completion AND contextWindow (regression)', () => {
    registerDynamicPricingFromModels('openrouter', [
      {
        id: 'openrouter-test-bar',
        contextLength: 128_000,
        pricing: { prompt: '0.0000003', completion: '0.0000015' },
      },
    ]);
    const barMeta = getModelMetadata('openrouter', 'openrouter-test-bar');
    expect(barMeta).toBeTruthy();
    expect(barMeta.contextWindow).toBe(128_000);
    expect(Math.round(barMeta.inputCostPer1M * 100) / 100).toBe(0.3);
    expect(Math.round(barMeta.outputCostPer1M * 100) / 100).toBe(1.5);
  });

  it('preserves explicit boolean false for capability fields (PRD-045 §5.2 contract)', () => {
    registerDynamicPricingFromModels('groq', [
      {
        id: 'groq-test-no-tools',
        contextWindow: 32_000,
        supportsTools: false,
      },
    ]);
    const meta = getModelMetadata('groq', 'groq-test-no-tools');
    expect(meta.supportsTools).toBe(false);
  });

  it('omits capability fields entirely when undefined (no false coercion)', () => {
    registerDynamicPricingFromModels('groq', [
      {
        id: 'groq-test-unknown-tools',
        contextWindow: 32_000,
        // supportsTools intentionally absent
      },
    ]);
    const meta = getModelMetadata('groq', 'groq-test-unknown-tools');
    expect('supportsTools' in meta).toBe(false);
  });
});
