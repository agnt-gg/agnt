// The prompt-cache contract.
//
// Anthropic's cached prefix is ordered `tools -> system -> messages`, so a
// change to the system block invalidates every cached message after it.
// Measured on this account over 7 days (claude-opus-5): cache reads are 96.4%
// of input tokens but 57% of the input bill; cache WRITES are 3.6% of tokens
// and 43% of the bill. A rewritten token costs 20x a cache-read token, and one
// prefix break on a 178k-token conversation is about $1.89 — roughly 300 turns
// of what the gating in this module saves.
//
// So the rule is not "gate aggressively", it is "gate on something that cannot
// flicker". These tests pin that rule structurally rather than trusting a
// comment.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildGateInputs,
  resolveResidentElements,
  RESIDENT_GATED_ELEMENTS,
  ON_DEMAND_ELEMENTS,
  getGuidanceCategory,
  getGuidanceCategoryNames,
} from './promptElements.js';
import { getAllCategoryNames, GUIDANCE_ONLY_CATEGORIES } from '../toolSelector.js';
import { LONG_RUNNING_TOOL_NAMES } from '../asyncToolParams.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tool = (name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } });

describe('gate inputs cannot see the user message', () => {
  // THE central invariant. A gate keyed on latestUserMessage flips both ways,
  // on turns where nothing else moved, and turns a saving into a net loss.
  const SRC = fs.readFileSync(path.join(HERE, 'promptElements.js'), 'utf8');

  it('buildGateInputs accepts only conversation-stable fields', () => {
    const sig = SRC.slice(SRC.indexOf('export function buildGateInputs'));
    const params = sig.slice(sig.indexOf('({') + 2, sig.indexOf('} = {}'));
    const names = params.split(',').map((s) => s.split('=')[0].trim()).filter(Boolean);
    expect(names.sort()).toEqual(['asyncToolsEnabled', 'provider', 'toolSchemas']);
  });

  it('the module never references a message-shaped identifier', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/latestUserMessage|userMessage|\bmessages\b/);
  });

  it('buildUnifiedPrompt passes no context object into the gates', () => {
    const bup = fs.readFileSync(path.join(HERE, 'buildUnifiedPrompt.js'), 'utf8');
    const call = bup.slice(bup.indexOf('buildGateInputs({'), bup.indexOf('buildGateInputs({') + 320);
    expect(call).toBeTruthy();
    expect(call).not.toMatch(/latestUserMessage/);
    // Only these three keys may be handed over.
    expect(call).toMatch(/toolSchemas:/);
    expect(call).toMatch(/asyncToolsEnabled/);
    expect(call).toMatch(/provider:\s*context\.normalizedProvider/);
  });

  it('every gate is a pure function of the supplied inputs', () => {
    const inputs = buildGateInputs({ toolSchemas: [tool('generate_image')], asyncToolsEnabled: true, provider: 'openai' });
    const a = resolveResidentElements(inputs);
    const b = resolveResidentElements(inputs);
    expect([...a.included].sort()).toEqual([...b.included].sort());
  });
});

describe('gates are monotonic in the tool surface', () => {
  // The resident tool set is append-only per conversation (chatConfigs unions
  // matchedGroups into _loadedToolGroups, applyStableToolOrder replays
  // first-seen order). Gates therefore must only ever turn ON as tools
  // accumulate — a block that could turn OFF would break the prefix on a turn
  // where the tools grew, which is the one thing we are buying.
  const ALL_TOOLS = [
    'analyze_image', 'generate_image', 'recall', 'list_recent', 'get_trace',
    'create_and_run_goal', 'web_search', 'web_scrape', 'execute_javascript_code',
    'read_file', 'write_file', 'file_operations', 'agnt_tools', 'execute_custom_agnt_tool',
  ];

  it('adding a tool never removes a resident block', () => {
    const base = { asyncToolsEnabled: true, provider: 'openai' };
    let surface = [];
    let previous = resolveResidentElements(buildGateInputs({ ...base, toolSchemas: surface }));
    for (const name of ALL_TOOLS) {
      surface = [...surface, tool(name)];
      const next = resolveResidentElements(buildGateInputs({ ...base, toolSchemas: surface }));
      for (const id of previous.included) {
        expect(next.included.has(id), `"${id}" disappeared when ${name} was added`).toBe(true);
      }
      previous = next;
    }
  });

  it('anti-vacuity: the surface really does grow the included set', () => {
    const empty = resolveResidentElements(buildGateInputs({ toolSchemas: [], asyncToolsEnabled: true, provider: 'openai' }));
    const full = resolveResidentElements(buildGateInputs({
      toolSchemas: ALL_TOOLS.map(tool), asyncToolsEnabled: true, provider: 'openai',
    }));
    expect(full.included.size).toBeGreaterThan(empty.included.size);
  });
});

