import { surfaceHasAsyncCapableTool } from '../asyncToolParams.js';
import {
  VIZ_ADVANCED_CHEATSHEET,
  CRITICAL_IMAGE_HANDLING,
  CRITICAL_IMAGE_GENERATION,
  IMAGE_ANALYSIS_CAPABILITIES,
  IMAGE_GENERATION_CAPABILITIES,
  CRITICAL_IMAGE_REFERENCE_FORMATTING,
  MEMORY_RECALL_GUIDANCE,
  IMPORTANT_GUIDELINES,
  MCP_TOOL_USE_RULES,
} from './orchestrator-chat.js';
import { ASYNC_EXECUTION_GUIDANCE } from './async-execution.js';

/**
 * Which optional prompt blocks are resident, and why.
 *
 * ── THE COST MODEL ────────────────────────────────────────────────────────
 * Anthropic's cached prefix is ordered `tools -> system -> messages`, with a
 * breakpoint after the tool array and another after the system block. A change
 * to the system block therefore invalidates the cached copy of EVERY message
 * after it. Measured on this account (7 days, claude-opus-5): cache reads are
 * 96.4% of input tokens but only 57% of the input bill, while cache WRITES are
 * 3.6% of tokens and 43% of the bill — a rewritten token costs 20x a read one,
 * and a single prefix break on a 178k conversation runs about $1.89.
 *
 * So a gate that flickers is far more expensive than the block it removes.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A resident block's gate MUST be a pure function of conversation-stable
 * inputs. Never of the user's message.
 *
 * That sounds restrictive but is not, because of a property the tool surface
 * already has: `chatConfigs` accumulates matched keyword groups across turns
 * (`allGroups = [...previousGroups, ...matchedGroups, ...forcedGroups]`,
 * persisted via `_loadedToolGroups`) and `applyStableToolOrder` replays
 * first-seen order, so each turn's tool array is an exact prefix-extension of
 * the previous turn's. The resident tool set is APPEND-ONLY per conversation.
 *
 * Gating on the resident tool set therefore inherits that monotonicity: a
 * block can turn on, never off, and only at a moment when the tool array
 * changed — which had already invalidated the system block anyway. The gate is
 * free. Gating on `latestUserMessage` would not be: it can flip both ways, on
 * turns where nothing else moved, and that is what turns an $8.9k/yr saving
 * into a net loss. `buildGateInputs` is deliberately given no access to the
 * message so this cannot be written by accident.
 *
 * ── THE OTHER HALF ────────────────────────────────────────────────────────
 * Anything genuinely message-dependent goes in ON_DEMAND_ELEMENTS and is
 * delivered as a `discover_tools` RESULT. Tool results land in the append-only
 * message region, which costs nothing in cached prefix. That is why the D3 /
 * Three.js / HTML renderer guides live there: they are needed on a small
 * minority of turns, and putting them behind a keyword would have been the
 * expensive kind of gate.
 */

/**
 * Groups the orchestrator keeps resident from turn 1.
 *
 * ── WHY THE FLOOR IS HIGH ─────────────────────────────────────────────────
 * An earlier pass cut the orchestrator's resident surface to 31 tools and
 * treated that as the win. It was optimising the wrong number. Resident tokens
 * are billed at the CACHE-READ rate (0.1x) once the prefix is warm; a
 * discovery appends to the tool array, which invalidates the system block and
 * every message after it, and those are rebuilt at the WRITE rate (2.0x).
 *
 * Measured on a real five-turn conversation (2026-08-01): the three turns that
 * called discover_tools rewrote 33.6k / 43.5k / 145.7k tokens and read 48%,
 * 49% and 26% from cache. The one turn that loaded nothing read 94.6%.
 *
 * The arithmetic that follows: ~22k extra resident tokens cost ~2.2k
 * token-equivalents per turn once cached, while ONE avoided prefix break on a
 * 100k conversation saves ~190k. The floor pays for itself if it prevents a
 * single discovery per ~85 turns. In that conversation it would have prevented
 * three out of five.
 *
 * So every STATIC group is resident. What stays behind discover_tools is the
 * genuinely large tail that no ordinary request needs: the 78 MCP tools and
 * the ~147 installed plugin/registry tools, which are the surface the
 * "everything is loaded" complaint was actually about.
 */
