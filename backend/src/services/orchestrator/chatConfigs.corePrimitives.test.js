// CORE_PRIMITIVES — read-only inspection tools that ride along on every
// tool-surface path.
//
// THE BUG THESE PIN: a per-channel `enabledTools` list is an enumerated
// snapshot of the registry taken when the user last touched the tool
// selector. Any built-in shipped afterwards is absent from that snapshot and
// unreachable on that channel forever — the backend applies the list as a
// strict whitelist and nothing ever re-widens it. `grep_files`/`glob_files`
// shipped after most saved selections, so the main chat could not call them
// despite both being registered and dispatchable; the assistant fell back to
// `execute_shell_command grep`, which does not exist on Windows.
//
// The fix must hold BOTH halves: newly shipped inspection tools become
// reachable, AND a curated selection still means something (mutation and
// execution tools stay off unless the user checked them).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));
vi.mock('../../models/AgentModel.js', () => ({
  default: { findOne: vi.fn() },
}));

import { getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import AgentModel from '../../models/AgentModel.js';
import { CORE_PRIMITIVES, DEFAULT_TOOLS, TOOL_GROUPS } from './toolSelector.js';

const schema = (name) => ({
  type: 'function',
  function: { name, description: `${name} description`, parameters: { type: 'object', properties: {} } },
});

function buildRegistry() {
  const names = [];
  const seen = new Set();
  const push = (n) => { if (!seen.has(n)) { seen.add(n); names.push(n); } };
  for (const n of DEFAULT_TOOLS) push(n);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) push(n);
  for (const n of ['list_tutorial_targets', 'scan_page_elements']) push(n);
  for (let i = 0; i < 150; i++) push(`plugin_tool_${i}`);
  return names.map(schema);
}

const namesOf = (schemas) => new Set(schemas.map((s) => s.function?.name));
const surfaceFor = (ctx) => getChatConfig('orchestrator').getToolSchemas(ctx);

// A message matching no keyword trigger, so anything present came from the
// always-on tiers rather than from group matching.
const NEUTRAL_MSG = 'hello there';

// A realistic curated selection saved BEFORE grep_files/glob_files existed:
// it already contains the older file tools, which is exactly why the gap was
// invisible — reading and editing worked, only searching was missing.
const SAVED_BEFORE_SEARCH_TOOLS_SHIPPED = [
  'discover_tools', 'web_search', 'web_scrape', 'execute_javascript_code',
  'execute_shell_command', 'read_file', 'write_file', 'edit_file', 'list_files',
  'recall', 'list_recent', 'get_trace', 'plugin_tool_3',
];

let registry;
beforeEach(() => {
  registry = buildRegistry();
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockResolvedValue(registry);
  AgentModel.findOne.mockReset();
});

describe('the CORE_PRIMITIVES set itself', () => {
  it('is a subset of DEFAULT_TOOLS, so the discovery path always has it too', () => {
    for (const n of CORE_PRIMITIVES) expect(DEFAULT_TOOLS.has(n)).toBe(true);
  });

  it('every member is a real tool declared in the group taxonomy', () => {
    // Anti-vacuity: a typo'd or renamed name would silently never match a
    // schema and the whole fix would be a no-op that still passes the
    // surface tests below (they'd assert absence of a name nothing emits).
    const grouped = new Set(Object.values(TOOL_GROUPS).flat());
    expect(CORE_PRIMITIVES.size).toBeGreaterThan(0);
    for (const n of CORE_PRIMITIVES) expect(grouped.has(n)).toBe(true);
  });

  it('contains only read-only tools — no mutation, execution or egress', () => {
    // Encodes the MEMBERSHIP BAR, not just today's membership. Forcing a tool
    // past a user's curation is only defensible while it cannot change state.
    for (const n of CORE_PRIMITIVES) {
      expect(n).not.toMatch(/write|edit|delete|remove|create|save|execute|shell|command|send|post/i);
    }
  });
});

