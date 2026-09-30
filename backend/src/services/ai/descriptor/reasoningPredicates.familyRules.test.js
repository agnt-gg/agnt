/**
 * Reasoning predicates match model FAMILIES, not id lists, for providers whose
 * catalogue is fetched live. Each regression below is a model the vendor was
 * serving on 2026-09-30 that an exact-id list had silently excluded.
 */
import { describe, expect, it } from 'vitest';
import {
  supportsDeepSeekThinkingToggle,
  isCerebrasGptOssReasoningModel,
  isCerebrasGlmReasoningModel,
  isCerebrasQwenReasoningModel,
} from './reasoningPredicates.js';
import { getReasoningControl } from '../providerConfigs.js';
import { buildOpenAiLikeReasoningExtraBody } from '../../orchestrator/transports/_shared.js';
import { createLlmAdapter } from '../../orchestrator/llmAdapters.js';

describe('DeepSeek', () => {
  it('REGRESSION: deepseek-flash (DeepSeek\'s lead model) gets the thinking control', () => {
    expect(supportsDeepSeekThinkingToggle('deepseek-flash')).toBe(true);
    expect(getReasoningControl('deepseek', 'deepseek-flash')?.options.map((o) => o.value)).toEqual(['default', 'off', 'high', 'max']);
  });

  it.each(['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'])('%s keeps it', (id) => {
    expect(supportsDeepSeekThinkingToggle(id)).toBe(true);
  });

  it('is not claimed by other vendors', () => {
    expect(supportsDeepSeekThinkingToggle('deepseek-ai/DeepSeek-V3.1')).toBe(false);
    expect(supportsDeepSeekThinkingToggle('gpt-5.5')).toBe(false);
  });
});

describe('Cerebras', () => {
  it('REGRESSION: qwen-3.8-27b gets the on/off control and sends reasoning_effort none when off', () => {
    expect(isCerebrasQwenReasoningModel('qwen-3.8-27b')).toBe(true);
    expect(getReasoningControl('cerebras', 'qwen-3.8-27b')?.kind).toBe('toggle');
  });

  it('matches families, not single ids', () => {
    expect(isCerebrasGptOssReasoningModel('gpt-oss-120b')).toBe(true);
    expect(isCerebrasGptOssReasoningModel('gpt-oss-20b')).toBe(true);
    expect(isCerebrasGlmReasoningModel('zai-glm-5')).toBe(true);
    expect(isCerebrasQwenReasoningModel('llama3.1-8b')).toBe(false);
  });

  it('REGRESSION: qwen streams with tools like gpt-oss; llama still does not', async () => {
    const client = { chat: { completions: { create: () => {} } } };
    for (const [model, streams] of [['qwen-3.8-27b', true], ['gpt-oss-120b', true], ['llama3.1-8b', false], ['llama-3.3-70b', false]]) {
      const adapter = await createLlmAdapter('cerebras', client, model, { provider: 'cerebras' });
      expect(adapter.supportsStreamingWithTools(), model).toBe(streams);
    }
  });
});

describe('the wire params follow the control', () => {
  it('sends the thinking toggle for deepseek-flash', () => {
    expect(buildOpenAiLikeReasoningExtraBody('deepseek', 'deepseek-flash', 'max')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'max' });
    expect(buildOpenAiLikeReasoningExtraBody('deepseek', 'deepseek-flash', 'off')).toEqual({ thinking: { type: 'disabled' } });
    expect(buildOpenAiLikeReasoningExtraBody('deepseek', 'deepseek-flash', 'default')).toBeNull();
  });

  it('turns Cerebras Qwen reasoning off with reasoning_effort none, and leaves its default alone', () => {
    expect(buildOpenAiLikeReasoningExtraBody('cerebras', 'qwen-3.8-27b', 'off')).toEqual({ reasoning_effort: 'none' });
    expect(buildOpenAiLikeReasoningExtraBody('cerebras', 'qwen-3.8-27b', 'default')).toBeNull();
  });
});
