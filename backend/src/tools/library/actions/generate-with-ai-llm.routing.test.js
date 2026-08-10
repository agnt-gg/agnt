import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllProviderKeys } from '../../../services/ai/providerConfigs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, 'generate-with-ai-llm.js'), 'utf8');

/**
 * ONE routing decision for the workflow AI node, not one per mode.
 *
 * handleTextGeneration and handleVision each carried their own twenty-arm
 * `switch (provider)`. They listed the same providers in the same order and
 * differed only in the params forwarded — so the two could disagree, and the
 * only way to notice was for a user to pick the one combination that had
 * drifted. That is the same class of defect as the four drifted default-model
 * maps in StreamEngine: duplicated dispatch nobody diffs.
 *
 * These tests pin the table AND the property that made the duplication
 * dangerous: text and vision must resolve identically for every provider.
 */

// The node reaches auth managers and the network at import time in some paths;
// routing itself needs none of that, so the generators are stubbed.
function stubbed() {
  // The module exports a SINGLETON instance, not the class. Routing is stateless,
  // so the generators are stubbed on a per-test object that delegates to it.
  return import('./generate-with-ai-llm.js').then(({ default: singleton }) => {
    const action = Object.create(singleton);
    const calls = [];
    for (const m of [
      'generateWithAnthropic', 'generateWithCodex', 'generateWithKimiCode',
      'generateWithChutes', 'generateWithGoogleGateway',
      'generateWithManagedOpenAiLike', 'generateWithOpenAiLike',
    ]) {
      action[m] = vi.fn(async (params, opts) => { calls.push({ method: m, params, opts }); return { generatedText: 'ok' }; });
    }
    return { action, calls };
  });
}

describe('workflow AI node provider routing', () => {
  it('the duplicated switches are gone', () => {
    // Neither handler may carry its own provider ladder again.
    expect(SRC).not.toMatch(/switch \(provider\) \{[\s\S]{0,200}case 'anthropic':/);
    expect(SRC).toMatch(/static PROVIDER_ROUTES = \{/);
    expect((SRC.match(/routeToProvider\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('every catalogued provider resolves to a generator', async () => {
    const { action, calls } = await stubbed();
    const unroutable = [];
    for (const key of getAllProviderKeys()) {
      calls.length = 0;
      try {
        await action.routeToProvider({ provider: key }, { prompt: 'x' });
        if (!calls.length) unroutable.push(key);
      } catch (e) {
        unroutable.push(`${key} (${e.message})`);
      }
    }
    expect(unroutable, 'every provider must reach a generator').toEqual([]);
  });

  it('text and vision route IDENTICALLY for every provider', async () => {
    // The property the two switches could not guarantee. A provider supported
    // for text but missing from the vision ladder produced a runtime
    // "Unsupported provider for vision" that no test would have caught.
    const { action, calls } = await stubbed();
    const mismatches = [];
    for (const key of getAllProviderKeys()) {
      calls.length = 0;
      await action.routeToProvider({ provider: key }, { prompt: 'x' }, 'text');
      const textMethod = calls[0]?.method;

      calls.length = 0;
      await action.routeToProvider({ provider: key }, { prompt: 'x', image: 'img' }, 'vision');
      const visionMethod = calls[0]?.method;

      if (textMethod !== visionMethod) mismatches.push(`${key}: ${textMethod} vs ${visionMethod}`);
    }
    expect(mismatches, 'text and vision must agree').toEqual([]);
  });

  it('routes the special-cased providers exactly as before', async () => {
    const { action, calls } = await stubbed();
    const routeOf = async (provider) => {
      calls.length = 0;
      await action.routeToProvider({ provider }, { prompt: 'x' });
      return calls[0];
    };

    expect((await routeOf('anthropic')).method).toBe('generateWithAnthropic');
    expect((await routeOf('claude-code')).method).toBe('generateWithAnthropic');
    expect((await routeOf('openai-codex')).method).toBe('generateWithCodex');
    expect((await routeOf('kimi-code')).method).toBe('generateWithKimiCode');
    expect((await routeOf('chutes')).method).toBe('generateWithChutes');
    expect((await routeOf('gemini-cli')).method).toBe('generateWithGoogleGateway');
    expect((await routeOf('antigravity')).method).toBe('generateWithGoogleGateway');

    // The managed CLI transports keep their explicit provider + default model.
    const grokBuild = await routeOf('grok-build');
    expect(grokBuild.method).toBe('generateWithManagedOpenAiLike');
    expect(grokBuild.opts).toEqual({ provider: 'grok-build', defaultModel: 'grok-4.5' });

    const cursor = await routeOf('cursor-cli');
    expect(cursor.method).toBe('generateWithManagedOpenAiLike');
    expect(cursor.opts).toEqual({ provider: 'cursor-cli', defaultModel: 'cursor-grok-4.5-high' });
  });

  it('the OpenAI-compatible default still serves the providers it used to', async () => {
    const { action, calls } = await stubbed();
    for (const key of ['cerebras', 'deepseek', 'gemini', 'grokai', 'groq', 'kimi', 'local', 'minimax', 'openai', 'openrouter', 'togetherai', 'zai']) {
      calls.length = 0;
      await action.routeToProvider({ provider: key }, { prompt: 'x' });
      expect(calls[0]?.method, `${key} must use the OpenAI-compatible generator`).toBe('generateWithOpenAiLike');
    }
  });

  it('an absent provider is rejected rather than silently defaulted', async () => {
    const { action } = await stubbed();
    await expect(action.routeToProvider({ provider: '' }, { prompt: 'x' })).rejects.toThrow(/Unsupported provider/);
    await expect(action.routeToProvider({}, { prompt: 'x' }, 'vision')).rejects.toThrow(/vision/);
  });

  it('forwards the mode overrides to the generator', async () => {
    const { action, calls } = await stubbed();
    await action.routeToProvider({ provider: 'groq', model: 'm' }, { prompt: 'P', image: 'I' });
    expect(calls[0].params).toMatchObject({ provider: 'groq', model: 'm', prompt: 'P', image: 'I' });
  });
});
