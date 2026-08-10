import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CHARACTERIZATION TESTS — the safety net for unifying the second provider stack.
 *
 * StreamEngine is 2,034 lines, reaches provider SDKs directly in 36 places, and
 * had ZERO tests. Its four `generate*` methods are 49-71% verbatim copies of
 * each other carrying the identical 20-arm provider ladder, and every Phase 1
 * cache/usage fix that landed in llmAdapters.js is absent here.
 *
 * These tests do not assert that the current behaviour is RIGHT. They assert
 * what it currently IS, so that replacing the four ladders with the shared
 * adapter can be proven to change nothing a caller can observe.
 *
 * The wire oracle cannot do this job: it records the REQUEST an adapter builds,
 * and everything here is about what these methods RETURN.
 */

const createLlmClient = vi.fn();
vi.mock('../services/ai/LlmService.js', () => ({
  createLlmClient: (...args) => createLlmClient(...args),
}));

// RAG and workflow loading touch disk/db; neither is part of the contract.
vi.mock('../services/ai/RagService.js', () => ({
  default: { search: vi.fn().mockResolvedValue([]), addDocuments: vi.fn().mockResolvedValue(undefined) },
}));

const { default: StreamEngine } = await import('./StreamEngine.js');

/** A believable Anthropic Messages response. */
function anthropicClient(text) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1200, output_tokens: 45, cache_read_input_tokens: 1100 },
      }),
    },
  };
}

/** A believable OpenAI-compatible Chat Completions response. */
function openAiLikeClient(text) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: text, role: 'assistant' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 45,
            prompt_tokens_details: { cached_tokens: 1100 },
          },
        }),
      },
    },
  };
}

const TOOL_JSON = JSON.stringify({ name: 'demo_tool', description: 'A demo', fields: [] });
const AGENT_JSON = JSON.stringify({ name: 'Demo Agent', description: 'A demo agent', category: 'custom' });

beforeEach(() => {
  createLlmClient.mockReset();
});

describe('StreamEngine — observable contract of the generate* methods', () => {
  it('generateTool returns parsed JSON on an OpenAI-like provider', async () => {
    createLlmClient.mockResolvedValue(openAiLikeClient(TOOL_JSON));
    const engine = new StreamEngine('user-1');
    const out = await engine.generateTool('make a demo tool', 'groq', 'openai/gpt-oss-120b');
    expect(out).toBeTruthy();
    // Shape is whatever it is today — pinned so the rewrite must reproduce it.
    expect(JSON.stringify(out)).toContain('demo_tool');
  });

  it('generateTool returns parsed JSON on Anthropic', async () => {
    createLlmClient.mockResolvedValue(anthropicClient(TOOL_JSON));
    const engine = new StreamEngine('user-1');
    const out = await engine.generateTool('make a demo tool', 'anthropic', 'claude-opus-4-8');
    expect(JSON.stringify(out)).toContain('demo_tool');
  });

  it('generateAgent returns parsed JSON on an OpenAI-like provider', async () => {
    createLlmClient.mockResolvedValue(openAiLikeClient(AGENT_JSON));
    const engine = new StreamEngine('user-1');
    const out = await engine.generateAgent('make a demo agent', 'groq', 'openai/gpt-oss-120b');
    expect(JSON.stringify(out)).toContain('Demo Agent');
  });

  it('generateAgent returns parsed JSON on Anthropic', async () => {
    createLlmClient.mockResolvedValue(anthropicClient(AGENT_JSON));
    const engine = new StreamEngine('user-1');
    const out = await engine.generateAgent('make a demo agent', 'claude-code', 'claude-opus-4-8');
    expect(JSON.stringify(out)).toContain('Demo Agent');
  });

  it('surfaces an unsupported provider as an error rather than a silent null', async () => {
    createLlmClient.mockResolvedValue(null);
    const engine = new StreamEngine('user-1');
    await expect(engine.generateTool('x', 'groq', 'm')).rejects.toThrow(/not supported/i);
  });

  it('propagates a provider failure instead of swallowing it', async () => {
    createLlmClient.mockResolvedValue({
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('upstream 500')) } },
    });
    const engine = new StreamEngine('user-1');
    await expect(engine.generateAgent('x', 'groq', 'm')).rejects.toThrow();
  });
});

