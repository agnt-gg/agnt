// A tool that exists but is never reachable is the quiet failure mode here:
// the schema can be authored, the executor can be correct, and the model can
// still never see it (no trigger group) or see it and get "Unknown tool" back
// (no dispatch branch). Both have shipped before in this codebase. This suite
// closes the loop from schema → group → trigger → executor dispatch.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAppearanceToolSchemas } from './appearanceTools.js';
import {
  TOOL_GROUPS, GROUP_TRIGGERS, GROUP_DESCRIPTIONS,
  selectTools, getToolsForCategories, getAllCategoryNames, DEFAULT_TOOLS,
} from './toolSelector.js';
import { ORCHESTRATOR_RESIDENT_GROUPS } from './system-prompts/promptElements.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPEARANCE_NAMES = getAppearanceToolSchemas().map((s) => s.function.name);
const schema = (name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } });
const registry = [...[...DEFAULT_TOOLS].map(schema), ...APPEARANCE_NAMES.map(schema), schema('generate_image')];

describe('group membership', () => {
  it('every appearance schema is in TOOL_GROUPS.appearance', () => {
    expect(APPEARANCE_NAMES.length).toBeGreaterThan(0); // anti-vacuity
    for (const name of APPEARANCE_NAMES) {
      expect(TOOL_GROUPS.appearance, `${name} is not in the appearance group`).toContain(name);
    }
  });

  it('the appearance group contains no name without a schema', () => {
    for (const name of TOOL_GROUPS.appearance) {
      expect(APPEARANCE_NAMES, `${name} is grouped but has no schema`).toContain(name);
    }
  });

  it('the group is documented for discover_tools', () => {
    expect(GROUP_DESCRIPTIONS.appearance).toBeTruthy();
    expect(getAllCategoryNames()).toContain('appearance');
  });
});

describe('reachability by conversation', () => {
  it('arrives when the user says "background"', () => {
    const { filteredSchemas, matchedGroups } = selectTools(registry, 'set the background to that annie picture');
    expect(matchedGroups.has('appearance')).toBe(true);
    expect(filteredSchemas.map((s) => s.function.name)).toEqual(expect.arrayContaining(APPEARANCE_NAMES));
  });

  it('arrives when the user says "wallpaper"', () => {
    const { matchedGroups } = selectTools(registry, 'can you change my wallpaper');
    expect(matchedGroups.has('appearance')).toBe(true);
  });

  it('is ABSENT from an unrelated turn on a keyword-gated surface', () => {
    // Sidebar/agent surfaces pay per schema, so the group stays keyword-gated
    // there. The main orchestrator is the exception below — different
    // mechanism, deliberately different answer.
    const { filteredSchemas } = selectTools(registry, 'generate an image of a sunset');
    const names = filteredSchemas.map((s) => s.function.name);
    for (const n of APPEARANCE_NAMES) expect(names).not.toContain(n);
    expect(names).toContain('generate_image'); // anti-vacuity: filtering did run
  });

  it('is loadable on demand via discover_tools', () => {
    const loaded = getToolsForCategories(registry, ['appearance']).map((s) => s.function.name);
    expect(loaded).toEqual(expect.arrayContaining(APPEARANCE_NAMES));
    expect(loaded).not.toContain('generate_image');
  });

  it('has a trigger at all', () => {
    expect(GROUP_TRIGGERS.appearance).toBeTruthy();
  });
});

describe('residency', () => {
  it('is resident on the orchestrator surface like every other static group', () => {
    // House rule (promptCacheStability.test.js): one mid-conversation
    // discover_tools round costs more than keeping a small static group
    // resident. Two schemas is well under that line.
    expect(ORCHESTRATOR_RESIDENT_GROUPS).toContain('appearance');
  });
});

describe('not universal', () => {
  it('chatConfigs does not add appearance tools to UNIVERSAL_TOOLS', () => {
    // Source-level because UNIVERSAL_TOOLS is module-private. If someone later
    // decides these SHOULD be universal, that is a real decision with a token
    // cost — this test is the place to make it deliberately.
    const src = fs.readFileSync(path.join(HERE, 'chatConfigs.js'), 'utf8');
    const block = src.slice(src.indexOf('const UNIVERSAL_TOOLS'), src.indexOf('function isUniversalToolName'));
    expect(block).toContain('mcp_client'); // anti-vacuity: we sliced the right block
    for (const name of APPEARANCE_NAMES) expect(block).not.toContain(name);
  });
});

describe('executor dispatch', () => {
  // Source guard: the executor lives inside a 5,400-line switch that would
  // require a live DB, MCP discovery and an auth token to exercise end to end.
  // What can break silently is the wiring, so that is what is pinned.
  const toolsSrc = fs.readFileSync(path.join(HERE, 'tools.js'), 'utf8');

  it('tools.js imports the appearance module', () => {
    expect(toolsSrc).toMatch(/import\s*\{[^}]*executeAppearanceTool[^}]*\}\s*from\s*'\.\/appearanceTools\.js'/);
  });

  it('tools.js aggregates the appearance schemas into the tool list', () => {
    expect(toolsSrc).toContain('...appearanceToolSchemas,');
  });

  it('tools.js routes appearance tool names to executeAppearanceTool', () => {
    expect(toolsSrc).toContain('await executeAppearanceTool(toolName, resolvedArgs, authToken, context)');
  });

  it('the dispatch branch is keyed off the schema list, not a hand-copied name array', () => {
    // A hand-written name list is how a third tool would get added to the
    // schemas and silently 404 in the executor.
    expect(toolsSrc).toContain('new Set(getAppearanceToolSchemas().map(s => s.function.name))');
  });
});
