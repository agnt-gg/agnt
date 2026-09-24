import { describe, it, expect } from 'vitest';
import {
  anthropicSupportsDeferredTools, responsesSupportsDeferredTools, chooseToolLoadingMode, deferredToolsEnabled,
  buildDeferredCatalog, collectToolLoads, renderToolsForTransport, stripToolLoads, attachToolLoad,
  renderAnthropicToolLoads, isReferenceOnlyResult, prepareTierRequest, TOOL_LOAD_FIELD, TOOL_REFS_KEY, DEFERRED_MARK,
} from './deferredTools.js';
import { BaseAdapter } from './transports/BaseAdapter.js';

const fn = (name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object' } } });

describe('model gating (vendor model tables)', () => {
  it.each([
    ['claude-opus-5-5', true], ['claude-fable-5-1', true], ['claude-mythos-5', true], ['claude-opus-5', true],
    ['claude-opus-4-8', true], ['claude-sonnet-4-6', true], ['claude-opus-4-5-20251101', true],
    ['claude-haiku-4-5-20251001', true], ['claude-sonnet-4-5-20250929', true],
    ['claude-opus-4-1-20250805', false], ['claude-sonnet-4-20250514', false], ['claude-3-5-sonnet-20240620', false], ['', false],
  ])('anthropic %s -> %s', (model, expected) => expect(anthropicSupportsDeferredTools(model)).toBe(expected));

  it.each([
    ['gpt-6-astra', true], ['gpt-5.5', true], ['gpt-5.4-mini', true], ['gpt-5.10', true],
    ['gpt-5.2-codex', false], ['gpt-5-codex', false], ['gpt-4o', false], ['o3', false],
  ])('responses %s -> %s', (model, expected) => expect(responsesSupportsDeferredTools(model)).toBe(expected));

  it('mode follows the primary adapter, and the kill switch forces legacy', () => {
    const capable = { deferredToolStyle: () => 'anthropic' };
    expect(chooseToolLoadingMode(capable, {})).toBe('deferred');
    expect(chooseToolLoadingMode({ deferredToolStyle: () => null }, {})).toBe('legacy');
    expect(chooseToolLoadingMode(null, {})).toBe('legacy');
    expect(chooseToolLoadingMode(capable, { AGNT_DEFERRED_TOOLS: '0' })).toBe('legacy');
    expect(deferredToolsEnabled({})).toBe(true);
  });
});

describe('catalog', () => {
  it('excludes resident tools, dedupes, and sorts by name so registry order cannot move it', () => {
    const catalog = buildDeferredCatalog([fn('zeta'), fn('read_file'), fn('alpha'), fn('zeta')], new Set(['read_file']));
    expect(catalog.map((s) => s.function.name)).toEqual(['alpha', 'zeta']);
    const shuffled = buildDeferredCatalog([fn('alpha'), fn('zeta'), fn('read_file')], ['read_file']);
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(catalog));
  });
});

describe('attachToolLoad', () => {
  const catalog = [fn('get_weather'), fn('alpha')];
  const result = (payload) => ({ tool_call_id: 'c1', role: 'tool', name: 'discover_tools', content: JSON.stringify(payload) });

  it('moves the reported names out of the visible content into a frozen record', () => {
    const out = attachToolLoad(result({ success: true, message: 'Loaded', [TOOL_REFS_KEY]: ['get_weather', 'not_in_catalog'] }), catalog);
    expect(JSON.parse(out.content)).toEqual({ success: true, message: 'Loaded' });
    expect(out[TOOL_LOAD_FIELD].names).toEqual(['get_weather']);
    expect(out[TOOL_LOAD_FIELD].schemas).toEqual([fn('get_weather')]);
    expect(out[TOOL_LOAD_FIELD].schemas[0]).not.toBe(catalog[0]);
  });

  it('carries guidance text for transports that cannot put text beside references', () => {
    const out = attachToolLoad(result({ success: true, guidance: { images: 'Use IMAGE_REF.' }, [TOOL_REFS_KEY]: ['alpha'] }), catalog);
    expect(out[TOOL_LOAD_FIELD].guidance).toBe('Use IMAGE_REF.');
  });

  it('leaves every other result untouched, by reference', () => {
    for (const r of [
      { name: 'read_file', content: '{"_tool_refs":["x"]}' },
      { name: 'discover_tools', content: 'not json' },
      result({ success: true, categories: [] }),
    ]) expect(attachToolLoad(r, catalog)).toBe(r);
  });
});

