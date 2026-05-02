import { getAvailableToolSchemas } from './tools.js';
import { selectTools, getToolsForCategories, DEFAULT_TOOLS } from './toolSelector.js';
import { buildUnifiedSystemPrompt } from './system-prompts/buildUnifiedPrompt.js';

export const AGENT_DEFAULT_TOOLS = new Set([
  'discover_tools',
  'web_search',
]);

const CHAT_OVERRIDES = {
  orchestrator: { maxToolRounds: 100, contextKey: null },
  agent: { maxToolRounds: 100, contextKey: 'agentContext' },
  workflow: { maxToolRounds: 25, contextKey: 'workflowContext' },
  tool: { maxToolRounds: 100, contextKey: 'toolContext' },
  widget: { maxToolRounds: 100, contextKey: 'widgetContext' },
  goal: { maxToolRounds: 100, contextKey: 'goalContext' },
  artifact: { maxToolRounds: 25, contextKey: 'codeContext' },
};

async function loadMemorySection(userId, query, agentId = null) {
  try {
    if (!userId) return '';
    const AgentMemoryModel = (await import('../../models/AgentMemoryModel.js')).default;
    const memories = query
      ? await AgentMemoryModel.findRelevant(agentId, userId, query, 15)
      : agentId
        ? await AgentMemoryModel.findByAgentId(agentId, { limit: 15 })
        : await AgentMemoryModel.findByUserId(userId, { limit: 15 });
    if (!memories.length) return '';
    const lines = memories.map(m => {
      const source = m.agent_id && m.agent_id !== 'orchestrator' ? ' (from agent)' : '';
      return `- [${m.memory_type}] ${m.content}${source}`;
    }).join('\n');
    return `\n\n## Memory\nRelevant learnings from previous activity:\n${lines}`;
  } catch (e) {
    console.warn('[chatConfigs] Failed to load memories:', e.message);
    return '';
  }
}

async function loadSkillsCatalogSection(context) {
  if (context._frozenSkillsCatalog !== undefined) return context._frozenSkillsCatalog;

  let skillsCatalogSection = '';
  try {
    const { buildSkillCatalog, buildSkillActivationInstructions } = await import('../SkillService.js');
    const catalogEntries = [];
    const seenNames = new Set();

    try {
      const SkillDiscoveryService = (await import('../SkillDiscoveryService.js')).default;
      if (SkillDiscoveryService.initialized) {
        const discovered = SkillDiscoveryService.getSkillCatalog();
        for (const ds of discovered) {
          catalogEntries.push(ds);
          seenNames.add(ds.name);
        }
      }
    } catch {
      // Discovery service may not be initialized.
    }

    if (context.userId) {
      const SkillModel = (await import('../../models/SkillModel.js')).default;
      const dbSkills = await SkillModel.findAll(context.userId);
      for (const s of dbSkills) {
        const key = s.slug || s.name;
        if (!seenNames.has(key)) {
          catalogEntries.push({ name: s.slug || s.name, description: s.description, source: 'database' });
          seenNames.add(key);
        }
      }
    }

    if (catalogEntries.length > 0) {
      skillsCatalogSection = '\n' + buildSkillCatalog(catalogEntries) + '\n\n' + buildSkillActivationInstructions() + '\n';
    }
  } catch (e) {
    console.warn('[chatConfigs] Failed to build skill catalog:', e.message);
  }

  context._frozenSkillsCatalog = skillsCatalogSection;
  return skillsCatalogSection;
}

async function loadFrozenMemorySection(context, agentId = null) {
  if (context._frozenMemorySection !== undefined) return context._frozenMemorySection;

  let memorySection = '';
  try {
    memorySection = await loadMemorySection(context.userId, context.latestUserMessage, agentId);
    if (agentId && memorySection) {
      memorySection += '\n\nUse these memories to provide personalized responses. If you learn new facts or receive corrections, use save_agent_memory to store them.';
    }
  } catch (e) {
    console.warn('[chatConfigs] Failed to load memories:', e.message);
  }

  context._frozenMemorySection = memorySection;
  return memorySection;
}

