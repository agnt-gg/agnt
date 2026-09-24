// The REAL discover_tools handler, in both conversation modes.
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true'; });
vi.mock('node-fetch', () => ({ default: vi.fn(() => { throw new Error('Unexpected network call'); }) }));

import { TOOLS } from './tools.js';
import { TOOL_GROUPS } from './toolSelector.js';
import { TOOL_REFS_KEY } from './deferredTools.js';

const discover = (args, context) => TOOLS.discover_tools.execute(args, 'Bearer test', context);
const fn = (name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object' } } });
const [category, members] = Object.entries(TOOL_GROUPS).find(([, names]) => names.length >= 2);

describe('discover_tools load', () => {
  it('deferred: reports catalog members to load, and never queues a change to the tool array', async () => {
    const catalog = [fn(members[0]), fn('unrelated_tool')];
    const context = { _deferredToolCatalog: catalog, _requestedToolCategories: new Set(['stale']) };
    const out = JSON.parse(await discover({ operation: 'load', categories: [category] }, context));
    expect(out.success).toBe(true);
    expect(out[TOOL_REFS_KEY]).toEqual([members[0]]);
    expect(out.tool_count).toBe(1);
    expect(out.message).toMatch(/available now/);
    expect([...context._requestedToolCategories]).toEqual([]);
  });

  it('deferred: members already resident are reported as available, not re-loaded', async () => {
    const context = { _deferredToolCatalog: [fn('unrelated_tool')] };
    const out = JSON.parse(await discover({ operation: 'load', categories: [category] }, context));
    expect(out[TOOL_REFS_KEY]).toEqual([]);
    expect(out.message).toMatch(/already available/);
  });

  it('deferred: the channel ceiling still bounds what can be loaded', async () => {
    const context = { _deferredToolCatalog: members.map(fn), _toolCeiling: new Set([members[1]]) };
    const out = JSON.parse(await discover({ operation: 'load', categories: [category] }, context));
    expect(out[TOOL_REFS_KEY]).toEqual([members[1]]);
  });

  it('legacy: unchanged, queues the category and reports nothing to reference', async () => {
    const context = {};
    const out = JSON.parse(await discover({ operation: 'load', categories: [category] }, context));
    expect(out[TOOL_REFS_KEY]).toBeUndefined();
    expect(context._requestedToolCategories.has(category)).toBe(true);
    expect(out.message).toMatch(/next response/);
  });
});