export const ORCHESTRATOR_RESIDENT_GROUPS = [
  'core',
  'shell',
  'agnt_platform',
  'agent_management',
  'workflow_authoring',
  'tool_authoring',
  'widget_authoring',
  'artifact_code',
  'goal_management',
  'media',
  'email',
  'memory',
  'tutorial',
  'canvas',
];

/**
 * Compute the gate inputs for a turn.
 *
 * NOTE THE SIGNATURE. It takes the resolved tool schemas, the frozen per-user
 * async toggle, the provider, and the conversation's loaded-guidance set —
 * every one of which is stable or append-only within a conversation. It does
 * NOT take `context`, so it cannot reach `latestUserMessage`. That is enforced
 * by promptElements.test.js, which fails the build if the parameter list grows
 * a message-shaped argument.
 */
export function buildGateInputs({ toolSchemas = [], asyncToolsEnabled = false, provider = null } = {}) {
  const toolNames = new Set();
  for (const s of toolSchemas) {
    const n = s?.function?.name;
    if (n) toolNames.add(n);
  }
  return {
    has: (name) => toolNames.has(name),
    hasAny: (...names) => names.some((n) => toolNames.has(n)),
    asyncToolsEnabled: asyncToolsEnabled === true,
    hasAsyncCapableTool: surfaceHasAsyncCapableTool(toolSchemas),
    provider,
    toolCount: toolNames.size,
  };
}

/**
 * Resident-but-gated prompt blocks.
 *
 * `id` is referenced positionally by buildUnifiedPrompt — the assembly order
 * of the prompt is deliberate (identity first, formatting rules last) and is
 * not something this registry should own. What it owns is the DECISION.
 */
export const RESIDENT_GATED_ELEMENTS = [
  {
    id: 'critical_image_handling',
    label: 'Image upload handling',
    tools: ['analyze_image'],
    text: CRITICAL_IMAGE_HANDLING,
    gate: (g) => g.has('analyze_image'),
  },
  {
    id: 'critical_image_generation',
    label: 'Image generation display rules',
    tools: ['generate_image'],
    text: CRITICAL_IMAGE_GENERATION,
    gate: (g) => g.has('generate_image'),
  },
  {
    id: 'image_analysis_capabilities',
    label: 'Vision provider matrix',
    tools: ['analyze_image'],
    text: IMAGE_ANALYSIS_CAPABILITIES,
    gate: (g) => g.has('analyze_image'),
  },
  {
    id: 'image_generation_capabilities',
    label: 'Image provider matrix',
    tools: ['generate_image'],
    text: IMAGE_GENERATION_CAPABILITIES,
    gate: (g) => g.has('generate_image'),
  },
  {
    id: 'critical_image_reference_formatting',
    label: 'IMAGE_REF formatting',
    tools: ['generate_image'],
    text: CRITICAL_IMAGE_REFERENCE_FORMATTING,
    gate: (g) => g.has('generate_image'),
  },
  {
    id: 'async_execution',
    label: 'Async & periodic execution',
    text: ASYNC_EXECUTION_GUIDANCE,
    // Two conditions, both conversation-stable: the user's frozen toggle, and
    // whether anything on the surface actually carries the params. Explaining
    // background execution on a surface of instant read-only tools taught the
    // model about a capability it had no reason to use.
    gate: (g) => g.asyncToolsEnabled && g.hasAsyncCapableTool,
  },
  {
    id: 'memory_recall',
    label: 'History recall guidance',
    tools: ['recall', 'list_recent', 'get_trace'],
    text: MEMORY_RECALL_GUIDANCE,
    gate: (g) => g.hasAny('recall', 'list_recent', 'get_trace'),
  },
  {
    id: 'task_delegation',
    label: 'Goal delegation',
    gate: (g) => g.has('create_and_run_goal'),
  },
  {
    id: 'important_guidelines',
    label: 'Multi-tool workflow guidelines',
    text: IMPORTANT_GUIDELINES,
    tools: [
      'web_search', 'web_scrape', 'execute_javascript_code',
      'read_file', 'write_file', 'file_operations',
      'agnt_tools', 'execute_custom_agnt_tool',
    ],
    gate: (g) => g.hasAny(
      'web_search', 'web_scrape', 'execute_javascript_code',
      'read_file', 'write_file', 'file_operations',
      'agnt_tools', 'execute_custom_agnt_tool',
    ),
  },
  {
    id: 'mcp_tool_use',
    label: 'MCP calling convention',
    text: MCP_TOOL_USE_RULES,
    // claude-code injects its own MCP framing upstream; duplicating it there
    // was contradictory as well as expensive.
    gate: (g) => g.provider !== 'claude-code',
  },
];