describe('a curated whitelist saved before a tool shipped', () => {
  it('still reaches the newly shipped search tools (the reported bug)', async () => {
    const ns = namesOf(await surfaceFor({
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(SAVED_BEFORE_SEARCH_TOOLS_SHIPPED),
    }));
    expect(ns.has('grep_files')).toBe(true);
    expect(ns.has('glob_files')).toBe(true);
  });

  it('reaches query_data, which no user message can ever trigger', async () => {
    // Offloaded-data placeholders appear in tool RESULTS, so keyword gating
    // can never load query_data at the moment it becomes necessary.
    const ns = namesOf(await surfaceFor({
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(SAVED_BEFORE_SEARCH_TOOLS_SHIPPED.filter((n) => n !== 'query_data')),
    }));
    expect(ns.has('query_data')).toBe(true);
  });

  it('still honours the curation: unselected mutating and plugin tools stay off', async () => {
    // The other half of the contract. Without this, "fix the whitelist" could
    // degrade into "ignore the whitelist" and every test above would pass.
    const narrow = ['discover_tools', 'web_search', 'read_file'];
    const ns = namesOf(await surfaceFor({
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set(narrow),
    }));
    expect(ns.has('web_search')).toBe(true);
    expect(ns.has('grep_files')).toBe(true);
    for (const denied of ['write_file', 'edit_file', 'execute_shell_command', 'generate_image', 'plugin_tool_0']) {
      expect(ns.has(denied)).toBe(false);
    }
  });

  it('marks a rode-along primitive as universal, not as user-selected', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, enabledTools: new Set(SAVED_BEFORE_SEARCH_TOOLS_SHIPPED) };
    await surfaceFor(ctx);
    expect(ctx._toolProvenance.grep_files).toEqual({ reason: 'universal' });
    expect(ctx._toolProvenance.read_file).toEqual({ reason: 'selected' });
  });
});

describe('near-full whitelists that degrade to a deny-list', () => {
  it('cannot deny a core primitive, but still denies a genuine opt-out', async () => {
    const unchecked = ['grep_files', 'web_search'];
    const ctx = {
      latestUserMessage: NEUTRAL_MSG,
      enabledTools: new Set([...namesOf(registry)].filter((n) => !unchecked.includes(n))),
    };
    const ns = namesOf(await surfaceFor(ctx));
    expect(ns.has('grep_files')).toBe(true);
    expect(ns.has('web_search')).toBe(false);
  });
});

describe('sidebar specialty fallback (no selection sent)', () => {
  it('gains the read-only primitives without gaining mutation tools', async () => {
    const ns = namesOf(await surfaceFor({
      latestUserMessage: NEUTRAL_MSG,
      widgetId: 'w1',
      enabledTools: null,
    }));
    expect(ns.has('generate_widget')).toBe(true);   // its own specialty survives
    expect(ns.has('read_file')).toBe(true);
    expect(ns.has('grep_files')).toBe(true);
    expect(ns.has('query_data')).toBe(true);
    expect(ns.has('write_file')).toBe(false);
    expect(ns.has('execute_shell_command')).toBe(false);
  });

  it('credits specialty and rode-along tools distinctly in the manifest', async () => {
    const ctx = { latestUserMessage: NEUTRAL_MSG, widgetId: 'w1', enabledTools: null };
    await surfaceFor(ctx);
    expect(ctx._toolProvenance.generate_widget).toEqual({ reason: 'specialty' });
    expect(ctx._toolProvenance.grep_files).toEqual({ reason: 'universal' });
  });
});

describe('restricted saved agents keep their declared ceiling', () => {
  it('does NOT gain core primitives from assignedTools alone', async () => {
    // Deliberate exception: `assignedTools` on a restricted agent is a
    // user-declared boundary, not a stale snapshot. Silently widening it
    // would break the contract the agent editor presents.
    AgentModel.findOne.mockResolvedValue({
      id: 'a1', name: 'Restricted', assignedTools: ['web_search'], toolAccessMode: 'restricted',
    });
    const ns = namesOf(await surfaceFor({
      latestUserMessage: NEUTRAL_MSG, agentId: 'a1', enabledTools: null,
    }));
    expect(ns.has('web_search')).toBe(true);
    expect(ns.has('grep_files')).toBe(false);
    expect(ns.has('query_data')).toBe(false);
  });
});
