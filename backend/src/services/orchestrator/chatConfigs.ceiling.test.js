// The tool ceiling: "permitted" and "resident" are different questions.
//
// A channel's enabledTools (or a restricted agent's assignedTools) bounds what
// MAY be used. Gating decides what is LOADED. These tests pin the boundary in
// both directions: nothing outside the ceiling can ever appear, and nothing
// inside it can become unreachable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));

import { getChatConfig, WHITELIST_VERBATIM_BUDGET_TOKENS } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { DEFAULT_TOOLS, TOOL_GROUPS, CORE_PRIMITIVES, getToolsForCategories } from './toolSelector.js';
import { estimateToolTokens } from '../../utils/contextManager.js';

const FILLER = 'Performs the described operation and returns a structured result. '.repeat(6);
const schema = (name) => ({
  type: 'function',
  function: {
    name,
    description: `${name}: ${FILLER}`,
    parameters: { type: 'object', properties: { target: { type: 'string', description: 'Target id.' } } },
  },
});

function buildRegistry() {
  const names = new Set();
  for (const n of DEFAULT_TOOLS) names.add(n);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) names.add(n);
  for (let i = 0; i < 150; i++) names.add(`plugin_tool_${i}`);
  for (let i = 0; i < 20; i++) names.add(`mcp__srv__tool_${i}`);
  return [...names].map(schema);
}

const namesOf = (s) => s.map((x) => x.function.name);
const getToolSchemas = (ctx) => getChatConfig('orchestrator').getToolSchemas(ctx);

let registry;
beforeEach(() => {
  registry = buildRegistry();
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockResolvedValue(registry);
});

describe('ceiling resolution', () => {
  it('is expensive enough to exercise the gate (anti-vacuity)', () => {
    expect(estimateToolTokens(registry)).toBeGreaterThan(WHITELIST_VERBATIM_BUDGET_TOKENS);
  });

  it('publishes _toolCeiling so later turns and discover_tools are bounded too', async () => {
    const ctx = { latestUserMessage: 'hello', enabledTools: new Set(namesOf(registry)) };
    await getToolSchemas(ctx);
    expect(ctx._toolCeiling).toBeInstanceOf(Set);
    expect(ctx._toolCeiling.size).toBeGreaterThan(0);
  });

  it('null enabledTools means "no opinion" — no ceiling at all', async () => {
    const ctx = { latestUserMessage: 'hello', enabledTools: null };
    await getToolSchemas(ctx);
    expect(ctx._toolCeiling).toBeNull();
  });

  it('always-on read-only primitives are folded INTO the ceiling', async () => {
    const ctx = { latestUserMessage: 'hello', enabledTools: new Set(['web_search']) };
    await getToolSchemas(ctx);
    for (const p of CORE_PRIMITIVES) expect(ctx._toolCeiling.has(p)).toBe(true);
    expect(ctx._toolCeiling.has('mcp_client')).toBe(true);
  });
});

describe('nothing outside the ceiling can be resident', () => {
  it('a gated (expensive) ceiling still excludes everything outside it', async () => {
    const permitted = ['web_search', 'read_file', 'generate_image', ...Array.from({ length: 120 }, (_, i) => `plugin_tool_${i}`)];
    const ctx = { latestUserMessage: 'generate an image', enabledTools: new Set(permitted) };
    const res = namesOf(await getToolSchemas(ctx));
    expect(res).toContain('generate_image');            // in ceiling AND keyword-matched
    expect(res).not.toContain('plugin_tool_149');       // outside the ceiling
    expect(res).not.toContain('send_email');            // outside the ceiling
  });

  it('a DEFAULT tool the user unchecked stays off', async () => {
    const permitted = namesOf(registry).filter((n) => n !== 'web_search');
    const ctx = { latestUserMessage: 'hello', enabledTools: new Set(permitted) };
    const res = namesOf(await getToolSchemas(ctx));
    expect(DEFAULT_TOOLS.has('web_search')).toBe(true); // premise
    expect(res).not.toContain('web_search');
  });

  it('MCP tools are not resident just because they exist', async () => {
    const ctx = { latestUserMessage: 'hello', enabledTools: new Set(namesOf(registry)) };
    const res = namesOf(await getToolSchemas(ctx));
    expect(res.some((n) => n.startsWith('mcp__'))).toBe(false);
  });
});

