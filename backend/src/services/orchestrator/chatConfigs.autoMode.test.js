// "All tools" is a mode, not a list — auto-degrade + stable discovery
// ordering for getUnifiedToolSchemas.
//
// The frontend historically sent an enumerated whitelist covering the whole
// registry as the orchestrator default, which routed around the lazy
// discovery system and shipped every schema (~120k tokens) on every turn.
// These tests pin the fix: near-full whitelists degrade to discovery mode
// (with explicit opt-outs preserved as a deny-list), genuinely narrow
// whitelists stay strict, and the discovery surface grows append-only so
// each turn's tools array is an exact prefix-extension of the last (prompt
// cache stability).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));

import { getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { DEFAULT_TOOLS, TOOL_GROUPS, GROUP_TRIGGERS } from './toolSelector.js';

const schema = (name) => ({
  type: 'function',
  function: { name, description: `${name} description`, parameters: { type: 'object', properties: {} } },
});

// Registry: every DEFAULT tool + every grouped tool + 150 plugin-ish extras
// that live outside all groups (reachable only via discover_tools).
function buildRegistry() {
  const names = [];
  const seen = new Set();
  const push = (n) => {
    if (!seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  };
  for (const n of DEFAULT_TOOLS) push(n);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) push(n);
  for (let i = 0; i < 150; i++) push(`plugin_tool_${i}`);
  return names.map(schema);
}

const namesOf = (schemas) => schemas.map((s) => s.function?.name);
const getToolSchemas = (ctx) => getChatConfig('orchestrator').getToolSchemas(ctx);

// A message that matches ZERO keyword triggers (asserted below) and one that
// matches the media group.
const NEUTRAL_MSG = 'hello there';
const MEDIA_MSG = 'please generate an image of a sunset';

let registry;
beforeEach(() => {
  registry = buildRegistry();
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockResolvedValue(registry);
});

describe('trigger fixtures are what the tests assume', () => {
  it('NEUTRAL_MSG matches no group trigger; MEDIA_MSG matches media', () => {
    expect(Object.values(GROUP_TRIGGERS).every((p) => !p || !p.test(NEUTRAL_MSG))).toBe(true);
    expect(GROUP_TRIGGERS.media.test(MEDIA_MSG)).toBe(true);
  });
});

describe('auto-degrade of near-full whitelists', () => {
  it('no selection at all -> lean discovery surface, no plugin tools', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: null };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    expect(ns.has('discover_tools')).toBe(true);
    expect(ns.has('web_search')).toBe(true);
    expect(ns.has('plugin_tool_0')).toBe(false);
    expect(res.length).toBeLessThan(registry.length / 3);
  });

  it('a whitelist covering every tool degrades to the same lean discovery surface', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: new Set(namesOf(registry)) };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    expect(ns.has('discover_tools')).toBe(true);
    expect(ns.has('plugin_tool_0')).toBe(false);
    expect(res.length).toBeLessThan(registry.length / 3);
  });

  it('near-full whitelist degrades but explicit opt-outs stick, even for DEFAULT tools', async () => {
    const unchecked = ['web_search', 'plugin_tool_0'];
    const ctx = {
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(namesOf(registry).filter((n) => !unchecked.includes(n))),
    };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    // web_search is in DEFAULT_TOOLS — the deny-list must win over defaults.
    expect(ns.has('web_search')).toBe(false);
    expect(ns.has('plugin_tool_0')).toBe(false);
    expect(ns.has('discover_tools')).toBe(true);
    expect(res.length).toBeLessThan(registry.length / 3);
  });

  it('a genuinely narrow whitelist is honoured strictly (no degrade)', async () => {
    const ctx = {
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(['web_search', 'execute_javascript_code']),
    };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    expect(ns.has('web_search')).toBe(true);
    expect(ns.has('execute_javascript_code')).toBe(true);
    // Strict mode: discover_tools is neither whitelisted nor universal.
    expect(ns.has('discover_tools')).toBe(false);
    expect(ns.has('plugin_tool_1')).toBe(false);
  });

  it('an empty Set still means "zero tools" (universal primitives only)', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: new Set() };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    expect(ns.has('web_search')).toBe(false);
    expect(ns.has('discover_tools')).toBe(false);
    // mcp_client is a UNIVERSAL_TOOL and present in the registry.
    expect(ns.has('mcp_client')).toBe(true);
  });

  it('sidebar specialty fallback is untouched', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, widgetId: 'w1', enabledTools: null };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    expect(ns.has('edit_widget_code')).toBe(true);
    expect(ns.has('plugin_tool_2')).toBe(false);
  });
});

describe('append-only discovery ordering (prompt-cache prefix stability)', () => {
  it('a newly matched keyword group extends the tools array, never reorders it', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: null };
    const A = namesOf(await getToolSchemas(ctx));

    ctx.latestUserMessage = MEDIA_MSG;
    const B = namesOf(await getToolSchemas(ctx));

    expect(B.length).toBeGreaterThan(A.length);
    expect(B.slice(0, A.length)).toEqual(A); // exact prefix
    expect(B).toContain('generate_image');
    expect(ctx._toolOrder).toEqual(B);
  });

  it('registry reordering between turns does not reorder an established surface', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: null };
    await getToolSchemas(ctx);
    ctx.latestUserMessage = MEDIA_MSG;
    const B = namesOf(await getToolSchemas(ctx));

    // Simulate a registry that enumerates in a different order next turn
    // (plugin reload, nondeterministic map iteration, etc.).
    getAvailableToolSchemas.mockResolvedValue([...registry].reverse());
    ctx.latestUserMessage = NEUTRAL_MSG;
    const C = namesOf(await getToolSchemas(ctx));

    expect(C).toEqual(B);
  });

  it('auto-degraded whitelist rides the same stable ordering', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: new Set(namesOf(registry)) };
    const A = namesOf(await getToolSchemas(ctx));
    ctx.latestUserMessage = MEDIA_MSG;
    const B = namesOf(await getToolSchemas(ctx));
    expect(B.slice(0, A.length)).toEqual(A);
    expect(B).toContain('generate_image');
  });
});
