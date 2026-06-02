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
    'get_agnt_api',
  ],
  artifact_code: [
    'read_file',
    'write_file',
    'edit_file',
    'list_files',
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
  artifact_code: /\b(artifact|file|files|workspace|read\s+file|write\s+file|edit\s+file|code|html|markdown)\b/i,
  goal_management: /\b(goal|task|tasks|progress|evaluate|golden\s*standard)\b/i,
  media: /\b(image|photo|picture|vision|draw|dall[\s-]?e|generate\s+(?:a\s+)?(?:photo|picture|image)|analyze\s+(?:this\s+)?(?:image|photo|picture)|screenshot|ocr)\b/i,
  email: /\b(email|e-mail|mail|compose|smtp|send\s+(?:a\s+)?(?:message|letter))\b/i,
  memory: /\b(remember|memory|recall|forget|memorize|last\s+(?:week|month|year|night|time)|earlier|previously|history|trace|traces|find\s+(?:that|the|when|where)|did\s+(?:you|we)\s+ever|what\s+did\s+(?:you|we)\s+do)\b/i,
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
  artifact_code: 'Read, write, edit, and list files in the Artifacts workspace',
  goal_management: 'Create, execute, monitor, evaluate, and manage goals and goal tasks',
  media: 'Image analysis (vision/OCR) and image generation (DALL-E, Gemini, Grok)',
  email: 'Send emails via SMTP',
  memory: 'Persistent history search (recall / list_recent / get_trace) and per-agent memory storage',
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
