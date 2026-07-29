import { estimateToolTokens } from '../../utils/contextManager.js';

/**
 * Dynamic Tool Selector — Fewest Tools First
 *
 * DEFAULT_TOOLS: always available in every conversation.
 * TOOL_GROUPS: keyword-triggered sets of native tools.
 * Everything else (registry/plugin tools NOT in DEFAULT_TOOLS):
 *   automatically gated, discoverable via discover_tools browse/load.
 */

/**
 * Tools always available without keyword matching or discovery.
 * Any tool not listed here AND not in a matched TOOL_GROUP is hidden
 * until the LLM explicitly loads it via discover_tools.
 */
export const DEFAULT_TOOLS = new Set([
  'discover_tools',
  'custom_api',
  'mcp_client',
  'agnt_agents',
  'agnt_chat',
  'agnt_goals',
  'get_agnt_api',
  'activate_skill',
  'execute_javascript',
  'execute_python',
  'random_number',
  'file_system_operation',
  'database_operation',
  'web_search',
  'web_scrape',
  // "Remember anything" memory layer — must be available on every chat
  // surface so the assistant can answer "what did we do last week?",
  // "find that earlier conversation about X", etc. without falling back
  // to ad-hoc execute_javascript probes. Write-side tools are promoted
  // alongside the reads so the assistant can persist facts/preferences
  // any turn without waiting on a keyword to load the `memory` group.
  'recall',
  'list_recent',
  'get_trace',
  'save_agent_memory',
  'get_agent_memories',
]);

/**
 * Tool groups — keyword-triggered sets of native tools.
 * When a user message matches a group's trigger, its tools become available.
 */
export const TOOL_GROUPS = {
  core: [
    'execute_javascript_code',
    'file_operations',
    'query_data',
    'web_search',
    'web_scrape',
  ],
  shell: [
    'execute_shell_command',
    'codex_exec',
    'grok_exec',
    'cursor_exec',
  ],
  agnt_platform: [
    'agnt_workflows',
    'agnt_tools',
    'execute_custom_agnt_tool',
    'agnt_goals',
    'agnt_agents',
    'agnt_auth',
    'agnt_chat',
    'get_agnt_api',
    'activate_skill',
    // Individual goal tools from goalTools.js
    'create_goal',
    'list_goals',
    'get_goal_details',
    'execute_goal',
    'pause_goal',
    'resume_goal',
    'delete_goal',
    'get_goal_status',
    'update_task_status',
    'fetch_goal_tasks',
    'evaluate_goal',
    'get_evaluation_report',
    'save_as_golden_standard',
    'create_and_run_goal',
    'execute_goal_autonomous',
  ],
  agent_management: [
    'generate_agent',
    'modify_agent',
    'save_agent',
    'load_agent',
    'delete_agent',
    'list_agents',
    'run_agent',
  ],
  workflow_authoring: [
    'update_workflow',
    'revert_workflow',
    'list_workflow_versions',
    'create_checkpoint',
    'get_available_tool_node_types',
    'get_node_type_schema',
    'start_workflow',
    'stop_workflow',
  ],
  tool_authoring: [
    'generate_tool_update',
    'save_tool',
    'load_tool',
    'delete_tool',
    'list_tools',
    'run_tool',
  ],
  widget_authoring: [
    'edit_widget_code',
    'generate_widget',
    'update_widget_config',
    'save_widget',
    'load_widget',
    'list_widgets',
    'get_agnt_api',
  ],
  artifact_code: [
    'read_file',
    'write_file',
    'edit_file',
    'list_files',
    'grep_files',
    'glob_files',
  ],
  goal_management: [
    'create_goal',
    'list_goals',
    'get_goal_details',
    'execute_goal',
    'pause_goal',
    'resume_goal',
    'delete_goal',
    'get_goal_status',
    'update_task_status',
    'fetch_goal_tasks',
    'evaluate_goal',
    'get_evaluation_report',
    'save_as_golden_standard',
    'create_and_run_goal',
    'execute_goal_autonomous',
  ],
  media: [
    'analyze_image',
    'generate_image',
  ],
  email: [
    'send_email',
  ],
  memory: [
    'save_agent_memory',
    'get_agent_memories',
    'recall',
    'list_recent',
    'get_trace',
  ],
  tutorial: [
    'list_tutorial_targets',
    'highlight_element',
    'start_guided_tour',
    'end_guided_tour',
    'scan_page_elements',
  ],
  canvas: [
    'get_canvas_state',
    'inspect_canvas_widget',
    'open_canvas_widget',
    'close_canvas_widget',
    'move_canvas_widget',
    // Full widget CRUD rides along: "build me a game canvas" means forging
    // widgets AND placing them — splitting those across trigger groups forced
    // agents through discover_tools (or worse, raw API calls) mid-task.
    'list_widgets',
    'generate_widget',
    'edit_widget_code',
    'save_widget',
    'update_widget_config',
    'load_widget',
  ],
};

