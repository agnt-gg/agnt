// enabledTools is a CEILING, not a manifest — cost-gated degrade + stable
// discovery ordering for getUnifiedToolSchemas.
//
// The frontend historically sent an enumerated whitelist covering the whole
// registry as the orchestrator default, which routed around the lazy
// discovery system and shipped every schema (~120k tokens) on every turn.
//
// The first fix keyed the degrade on COVERAGE (>=95% of the registry). That
// measured the wrong axis: measured live 2026-07-31 the real main chat sent a
// 138-name list at 42.5% coverage, sailed under the threshold, and was still
// honoured verbatim at 57,274 tokens/turn. A list is not curated because it
// omits half the registry — it is curated when it is SMALL. The degrade is
// now keyed on the COST of the permitted set.
//
// These tests pin the behaviour: expensive ceilings degrade to discovery mode
// (with everything outside the ceiling still excluded), genuinely narrow
// selections stay strict, and the discovery surface grows append-only so each
// turn's tools array is an exact prefix-extension of the last (prompt cache
// stability).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));

import { getChatConfig, WHITELIST_VERBATIM_BUDGET_TOKENS } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { DEFAULT_TOOLS, TOOL_GROUPS, GROUP_TRIGGERS } from './toolSelector.js';
import { ORCHESTRATOR_RESIDENT_GROUPS } from './system-prompts/promptElements.js';
import { estimateToolTokens } from '../../utils/contextManager.js';

// REALISTICALLY SIZED. The degrade rule is a COST rule, so a fixture whose
// schemas are an order of magnitude cheaper than production cannot exercise
// it — a whole synthetic registry would slip under the budget and take the
// verbatim path, passing the assertions below for entirely the wrong reason.
// Production schemas measure ~200-400 tokens each; these are ~200.
const FILLER = ('Performs the operation described by this tool. Accepts a target '
  + 'identifier and an options object, validates them against the current '
  + 'workspace state, and returns a structured result describing what changed. ')
  .repeat(3);

const schema = (name) => ({
  type: 'function',
  function: {
    name,
    description: `${name}: ${FILLER}`,
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'The identifier this call operates on.' },
        options: { type: 'object', description: 'Optional settings for this call.' },
      },
      required: ['target'],
    },
  },
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
  // The dynamic MCP category — the tail that is still gated now that every
  // STATIC group is resident. See ORCHESTRATOR_RESIDENT_GROUPS.
  for (let i = 0; i < 20; i++) push(`mcp__srv__tool_${i}`);
  return names.map(schema);
}

// What "lean" means now. Every static group is resident from turn 1, because
// trading resident tokens (billed at the cache-READ rate) for discoveries
// (which rewrite the prefix at the WRITE rate) was a net loss — measured at
// 48%/49%/26% cache hits on discovery turns vs 94.6% on a turn that loaded
// nothing. So the assertion is no longer "the surface is small", it is "the
// surface excludes the large gated tail": plugins and MCP.
const isGatedTail = (n) => /^plugin_tool_\d+$/.test(n) || n.startsWith('mcp__');

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

  // ANTI-VACUITY. Every "degrades" assertion below is meaningless unless the
  // fixture registry genuinely exceeds the budget, and every "stays strict"
  // assertion is meaningless unless the narrow one genuinely does not.
  it('the fixture registry is expensive and a narrow pick is cheap', () => {
    expect(estimateToolTokens(registry)).toBeGreaterThan(WHITELIST_VERBATIM_BUDGET_TOKENS);
    const narrow = registry.filter((s) => ['web_search', 'execute_javascript_code'].includes(s.function.name));
    expect(estimateToolTokens(narrow)).toBeLessThan(WHITELIST_VERBATIM_BUDGET_TOKENS);
  });
});

describe('cost-gated degrade of expensive ceilings', () => {
  it('no selection at all -> lean discovery surface, no plugin tools', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: null };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    expect(ns.has('discover_tools')).toBe(true);
    expect(ns.has('web_search')).toBe(true);
    expect(namesOf(res).filter(isGatedTail)).toEqual([]);
    expect(res.length).toBeLessThan(registry.length);
  });

  it('the resident floor is APPLIED, not merely declared', async () => {
    // Every other assertion in this file checks what is ABSENT from the
    // surface, so deleting the floor from the group union left them all green
    // while restoring a discovery on almost every turn. "Declared but not
    // wired" is invisible to absence checks — this one checks presence.
    //
    // NEUTRAL_MSG matches no keyword trigger, so anything here arrived because
    // the floor put it there rather than because the message asked for it.
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: null };
    const ns = new Set(namesOf(await getToolSchemas(ctx)));
    for (const group of ORCHESTRATOR_RESIDENT_GROUPS) {
      const members = TOOL_GROUPS[group] || [];
      if (members.length === 0) continue;
      expect(
        members.some((n) => ns.has(n)),
        `group "${group}" is declared resident but no member reached the surface`,
      ).toBe(true);
    }
  });

  it('a whitelist covering every tool degrades to the same lean discovery surface (cost, not coverage)', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: new Set(namesOf(registry)) };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    expect(ns.has('discover_tools')).toBe(true);
    expect(namesOf(res).filter(isGatedTail)).toEqual([]);
    expect(res.length).toBeLessThan(registry.length);
  });

  it('an expensive ceiling degrades but exclusions stick, even for DEFAULT tools', async () => {
    const unchecked = ['web_search', 'plugin_tool_0'];
    const ctx = {
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(namesOf(registry).filter((n) => !unchecked.includes(n))),
    };
    const res = await getToolSchemas(ctx);
    const ns = new Set(namesOf(res));
    // web_search is in DEFAULT_TOOLS — the ceiling must win over defaults.
    expect(ns.has('web_search')).toBe(false);
    expect(namesOf(res).filter(isGatedTail)).toEqual([]);
    expect(ns.has('discover_tools')).toBe(true);
    expect(res.length).toBeLessThan(registry.length);
  });

  // A 42.5%-coverage list that costs 57k tokens is the case the coverage rule
  // missed entirely: it is neither "everything" nor curated. Cost catches it.
  it('a MID-SIZED whitelist (far under any coverage threshold) still degrades', async () => {
    const half = namesOf(registry).slice(0, Math.floor(registry.length * 0.42));
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: new Set(half) };
    const coverage = half.length / registry.length;
    expect(coverage).toBeLessThan(0.95); // would have been honoured verbatim before
    const res = await getToolSchemas(ctx);
    // Degraded = gated, not verbatim: the permitted plugin tail is excluded
    // even though the ceiling allows it.
    expect(namesOf(res).filter(isGatedTail)).toEqual([]);
    expect(half.filter(isGatedTail).length).toBeGreaterThan(0); // the ceiling DID permit some
    expect(new Set(namesOf(res)).has('discover_tools')).toBe(true);
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
    // MCP, because every STATIC group is now resident from turn 1 and cannot
    // be "newly matched" — which is the point: the only surface that still
    // grows mid-conversation is the tail nobody needs by default.
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: null };
    const A = namesOf(await getToolSchemas(ctx));
    expect(A.some((n) => n.startsWith('mcp__'))).toBe(false);

    ctx.latestUserMessage = 'use the mcp server to open a page';
    const B = namesOf(await getToolSchemas(ctx));

    expect(B.length).toBeGreaterThan(A.length);
    expect(B.slice(0, A.length)).toEqual(A); // exact prefix
    expect(B).toContain('mcp__srv__tool_0');
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