/**
 * Blocks that are NEVER resident and arrive as a `discover_tools` result.
 *
 * These are guidance-only categories: they load no tools, so a load does not
 * touch the tool array and does not break the cached prefix. The text lands in
 * the message stream, where it stays for the rest of the conversation at
 * cache-read prices.
 *
 * Every entry MUST be reachable in exactly one call — `category` is the
 * argument the model passes to `discover_tools`. promptElements.test.js
 * asserts that the resident prompt tells the model the category exists, so a
 * block can never become unreachable by being moved here.
 */
export const ON_DEMAND_ELEMENTS = [
  {
    id: 'viz_advanced',
    category: 'visualization',
    label: 'D3 / Three.js / HTML renderer guides',
    description: 'Full guides for D3 custom visualizations, Three.js 3D scenes, and self-contained interactive HTML pages',
    text: VIZ_ADVANCED_CHEATSHEET,
  },
];

const ON_DEMAND_BY_CATEGORY = new Map(ON_DEMAND_ELEMENTS.map((e) => [e.category, e]));

/** Guidance-only category names accepted by discover_tools. */
export function getGuidanceCategoryNames() {
  return ON_DEMAND_ELEMENTS.map((e) => e.category);
}

/** @returns {{category, label, description, text}|null} */
export function getGuidanceCategory(name) {
  return ON_DEMAND_BY_CATEGORY.get(name) || null;
}

/**
 * Resolve which resident blocks are included this turn.
 * @returns {{included: Set<string>, omitted: Set<string>}}
 */
export function resolveResidentElements(gateInputs) {
  const included = new Set();
  const omitted = new Set();
  for (const el of RESIDENT_GATED_ELEMENTS) {
    if (el.gate(gateInputs)) included.add(el.id);
    else omitted.add(el.id);
  }
  return { included, omitted };
}

/**
 * Capability prose for tools that arrive AFTER the system prompt was frozen.
 *
 * The gate decisions are frozen on turn 1 (see chatConfigs
 * `_frozenPromptGates`) because the system block is a cache prefix: letting a
 * block switch on mid-conversation rewrites every cached message after it.
 * That freeze would otherwise silently strand guidance — a tool discovered on
 * turn 4 would arrive with no instructions on how to use it.
 *
 * So the guidance follows the tool instead, delivered as part of the
 * discover_tools RESULT. Tool results land in the append-only message region,
 * which costs nothing in cached prefix. Same mechanism as the on-demand
 * renderer guides; the model ends up with exactly the same instructions, in a
 * region where adding them is free.
 *
 * @param {string[]} toolNames  tools just loaded
 * @param {Iterable<string>} residentIds  element ids already in the prompt
 * @returns {Array<{id: string, label: string, text: string}>}
 */
export function getGuidanceForTools(toolNames, residentIds = []) {
  const names = new Set(toolNames || []);
  const resident = new Set(residentIds || []);
  const out = [];
  for (const el of RESIDENT_GATED_ELEMENTS) {
    if (!el.text || !el.tools || resident.has(el.id)) continue;
    if (el.tools.some((t) => names.has(t))) {
      out.push({ id: el.id, label: el.label, text: el.text });
    }
  }
  return out;
}