/**
 * GROUP_TRIGGERS — regex patterns that trigger each group.
 * Core is included whenever ANY other group triggers (not by default).
 */
export const GROUP_TRIGGERS = {
  core: null, // Never triggered by keywords directly — included as a dependency
  shell: /\b(shell|terminal|bash|command\s*line|cli|codex|npm|pip|apt|brew|cmd)\b/i,
  agnt_platform: /\b(workflow|agent|goal|tool|skill|api|agnt|plugin|forge|autonom|research|optimize|iterate|experiment)\b/i,
  agent_management: /\b(agent|agentforge|agent\s*forge|persona|assigned\s*tools)\b/i,
  workflow_authoring: /\b(workflow|node|edge|trigger|action|delay|checkpoint|workflow\s*version|start\s+workflow|stop\s+workflow)\b/i,
  tool_authoring: /\b(tool|toolforge|tool\s*forge|custom\s*tool|save\s+tool|run\s+tool)\b/i,
  widget_authoring: /\b(widget|dashboard|iframe|source\s*code|html\s*widget|widget\s*forge)\b/i,
  artifact_code: /\b(artifact|file|files|workspace|read\s+file|write\s+file|edit\s+file|code|html|markdown|grep|glob|search\s+(?:the\s+)?(?:code|files|repo|codebase)|find\s+(?:the\s+)?files?)\b/i,
  goal_management: /\b(goal|task|tasks|progress|evaluate|golden\s*standard)\b/i,
  media: /\b(image|photo|picture|vision|draw|dall[\s-]?e|generate\s+(?:a\s+)?(?:photo|picture|image)|analyze\s+(?:this\s+)?(?:image|photo|picture)|screenshot|ocr)\b/i,
  email: /\b(email|e-mail|mail|compose|smtp|send\s+(?:a\s+)?(?:message|letter))\b/i,
  memory: /\b(remember|memory|recall|forget|memorize|last\s+(?:week|month|year|night|time)|earlier|previously|history|trace|traces|find\s+(?:that|the|when|where)|did\s+(?:you|we)\s+ever|what\s+did\s+(?:you|we)\s+do)\b/i,
  tutorial: /\b(tour|tutorial|walk\s*me\s*through|guide\s*me|show\s*me\s*(?:how|where)|highlight|point\s*(?:to|at)|onboard)\b/i,
  canvas: /\b(canvas|workspace|widget|window|pane|tab|open\s+(?:the\s+)?(?:traces|goals|dashboard|memory|artifacts)|looking\s+at|on\s+(?:my|the)\s+screen)\b/i,
};

/**
 * GROUP_DESCRIPTIONS — human-readable descriptions for discover_tools browse.
 */
