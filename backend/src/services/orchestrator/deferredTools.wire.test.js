/**
 * Byte-level wire contract for deferred tool loading.
 *
 * Drives the REAL adapters (via createLlmAdapter, exactly as the orchestrator
 * builds them) through a four-request conversation that discovers a tool
 * mid-way, and captures the exact request each one would put on the wire.
 *
 * The cache contract being pinned, per provider:
 *   - the tool array is byte-identical on every request, discovery included;
 *   - the system block is byte-identical on every request;
 *   - every request's history is a byte-exact PREFIX of the next request's
 *     (cache_control markers excluded: they move by design and are not part
 *     of the provider's cache key);
 *   - no private `_agnt*` field ever reaches a wire.
 * Live counterparts (real cache reads) are in harness-audit/spike_transition.mjs.
 */
import { describe, it, expect } from 'vitest';
import { makeCaptureClient } from '../../../tests/provider-oracle/capture.js';
import { createLlmAdapter } from './llmAdapters.js';
import { foldBlocksIntoLastToolResult } from './turnContinuity.js';
import {
  buildDeferredCatalog, renderToolsForTransport, stripToolLoads, attachToolLoad, TOOL_REFS_KEY,
} from './deferredTools.js';

const fn = (name, description = `The ${name} tool.`) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
});
const RESIDENT = [fn('discover_tools'), fn('read_file')];
const CATALOG = buildDeferredCatalog([fn('zeta_tool'), fn('get_weather'), fn('read_file'), fn('alpha_tool')], new Set(['discover_tools', 'read_file']));
const SYSTEM = { role: 'system', content: 'You are Annie. Be precise.' };
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const discoverResult = () => ({
  tool_call_id: 'call_discover', role: 'tool', name: 'discover_tools',
  content: JSON.stringify({ success: true, message: 'Loaded 1 tools from categories: weather. They are available now.', [TOOL_REFS_KEY]: ['get_weather'] }),
});

const stripMarkers = (value) => JSON.parse(JSON.stringify(value, (k, v) => (k === 'cache_control' ? undefined : v)));
/**
 * Anthropic reads `content: "x"` and `content: [{type:'text', text:'x'}]` as the
 * same content, and the adapter writes the block form only while a message
 * holds the rolling cache marker. Compare in that canonical form.
 */
const canonicalAnthropic = (messages) => stripMarkers(messages).map((m) => (
  typeof m.content === 'string' ? { ...m, content: [{ type: 'text', text: m.content }] } : m
));
const CANONICAL = { anthropic: canonicalAnthropic, responses: stripMarkers };

async function capture(provider, model, messages) {
  const { client, captured } = makeCaptureClient();
  const adapter = await createLlmAdapter(provider, client, model, { conversationId: 'wire-test' });
  const style = adapter.deferredToolStyle();
  const tools = renderToolsForTransport(style, { resident: RESIDENT, catalog: CATALOG, messages });
  const wireMessages = style ? messages : stripToolLoads(messages);
  try {
    await adapter.callStream(structuredClone(wireMessages), structuredClone(tools), () => {}, {});
  } catch (error) {
    if (!String(error?.message).includes('__ORACLE_CAPTURE__')) throw error;
  }
  expect(captured.length).toBeGreaterThan(0);
  return { body: captured[0].params, style, adapter };
}

/**
 * An assistant turn that calls one tool, in the shape the adapter's own
 * response normalizer stores in the ledger: Anthropic keeps tool_use blocks,
 * everything else keeps OpenAI-style tool_calls.
 */
function toolTurn(adapter, id, name, args) {
  if (adapter.formatToolResults([{ tool_call_id: 'probe', role: 'tool', name: 'probe', content: '' }])[0].role === 'user') {
    return { role: 'assistant', content: [{ type: 'tool_use', id, name, input: args }] };
  }
  return { role: 'assistant', content: '', tool_calls: [call(id, name, args)] };
}

/** The ledger exactly as the orchestrator grows it, using the adapter's own formatToolResults. */
function conversation(adapter, { steer = false } = {}) {
  const r0 = [SYSTEM, { role: 'user', content: 'What is the weather in Paris?' }];
  const loaded = adapter.formatToolResults([attachToolLoad(discoverResult(), CATALOG)]);
  if (steer) {
    const last = loaded[loaded.length - 1];
    if (Array.isArray(last.content)) loaded[loaded.length - 1] = foldBlocksIntoLastToolResult(last, [{ type: 'text', text: '[USER STEER] use Celsius' }], { label: false });
  }
  const r1 = [...r0, toolTurn(adapter, 'call_discover', 'discover_tools', { categories: ['weather'] }), ...loaded];
  const r2 = [...r1, toolTurn(adapter, 'call_weather', 'get_weather', { value: 'Paris' }),
    ...adapter.formatToolResults([{ tool_call_id: 'call_weather', role: 'tool', name: 'get_weather', content: 'Paris: 18C, clear.' }])];
  const r3 = [...r2, { role: 'assistant', content: 'It is 18C and clear in Paris.' }, { role: 'user', content: 'Thanks. Is that warm?' }];
  return [r0, r1, r2, r3];
}

const HISTORY = { anthropic: (b) => b.messages, responses: (b) => b.input };
const SYSTEM_OF = { anthropic: (b) => b.system, responses: (b) => b.instructions };