describe('rendering per transport', () => {
  const resident = [fn('discover_tools'), fn('read_file')];
  const catalog = [fn('alpha'), fn('get_weather')];
  const load = { names: ['get_weather'], schemas: [fn('get_weather')] };
  const ledger = [{ role: 'user', content: 'hi' }, { role: 'tool', tool_call_id: 'c1', content: '{}', [TOOL_LOAD_FIELD]: load }];

  it('anthropic: resident then every catalog tool marked deferred', () => {
    const tools = renderToolsForTransport('anthropic', { resident, catalog, messages: ledger });
    expect(tools.map((t) => [t.function.name, Boolean(t[DEFERRED_MARK])])).toEqual([
      ['discover_tools', false], ['read_file', false], ['alpha', true], ['get_weather', true],
    ]);
  });

  it('responses: resident only; loads travel in history', () => {
    expect(renderToolsForTransport('responses', { resident, catalog, messages: ledger })).toBe(resident);
  });

  it('no mechanism: resident + loaded, in load order, never duplicating a resident tool', () => {
    const withDup = [...ledger, { role: 'tool', content: '{}', [TOOL_LOAD_FIELD]: { names: ['read_file'], schemas: [fn('read_file')] } }];
    expect(renderToolsForTransport(null, { resident, catalog, messages: withDup }).map((t) => t.function.name))
      .toEqual(['discover_tools', 'read_file', 'get_weather']);
  });

  it('collects loads from both ledger shapes', () => {
    const anthropicShaped = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{}', [TOOL_LOAD_FIELD]: load }] }];
    expect(collectToolLoads(anthropicShaped).map((s) => s.function.name)).toEqual(['get_weather']);
  });

  it('stripToolLoads returns the SAME array when there is nothing to strip', () => {
    const plain = [{ role: 'user', content: 'x' }];
    expect(stripToolLoads(plain)).toBe(plain);
    const stripped = stripToolLoads(ledger);
    expect(JSON.stringify(stripped)).not.toContain(TOOL_LOAD_FIELD);
    expect(ledger[1][TOOL_LOAD_FIELD]).toBe(load);
  });
});

describe('prepareTierRequest', () => {
  const tools = [fn('discover_tools')];
  const messages = [{ role: 'user', content: 'x' }];

  it('a legacy conversation passes through untouched, by reference', () => {
    const out = prepareTierRequest('anthropic', { tools, messages, catalog: null });
    expect(out.tools).toBe(tools);
    expect(out.messages).toBe(messages);
    expect(out.fingerprintTools).toBe(tools);
  });

  it('a deferred conversation fingerprints only the resident tools', () => {
    const out = prepareTierRequest('anthropic', { tools, messages, catalog: [fn('alpha')] });
    expect(out.tools.map((t) => t.function.name)).toEqual(['discover_tools', 'alpha']);
    expect(out.fingerprintTools.map((t) => t.function.name)).toEqual(['discover_tools']);
    expect(out.messages).toBe(messages);
  });
});

describe('renderAnthropicToolLoads', () => {
  const load = { names: ['get_weather', 'gone_tool'], schemas: [], guidance: 'Celsius only.' };
  const carrier = { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: '{}' }, { type: 'text', text: 'STEER' }], [TOOL_LOAD_FIELD]: load },
    { type: 'tool_result', tool_use_id: 'c2', content: 'other' },
  ] };

  it('references only the tools present in this request, then guidance and steer after ALL results', () => {
    const [out] = renderAnthropicToolLoads([carrier], new Set(['get_weather']));
    expect(out.content).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'tool_reference', tool_name: 'get_weather' }] },
      { type: 'tool_result', tool_use_id: 'c2', content: 'other' },
      { type: 'text', text: 'Guidance for the tools just loaded:\nCelsius only.' },
      { type: 'text', text: 'STEER' },
    ]);
    expect(carrier.content[0][TOOL_LOAD_FIELD]).toBe(load);
  });

  it('with no referable tool, keeps the plain result and drops only the private field', () => {
    const [out] = renderAnthropicToolLoads([carrier], null);
    expect(out.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'c1', content: carrier.content[0].content });
  });

  it('messages without loads pass through by reference', () => {
    const plain = { role: 'user', content: [{ type: 'text', text: 'x' }] };
    expect(renderAnthropicToolLoads([plain], new Set())[0]).toBe(plain);
  });
});

describe('fold guard', () => {
  it('never folds text into a reference-only result (the API rejects mixing)', () => {
    const msg = { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'tool_reference', tool_name: 'x' }] },
      { type: 'text', text: 'after' },
    ] };
    expect(isReferenceOnlyResult(msg.content[0])).toBe(true);
    expect(BaseAdapter._foldTextAfterToolResults([msg])[0]).toBe(msg);
  });

  it('still folds as before when no reference-only result is present', () => {
    const msg = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'r' }, { type: 'text', text: 'after' }] };
    const [out] = BaseAdapter._foldTextAfterToolResults([msg]);
    expect(out.content).toHaveLength(1);
  });
});