export const GROUP_DESCRIPTIONS = {
  core: 'Code execution, file operations, web search & scrape, data queries',
  shell: 'Terminal/shell commands, CLI tools, Codex CLI',
  agnt_platform: 'Workflow management, agent management, goals, tools, skills, AGNT API',
  agent_management: 'Create, modify, save, load, delete, list, and run AGNT agents',
  workflow_authoring: 'Edit workflows, inspect node types, create checkpoints, and start/stop workflows',
  tool_authoring: 'Generate, save, load, delete, list, and run Tool Forge tools',
  widget_authoring: 'Generate, edit, configure, save, and load dashboard widgets',
  artifact_code: 'Read, write, edit, list, grep and glob files in the Artifacts workspace',
  goal_management: 'Create, execute, monitor, evaluate, and manage goals and goal tasks',
  media: 'Image analysis (vision/OCR) and image generation (DALL-E, Gemini, Grok)',
  email: 'Send emails via SMTP',
  memory: 'Persistent history search (recall / list_recent / get_trace) and per-agent memory storage',
  tutorial: 'Show in-app tours and highlight UI elements via the live PopupTutorial overlay',
  canvas: 'See and arrange the Workspaces page: read open widget windows, inspect their contents, open/close/move them',
};

/**
 * GROUP_GUIDANCE — maps groups to the guidance section names that should be
 * included in the system prompt when that group is loaded.
 */
export const GROUP_GUIDANCE = {
  core: [
    'ASYNC_EXECUTION_GUIDANCE',
    'OFFLOADED_DATA_GUIDANCE',
    'IMPORTANT_GUIDELINES',
    'CHART_CHEATSHEET',
  ],
  shell: [
    'ASYNC_EXECUTION_GUIDANCE',
  ],
  agnt_platform: [
    'ASYNC_EXECUTION_GUIDANCE',
    'IMPORTANT_GUIDELINES',
    'MCP_TOOL_USE_RULES',
  ],
  agent_management: [
    'ASYNC_EXECUTION_GUIDANCE',
    'IMPORTANT_GUIDELINES',
  ],
  workflow_authoring: [
    'ASYNC_EXECUTION_GUIDANCE',
    'IMPORTANT_GUIDELINES',
  ],
  tool_authoring: [
    'ASYNC_EXECUTION_GUIDANCE',
    'IMPORTANT_GUIDELINES',
  ],
  widget_authoring: [
    'ASYNC_EXECUTION_GUIDANCE',
    'IMPORTANT_GUIDELINES',
  ],
  artifact_code: [
    'ASYNC_EXECUTION_GUIDANCE',
    'IMPORTANT_GUIDELINES',
  ],
  goal_management: [
    'ASYNC_EXECUTION_GUIDANCE',
    'IMPORTANT_GUIDELINES',
  ],
  media: [
    'CRITICAL_IMAGE_HANDLING',
    'CRITICAL_IMAGE_GENERATION',
    'IMAGE_ANALYSIS_CAPABILITIES',
    'IMAGE_GENERATION_CAPABILITIES',
    'CRITICAL_IMAGE_REFERENCE_FORMATTING',
  ],
  email: [],
  memory: [],
  tutorial: ['IMPORTANT_GUIDELINES'],
};

/**
 * Sections that are ALWAYS included regardless of which groups are loaded.
 */
export const ALWAYS_INCLUDED_GUIDANCE = new Set([
  'CRITICAL_TOOL_CALL_REQUIREMENTS',
  'RESPONSE_FORMATTING',
  'CRITICAL_TOOL_RESPONSE_RULES',
  'CHART_CHEATSHEET',
]);

/**
 * Set of all tool names that live inside TOOL_GROUPS.
 */
const ALL_GROUPED_TOOL_NAMES = new Set(
  Object.values(TOOL_GROUPS).flat()
);

