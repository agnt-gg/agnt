// The system prompt must be CONSTANT within a conversation, not merely monotonic.
//
// ── WHAT THIS CATCHES, AND WHY THE OLD TEST DIDN'T ────────────────────────
// promptElements.test.js asserts monotonicity: adding tools never REMOVES a
// resident block. That property held, and the prompt still changed on turns 2
// and 3 of a real conversation, because a block switching ON is also a change.
// The system block is a cache prefix: Anthropic caches `tools -> system ->
// messages`, so rewriting it invalidates every cached message after it.
// Monotonic is cheap to satisfy and worth nothing; only CONSTANT is free.
//
// Measured on the conversation that exposed it (2026-08-01, claude-opus-5):
// the three turns that ran discover_tools read 48.3% / 48.7% / 26.1% from
// cache and rewrote 33.6k / 43.5k / 145.7k tokens. The one turn that loaded no
// tools read 94.6%.
//
// So this file asserts the invariant directly — replay a conversation whose
// tool surface GROWS and require the prompt bytes not to move — and pairs it
// with an anti-vacuity control proving the same fixture DOES move when the
// freeze is removed.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildUnifiedSystemPrompt } from './buildUnifiedPrompt.js';
import {
  buildGateInputs,
  resolveResidentElements,
  getGuidanceForTools,
  ORCHESTRATOR_RESIDENT_GROUPS,
  RESIDENT_GATED_ELEMENTS,
} from './promptElements.js';
import { TOOL_GROUPS } from '../toolSelector.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tool = (name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } });

// A surface that grows exactly the way discover_tools grows one: append-only,
// pulling in tools that several gated blocks key on.
const TURN_SURFACES = [
  ['discover_tools', 'web_search', 'read_file'],
  ['discover_tools', 'web_search', 'read_file', 'recall', 'list_recent', 'get_trace'],
  ['discover_tools', 'web_search', 'read_file', 'recall', 'list_recent', 'get_trace', 'generate_image'],
  ['discover_tools', 'web_search', 'read_file', 'recall', 'list_recent', 'get_trace', 'generate_image', 'analyze_image', 'create_and_run_goal'],
];

const ctxFor = (names) => ({
  toolSchemas: names.map(tool),
  normalizedProvider: 'claude-code',
  latestUserMessage: 'anything',
});

const OPTS = {
  skillsCatalogSection: '\nSKILLS\n',
  memorySection: '\nMEMORY\n',
  customInstructionsSection: 'CUSTOM',
  workspaceSection: 'WORKSPACE',
  asyncToolsEnabled: true,
};

// Freeze on turn 1, exactly as chatConfigs.loadFrozenPromptGates does.
function freezeFromTurnOne() {
  const gates = buildGateInputs({
    toolSchemas: TURN_SURFACES[0].map(tool),
    asyncToolsEnabled: true,
    provider: 'claude-code',
  });
  return [...resolveResidentElements(gates).included];
}

