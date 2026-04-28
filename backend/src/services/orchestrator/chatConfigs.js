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

async function getSavedAgentToolSchemas(context, allSchemas) {
  const AgentModel = (await import('../../models/AgentModel.js')).default;
  const agent = await AgentModel.findOne(context.agentId);
  const assignedToolNames = Array.isArray(agent?.assignedTools) ? agent.assignedTools : [];
  const allowedToolNames = new Set([...AGENT_DEFAULT_TOOLS, ...assignedToolNames]);

  let filteredSchemas = allSchemas.filter((tool) => allowedToolNames.has(tool.function?.name));

  if (context.enabledTools) {
    filteredSchemas = filteredSchemas.filter((s) => context.enabledTools.has(s.function?.name));
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

  let filteredSchemas = allSchemas.filter((schema) => {
    const name = schema.function?.name;
    if (!name) return false;
    if (DEFAULT_TOOLS.has(name)) return true;
    return groupToolNames.has(name);
  });

  if (context.enabledTools) {
    filteredSchemas = filteredSchemas.filter((s) => context.enabledTools.has(s.function?.name));
  }

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

    return buildUnifiedSystemPrompt(context, {
      skillsCatalogSection,
      memorySection,
      customInstructionsSection,
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