describe('individual gates', () => {
  const g = (names, extra = {}) => buildGateInputs({
    toolSchemas: names.map(tool), asyncToolsEnabled: true, provider: 'openai', ...extra,
  });
  const on = (names, extra) => resolveResidentElements(g(names, extra)).included;

  it('image blocks require the matching image tool', () => {
    expect(on([]).has('image_generation_capabilities')).toBe(false);
    expect(on(['generate_image']).has('image_generation_capabilities')).toBe(true);
    expect(on(['generate_image']).has('image_analysis_capabilities')).toBe(false);
    expect(on(['analyze_image']).has('image_analysis_capabilities')).toBe(true);
  });

  it('async guidance needs BOTH the toggle and an async-capable tool', () => {
    // Teaching background execution on a surface of instant read-only tools
    // is the case that made this 1,826 calibrated tokens of pure waste.
    expect(on(['read_file', 'glob_files']).has('async_execution')).toBe(false);
    expect(on(['web_search']).has('async_execution')).toBe(true);
    expect(on(['web_search'], { asyncToolsEnabled: false }).has('async_execution')).toBe(false);
  });

  it('async eligibility tracks the long-running list', () => {
    for (const name of ['web_search', 'execute_shell_command', 'generate_image']) {
      expect(LONG_RUNNING_TOOL_NAMES.has(name)).toBe(true);
      expect(on([name]).has('async_execution')).toBe(true);
    }
    for (const name of ['read_file', 'list_files', 'highlight_element']) {
      expect(LONG_RUNNING_TOOL_NAMES.has(name)).toBe(false);
    }
  });

  it('MCP calling convention is skipped for claude-code, which injects its own', () => {
    expect(on([], { provider: 'claude-code' }).has('mcp_tool_use')).toBe(false);
    expect(on([], { provider: 'anthropic' }).has('mcp_tool_use')).toBe(true);
  });

  it('memory recall guidance follows any of the three recall tools', () => {
    expect(on([]).has('memory_recall')).toBe(false);
    for (const n of ['recall', 'list_recent', 'get_trace']) {
      expect(on([n]).has('memory_recall')).toBe(true);
    }
  });
});

describe('on-demand elements stay reachable in exactly one call', () => {
  // Aggressive gating is only safe if nothing becomes unreachable. Every block
  // moved out of the prompt must be loadable by name, and the resident prompt
  // must say the name.
  it('every on-demand element resolves by its category', () => {
    expect(ON_DEMAND_ELEMENTS.length).toBeGreaterThan(0);
    for (const el of ON_DEMAND_ELEMENTS) {
      const got = getGuidanceCategory(el.category);
      expect(got, `category "${el.category}" does not resolve`).toBeTruthy();
      expect(got.text.length).toBeGreaterThan(200);
      expect(got.description).toBeTruthy();
    }
  });

  it('discover_tools accepts every guidance category', () => {
    const accepted = getAllCategoryNames();
    for (const name of getGuidanceCategoryNames()) {
      expect(accepted, `discover_tools would reject "${name}"`).toContain(name);
    }
  });

  it('toolSelector and promptElements agree on the guidance category list', () => {
    // Declared in two modules to avoid a dependency cycle; a divergence would
    // make a category advertised-but-unloadable or loadable-but-invisible.
    expect([...GUIDANCE_ONLY_CATEGORIES].sort()).toEqual([...getGuidanceCategoryNames()].sort());
  });

  it('an on-demand category is NOT a tool group (it loads no tools)', () => {
    for (const name of getGuidanceCategoryNames()) {
      const el = getGuidanceCategory(name);
      expect(el.text).toBeTruthy();
      expect(el).not.toHaveProperty('tools');
    }
  });
});

describe('registry hygiene', () => {
  it('every resident element has a unique id, label and callable gate', () => {
    const ids = RESIDENT_GATED_ELEMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const el of RESIDENT_GATED_ELEMENTS) {
      expect(el.label).toBeTruthy();
      expect(typeof el.gate).toBe('function');
    }
  });

  it('every resident element id is actually consulted by the assembler', () => {
    // A registry entry nothing reads is a gate that silently does nothing.
    const bup = fs.readFileSync(path.join(HERE, 'buildUnifiedPrompt.js'), 'utf8');
    for (const el of RESIDENT_GATED_ELEMENTS) {
      expect(bup, `"${el.id}" is registered but never consulted`).toContain(`on('${el.id}')`);
    }
  });
});