describe('the system prompt is byte-stable while the tool surface grows', () => {
  it('is IDENTICAL on every turn when the gate decisions are frozen', async () => {
    const residentElementIds = freezeFromTurnOne();
    const prompts = [];
    for (const names of TURN_SURFACES) {
      prompts.push(await buildUnifiedSystemPrompt(ctxFor(names), { ...OPTS, residentElementIds }));
    }
    for (let i = 1; i < prompts.length; i++) {
      expect(prompts[i], `system prompt changed on turn ${i + 1} — that rewrites every cached message`).toBe(prompts[0]);
    }
  });

  it('ANTI-VACUITY: the same fixture DOES change without the freeze', async () => {
    // If this passes trivially, the test above proves nothing — the surfaces
    // would simply not be exercising any gate.
    const prompts = [];
    for (const names of TURN_SURFACES) {
      prompts.push(await buildUnifiedSystemPrompt(ctxFor(names), { ...OPTS, residentElementIds: null }));
    }
    const distinct = new Set(prompts);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('the frozen set really is smaller than the fully-grown set', async () => {
    // Otherwise "frozen" and "live" coincide and the first test is vacuous.
    const frozen = freezeFromTurnOne();
    const grown = resolveResidentElements(buildGateInputs({
      toolSchemas: TURN_SURFACES.at(-1).map(tool), asyncToolsEnabled: true, provider: 'claude-code',
    })).included;
    expect(frozen.length).toBeLessThan(grown.size);
  });

  it('an explicit empty frozen set omits every gated block', async () => {
    const none = await buildUnifiedSystemPrompt(ctxFor(TURN_SURFACES.at(-1)), { ...OPTS, residentElementIds: [] });
    const all = await buildUnifiedSystemPrompt(ctxFor(TURN_SURFACES.at(-1)), { ...OPTS, residentElementIds: null });
    expect(none.length).toBeLessThan(all.length);
  });
});

describe('freezing strands nothing — guidance follows the tool', () => {
  it('a tool discovered after the freeze still gets its prose', () => {
    const frozen = freezeFromTurnOne();
    const late = getGuidanceForTools(['generate_image', 'analyze_image'], frozen);
    expect(late.length).toBeGreaterThan(0);
    for (const g of late) {
      expect(g.text.length).toBeGreaterThan(50);
      expect(frozen).not.toContain(g.id);
    }
  });

  it('does NOT repeat prose that is already resident', () => {
    const everything = RESIDENT_GATED_ELEMENTS.map((e) => e.id);
    expect(getGuidanceForTools(['generate_image', 'analyze_image', 'recall'], everything)).toEqual([]);
  });

  it('returns nothing for a tool no block is keyed to', () => {
    expect(getGuidanceForTools(['some_unrelated_plugin_tool'], [])).toEqual([]);
  });

  it('every tool-keyed element carries deliverable text', () => {
    // An element with tools but no text would be silently unreachable once
    // frozen out of the prompt.
    for (const el of RESIDENT_GATED_ELEMENTS) {
      if (!el.tools) continue;
      expect(el.text, `"${el.id}" is tool-keyed but has no text to deliver`).toBeTruthy();
    }
  });
});

describe('the resident floor keeps discovery rare', () => {
  it('covers every static tool group', () => {
    // Anything left out is a discovery waiting to happen, and one discovery
    // costs more than the whole group costs to keep resident.
    for (const group of Object.keys(TOOL_GROUPS)) {
      expect(ORCHESTRATOR_RESIDENT_GROUPS, `group "${group}" is not resident`).toContain(group);
    }
  });

  it('does NOT include the dynamic MCP category', () => {
    // 78 tools that only matter when the user names them; this is the tail the
    // gating was actually for.
    expect(ORCHESTRATOR_RESIDENT_GROUPS).not.toContain('mcp');
    expect(ORCHESTRATOR_RESIDENT_GROUPS).not.toContain('installed');
  });
});

describe('wiring contract', () => {
  const CHAT = fs.readFileSync(path.join(HERE, '..', 'chatConfigs.js'), 'utf8');
  const ORCH = fs.readFileSync(path.join(HERE, '..', '..', 'OrchestratorService.js'), 'utf8');
  const TOOLS = fs.readFileSync(path.join(HERE, '..', 'tools.js'), 'utf8');

  it('chatConfigs freezes the gates and passes them to the builder', () => {
    expect(CHAT).toMatch(/function loadFrozenPromptGates\(/);
    expect(CHAT).toMatch(/context\._frozenPromptGates = \[\.\.\.included\]/);
    expect(CHAT).toMatch(/residentElementIds: loadFrozenPromptGates\(/);
  });

  it('the freeze is memoised, not recomputed each turn', () => {
    expect(CHAT).toMatch(/if \(Array\.isArray\(context\._frozenPromptGates\)\) return context\._frozenPromptGates;/);
  });

  it('OrchestratorService restores the freeze across turns', () => {
    // Memoising on a per-turn context object does nothing unless the value
    // survives into the next turn.
    expect(ORCH).toMatch(/priorContext\._frozenPromptGates/);
    expect(ORCH).toMatch(/conversationContext\._frozenPromptGates = priorContext\._frozenPromptGates/);
  });

  it('chatConfigs seeds the resident groups into the surface', () => {
    expect(CHAT).toMatch(/\.\.\.ORCHESTRATOR_RESIDENT_GROUPS/);
  });

  it('discover_tools delivers late guidance in its result', () => {
    expect(TOOLS).toMatch(/getGuidanceForTools\(admitted, context\?\._frozenPromptGates \|\| \[\]\)/);
  });
});