/**
 * Select tools for the orchestrator based on keyword matching against the user message.
 *
 * Inclusion rules (in order):
 *   1. DEFAULT_TOOLS → always included
 *   2. Tool is in a keyword-matched TOOL_GROUP → included
 *   3. Tool was previously loaded via discover_tools → included (handled by caller)
 *   4. Everything else → filtered out (available via discover_tools)
 *
 * @param {Array} allSchemas - All available tool schemas (native + registry + plugin)
 * @param {string} userMessage - The latest user message text
 * @returns {{ filteredSchemas: Array, includedGuidance: Set<string>, matchedGroups: Set<string> }}
 */
export function selectTools(allSchemas, userMessage) {
  const matchedGroups = new Set();
  const msg = userMessage || '';

  // Check each group's trigger patterns
  for (const [group, pattern] of Object.entries(GROUP_TRIGGERS)) {
    if (pattern && pattern.test(msg)) {
      matchedGroups.add(group);
    }
  }

  // If any group matched, also include core as a dependency
  if (matchedGroups.size > 0) {
    matchedGroups.add('core');
  }

  // Build the set of tool names included via matched groups
  const includedGroupToolNames = new Set();
  for (const group of matchedGroups) {
    for (const toolName of TOOL_GROUPS[group]) {
      includedGroupToolNames.add(toolName);
    }
  }

  // Build the guidance set
  const includedGuidance = new Set(ALWAYS_INCLUDED_GUIDANCE);
  for (const group of matchedGroups) {
    const sections = GROUP_GUIDANCE[group] || [];
    for (const section of sections) {
      includedGuidance.add(section);
    }
  }

  // Filter schemas:
  //   - DEFAULT_TOOLS: always included
  //   - In a matched group: included
  //   - Everything else: filtered out
  const filteredSchemas = allSchemas.filter((schema) => {
    const name = schema.function?.name;
    if (!name) return false;

    // Always-available defaults
    if (DEFAULT_TOOLS.has(name)) return true;

    // In a keyword-matched group
    if (includedGroupToolNames.has(name)) return true;

    // Everything else is gated behind discover_tools
    return false;
  });

  console.log(
    `[ToolSelector] Message: "${msg.substring(0, 80)}..." → ` +
    `Matched groups: [${[...matchedGroups].join(', ') || 'none'}] → ` +
    `${filteredSchemas.length} tools (from ${allSchemas.length} total)`
  );

  return { filteredSchemas, includedGuidance, matchedGroups };
}

/**
 * Get tool schemas for specific categories (used by discover_tools load operation).
 * Supports TOOL_GROUP names and the special "installed" category which
 * returns all non-default, non-grouped tools (registry + plugin tools).
 *
 * @param {Array} allSchemas - All available tool schemas
 * @param {Iterable<string>} categories - Category names to load
 * @returns {Array} Matching tool schemas
 */
export function getToolsForCategories(allSchemas, categories) {
  const catSet = new Set(categories);

  // If "installed" is requested, return all non-default tools not in any group
  const includeInstalled = catSet.has('installed');

  // Collect tool names from named groups
  const targetNames = new Set();
  for (const cat of catSet) {
    const tools = TOOL_GROUPS[cat];
    if (tools) {
      for (const name of tools) {
        targetNames.add(name);
      }
    }
  }

  return allSchemas.filter((schema) => {
    const name = schema.function?.name;
    if (!name) return false;

    // Named group match
    if (targetNames.has(name)) return true;

    // "installed" category: include if not a default and not in any static group
    if (includeInstalled && !DEFAULT_TOOLS.has(name) && !ALL_GROUPED_TOOL_NAMES.has(name)) {
      return true;
    }

    return false;
  });
}

/**
 * Get guidance sections for specific categories (used by discover_tools load operation).
 *
 * @param {Iterable<string>} categories - Category names
 * @returns {Set<string>} Guidance section names to include
 */
export function getGuidanceForCategories(categories) {
  const guidance = new Set();
  for (const cat of categories) {
    const sections = GROUP_GUIDANCE[cat] || [];
    for (const section of sections) {
      guidance.add(section);
    }
  }
  return guidance;
}

