import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * WHAT THE WORKFLOW AI NODE RECORDS IS WHAT THE PROVIDER BILLED.
 *
 * Anthropic reports usage.input_tokens as the UNCACHED remainder only; cache
 * reads and writes arrive in their own fields. The node read input_tokens
 * alone, so a ~80k-token claude-code prompt whose prefix was cache-written was
 * recorded — and priced — as 4 input tokens.
 *
 * The ledger (normalizeUsage -> getModelCost) wants the TRUE total plus the
 * cache breakdown, and derives the uncached part by subtraction. Both halves
 * must arrive, under the ledger's own field names, which is why every
 * assertion below goes through the REAL normalizeUsage: a misspelled key would
 * otherwise pass here and price as zero there.
 */

let chainFor = () => [];
vi.mock('../../../services/ai/ModelRouter.js', () => ({
  resolveChain: async () => ({ chain: chainFor() }),
}));

const recorded = [];
vi.mock('../../../services/execution/LedgerRecorder.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLlmCall: async (row) => { recorded.push(row); return 'row'; },
}));

let providerUsage;
const adapterCalls = [];
vi.mock('../../../services/ai/LlmService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createLlmClient: async () => ({}),
}));
vi.mock('../../../services/orchestrator/llmAdapters.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createLlmAdapter: async (provider, client, model) => ({
    call: async (messages) => {
      adapterCalls.push({ provider, model, messages });
      return {
        responseMessage: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        toolCalls: [],
        usage: providerUsage,
      };
    },
  }),
}));

const { default: singleton } = await import('./generate-with-ai-llm.js');
const { normalizeUsage } = await import('../../../services/execution/LedgerRecorder.js');
const { providerHealth } = await import('../../../services/ai/providerHealth.js');

const engine = { userId: 'u1', currentExecutionId: 'exec-1' };

async function run(provider, model, usage, extraParams = {}) {
  chainFor = () => [{ provider, model, source: 'pinned', tier: 0, primary: true }];
  providerUsage = usage;
  const node = Object.create(singleton);
  node.resolveCredential = vi.fn(async () => 'token');
  return node.execute({ provider, model, prompt: 'hi', ...extraParams }, {}, engine);
}

const ledgerSaw = () => normalizeUsage(recorded[0].usage);

beforeEach(() => {
  recorded.length = 0;
  adapterCalls.length = 0;
  providerHealth.reset();
});

describe('workflow AI node — usage reaches the ledger as billed', () => {
  it('claude-code: cache-written tokens count as input (an 80k prompt is not recorded as 4)', async () => {
    const out = await run('claude-code', 'claude-haiku-5-5', {
      input_tokens: 4, cache_creation_input_tokens: 80000, cache_read_input_tokens: 0, output_tokens: 229,
    });

    expect(out.error ?? null).toBeNull();
    expect(out).toMatchObject({ inputTokens: 80004, outputTokens: 229, tokenCount: 80233 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ provider: 'claude-code', model: 'claude-haiku-5-5', status: 'ok' });
    expect(ledgerSaw()).toEqual({
      inputTokens: 80004, outputTokens: 229, cacheReadTokens: 0, cacheCreation5mTokens: 80000, cacheCreation1hTokens: 0,
    });
  });

  it('anthropic: cache reads and the 5m/1h write split each keep their own bucket', async () => {
    await run('anthropic', 'claude-sonnet-4-5-20250929', {
      input_tokens: 10,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
      output_tokens: 7,
    });

    expect(ledgerSaw()).toEqual({
      inputTokens: 5310, outputTokens: 7, cacheReadTokens: 5000, cacheCreation5mTokens: 100, cacheCreation1hTokens: 200,
    });
  });

  it('vision carries the same breakdown as text', async () => {
    await run('claude-code', 'claude-haiku-5-5', { input_tokens: 300, cache_read_input_tokens: 1200, output_tokens: 40 }, {
      mode: 'Vision (Image → Text)',
      visionPrompt: 'what is this',
      visionImage: 'data:image/png;base64,iVBORw0KGgo=',
    });

    expect(adapterCalls[0].messages[0].content.some((block) => block.type === 'image')).toBe(true);
    expect(ledgerSaw()).toMatchObject({ inputTokens: 1500, outputTokens: 40, cacheReadTokens: 1200 });
  });

  it('OpenAI-shaped usage: cached tokens are a SUBSET of the total, never added to it', async () => {
    await run('openai-codex', 'gpt-5.5', {
      input_tokens: 1000, output_tokens: 20, input_tokens_details: { cached_tokens: 600 },
    });

    expect(ledgerSaw()).toEqual({
      inputTokens: 1000, outputTokens: 20, cacheReadTokens: 600, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
    });
  });

  it('a provider that reports no usage records zeros, never NaN', async () => {
    const out = await run('claude-code', 'claude-haiku-5-5', undefined);

    expect(out).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(ledgerSaw()).toEqual({
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
    });
  });
});
