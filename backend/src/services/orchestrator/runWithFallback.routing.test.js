import { describe, it, expect, vi } from 'vitest';
import { runWithFallback } from './ProviderFallback.js';

const tier = (provider, model, i) => ({ provider, model, tier: i, primary: i === 0 });
const ok = (text = 'fine') => ({ responseMessage: { content: text }, toolCalls: [] });
const failed = (recoveredError) => ({ responseMessage: null, toolCalls: [], recoveredFromError: true, recoveredError });

function scripted(outcomes) {
  const calls = [];
  const runOne = vi.fn(async (t) => {
    calls.push(`${t.provider}/${t.model}`);
    const next = outcomes[`${t.provider}/${t.model}`];
    if (next instanceof Error) throw next;
    return next;
  });
  return { runOne, calls };
}

describe('validate — "did it work?" beyond "did it error"', () => {
  it('rolls over to the next pick when the answer fails the check', async () => {
    const chain = [tier('groq', 'a', 0), tier('anthropic', 'b', 1)];
    const { runOne, calls } = scripted({ 'groq/a': ok('not json'), 'anthropic/b': ok('{"title":"x"}') });
    const { result, tier: served, attempts } = await runWithFallback({
      chain, runOne, validate: (r) => r.responseMessage.content.startsWith('{') || 'not json',
    });
    expect(calls).toEqual(['groq/a', 'anthropic/b']);
    expect(served.provider).toBe('anthropic');
    expect(result.responseMessage.content).toBe('{"title":"x"}');
    expect(attempts[0]).toMatchObject({ failed: true, reason: 'invalid_output' });
  });

  it('when every pick fails the check, returns the last result marked invalid', async () => {
    const chain = [tier('groq', 'a', 0), tier('anthropic', 'b', 1)];
    const { runOne } = scripted({ 'groq/a': ok('x'), 'anthropic/b': ok('y') });
    const { result } = await runWithFallback({ chain, runOne, validate: () => 'nope' });
    expect(result.invalidOutput).toBe(true);
    expect(result.validationError).toBe('nope');
  });

  it('a throwing validator counts as a failed check, not a crash', async () => {
    const chain = [tier('groq', 'a', 0), tier('anthropic', 'b', 1)];
    const { runOne, calls } = scripted({ 'groq/a': ok(), 'anthropic/b': ok() });
    let first = true;
    await runWithFallback({ chain, runOne, validate: () => { if (first) { first = false; throw new Error('bad'); } return true; } });
    expect(calls).toEqual(['groq/a', 'anthropic/b']);
  });

  it('is not consulted for a transport failure', async () => {
    const validate = vi.fn(() => true);
    const chain = [tier('groq', 'a', 0), tier('anthropic', 'b', 1)];
    const { runOne } = scripted({ 'groq/a': failed('503 overloaded'), 'anthropic/b': ok() });
    await runWithFallback({ chain, runOne, validate });
    expect(validate).toHaveBeenCalledTimes(1);
  });
});

describe('provider-wide failures skip the rest of that provider', () => {
  it('a 429 on anthropic/haiku skips anthropic/opus and goes to the next provider', async () => {
    const chain = [tier('anthropic', 'haiku', 0), tier('anthropic', 'opus', 1), tier('openai', 'gpt', 2)];
    const { runOne, calls } = scripted({ 'anthropic/haiku': failed('429 rate limit'), 'anthropic/opus': ok(), 'openai/gpt': ok() });
    const onFallback = vi.fn();
    const { tier: served, attempts } = await runWithFallback({ chain, runOne, onFallback });
    expect(calls).toEqual(['anthropic/haiku', 'openai/gpt']);
    expect(served.provider).toBe('openai');
    expect(attempts[1]).toMatchObject({ provider: 'anthropic', skipped: true, reason: 'provider_down' });
    // The failover event names the tier that will actually run.
    expect(onFallback.mock.calls[0][0].to.provider).toBe('openai');
  });

  it('a model-specific failure still tries the account default on the same provider', async () => {
    const chain = [tier('anthropic', 'retired-model', 0), tier('anthropic', 'opus', 1)];
    const { runOne, calls } = scripted({ 'anthropic/retired-model': failed('404 model not found'), 'anthropic/opus': ok() });
    const { tier: served } = await runWithFallback({ chain, runOne });
    expect(calls).toEqual(['anthropic/retired-model', 'anthropic/opus']);
    expect(served.model).toBe('opus');
  });

  it('compares providers canonically', async () => {
    const chain = [tier('Claude-Code', 'a', 0), tier('claude-code', 'b', 1)];
    const { runOne, calls } = scripted({ 'Claude-Code/a': failed('401 unauthorized'), 'claude-code/b': ok() });
    await runWithFallback({ chain, runOne });
    expect(calls).toEqual(['Claude-Code/a']);
  });

  it('when every remaining tier is skipped, returns the last real failure', async () => {
    const chain = [tier('anthropic', 'a', 0), tier('anthropic', 'b', 1)];
    const { runOne } = scripted({ 'anthropic/a': failed('401 unauthorized'), 'anthropic/b': ok() });
    const { result, tier: last } = await runWithFallback({ chain, runOne });
    expect(result.recoveredFromError).toBe(true);
    expect(last.model).toBe('a');
  });
});

describe('health — every attempt is reported', () => {
  it('records provider failures and successes, but not a bad answer as a failure', async () => {
    const health = { recordFailure: vi.fn(), recordSuccess: vi.fn() };
    const chain = [tier('groq', 'a', 0), tier('deepseek', 'b', 1), tier('openai', 'c', 2)];
    const { runOne } = scripted({ 'groq/a': failed('503 overloaded'), 'deepseek/b': ok('bad'), 'openai/c': ok('good') });
    await runWithFallback({ chain, runOne, health, validate: (r) => r.responseMessage.content === 'good' });
    expect(health.recordFailure).toHaveBeenCalledWith('groq', 'overloaded');
    expect(health.recordSuccess).toHaveBeenCalledWith('deepseek');
    expect(health.recordSuccess).toHaveBeenCalledWith('openai');
    expect(health.recordFailure).toHaveBeenCalledTimes(1);
  });

  it('a throwing health hook never breaks the run', async () => {
    const health = { recordFailure: () => { throw new Error('x'); }, recordSuccess: () => { throw new Error('y'); } };
    const { result } = await runWithFallback({ chain: [tier('groq', 'a', 0)], runOne: async () => ok(), health });
    expect(result.responseMessage.content).toBe('fine');
  });
});

describe('cancellation is still sacred', () => {
  it('a stopped run neither validates, nor records health, nor rolls over', async () => {
    const health = { recordFailure: vi.fn(), recordSuccess: vi.fn() };
    const validate = vi.fn(() => false);
    const chain = [tier('groq', 'a', 0), tier('openai', 'b', 1)];
    const { runOne, calls } = scripted({ 'groq/a': failed('aborted'), 'openai/b': ok() });
    const { attempts } = await runWithFallback({ chain, runOne, shouldStop: () => true, health, validate });
    expect(calls).toEqual(['groq/a']);
    expect(attempts[0].stopped).toBe(true);
    expect(validate).not.toHaveBeenCalled();
    expect(health.recordFailure).not.toHaveBeenCalled();
  });
});
