import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Capture what reaches the OpenAI SDK.
 *
 * Mocked at the MODULE boundary rather than by spying on the prototype: in
 * this SDK version `images` is an instance property assigned in the
 * constructor, not a prototype getter, so vi.spyOn has nothing to intercept.
 * Stubbing the class is also the stronger test — it proves the request the
 * method actually builds, rather than trusting a patched method.
 */
const sdkCalls = [];
vi.mock('openai/index.mjs', () => {
  class FakeOpenAI {
    constructor(opts) {
      this.opts = opts;
      this.images = {
        generate: async (req) => {
          sdkCalls.push({ kind: 'generate', ...req, baseURL: opts?.baseURL });
          return { data: [{ b64_json: 'AAAA', revised_prompt: null }] };
        },
        edit: async (req) => {
          sdkCalls.push({ kind: 'edit', ...req, baseURL: opts?.baseURL });
          return { data: [{ b64_json: 'AAAA' }] };
        },
      };
      this.chat = { completions: { create: async () => ({ choices: [{ message: { content: '' } }] }) } };
    }
  }
  return { default: FakeOpenAI, OpenAI: FakeOpenAI };
});
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as ProviderRegistry from '../../../services/ai/ProviderRegistry.js';
import { getProvidersWithCapability, getProviderConfig, buildBaseURLs } from '../../../services/ai/providerConfigs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, 'generate-with-ai-llm.js'), 'utf8');
/** Comments legitimately cite the stale values they replaced. */
const CODE_ONLY = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/**
 * IMAGE GENERATION AND VISION READ THE REGISTRY, NOT A PRIVATE COPY.
 *
 * This file used to carry a 150-line PROVIDER_CONFIG table duplicating
 * services/ai/providerConfigs.js — baseURLs, default models, vision flags and
 * image-model lists for twenty providers. It had drifted, and every image and
 * vision defect found in the audit descended from it:
 *
 *   - grok image generation hardcoded 'grok-2-image' and IGNORED params.model,
 *     while the orchestrator validated the user's choice against the live list
 *     and accepted it — validation the implementation then discarded;
 *   - the gemini image default named 'gemini-2.0-flash-exp', delisted;
 *   - 6 stale text defaults, 4 wrong capability flags, 2 providers missing;
 *   - analyze_image blocked cerebras/chutes and allowed deepseek/minimax/local.
 *
 * The lesson from the seven stale defaults in StreamEngine applies unchanged:
 * a hand-maintained provider table is wrong the moment a vendor ships, and
 * nobody diffs it. These tests pin the derivation, not the values.
 */