/**
 * Fraction of a model's input budget that must remain available for the
 * CONVERSATION after tool schemas are accounted for. Tools are infrastructure;
 * the conversation is the product. A 295-tool surface is ~120k real tokens,
 * which alone exceeds the entire window of a 128k model — without a cap the
 * context manager is forced into emergency recovery and deletes the chat.
 */
// Floor = one full-size tool result. AGNT's default toolOutputCap is 100,000
// chars, which the shared estimator scores at 100_000 / 3.5 * 1.12 = 32,000
// tokens. Reserving at least that much guarantees a tool round can always land
// in the conversation instead of being crushed by the tool schemas.
const CONVERSATION_RESERVE_FLOOR_TOKENS = 32_000;
// Scales the reserve on larger windows so long chats keep breathing room.
// JUDGEMENT CALL, not a measurement: 0.15 sits above the floor from ~213k
// windows upward. It was 0.25, which — once the system prompt became a separate
// reservation — over-reserved badly enough to cap Codex at 257 of 296 tools on
// a request that really only used 131k of a 272k window.
const CONVERSATION_RESERVE_FRACTION = 0.15;

/**
 * How many tokens of tool schema a model can afford, given its available
 * input budget (contextWindow minus output reserve minus safety margin).
 */
export function computeToolBudget(availableTokens, { reservedTokens = 0 } = {}) {
  // Clamp the floor to what the model actually has. On a 32k window the 32,000
  // token floor exceeds the entire input budget, so an unclamped reserve makes
  // the subtraction meaningless (it would be "negative room" either way). The
  // clamped form states the real conclusion: every available token is spoken
  // for, so the tool budget is 0 and only the force-added minimum set ships.
  const reserve = Math.min(
    Math.max(0, availableTokens),
    Math.max(
      CONVERSATION_RESERVE_FLOOR_TOKENS,
      Math.floor(availableTokens * CONVERSATION_RESERVE_FRACTION),
    ),
  );
  // reservedTokens is the SYSTEM PROMPT. It is not conversation and it is not
  // negotiable — it ships on every request. Live measurement on gpt-4o: the
  // assembled prompt (base + memories + skills catalog + workspace context) is
  // ~31.6k tokens. Omitting it from the reservation left the context manager
  // with 28,307 tokens for a 31,645-token system prompt, so it fired emergency
  // recovery and dropped the conversation anyway — the exact failure the cap
  // exists to prevent, just moved one layer down.
  return Math.max(0, availableTokens - reservedTokens - reserve);
}

/**
 * Hard ceiling on the NUMBER of tools a provider will accept, independent of
 * token cost.
 *
 * The OpenAI Chat Completions API rejects more than 128 functions outright:
 *   400 Invalid 'tools': array too long. Expected an array with maximum
 *       length 128, but got an array with length 158 instead.
 * Verified live 2026-07-26 against openai/gpt-4o AND groq/llama-3.3-70b.
 * The OpenAI-compatible providers mirror this limit.
 *
 * It is a TRANSPORT constraint, not a provider one: in the same session the
 * Responses API (openai-codex/gpt-5.6-sol) accepted all 296 tools. Anthropic
 * and Gemini use their own schemas and impose no comparable documented cap.
 * Applying 128 blindly would silently hide 168 tools from Codex, so the
 * Responses transport and the native-schema providers are exempt.
 */
export const CHAT_COMPLETIONS_TOOL_COUNT_LIMIT = 128;

const NATIVE_SCHEMA_PROVIDERS = new Set([
  'anthropic', 'claude-code',        // Anthropic tool blocks
  'gemini', 'gemini-cli', 'antigravity', // Gemini functionDeclarations
]);

export function getToolCountLimit(provider, { usesResponsesApi = false } = {}) {
  if (usesResponsesApi) return null;                       // Responses API: no cap observed
  if (NATIVE_SCHEMA_PROVIDERS.has(provider)) return null;  // non-OpenAI schema
  return CHAT_COMPLETIONS_TOOL_COUNT_LIMIT;
}

