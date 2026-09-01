// TOOL SUCCESSION — a curated selection survives us renaming what it named.
//
// THE BUG THIS PINS (measured live 2026-09-01): a per-channel `enabledTools`
// list is an enumerated snapshot of the registry from when the user last
// touched the tool selector, and the backend applies it as a hard ceiling
// that bounds even discover_tools. Consolidating ai_browser_act/use/control
// into one `browser` tool put the new name outside every existing snapshot,
// so a user who had explicitly enabled browsing lost it entirely: the
// `browser` group filtered to zero members and vanished from discover_tools
// browse, while the legacy tools stayed visible in the same channel.
//
// Both halves must hold: an inherited permission appears, AND a channel that
// never permitted browsing still gets nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));
vi.mock('../../models/AgentModel.js', () => ({ default: { findOne: vi.fn() } }));

import { getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import AgentModel from '../../models/AgentModel.js';
import { DEFAULT_TOOLS, TOOL_GROUPS } from './toolSelector.js';

const schema = (name) => ({
  type: 'function',
  function: { name, description: `${name} description`, parameters: { type: 'object', properties: {} } },
});

// The legacy browser tools are no longer in any group — they are dispatch
// aliases now — so the fixture must add them explicitly, exactly as a live
// registry still carries them.
const LEGACY = ['ai_browser_use', 'ai_browser_control', 'ai_browser_act'];

function buildRegistry() {
  const names = [];
  const seen = new Set();
  const push = (n) => { if (!seen.has(n)) { seen.add(n); names.push(n); } };
  for (const n of DEFAULT_TOOLS) push(n);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) push(n);
  for (const n of LEGACY) push(n);
  for (let i = 0; i < 150; i++) push(`plugin_tool_${i}`);
  return names.map(schema);
}

const namesOf = (schemas) => new Set(schemas.map((s) => s.function?.name));
const surfaceFor = (ctx) => getChatConfig('orchestrator').getToolSchemas(ctx);
const NEUTRAL_MSG = 'hello there';

// A realistic selection saved BEFORE the consolidation: it enables browsing
// under the old name, which is why the loss was invisible — the legacy tool
// was still listed, just no longer the one the model is told to use.
const SAVED_BEFORE_CONSOLIDATION = [
  'discover_tools', 'web_search', 'web_scrape', 'execute_javascript_code',
  'read_file', 'write_file', 'ai_browser_use', 'plugin_tool_3',
];

let registry;
beforeEach(() => {
  registry = buildRegistry();
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockResolvedValue(registry);
  AgentModel.findOne.mockReset();
});

describe('the succession map itself', () => {
  it('names a successor that really is a tool in the taxonomy', () => {
    // Anti-vacuity: a typo'd successor would make the whole fix a no-op that
    // still passes every surface test below.
    const grouped = new Set(Object.values(TOOL_GROUPS).flat());
    expect(grouped.has('browser')).toBe(true);
  });

  it('names predecessors that really are in the registry', () => {
    const known = namesOf(registry);
    for (const n of LEGACY) expect(known.has(n)).toBe(true);
  });
});

describe('a selection saved before the consolidation', () => {
  it('reaches the tool that REPLACED what it named (the reported bug)', async () => {
    const ns = namesOf(await surfaceFor({
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(SAVED_BEFORE_CONSOLIDATION),
    }));
    expect(ns.has('browser')).toBe(true);
  });

  it('puts it in the CEILING too, so discover_tools can reach it', async () => {
    // The ceiling bounds discover_tools; a successor permitted for residency
    // but absent from the ceiling would be silently unloadable.
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: new Set(SAVED_BEFORE_CONSOLIDATION) };
    await surfaceFor(ctx);
    expect(ctx._toolCeiling.has('browser')).toBe(true);
  });

  it('inherits from ANY predecessor, not just the first one listed', async () => {
    for (const legacy of LEGACY) {
      const ns = namesOf(await surfaceFor({
        latestUserMessage: NEUTRAL_MSG,
        enabledTools: new Set(['discover_tools', legacy]),
      }));
      expect(ns.has('browser'), `${legacy} should confer browser`).toBe(true);
    }
  });

  it('leaves the user\'s literal selection untouched', async () => {
    // Provenance and the settings UI both read enabledTools; widening it in
    // place would misreport an inherited permission as something the user
    // ticked, and could be written back to their saved list.
    const enabledTools = new Set(SAVED_BEFORE_CONSOLIDATION);
    await surfaceFor({ latestUserMessage: NEUTRAL_MSG, enabledTools });
    expect(enabledTools.has('browser')).toBe(false);
  });
});

describe('it is inheritance, not a blanket grant', () => {
  it('a channel that never permitted browsing still gets nothing', async () => {
    const ns = namesOf(await surfaceFor({
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(['discover_tools', 'web_search', 'read_file']),
    }));
    expect(ns.has('browser')).toBe(false);
    expect(ns.has('ai_browser_use')).toBe(false);
  });

  it('an empty selection still means zero tools', async () => {
    const ns = namesOf(await surfaceFor({ latestUserMessage: NEUTRAL_MSG, enabledTools: new Set() }));
    expect(ns.has('browser')).toBe(false);
  });

  it('no selection at all is unaffected — browser rides its resident group', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: null };
    const ns = namesOf(await surfaceFor(ctx));
    expect(ctx._toolCeiling).toBeNull();
    expect(ns.has('browser')).toBe(true);
  });
});