const CAPABLE = [
  ['claude-code', 'claude-opus-5-5', 'anthropic'],
  ['anthropic', 'claude-sonnet-4-6', 'anthropic'],
  ['openai-codex', 'gpt-6-astra', 'responses'],
  ['openai', 'gpt-5.5', 'responses'],
];

describe.each(CAPABLE)('deferred tools on %s/%s', (provider, model, expectedStyle) => {
  async function run(options) {
    const { adapter, style } = await capture(provider, model, [SYSTEM, { role: 'user', content: 'x' }]);
    expect(style).toBe(expectedStyle);
    const bodies = [];
    for (const messages of conversation(adapter, options)) bodies.push((await capture(provider, model, messages)).body);
    return bodies;
  }

  it('keeps the tool array and system block byte-identical through a discovery', async () => {
    const bodies = await run();
    const tools = bodies.map((b) => JSON.stringify(b.tools));
    const system = bodies.map((b) => JSON.stringify(SYSTEM_OF[style()](b)));
    function style() { return expectedStyle; }
    expect(new Set(tools).size).toBe(1);
    expect(new Set(system).size).toBe(1);
  });

  it('makes every request a byte-exact prefix of the next', async () => {
    const bodies = await run();
    for (let k = 0; k + 1 < bodies.length; k += 1) {
      const before = CANONICAL[expectedStyle](HISTORY[expectedStyle](bodies[k]));
      const after = CANONICAL[expectedStyle](HISTORY[expectedStyle](bodies[k + 1]));
      expect(after.length).toBeGreaterThan(before.length);
      for (let i = 0; i < before.length; i += 1) {
        expect(JSON.stringify(after[i]), `request ${k + 1} item ${i}`).toBe(JSON.stringify(before[i]));
      }
    }
  });

  it('never puts a private field on the wire', async () => {
    for (const body of await run({ steer: true })) expect(JSON.stringify(body)).not.toMatch(/_agnt|_tool_refs/);
  });

  if (expectedStyle === 'anthropic') {
    it('defers the catalog, marks the last resident tool, and answers discovery with references only', async () => {
      const [, r1] = await run();
      expect(r1.tools.map((t) => [t.name, Boolean(t.defer_loading), Boolean(t.cache_control)])).toEqual([
        ['discover_tools', false, false], ['read_file', false, true],
        ['alpha_tool', true, false], ['get_weather', true, false], ['zeta_tool', true, false],
      ]);
      const results = r1.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result');
      expect(stripMarkers(results.at(-1).content)).toEqual([{ type: 'tool_reference', tool_name: 'get_weather' }]);
    });

    it('keeps a steer folded into a load: references stay pure, the steer follows as text', async () => {
      const [, r1] = await run({ steer: true });
      const carrier = stripMarkers(r1.messages.at(-1));
      expect(carrier.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'call_discover', content: [{ type: 'tool_reference', tool_name: 'get_weather' }] });
      expect(carrier.content.slice(1)).toEqual([{ type: 'text', text: '[USER STEER] use Celsius' }]);
    });
  } else {
    it('sends resident tools only and loads the definition right after the discovery output', async () => {
      const [, r1] = await run();
      expect(r1.tools.map((t) => t.name)).toEqual(['discover_tools', 'read_file']);
      const at = r1.input.findIndex((i) => i.type === 'function_call_output' && i.call_id === 'call_discover');
      expect(r1.input[at + 1]).toMatchObject({ type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'get_weather' }] });
      expect(JSON.parse(r1.input[at].output)).toEqual({ success: true, message: 'Loaded 1 tools from categories: weather. They are available now.' });
    });
  }
});

describe('a tier without a deferred mechanism (failover)', () => {
  it.each([
    ['anthropic', 'claude-3-5-sonnet-20240620'],
    ['openai-codex', 'gpt-5.2-codex'],
    ['groq', 'llama-3.3-70b-versatile'],
  ])('%s/%s gets resident + loaded tools and a clean history', async (provider, model) => {
    const { adapter, style } = await capture(provider, model, [SYSTEM, { role: 'user', content: 'x' }]);
    expect(style).toBeNull();
    const [, r1] = conversation(adapter);
    const { body } = await capture(provider, model, r1);
    const names = (body.tools || []).map((t) => t.name || t.function?.name);
    expect(names).toEqual(['discover_tools', 'read_file', 'get_weather']);
    expect(JSON.stringify(body)).not.toMatch(/_agnt|_tool_refs|defer_loading|tool_reference|additional_tools/);
  });
});

describe('legacy conversations are untouched', () => {
  it('no catalog, no loads: tools and history carry nothing deferred', async () => {
    const { client, captured } = makeCaptureClient();
    const adapter = await createLlmAdapter('claude-code', client, 'claude-opus-5-5', { conversationId: 'wire-test' });
    try { await adapter.callStream([SYSTEM, { role: 'user', content: 'x' }], structuredClone(RESIDENT), () => {}, {}); } catch { /* capture sentinel */ }
    const body = captured[0].params;
    expect(body.tools.map((t) => Object.keys(t).sort())).toEqual([
      ['description', 'input_schema', 'name'], ['cache_control', 'description', 'input_schema', 'name'],
    ]);
  });
});
