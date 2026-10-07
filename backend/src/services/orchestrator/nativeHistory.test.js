import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toOpenAIHistory, isAnthropicNativeMessage } from './nativeHistory.js';
import { OpenAIResponsesAdapter, createLlmAdapter } from './llmAdapters.js';
import { BaseAdapter } from './transports/BaseAdapter.js';
import { TOOL_LOAD_FIELD } from './deferredTools.js';

const SYSTEM = { role: 'system', content: 'You are Annie.' };

/** A Claude turn exactly as the ledger / stored transcript holds it. */
function anthropicLedger() {
  return [
    SYSTEM,
    { role: 'user', content: 'find the bug' },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'SIG-1' },
      { type: 'text', text: 'Reading the file first.' },
      { type: 'tool_use', id: 'toolu_A', name: 'read_file', input: { path: 'src/a.js' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'const a = 1;' }] },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'SIG-2' },
      { type: 'tool_use', id: 'toolu_B', name: 'grep_files', input: { pattern: 'bug' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_B', content: 'src/a.js:3: bug' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Line 3 is the bug.' }] },
    { role: 'user', content: 'now fix it' },
  ];
}

/** What the Codex transport puts on the wire for this ledger (pure transform). */
const codexWire = (messages) => new OpenAIResponsesAdapter({}, 'gpt-6-astra', { provider: 'openai-codex' })
  ._transformMessagesToInput(BaseAdapter._sanitizeOutboundAsOpenAI(messages, 'codex-responses')).input;

/**
 * The bytes the REAL failover path hands the ChatGPT backend: the Codex
 * adapter's own callStream, exactly as runTierStream invokes it, with a client
 * that captures the request instead of sending it.
 */
async function codexRequestFor(messages) {
  const seen = [];
  const client = { responses: { create: async (params) => {
    seen.push(params);
    return { async *[Symbol.asyncIterator]() {
      yield { type: 'response.completed', response: { id: 'resp_1', output: [], usage: { input_tokens: 1, output_tokens: 1 } } };
    } };
  } } };
  const adapter = await createLlmAdapter('openai-codex', client, 'gpt-6-astra');
  await adapter.callStream(messages, [], () => {}, {});
  expect(seen).toHaveLength(1);
  return seen[0].input;
}

describe('Claude Code → Codex failover (the 400 "input[0].content[0].text: expected a string")', { timeout: 30000 }, () => {
  it('the request callStream sends carries only string text parts', async () => {
    const input = await codexRequestFor(anthropicLedger());
    const parts = input.filter((item) => item.type === 'message').flatMap((item) => item.content);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      if (part.type === 'input_text' || part.type === 'output_text') expect(typeof part.text).toBe('string');
    }
    expect(input.filter((item) => item.type === 'function_call').map((c) => c.call_id)).toEqual(['toolu_A', 'toolu_B']);
    expect(input.filter((item) => item.type === 'function_call_output').map((o) => o.call_id)).toEqual(['toolu_A', 'toolu_B']);
  });

  it('every Responses text part is a string', () => {
    const input = codexWire(anthropicLedger());
    const parts = input.filter((item) => item.type === 'message').flatMap((item) => item.content);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      if (part.type === 'input_text' || part.type === 'output_text') expect(typeof part.text).toBe('string');
    }
  });

  it('native tool rounds become paired function_call / function_call_output items', () => {
    const input = codexWire(anthropicLedger());
    const calls = input.filter((item) => item.type === 'function_call');
    const outputs = input.filter((item) => item.type === 'function_call_output');
    expect(calls.map((c) => [c.call_id, c.name, JSON.parse(c.arguments)])).toEqual([
      ['toolu_A', 'read_file', { path: 'src/a.js' }],
      ['toolu_B', 'grep_files', { pattern: 'bug' }],
    ]);
    expect(outputs.map((o) => [o.call_id, o.output])).toEqual([
      ['toolu_A', 'const a = 1;'],
      ['toolu_B', 'src/a.js:3: bug'],
    ]);
  });

  it('Anthropic thinking signatures never reach another provider', () => {
    expect(JSON.stringify(codexWire(anthropicLedger()))).not.toMatch(/SIG-|thinking/);
  });

  it('the conversation text survives in order', () => {
    const texts = codexWire(anthropicLedger()).filter((i) => i.type === 'message').map((i) => i.content[0].text);
    expect(texts).toEqual(['find the bug', 'Reading the file first.', 'Line 3 is the bug.', 'now fix it']);
  });
});

describe('toOpenAIHistory', () => {
  it('returns the SAME array when nothing is native (no allocation, cache bytes untouched)', () => {
    const ledger = [SYSTEM, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' },
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] }];
    expect(toOpenAIHistory(ledger)).toBe(ledger);
  });

  it('never mutates the live ledger', () => {
    const ledger = anthropicLedger();
    const before = structuredClone(ledger);
    toOpenAIHistory(ledger);
    expect(ledger).toEqual(before);
  });

  it('is idempotent', () => {
    const once = toOpenAIHistory(anthropicLedger());
    expect(toOpenAIHistory(once)).toBe(once);
  });

  it('drops a thinking-only assistant turn (nothing the target can carry)', () => {
    const out = toOpenAIHistory([{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 'S' }] }]);
    expect(out).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('splits a merged user turn into tool results followed by the follow-up text', () => {
    const out = toOpenAIHistory([{ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] },
      { type: 'text', text: 'also do this' },
    ] }]);
    expect(out).toEqual([
      { role: 'tool', tool_call_id: 't1', content: 'one\ntwo' },
      { role: 'user', content: 'also do this' },
    ]);
  });

  it('keeps the deferred-tool load record on the translated tool message', () => {
    const load = { schemas: [{ name: 'x' }] };
    const out = toOpenAIHistory([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', [TOOL_LOAD_FIELD]: load }] }]);
    expect(out[0][TOOL_LOAD_FIELD]).toBe(load);
  });

  it('carries Anthropic images as OpenAI image_url parts, which Responses sends as input_image', () => {
    const native = { role: 'user', content: [
      { type: 'text', text: 'what is this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ] };
    expect(isAnthropicNativeMessage(native)).toBe(true);
    const input = codexWire([native]);
    expect(input[0].content).toEqual([
      { type: 'input_text', text: 'what is this' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    ]);
  });
});

describe('every OpenAI-shaped transport translates at its outbound choke point', () => {
  const transports = ['openaiResponses.js', 'chatCompletions.js', 'gemini.js'];
  it.each(transports)('%s never calls the untranslated _sanitizeOutbound', (file) => {
    const source = readFileSync(fileURLToPath(new URL(`./transports/${file}`, import.meta.url)), 'utf8');
    expect(source).toMatch(/BaseAdapter\._sanitizeOutboundAsOpenAI\(/);
    expect(source).not.toMatch(/BaseAdapter\._sanitizeOutbound\(/);
  });
});