async function loadCustomInstructionsSection(context) {
  if (context._frozenCustomInstructions !== undefined) return context._frozenCustomInstructions;

  let customInstructionsSection = '';
  try {
    if (context.userId) {
      const UserModel = (await import('../../models/UserModel.js')).default;
      const settings = await UserModel.getUserSettings(context.userId);
      const raw = (settings.customInstructions || '').trim();
      if (raw) {
        customInstructionsSection = `## User's Custom System Instructions\nThe user has provided these persistent instructions that apply to every Annie chat. Follow them unless they conflict with safety, tool-usage, or image-handling requirements above.\n\n${raw}`;
      }
    }
  } catch (e) {
    console.warn('[chatConfigs] Failed to load custom instructions:', e.message);
  }

  context._frozenCustomInstructions = customInstructionsSection;
  return customInstructionsSection;
}

// Single source of truth for the user's workspace directory across every chat
// surface (orchestrator, agent, workflow, tool, widget, goal, artifact). The
// path is set in onboarding and editable in artifacts settings; reading it
// here means tools that take a file path can default to under the workspace.
async function loadWorkspaceContextSection() {
  try {
    const { getWorkspaceRootPath } = await import('./codeTools.js');
    const workspaceRoot = await getWorkspaceRootPath();
    if (!workspaceRoot) return '';
    return `## Workspace
The user's workspace directory is: ${workspaceRoot}
When you create, edit, or save files on the user's behalf, place them under this workspace path unless the user explicitly names a different location. This is where their project files live, and any tool that accepts a file path (file_operations, write_file, code generators, video tools, etc.) should default to a path under here.`;
  } catch (e) {
    console.warn('[chatConfigs] Failed to load workspace root:', e.message);
    return '';
  }
}

async function loadAgentOverride(context) {
  const isSavedAgent = context.agentId && context.agentId !== 'agent-chat';
  if (!isSavedAgent) return null;

  if (context.agentContext?.systemPrompt) {
    return {
      name: context.agentContext.name,
      systemPrompt: context.agentContext.systemPrompt,
    };
  }

  try {
    const AgentModel = (await import('../../models/AgentModel.js')).default;
    const agent = await AgentModel.findOne(context.agentId);
    if (!agent) return null;
    context.agentContext = {
      ...context.agentContext,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt || '',
    };
    return {
      name: agent.name,
      systemPrompt: agent.systemPrompt || '',
    };
  } catch (e) {
    console.warn(`[chatConfigs] Failed to load agent ${context.agentId} from DB:`, e.message);
    return null;
  }
}

function getForcedToolGroups(context) {
  const groups = new Set();

  if (context.workflowId || context.workflowContext || context.workflowState) {
    groups.add('workflow_authoring');
    groups.add('agnt_platform');
  }
  if (context.agentId === 'agent-chat') {
    groups.add('agent_management');
    groups.add('agnt_platform');
  }
  if (context.toolId || context.toolContext || context.toolState) {
    groups.add('tool_authoring');
    groups.add('agnt_platform');
  }
  if (context.widgetId || context.widgetContext || context.widgetState) {
    groups.add('widget_authoring');
    groups.add('agnt_platform');
  }
  if (context.goalId || context.goalContext) {
    groups.add('goal_management');
    groups.add('agnt_platform');
  }
  if (context.codeId || context.codeContext) {
    groups.add('artifact_code');
  }
  if (context.imageData && context.imageData.length > 0) {
    groups.add('media');
  }

  if (groups.size > 0) groups.add('core');
  return groups;
}

