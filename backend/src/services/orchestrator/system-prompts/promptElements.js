import { surfaceHasAsyncCapableTool } from '../asyncToolParams.js';
import {
  VIZ_ADVANCED_CHEATSHEET,
  CRITICAL_IMAGE_HANDLING,
  CRITICAL_IMAGE_GENERATION,
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
  'plugin_authoring',
  'artifact_code',
  'goal_management',
  'media',
  'email',
  'memory',
  'tutorial',
  'canvas',
  'appearance',
  // NOT 'browser' AND NOT 'computer' — DELIBERATELY ON INTENT, NEVER RESIDENT.
  //
  // Both drive something the user can see: a real browser window, or the
  // user's own desktop. Resident, the model reached for them unprompted —
  // measured over the 30 days to 2026-10-06: 663 browser calls across 118
  // runs, ~49 of those runs with no web intent in the user's message, 41% of
  // calls the raw `script` escape hatch (one was used to read an environment
  // variable). Each one surfaced an empty Browser card, widget or OS window.
  //
  // They still arrive the moment they are wanted: the `browser` / `computer`
  // GROUP_TRIGGERS load them when the message names a site, a URL, a browser
  // or an app, a deferred conversation discovers them in one free call, and
  // a group once loaded stays loaded for the rest of the conversation.
  // Named in ON_INTENT_GROUPS below, so the exclusion is a contract, not a gap.
];

/**
 * Static groups that are deliberately NEVER resident: they act on something
 * the user can see (a browser, their desktop), so they load only when the
 * turn asks for them. Every other static group is resident.
 */
export const ON_INTENT_GROUPS = Object.freeze(['browser', 'computer']);

/**
 * The resident tool surface for a DEFERRED-mode conversation.
 *
 * ORCHESTRATOR_RESIDENT_GROUPS above is right for LEGACY transports, where a
 * discovery appends to the tool array and rewrites the cached prefix. In
 * deferred mode (deferredTools.js: Claude 4.5+, GPT-5.4+ Responses) that
 * premise is false — a discovery lands in the message history and the prefix
 * is untouched (measured 16,007 of 16,011 read after a discovery) — so the
 * floor is pure cost: 26,928 tokens on every request, 39 of its 105 tools
 * never called in 30 days.
 *
 * This set is what the measured usage says is needed on turn 1:
 *   - every resident tool with >= 100 calls in the 30 days to 2026-10-06
 *     (together 99.1% of all calls to resident tools);
 *   - the tools the system prompt itself instructs (memory and history,
 *     mention_agent for group chat, start_chat for Main-chat delegation).
 * Everything else is still permitted and still one discover_tools call away,
 * delivered as deferred definitions at no prefix cost.
 *
 * Only conversations that START in deferred mode use it, and the choice is
 * frozen with the conversation (see chatConfigs._residentProfile), so no
 * conversation's tool array ever changes mid-flight. Legacy transports keep
 * the full floor and behave exactly as before.
 */
export const DEFERRED_MODE_RESIDENT_TOOLS = Object.freeze([
  'discover_tools',
  // Execution and files: 81% of all calls.
  'execute_shell_command',
  'execute_javascript_code',
  'read_file',
  'edit_file',
  'write_file',
  'grep_files',
  'glob_files',
  'list_files',
  'file_system_operation',
  'query_data',
  // Research and media.
  'web_search',
  'web_scrape',
  // 'browser' clears the >= 100-call bar but is excluded on purpose: see the
  // note at the end of ORCHESTRATOR_RESIDENT_GROUPS. It is one discovery away.
  'analyze_image',
  'generate_image',
  // Platform the prompt depends on.
  'activate_skill',
  'get_agnt_api',
  'agnt_auth',
  'mention_agent',
  'start_chat',
  // Memory and history (instructed by the HISTORY AND MEMORY section).
  'save_agent_memory',
  'get_agent_memories',
  'record_memory_use',
  'recall',
  'list_recent',
  'get_trace',
]);

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
  // The provider/model matrices for analyze_image and generate_image were
  // removed: they duplicated the tool schemas and had gone stale. The
  // IMAGE_REF display rule lives in critical_image_generation above.
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