describe('nothing inside the ceiling becomes unreachable', () => {
  it('discover_tools remains present whenever the surface is gated', async () => {
    const ctx = { latestUserMessage: 'hello', enabledTools: new Set(namesOf(registry)) };
    expect(namesOf(await getToolSchemas(ctx))).toContain('discover_tools');
  });

  it('a permitted-but-hidden tool is loadable by category, bounded by the ceiling', async () => {
    const permitted = new Set(['web_search', 'send_email', 'discover_tools', ...Array.from({ length: 140 }, (_, i) => `plugin_tool_${i}`)]);
    const ctx = { latestUserMessage: 'hello', enabledTools: permitted };
    const first = namesOf(await getToolSchemas(ctx));
    expect(first).not.toContain('send_email'); // hidden: no keyword match

    // Replicate the OrchestratorService dynamic-load step.
    const loaded = getToolsForCategories(registry, ['email'])
      .filter((s) => ctx._toolCeiling.has(s.function.name))
      .map((s) => s.function.name);
    expect(loaded).toContain('send_email');
  });

  it('the ceiling withholds a category load that reaches past it', () => {
    const ceiling = new Set(['web_search']);
    const loaded = getToolsForCategories(registry, ['email'])
      .filter((s) => ceiling.has(s.function.name));
    expect(loaded).toHaveLength(0);
  });
});

describe('restricted saved agents declare a real ceiling', () => {
  beforeEach(() => {
    vi.doMock('../../models/AgentModel.js', () => ({
      default: { findOne: vi.fn(async () => ({ id: 'a1', name: 'A', assignedTools: ['web_search'], toolAccessMode: 'restricted' })) },
    }));
  });

  it('publishes _toolCeiling for a restricted agent', async () => {
    vi.resetModules();
    vi.doMock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn(async () => registry) }));
    vi.doMock('./system-prompts/buildUnifiedPrompt.js', () => ({ buildUnifiedSystemPrompt: vi.fn(async () => 'P') }));
    vi.doMock('./workspaceContext.js', () => ({ loadWorkspaceContextSection: vi.fn(async () => '') }));
    const { getChatConfig: gc } = await import('./chatConfigs.js');
    const ctx = { latestUserMessage: 'hello', agentId: 'a1' };
    const res = await gc('orchestrator').getToolSchemas(ctx);
    expect(ctx._toolCeiling).toBeInstanceOf(Set);
    expect(namesOf(res).every((n) => ctx._toolCeiling.has(n))).toBe(true);
    // The prefix bypass used to hand every restricted agent all MCP tools.
    expect(namesOf(res).some((n) => n.startsWith('mcp__'))).toBe(false);
  });
});

// The original defect class here is a WIRING failure: the ceiling can be
// computed perfectly and still not be consulted where tools actually enter the
// request. Unit tests of the resolver cannot see that, so pin the call site.
describe('OrchestratorService honours the ceiling on dynamic loads (source contract)', () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'OrchestratorService.js'),
    'utf8',
  );

  it('filters discover_tools results by _toolCeiling before they are appended', () => {
    const loadIdx = src.indexOf('getToolsForCategories(allSchemas, conversationContext._requestedToolCategories)');
    const pushIdx = src.indexOf('finalToolSchemas.push(schema)', loadIdx);
    const filterIdx = src.indexOf('toolCeiling.has(s.function?.name)', loadIdx);
    expect(loadIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeGreaterThan(loadIdx);
    expect(filterIdx).toBeLessThan(pushIdx); // filter happens BEFORE the append
  });

  it('the filter is reachable — guarded only by the ceiling actually being a Set', () => {
    // Presence and ordering are satisfiable by dead code (a `if (false && ...)`
    // wrapper keeps every positional assertion above green). Pin the guard.
    expect(src).toMatch(/if\s*\(\s*toolCeiling instanceof Set\s*\)/);
    expect(src).not.toMatch(/if\s*\(\s*false\s*&&/);
  });
});