/**
 * Cap a tool-schema array to a token budget WITHOUT breaking prompt caching.
 *
 * Every major provider caches on the longest common PREFIX of the serialized
 * request, and the tools array sits at or near the front of that prefix. A
 * selection that changes between turns therefore invalidates the entire cached
 * prompt — which costs far more than the tools it saves. Two rules keep the
 * prefix intact:
 *
 *   1. NO-OP WHEN IT FITS. If the full surface is under budget the input array
 *      is returned by identity. Large-window models (Sonnet 5, Gemini, GPT-5.6,
 *      Codex Sol) therefore see zero behavioural change.
 *   2. PIN AND APPEND. When a cap IS required, the chosen order is pinned for
 *      the conversation and replayed verbatim on later turns; anything new
 *      (discover_tools loads) is APPENDED, never inserted. The common prefix
 *      only ever grows.
 *
 * Priority when the cap bites: DEFAULT_TOOLS first (discover_tools lives here,
 * so the model can always recover what was hidden), then tools the model has
 * explicitly loaded this conversation, then registry order until the budget is
 * exhausted. Nothing is lost — only deferred behind discover_tools.
 *
 * @param {Array} schemas          Deduped tool schemas, registry order.
 * @param {object} opts
 * @param {number} opts.budgetTokens   Max tokens the tool array may occupy.
 * @param {string[]|null} opts.pinnedNames  Ordered names pinned on a prior turn.
 * @param {Set<string>|null} opts.loadedToolNames  Names loaded via discover_tools.
 * @returns {{ schemas: Array, capped: boolean, toolTokens: number, pinnedNames: string[]|null, hiddenCount: number }}
 */