describe('the private provider table is gone', () => {
  it('PROVIDER_CONFIG no longer exists', () => {
    expect(CODE_ONLY).not.toMatch(/const PROVIDER_CONFIG\s*=/);
    expect(CODE_ONLY).not.toContain('PROVIDER_CONFIG[');
  });

  it('no stale model literals survive in code', () => {
    for (const dead of ['grok-2-image', 'gemini-2.0-flash-exp', 'mixtral-8x7b-32768', 'grok-beta', 'GLM-4.7', 'openai/gpt-3.5-turbo']) {
      expect(CODE_ONLY, `${dead} is a delisted model id`).not.toContain(dead);
    }
  });

  it('no hardcoded provider base URLs survive in code', () => {
    // The x.ai literal in generateImageWithGrok was the twelfth copy.
    expect(CODE_ONLY).not.toMatch(/baseURL:\s*'https?:\/\//);
  });

  it('ANTI-VACUITY: the file still resolves base URLs and defaults somehow', () => {
    // A "fix" that deleted the lookups entirely would satisfy everything above.
    expect(CODE_ONLY).toContain('buildBaseURLs()');
    expect(CODE_ONLY).toMatch(/function providerDefaultModel\(/);
    expect(CODE_ONLY).toMatch(/function imageDefaultModel\(/);
  });
});

describe('image generation routes match the registry exactly', () => {
  let Cls;
  beforeAll(async () => {
    const mod = await import('./generate-with-ai-llm.js');
    Cls = Object.getPrototypeOf(mod.default).constructor;
  });

  it('every registry image provider has an implementation', () => {
    const registry = ProviderRegistry.getImageGenProviders().map((p) => p.provider).sort();
    const implemented = Object.keys(Cls.IMAGE_ROUTES).sort();
    // Both directions matter. A registry provider with no implementation
    // throws "not implemented" at whoever picked it in the UI; an
    // implementation the registry denies is dead code that validation blocks.
    expect(implemented).toEqual(registry);
  });

  it('every route names a method that exists', async () => {
    const mod = await import('./generate-with-ai-llm.js');
    for (const [provider, method] of Object.entries(Cls.IMAGE_ROUTES)) {
      expect(typeof mod.default[method], `${provider} -> ${method}`).toBe('function');
    }
  });

  it('ANTI-VACUITY: there is at least one image provider to check', () => {
    expect(Object.keys(Cls.IMAGE_ROUTES).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the requested image model is honoured', () => {
  async function callGrok(requested) {
    sdkCalls.length = 0;
    const mod = await import('./generate-with-ai-llm.js');
    await mod.default.generateImageWithGrok({ apiKey: 'k', imagePrompt: 'a cat', model: requested });
    return sdkCalls[0];
  }

  it('sends the caller-supplied model verbatim', async () => {
    // The defect: this used to send 'grok-2-image' no matter what was asked,
    // while the orchestrator validated the user's choice and accepted it.
    expect((await callGrok('grok-imagine-image')).model).toBe('grok-imagine-image');
  });

  it('falls back to the REGISTRY default, not a literal', async () => {
    const expected = ProviderRegistry.getImageGenCapabilities('grokai')?.defaultModel;
    expect(expected).toBeTruthy();
    expect(expected).not.toBe('grok-2-image');
    expect((await callGrok(undefined)).model).toBe(expected);
  });

  it('reports the model it actually used in imageMetadata', async () => {
    // The metadata block echoed the hardcoded id too, so even the receipt was
    // wrong — a user checking which model ran was told grok-2-image regardless.
    const mod = await import('./generate-with-ai-llm.js');
    const out = await mod.default.generateImageWithGrok({ apiKey: 'k', imagePrompt: 'x', model: 'grok-imagine-image' });
    expect(out.imageMetadata.model).toBe('grok-imagine-image');
  });

  it('uses the registry base URL, not a hardcoded x.ai literal', async () => {
    const { buildBaseURLs: b } = await import('../../../services/ai/providerConfigs.js');
    expect((await callGrok('grok-imagine-image')).baseURL).toBe(b().grokai);
  });
});

describe('vision support is a registry question', () => {
  it('the capability list includes providers the old hardcoded array blocked', () => {
    const keys = getProvidersWithCapability('vision').map((p) => p.key);
    // Both declare vision and were refused outright by the old array.
    expect(keys).toContain('cerebras');
    expect(keys).toContain('chutes');
  });

  it('and excludes providers it wrongly allowed', () => {
    const keys = getProvidersWithCapability('vision').map((p) => p.key);
    // These were sent images and failed at the provider API instead.
    for (const p of ['deepseek', 'minimax', 'local']) {
      expect(keys, `${p} does not declare vision`).not.toContain(p);
    }
  });
});

describe('base URLs come from the same map LlmService uses', () => {
  it('buildBaseURLs covers every provider the node can reach over HTTP', () => {
    const urls = buildBaseURLs();
    // `local` has no registry entry of its own; buildBaseURLs supplies it, and
    // that is exactly why the node uses this helper rather than
    // getProviderConfig().baseURL.
    expect(urls.local).toBeTruthy();
    for (const key of ['groq', 'grokai', 'openrouter', 'togetherai', 'cerebras', 'kimi', 'zai', 'minimax', 'deepseek']) {
      expect(urls[key], `${key} must have a base URL`).toBeTruthy();
    }
  });

  it('the registry agrees with itself on grok', () => {
    expect(buildBaseURLs().grokai).toBe(getProviderConfig('grokai').baseURL);
  });
});
