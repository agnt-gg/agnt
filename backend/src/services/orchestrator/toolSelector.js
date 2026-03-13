/**
 * Dynamic Tool Selector — Fewest Tools First
 *
 * Starts with the minimum tools needed based on keyword matching.
 * Provides a `discover_tools` meta-tool for the LLM to dynamically
 * browse and load additional tool categories mid-conversation.
 */

/**
 * Tool groups — each group maps to an array of native tool names.
 * Registry/plugin tools are always included (user explicitly installed them).
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
  ],
};

/**
 * GROUP_TRIGGERS — regex patterns that trigger each group.
 * Core is included whenever ANY other group triggers (not by default).
 */
export const GROUP_TRIGGERS = {
  core: null, // Never triggered by keywords directly — included as a dependency
  shell: /\b(shell|terminal|bash|command\s*line|cli|codex|npm|pip|apt|brew|cmd)\b/i,
  agnt_platform: /\b(workflow|agent|goal|tool|skill|api|agnt|plugin|forge)\b/i,
  media: /\b(image|photo|picture|vision|draw|dall[\s-]?e|generate\s+(?:a\s+)?(?:photo|picture|image)|analyze\s+(?:this\s+)?(?:image|photo|picture)|screenshot|ocr)\b/i,
  email: /\b(email|e-mail|mail|compose|smtp|send\s+(?:a\s+)?(?:message|letter))\b/i,
  memory: /\b(remember|memory|recall|forget|memorize)\b/i,
};

/**
 * GROUP_DESCRIPTIONS — human-readable descriptions for discover_tools browse.
 */
export const GROUP_DESCRIPTIONS = {
  core: 'Code execution, file operations, web search & scrape, data queries',
  shell: 'Terminal/shell commands, CLI tools, Codex CLI',
  agnt_platform: 'Workflow management, agent management, goals, tools, skills, AGNT API',
  media: 'Image analysis (vision/OCR) and image generation (DALL-E, Gemini, Grok)',
  email: 'Send emails via SMTP',
  memory: 'Save and retrieve agent memories across conversations',
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
]);

/**
 * Set of all native tool names across all groups.
 * Used to distinguish native tools (which we filter) from registry/plugin tools (which always pass through).
 */
const ALL_NATIVE_TOOL_NAMES = new Set(
  Object.values(TOOL_GROUPS).flat()
);

/**
 * Select tools for the orchestrator based on keyword matching against the user message.
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

  // Build the set of native tool names that should be included
  const includedToolNames = new Set();
  for (const group of matchedGroups) {
    for (const toolName of TOOL_GROUPS[group]) {
      includedToolNames.add(toolName);
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
  // - Native tools: only include if they're in a matched group
  // - Registry/plugin tools: always include (user explicitly installed them)
  // - discover_tools: always include (handled separately in chatConfigs)
  const filteredSchemas = allSchemas.filter((schema) => {
    const name = schema.function?.name;
    if (!name) return false;

    // discover_tools is always included
    if (name === 'discover_tools') return true;

    // Non-native tools (registry/plugin) are always included
    if (!ALL_NATIVE_TOOL_NAMES.has(name)) return true;

    // Native tools: only include if in a matched group
    return includedToolNames.has(name);
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
 *
 * @param {Array} allSchemas - All available tool schemas
 * @param {Iterable<string>} categories - Category names to load
 * @returns {Array} Matching tool schemas
 */
export function getToolsForCategories(allSchemas, categories) {
  const targetNames = new Set();
  for (const cat of categories) {
    const tools = TOOL_GROUPS[cat];
    if (tools) {
      for (const name of tools) {
        targetNames.add(name);
      }
    }
  }

  return allSchemas.filter((schema) => {
    const name = schema.function?.name;
    return name && targetNames.has(name);
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