export function capToolsToBudget(schemas, { budgetTokens, pinnedNames = null, loadedToolNames = null, maxToolCount = null } = {}) {
  const all = Array.isArray(schemas) ? schemas : [];
  const fullTokens = estimateToolTokens(all);
  const countLimit = Number.isFinite(maxToolCount) && maxToolCount > 0 ? maxToolCount : Infinity;

  // ONLY a non-finite budget means "the caller did not specify one". Zero is a
  // legitimate, meaningful value: it says this model cannot afford ANY optional
  // tools once the system prompt and conversation are reserved. Treating 0 as
  // "unlimited" is what let a 32k-window model receive 64k tokens of schemas.
  const budgetSpecified = Number.isFinite(budgetTokens);
  const tokensFit = !budgetSpecified || fullTokens <= budgetTokens;
  const countFits = all.length <= countLimit;

  // Rule 1: it fits on BOTH axes — change nothing at all.
  if (tokensFit && countFits) {
    return { schemas: all, capped: false, toolTokens: fullTokens, pinnedNames: null, hiddenCount: 0 };
  }

  const byName = new Map();
  for (const s of all) {
    const n = s?.function?.name;
    if (n && !byName.has(n)) byName.set(n, s);
  }

  const chosen = [];
  const taken = new Set();
  let used = 0;

  const tryAdd = (name, { force = false } = {}) => {
    if (!name || taken.has(name)) return false;
    const schema = byName.get(name);
    if (!schema) return false;
    // The COUNT limit is a hard provider constraint — exceeding it returns a
    // 400 and the user gets nothing at all. Even force-added tools must respect
    // it; a missing tool is recoverable via discover_tools, a rejected request
    // is not.
    if (chosen.length >= countLimit) return false;
    const cost = estimateToolTokens([schema]);
    if (!force && tokensFit === false && used + cost > budgetTokens) return false;
    chosen.push(schema);
    taken.add(name);
    used += cost;
    return true;
  };

  // Slots that must survive the pin replay.
  //
  // At the provider's hard COUNT ceiling the pin alone can fill every slot. If
  // it is replayed unconditionally, a tool the model just loaded via
  // discover_tools is pushed past the limit and silently dropped — the request
  // succeeds, no error is raised, and the tool simply is not there. That makes
  // discover_tools a no-op exactly when it matters most, and breaks the promise
  // that hidden tools remain reachable.
  //
  // Reserve one slot per not-yet-pinned default or explicitly-loaded tool, then
  // replay the pin only up to the remaining room. The prefix stays byte-identical
  // up to the eviction point (the longest common prefix still achievable) and the
  // new tool lands at the tail, where breaking the cache boundary costs least.
  // The reserve is itself capped at half the limit so a large discover_tools load
  // can never evict the entire established prefix in one turn.
  // Compare against the part of the pin that will actually FIT, not the whole
  // pin. discover_tools appends the new name to the pin, so a naive
  // "is it in the pin?" test reports it as already covered while it in fact
  // sits at position 129 of a 128-slot array — which is exactly how it was
  // being silently dropped.
  const pinnedList = Array.isArray(pinnedNames) ? pinnedNames : [];

  // Priority names are the ones that must be present no matter what: the
  // always-on defaults (discover_tools among them) and everything the model has
  // explicitly loaded this conversation. Deduplicated — a name can be in both.
  const priorityNames = new Set([
    ...DEFAULT_TOOLS,
    ...(loadedToolNames || []),
  ].filter((n) => byName.has(n)));

  // The reserve is self-referential: how many slots we must hold back depends on
  // how much of the pin we replay, which is itself countLimit minus the reserve.
  // A previously-loaded tool sitting at the TAIL of the pin falls outside the
  // shortened replay and then consumes one of the very slots we reserved, so a
  // single pass under-counts and the newest load is still dropped. Iterate to a
  // fixed point instead; the reserve only ever grows, so this converges in a
  // couple of rounds and is bounded regardless.
  const maxReserve = Number.isFinite(countLimit) ? Math.floor(countLimit / 2) : 0;
  let reserve = 0;
  if (Number.isFinite(countLimit)) {
    for (let i = 0; i < 8; i++) {
      const head = new Set(pinnedList.slice(0, Math.max(0, countLimit - reserve)));
      let need = 0;
      for (const n of priorityNames) if (!head.has(n)) need++;
      const next = Math.min(need, maxReserve);
      if (next === reserve) break;
      reserve = next;
    }
  }
  const pinnedCap = Number.isFinite(countLimit) ? Math.max(0, countLimit - reserve) : Infinity;

  // Rule 2: replay the pinned order first so the prefix is byte-stable.
  if (Array.isArray(pinnedNames)) {
    for (const name of pinnedNames) {
      if (chosen.length >= pinnedCap) break;
      tryAdd(name, { force: true });
    }
  }

  // Always-available defaults (discover_tools is in here — it is the escape
  // hatch back to everything we are about to hide, so it is force-added).
  for (const name of DEFAULT_TOOLS) tryAdd(name, { force: true });

  // Tools the model explicitly loaded this conversation.
  if (loadedToolNames) {
    for (const name of loadedToolNames) tryAdd(name, { force: true });
  }

  // Fill the remainder in registry order — deterministic across turns.
  for (const s of all) tryAdd(s?.function?.name);

  return {
    schemas: chosen,
    capped: true,
    toolTokens: used,
    pinnedNames: chosen.map((s) => s.function.name),
    hiddenCount: all.length - chosen.length,
  };
}

/**
 * Build the list of non-default, non-grouped tool names from available schemas.
 * Used by discover_tools browse to show the dynamic "installed" category.
 *
 * @param {Array} allSchemas - All available tool schemas
 * @returns {string[]} Tool names in the "installed" bucket
 */
export function getInstalledToolNames(allSchemas) {
  return allSchemas
    .map((s) => s.function?.name)
    .filter((name) => name && !DEFAULT_TOOLS.has(name) && !ALL_GROUPED_TOOL_NAMES.has(name));
}