// Backend mirror of the frontend SIDEBAR_DEFAULTS in chatChannelConfig.js.
// If a sidebar chat reaches the backend without an explicit enabledTools list
// (older client, malformed request, etc.), we still cap its tool surface to
// the page's specialty set instead of falling through to "everything in the
// matched groups". Mirrors must stay in sync with the frontend file.
// Tools that ALWAYS get unioned into the final whitelist for every chat
// surface regardless of what the user has selected. These are system
// primitives — capabilities the assistant must always know about even when
// the user has narrowed the per-channel selector. Without this, the v0.5.7
// strict-scoping silently hides MCP awareness from users who don't have
// `mcp_client` in their saved enabledTools list.
const UNIVERSAL_TOOLS = new Set([
  'mcp_client',
]);

// Per-tool MCP entries are namespaced as `mcp__<server>__<tool>`. We can't
// enumerate them in UNIVERSAL_TOOLS (the set would change every time a user
// configures a server), so we match by prefix during whitelist filtering —
// every mcp__-prefixed tool is implicitly universal.
const UNIVERSAL_TOOL_PREFIXES = ['mcp__'];

function isUniversalToolName(name) {
  if (!name) return false;
  if (UNIVERSAL_TOOLS.has(name)) return true;
  for (const prefix of UNIVERSAL_TOOL_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

// mcp_client is a universal capability — every sidebar chat needs awareness
// of MCP servers regardless of its specialty. Including it in every list so
// the strict-scoping introduced in v0.5.7 doesn't accidentally hide it.
const SIDEBAR_SPECIALTY = {
  agent: ['generate_agent', 'modify_agent', 'save_agent', 'load_agent', 'delete_agent', 'list_agents', 'run_agent', 'get_agnt_api', 'mcp_client'],
  workflow: ['update_workflow', 'revert_workflow', 'list_workflow_versions', 'create_checkpoint', 'get_available_tool_node_types', 'get_node_type_schema', 'start_workflow', 'stop_workflow', 'get_agnt_api', 'mcp_client'],
  tool: ['generate_tool_update', 'save_tool', 'load_tool', 'delete_tool', 'list_tools', 'run_tool', 'get_agnt_api', 'mcp_client'],
  widget: ['edit_widget_code', 'generate_widget', 'update_widget_config', 'save_widget', 'load_widget', 'get_agnt_api', 'mcp_client'],
  artifact: ['read_file', 'write_file', 'edit_file', 'list_files', 'get_agnt_api', 'mcp_client'],
};

function detectSidebarSpecialty(context) {
  if (context.agentId === 'agent-chat') return SIDEBAR_SPECIALTY.agent;
  if (context.workflowId || context.workflowContext || context.workflowState) return SIDEBAR_SPECIALTY.workflow;
  if (context.toolId || context.toolContext || context.toolState) return SIDEBAR_SPECIALTY.tool;
  if (context.widgetId || context.widgetContext || context.widgetState) return SIDEBAR_SPECIALTY.widget;
  if (context.codeId || context.codeContext) return SIDEBAR_SPECIALTY.artifact;
  return null;
}

async function getSavedAgentToolSchemas(context, allSchemas) {
  const AgentModel = (await import('../../models/AgentModel.js')).default;
  const agent = await AgentModel.findOne(context.agentId);
  const assignedToolNames = Array.isArray(agent?.assignedTools) ? agent.assignedTools : [];
  // UNIVERSAL_TOOLS ride along even on saved agents — system primitives like
  // mcp_client should be available regardless of which tools the agent was
  // explicitly assigned at save time.
  const allowedToolNames = new Set([...AGENT_DEFAULT_TOOLS, ...assignedToolNames, ...UNIVERSAL_TOOLS]);

  let filteredSchemas = allSchemas.filter((tool) => {
    const name = tool.function?.name;
    return name && (allowedToolNames.has(name) || isUniversalToolName(name));
  });

  // The agent's assignedTools is a hard ceiling — runtime enabledTools can
  // narrow it further but never widen it beyond what the agent was given.
  // When the frontend sends an explicit enabledTools list it is the single
  // source of truth: we honour the user's checkbox exactly. `mcp_client`
  // (the meta-discovery tool) still rides along as a universal capability,
  // but specific `mcp__server__tool` entries must be in enabledTools to
  // appear — otherwise turning off the MCP category in the sidebar selector
  // had no effect (the LLM still saw every MCP tool via the prefix bypass).
  if (context.enabledTools) {
    const runtimeAllowed = new Set([...context.enabledTools, ...UNIVERSAL_TOOLS]);
    filteredSchemas = filteredSchemas.filter((s) => {
      const name = s.function?.name;
      return name && runtimeAllowed.has(name);
    });
  }

  console.log(
    `[UnifiedChat] Saved-agent tool surface for ${context.agentId}: ${filteredSchemas.length} tools (${assignedToolNames.length} assigned + defaults: ${[...AGENT_DEFAULT_TOOLS].join(', ')})`
  );
  return filteredSchemas;
}

async function getUnifiedToolSchemas(context) {
  const allSchemas = await getAvailableToolSchemas();

  if (context.agentId && context.agentId !== 'agent-chat') {
    return getSavedAgentToolSchemas(context, allSchemas);
  }

  // STRICT FILTER: when the frontend tool selector has sent an enabledTools
  // list, that list is the single source of truth. The chat sees exactly the
  // tools the user has checked, plus a small set of system primitives in
  // UNIVERSAL_TOOLS (currently just `mcp_client`, the meta-discovery tool).
  //
  // The frontend already enumerates specific MCP tool names in enabledTools
  // (e.g. `mcp__chrome-devtools-mcp__click`), so there is no need to bypass
  // the whitelist with a `mcp__` prefix match — that bypass let MCP tools
  // slip through even when the user explicitly turned them off.
  //
  // We honour an *empty* enabledTools Set as "user wants zero tools" — it's
  // a real selection, not a missing one (see OrchestratorService where the
  // distinction is preserved). Only `null`/missing falls through to the
  // no-selection branch below.
  if (context.enabledTools instanceof Set) {
    const allowed = new Set([...context.enabledTools, ...UNIVERSAL_TOOLS]);
    const filteredSchemas = allSchemas.filter((s) => {
      const name = s.function?.name;
      return name && allowed.has(name);
    });
    console.log(`[UnifiedChat] enabledTools whitelist (${context.enabledTools.size} requested + ${UNIVERSAL_TOOLS.size} universal) -> ${filteredSchemas.length} tools`);
    return filteredSchemas;
  }

  // No explicit selection from the client. For sidebar chats, fall back to
  // the page's specialty set (mirrored from the frontend) so we never leak
  // tools the user hasn't asked for. For the orchestrator (no specialty
  // set), keep the dynamic keyword-driven group selection. Universal tools
  // (including every mcp__* entry) always ride along.
  const specialty = detectSidebarSpecialty(context);
  if (specialty) {
    const allowed = new Set([...specialty, ...UNIVERSAL_TOOLS]);
    const filteredSchemas = allSchemas.filter((s) => {
      const name = s.function?.name;
      return name && (allowed.has(name) || isUniversalToolName(name));
    });
    console.log(`[UnifiedChat] Sidebar specialty fallback (no enabledTools sent) -> ${filteredSchemas.length} tools`);
    return filteredSchemas;
  }

  const latestUserMessage = context.latestUserMessage || '';
  const { matchedGroups } = selectTools(allSchemas, latestUserMessage);
  const forcedGroups = getForcedToolGroups(context);
  const previousGroups = context._loadedToolGroups || new Set();
  const allGroups = new Set([...previousGroups, ...matchedGroups, ...forcedGroups]);

  const groupToolNames = new Set();
  for (const group of allGroups) {
    const tools = getToolsForCategories(allSchemas, [group]);
    for (const t of tools) {
      if (t.function?.name) groupToolNames.add(t.function.name);
    }
  }

  const filteredSchemas = allSchemas.filter((schema) => {
    const name = schema.function?.name;
    if (!name) return false;
    if (DEFAULT_TOOLS.has(name)) return true;
    return groupToolNames.has(name);
  });

  context._loadedToolGroups = allGroups;
  console.log(`[UnifiedChat] Tool groups: [${[...allGroups].join(', ')}] -> ${filteredSchemas.length} tools`);
  return filteredSchemas;
}

const unifiedConfig = {
  name: 'unified',
  async getToolSchemas(context) {
    return getUnifiedToolSchemas(context);
  },
  async buildSystemPrompt(context) {
    const agentOverride = await loadAgentOverride(context);
    const skillsCatalogSection = await loadSkillsCatalogSection(context);
    const memorySection = await loadFrozenMemorySection(context, context.agentId && context.agentId !== 'agent-chat' ? context.agentId : null);
    const customInstructionsSection = await loadCustomInstructionsSection(context);
    const workspaceSection = await loadWorkspaceContextSection();

    return buildUnifiedSystemPrompt(context, {
      skillsCatalogSection,
      memorySection,
      customInstructionsSection,
      workspaceSection,
      agentOverride,
    });
  },
  maxToolRounds: 100,
  responseType: 'stream',
  contextKey: null,
};

const suggestionsConfig = {
  name: 'suggestions',
  async getToolSchemas() {
    return [];
  },
  buildSystemPrompt(context) {
    const { agentContext } = context;
    let availableToolsList = '';

    if (agentContext && agentContext.availableTools) {
      availableToolsList = agentContext.availableTools.map((tool) => `- ${tool.function.name}: ${tool.function.description}`).join('\n');
    }

    return `You are a helpful assistant that generates smart, contextual suggestions for the user based on their conversation history.

Your task is to analyze the conversation and generate 3 relevant suggestions that:
1. Build upon what was just discussed
2. Explore related topics or next logical steps
3. Showcase the available tools when appropriate

Available tools to reference in suggestions:
${availableToolsList}

Return ONLY a JSON array with exactly 3 suggestion objects, each with:
- text: The suggestion text (keep it concise, action-oriented)
- icon: An appropriate emoji or symbol

Make suggestions relevant to the conversation context.

IMPORTANT: Return ONLY the JSON array, no markdown formatting, no code blocks, no extra text.`;
  },
  maxToolRounds: 0,
  responseType: 'json',
  contextKey: 'agentContext',
};

export const CHAT_CONFIGS = {
  orchestrator: unifiedConfig,
  agent: unifiedConfig,
  workflow: unifiedConfig,
  tool: unifiedConfig,
  widget: unifiedConfig,
  goal: unifiedConfig,
  artifact: unifiedConfig,
  suggestions: suggestionsConfig,
};

export function detectChatType(req, context = {}) {
  const path = req.path || req.route?.path || '';

  if (path.includes('/agent-chat')) return 'agent';
  if (path.includes('/workflow-chat')) return 'workflow';
  if (path.includes('/tool-chat')) return 'tool';
  if (path.includes('/widget-chat')) return 'widget';
  if (path.includes('/goal-chat')) return 'goal';
  if (path.includes('/artifact-chat')) return 'artifact';
  if (path.includes('/suggestions')) return 'suggestions';

  const body = req.body || {};
  if (body.agentId || body.agentContext || body.agentState) return 'agent';
  if (body.workflowId || body.workflowContext || body.workflowState) return 'workflow';
  if (body.toolId || body.toolContext || body.toolState) return 'tool';
  if (body.widgetId || body.widgetContext || body.widgetState) return 'widget';
  if (body.goalId || body.goalContext) return 'goal';
  if (body.codeId || body.codeContext) return 'artifact';
  if (context.type) return context.type;

  return 'orchestrator';
}

export function getChatConfig(chatType) {
  if (chatType === 'suggestions') return suggestionsConfig;

  const overrides = CHAT_OVERRIDES[chatType] || CHAT_OVERRIDES.orchestrator;
  if (!CHAT_OVERRIDES[chatType]) {
    console.warn(`Unknown chat type: ${chatType}, falling back to orchestrator`);
  }

  return {
    ...unifiedConfig,
    name: chatType,
    ...overrides,
    responseType: 'stream',
  };
}
