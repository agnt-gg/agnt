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

  it('compresses oversized histories and keeps the summary in conversation messages', () => {
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
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toContain('Previous conversation');
  });
});

describe('getTokenLimit — provider-agnostic resolution', () => {
  // Buffer reserved for response generation; mirrors RESPONSE_BUFFER in contextManager.js
  const RESPONSE_BUFFER = 8000;

  it('falls back to the family-prefix heuristic for Codex gpt-5.5 when no metadata is registered', () => {
    // Pre-condition: no entry registered for openai-codex/gpt-5.5
    const meta = getModelMetadata('openai-codex', 'gpt-5.5');
    if (meta?.contextWindow) {
      // If a previous test or seed populated this, skip — heuristic test
      // is meaningless when an exact match exists.
      expect.fail('precondition: openai-codex/gpt-5.5 has registered metadata; heuristic path not exercised');
    }
    // gpt-5* heuristic = 400k
    expect(getTokenLimit('gpt-5.5', 'openai-codex')).toBe(400_000 - RESPONSE_BUFFER);
  });

  it('honors registered dynamic metadata over the family heuristic', () => {
    registerDynamicPricing('openai-codex', 'heuristic-test-model', { contextWindow: 200_000 });
    expect(getTokenLimit('heuristic-test-model', 'openai-codex')).toBe(200_000 - RESPONSE_BUFFER);
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
