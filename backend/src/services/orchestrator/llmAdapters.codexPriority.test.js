import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Do not import the adapter factory or OrchestratorService: their import graphs
// can initialize auth/database state. Cut off all side-effectful transport
// dependencies before loading the real adapter, BaseAdapter and reasoning code.
vi.mock('axios', () => ({ default: {} }));
vi.mock('../ai/CustomOpenAIProviderService.js', () => ({ default: {} }));
vi.mock('../ai/ProviderRegistry.js', () => ({ supportsVision: () => true }));
vi.mock('../ai/claudeBillingHeader.js', () => ({
  buildBillingHeaderBlock: () => '',
  extractFirstUserMessage: () => '',
}));

import { CodexResponsesAdapter, OpenAIResponsesAdapter } from './transports/openaiResponses.js';

const messages = [{ role: 'user', content: 'Synthetic priority test' }];
const cases = [
  ['absent', undefined, false],
  ['boolean true', true, true],
  ['multipart true', 'true', true],
  ['boolean false', false, false],
  ['multipart false', 'false', false],
  ['null', null, false],
  ['empty string', '', false],
  ['number one', 1, false],
  ['string one', '1', false],
  ['uppercase true', 'TRUE', false],
  ['padded true', ' true ', false],
  ['object', {}, false],
  ['array', ['true'], false],
];

function mockClient() {
  return {
    responses: {
      create: vi.fn(async () => (async function* () {
        yield { type: 'response.output_text.delta', delta: 'Synthetic reply' };
        yield { type: 'response.completed', response: { id: 'synthetic-response', output: [] } };
      })()),
    },
  };
}

for (const method of ['call', 'callStream']) {
  describe(`Codex priority ${method}`, () => {
    it.each(cases)('%s is strictly opt-in and leaves max reasoning unchanged', async (_label, value, enabled) => {
      const client = mockClient();
      const options = { reasoningValue: 'max' };
      if (value !== undefined) options.codexPriority = value;
      const adapter = new CodexResponsesAdapter(client, 'gpt-6-astra', options);
      const baseline = new CodexResponsesAdapter({}, 'gpt-6-astra', { reasoningValue: 'max' })
        ._buildCodexParams(messages, []);
      const chunks = [];
      const result = method === 'call'
        ? await adapter.call(messages, [])
        : await adapter.callStream(messages, [], (chunk) => chunks.push(chunk));

      expect(adapter.codexPriority).toBe(enabled);
      expect(client.responses.create).toHaveBeenCalledTimes(1);
      const params = client.responses.create.mock.calls[0][0];
      expect(params).toEqual(enabled ? { ...baseline, service_tier: 'priority' } : baseline);
      if (!enabled) expect(params).not.toHaveProperty('service_tier');
      expect(params.stream).toBe(true); // Even call() must stream on the wire.
      expect(params.reasoning).toEqual({ effort: 'max', summary: 'auto' });
      expect(params).not.toHaveProperty('prompt_cache_options');
      expect(params).not.toHaveProperty('prompt_cache_retention');
      expect(result.responseMessage.content).toBe('Synthetic reply');
      expect(result.recoveredFromError).toBeUndefined();
      if (method === 'callStream') expect(chunks).toContainEqual({
        type: 'content', delta: 'Synthetic reply', accumulated: 'Synthetic reply',
      });
    });
  });
}

it('priority does not change default reasoning or configure the public OpenAI adapter', () => {
  for (const codexPriority of [false, true]) {
    const adapter = new CodexResponsesAdapter({}, 'gpt-6-astra', { codexPriority });
    expect(adapter._buildCodexParams(messages, []).reasoning).toEqual({ effort: 'medium', summary: 'auto' });
  }
  expect(new OpenAIResponsesAdapter({}, 'gpt-6-astra', { codexPriority: true }))
    .not.toHaveProperty('codexPriority');
});

it('wires strict request normalization into both primary and fallback adapter creation (source contract)', () => {
  // Read source only: executing this handler would pull in app/auth state.
  const source = readFileSync(new URL('../OrchestratorService.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('async function universalChatHandler('));
  expect(handler).toContain('codexPriority: rawCodexPriority,');
  expect(handler).toContain("const codexPriority = rawCodexPriority === true || rawCodexPriority === 'true';");
  const calls = [...handler.matchAll(/createLlmAdapter\(normalizedProvider, client, model, \{([^}]+)\}\)/g)];
  expect(calls).toHaveLength(2);
  for (const [, options] of calls) {
    expect(options.split(',').map((key) => key.trim()))
      .toEqual(['reasoningEnabled', 'reasoningValue', 'codexPriority', 'conversationId']);
  }
});
