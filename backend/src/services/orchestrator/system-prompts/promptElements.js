import { surfaceHasAsyncCapableTool } from '../asyncToolParams.js';
import { VIZ_ADVANCED_CHEATSHEET } from './orchestrator-chat.js';

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
    gate: (g) => g.has('analyze_image'),
  },
  {
    id: 'critical_image_generation',
    label: 'Image generation display rules',
    gate: (g) => g.has('generate_image'),
  },
  {
    id: 'image_analysis_capabilities',
    label: 'Vision provider matrix',
    gate: (g) => g.has('analyze_image'),
  },
  {
    id: 'image_generation_capabilities',
    label: 'Image provider matrix',
    gate: (g) => g.has('generate_image'),
  },
  {
    id: 'critical_image_reference_formatting',
    label: 'IMAGE_REF formatting',
    gate: (g) => g.has('generate_image'),
  },
  {
    id: 'async_execution',
    label: 'Async & periodic execution',
    // Two conditions, both conversation-stable: the user's frozen toggle, and
    // whether anything on the surface actually carries the params. Explaining
    // background execution on a surface of instant read-only tools taught the
    // model about a capability it had no reason to use.
    gate: (g) => g.asyncToolsEnabled && g.hasAsyncCapableTool,
  },
  {
    id: 'memory_recall',
    label: 'History recall guidance',
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
    gate: (g) => g.hasAny(
      'web_search', 'web_scrape', 'execute_javascript_code',
      'read_file', 'write_file', 'file_operations',
      'agnt_tools', 'execute_custom_agnt_tool',
    ),
  },
  {
    id: 'mcp_tool_use',
    label: 'MCP calling convention',
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
