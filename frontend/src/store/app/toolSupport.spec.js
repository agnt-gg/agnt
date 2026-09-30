import { describe, expect, it } from 'vitest';
import { getToolSupportWarning, modelDefinitelyNoTools, modelDefinitelyHasTools } from './toolSupport.js';

describe('getToolSupportWarning — the model\'s own metadata decides', () => {
  it('warns for a model the catalogue says cannot call tools, on any provider', () => {
    expect(getToolSupportWarning('OpenRouter', 'vendor/no-tools', { supportsTools: false })).toMatch(/"vendor\/no-tools" does not support function calling/);
    expect(getToolSupportWarning('Cerebras', 'qwen-3.8-27b', { supportsTools: false })).toMatch(/does not support/);
  });

  it('clears the provider-level caveat for a model the catalogue confirms', () => {
    expect(getToolSupportWarning('OpenRouter', 'anthropic/claude-sonnet-4.6', { supportsTools: true })).toBeNull();
  });

  it('falls back to provider policy only when the metadata is silent', () => {
    expect(getToolSupportWarning('OpenRouter', 'unknown/model', {})).toMatch(/varies by model/);
    expect(getToolSupportWarning('Anthropic', 'claude-opus-5-5', null)).toBeNull();
    expect(getToolSupportWarning('Cerebras', 'gpt-oss-120b', null)).toBeNull();
    expect(getToolSupportWarning('3d4c97fe-5212-443e-9405-2f13240b63b5', 'm', null)).toMatch(/Custom providers/);
    expect(getToolSupportWarning(null, 'm')).toBeNull();
  });

  it('metadata overrides even a "full support" provider', () => {
    expect(getToolSupportWarning('OpenAI', 'gpt-image-2', { supportsTools: false })).toMatch(/does not support/);
  });
});

describe('modelDefinitelyNoTools / modelDefinitelyHasTools', () => {
  it('follow the metadata, then provider policy', () => {
    expect(modelDefinitelyNoTools('OpenRouter', 'x', { supportsTools: false })).toBe(true);
    expect(modelDefinitelyNoTools('OpenRouter', 'x', {})).toBe(false);
    expect(modelDefinitelyHasTools('OpenRouter', 'x', { supportsTools: true })).toBe(true);
    expect(modelDefinitelyHasTools('OpenAI', 'gpt-image-2', { supportsTools: false })).toBe(false);
    expect(modelDefinitelyHasTools('Anthropic', 'claude-x', null)).toBe(true);
    expect(modelDefinitelyHasTools('TogetherAI', 'x', null)).toBe(false);
  });
});
