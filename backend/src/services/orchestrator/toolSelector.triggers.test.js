// Keyword triggers must survive ordinary English.
//
// Until 2026-07-31 every countable noun in GROUP_TRIGGERS was singular-only:
// `\btool\b` did not match "tools", `\bskill\b` did not match "skills",
// `\bplugin\b` did not match "plugins". A real user message reading
// "having tools and skills and plugins available ... loaded into context"
// matched ZERO groups and the model got nothing but DEFAULT_TOOLS. The bug was
// invisible because the singular forms worked in most testing.
//
// This suite makes the class of defect impossible to reintroduce quietly: each
// non-null trigger must declare at least one singular/plural probe pair, and a
// guard test fails when a new group ships without one.
import { describe, it, expect } from 'vitest';
import {
  GROUP_TRIGGERS, TOOL_GROUPS, DYNAMIC_GROUP_MATCHERS,
  selectTools, getToolsForCategories, getAllCategoryNames, DEFAULT_TOOLS,
} from './toolSelector.js';

// group -> [singular, plural] pairs that must BOTH match.
const PLURAL_PROBES = {
  shell: [['shell', 'shells'], ['terminal', 'terminals']],
  agnt_platform: [['tool', 'tools'], ['skill', 'skills'], ['plugin', 'plugins'], ['agent', 'agents'], ['workflow', 'workflows'], ['goal', 'goals'], ['api', 'apis']],
  agent_management: [['agent', 'agents'], ['persona', 'personas']],
  workflow_authoring: [['workflow', 'workflows'], ['node', 'nodes'], ['edge', 'edges'], ['trigger', 'triggers'], ['checkpoint', 'checkpoints']],
  tool_authoring: [['tool', 'tools']],
  widget_authoring: [['widget', 'widgets'], ['dashboard', 'dashboards'], ['iframe', 'iframes']],
  artifact_code: [['artifact', 'artifacts'], ['file', 'files'], ['workspace', 'workspaces']],
  goal_management: [['goal', 'goals'], ['task', 'tasks']],
  media: [['image', 'images'], ['photo', 'photos'], ['picture', 'pictures'], ['screenshot', 'screenshots']],
  email: [['email', 'emails']],
  memory: [['memory', 'memories'], ['trace', 'traces']],
  tutorial: [['tour', 'tours'], ['tutorial', 'tutorials']],
  appearance: [['background', 'backgrounds'], ['wallpaper', 'wallpapers']],
  canvas: [['widget', 'widgets'], ['window', 'windows'], ['tab', 'tabs'], ['pane', 'panes']],
  mcp: [['mcp', 'mcps']],
};

describe('GROUP_TRIGGERS plural tolerance', () => {
  it('every keyword-triggered group declares plural probes', () => {
    const triggered = Object.entries(GROUP_TRIGGERS).filter(([, p]) => p).map(([g]) => g);
    expect(triggered.length).toBeGreaterThan(5); // anti-vacuity
    for (const group of triggered) {
      expect(PLURAL_PROBES[group], `group "${group}" has no plural probe`).toBeTruthy();
      expect(PLURAL_PROBES[group].length).toBeGreaterThan(0);
    }
  });

  for (const [group, pairs] of Object.entries(PLURAL_PROBES)) {
    for (const [singular, plural] of pairs) {
      it(`${group}: "${singular}" and "${plural}" both trigger`, () => {
        expect(GROUP_TRIGGERS[group].test(`please handle the ${singular} now`)).toBe(true);
        expect(GROUP_TRIGGERS[group].test(`please handle the ${plural} now`)).toBe(true);
      });
    }
  }

  it('the exact message that matched nothing now matches (regression)', () => {
    const msg = 'having tools and skills and plugins AVAILABLE to the orchestrator '
      + 'should NOT mean all of that data is loaded into context';
    const matched = Object.entries(GROUP_TRIGGERS).filter(([, p]) => p && p.test(msg)).map(([g]) => g);
    expect(matched).toContain('agnt_platform');
    expect(matched.length).toBeGreaterThan(0);
  });

  it('still does not fire on an unrelated message', () => {
    const msg = 'good morning, how are you today';
    expect(Object.values(GROUP_TRIGGERS).every((p) => !p || !p.test(msg))).toBe(true);
  });
});

const schema = (name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } });

describe('mcp is a gated dynamic category, not a universal bypass', () => {
  const registry = [
    ...[...DEFAULT_TOOLS].map(schema),
    schema('mcp__chrome__click'),
    schema('mcp__chrome__navigate'),
    schema('mcp__files__read'),
    schema('generate_image'),
  ];

  it('MCP tools are ABSENT from a surface whose message never mentions them', () => {
    const { filteredSchemas } = selectTools(registry, 'generate an image of a sunset');
    const names = filteredSchemas.map((s) => s.function.name);
    expect(names.some((n) => n.startsWith('mcp__'))).toBe(false);
    expect(names).toContain('generate_image');
  });

  it('MCP tools arrive when the message mentions mcp', () => {
    const { filteredSchemas, matchedGroups } = selectTools(registry, 'use the mcp server to click');
    expect(matchedGroups.has('mcp')).toBe(true);
    const names = filteredSchemas.map((s) => s.function.name);
    expect(names).toContain('mcp__chrome__click');
    expect(names).toContain('mcp__files__read');
  });

  it('mcp_client stays always-on so the servers remain discoverable', () => {
    const { filteredSchemas } = selectTools(registry, 'hello');
    expect(filteredSchemas.map((s) => s.function.name)).toContain('mcp_client');
  });

  it('discover_tools can load the mcp category explicitly', () => {
    const loaded = getToolsForCategories(registry, ['mcp']).map((s) => s.function.name);
    expect(loaded).toEqual(expect.arrayContaining(['mcp__chrome__click', 'mcp__chrome__navigate', 'mcp__files__read']));
    expect(loaded).not.toContain('generate_image');
  });

  it('"mcp" is an accepted discover_tools category name', () => {
    expect(getAllCategoryNames()).toContain('mcp');
    expect(getAllCategoryNames()).toContain('installed');
    for (const g of Object.keys(TOOL_GROUPS)) expect(getAllCategoryNames()).toContain(g);
  });

  it('every dynamic group is both triggerable and loadable', () => {
    // A matcher with no trigger is unreachable by conversation; a matcher with
    // no category name is unreachable by discover_tools. Either alone is a
    // silently hidden capability.
    for (const name of Object.keys(DYNAMIC_GROUP_MATCHERS)) {
      expect(GROUP_TRIGGERS[name], `${name} has no trigger`).toBeTruthy();
      expect(getAllCategoryNames()).toContain(name);
    }
  });
});