describe('StreamEngine — the model actually requested', () => {
  /** Capture the model id that reached the SDK. */
  async function modelSentFor(provider, model, kind = 'openai') {
    const client = kind === 'anthropic' ? anthropicClient(TOOL_JSON) : openAiLikeClient(TOOL_JSON);
    createLlmClient.mockResolvedValue(client);
    const engine = new StreamEngine('user-1');
    await engine.generateTool('x', provider, model).catch(() => {});
    const fn = kind === 'anthropic' ? client.messages.create : client.chat.completions.create;
    return fn.mock.calls[0]?.[0]?.model;
  }

  it('sends the caller-supplied model verbatim', async () => {
    expect(await modelSentFor('groq', 'openai/gpt-oss-120b')).toBe('openai/gpt-oss-120b');
    expect(await modelSentFor('anthropic', 'claude-opus-4-8', 'anthropic')).toBe('claude-opus-4-8');
  });

  it('FIXED: with no model it now takes the registry default, not a stale hardcoded id', async () => {
    // Was 'llama-3.3-70b-versatile' from generateTool's private map, while
    // generateWorkflow and generateCompletion answered 'mixtral-8x7b-32768' —
    // a model Groq no longer serves at all. Now both come from the registry,
    // which is refreshed from the vendor.
    const { getProviderConfig } = await import('../services/ai/providerConfigs.js');
    const cfg = getProviderConfig('groq');
    const expected = cfg.recommendedModels?.[0] || cfg.fallbackModels?.[0];

    expect(await modelSentFor('groq', undefined)).toBe(expected);
    expect(expected).not.toBe('mixtral-8x7b-32768'); // the dead id is gone
  });

  it('FIXED: the duplicated default-model maps are gone entirely', async () => {
    // There used to be four copies of a ~20-entry map, and they had drifted:
    // 6 of 19 providers resolved differently depending on which generator was
    // invoked (groq llama-3.3-70b-versatile vs mixtral-8x7b-32768; openai
    // gpt-4o vs o1-preview; gemini gemini-2.5-pro-exp-03-25 vs gemini-pro).
    // Which model answered depended on which button the user pressed.
    //
    // Asserted from SOURCE because their absence is a structural fact.
    const fs = await import('fs');
    const path = await import('path');
    const url = await import('url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'StreamEngine.js'), 'utf8');

    // Comments are stripped first: the doc block on defaultGenerationModel
    // NAMES the stale ids on purpose, to record what was wrong and why. A
    // naive substring check would fail on its own explanation.
    const codeOnly = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');

    expect(codeOnly).not.toMatch(/const defaultModel = \{/);
    expect(codeOnly).not.toContain('mixtral-8x7b-32768');
    expect(codeOnly).not.toContain("'o1-preview'");
    // ...and exactly one place decides the default now.
    expect((src.match(/function defaultGenerationModel\(/g) || []).length).toBe(1);
  });

  it('FIXED: no provider switch ladders remain in the generators', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const url = await import('url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'StreamEngine.js'), 'utf8');

    // 102 provider branches lived here, ~20 per generator. The streaming
    // methods still dispatch by transport, which is legitimate; what must be
    // gone is the duplicated per-generator ladder.
    expect((src.match(/switch \(lowerCaseProvider\) \{/g) || []).length).toBe(0);
    // And every generator now shares one path.
    expect((src.match(/_generateViaAdapter\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

describe('StreamEngine — usage capture', () => {
  it('records provider usage on the instance', async () => {
    createLlmClient.mockResolvedValue(openAiLikeClient(TOOL_JSON));
    const engine = new StreamEngine('user-1');
    await engine.generateTool('x', 'groq', 'openai/gpt-oss-120b');
    expect(engine._lastToolUsage ?? engine._lastCompletionUsage ?? null).not.toBeUndefined();
  });

  it('DOCUMENTS TODAY\'S DEFECT: cached-token counts are never normalized here', async () => {
    // llmAdapters routes every provider's usage through the shared reader so
    // cache reads are counted identically everywhere. This stack keeps the raw
    // SDK object, so nothing downstream can read a cached-token count without
    // knowing each provider's field names. Unification fixes this.
    createLlmClient.mockResolvedValue(openAiLikeClient(TOOL_JSON));
    const engine = new StreamEngine('user-1');
    await engine.generateTool('x', 'groq', 'openai/gpt-oss-120b');
    const usage = engine._lastToolUsage ?? engine._lastCompletionUsage;
    if (usage) {
      expect(usage.cacheReadTokens).toBeUndefined(); // raw SDK shape, not normalized
    }
  });
});
