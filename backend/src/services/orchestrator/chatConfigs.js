import { getAvailableToolSchemas } from './tools.js';
import { selectTools, getToolsForCategories, DEFAULT_TOOLS } from './toolSelector.js';
import { buildUnifiedSystemPrompt } from './system-prompts/buildUnifiedPrompt.js';
import { loadWorkspaceContextSection } from './workspaceContext.js';
import { estimateTokens } from '../../utils/contextManager.js';

export const AGENT_DEFAULT_TOOLS = new Set([
  'discover_tools',
  'web_search',
  // Memory recall — default-on for every saved agent chat. Toggleable from
  // the per-channel tool selector if the user wants to opt out.
  'recall',
  'list_recent',
  'get_trace',
  // Skills + memory write-side. The unified prompt instructs every agent to
  // call activate_skill for catalog skills and save_agent_memory to persist
  // learnings — these MUST be in the schema list or the model improvises
  // (wrong skills, recreated content, no persistence). See PRD discussion:
  // agents were being told about tools they could not call.
  'activate_skill',
  'save_agent_memory',
  'get_agent_memories',
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
    let memories;
    if (query) {
      memories = await AgentMemoryModel.findRelevant(agentId, userId, query, 15);
    } else if (agentId) {
      // Agent's own memories first; backfill from the user-wide pool so a
      // freshly created agent isn't born amnesiac (it inherits the global
      // context the orchestrator has accumulated).
      const own = await AgentMemoryModel.findByAgentId(agentId, { limit: 15 });
      memories = own;
      if (own.length < 15) {
        const seen = new Set(own.map((m) => m.id));
        const global = await AgentMemoryModel.findByUserId(userId, { limit: 15 });
        for (const m of global) {
          if (memories.length >= 15) break;
          if (!seen.has(m.id)) memories.push(m);
        }
      }
    } else {
      memories = await AgentMemoryModel.findByUserId(userId, { limit: 15 });
    }
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

// Resolve the per-user "Async tool execution" toggle. Cached on the context
// for the life of the chat turn so we hit the DB once even though both the
// tool-schema fetcher and the prompt builder need the answer. Defaults to
// FALSE (off) — async tool execution is an experimental opt-in capability;
// any failure to load the user's preference, missing userId, or unknown
// row falls back to off. Strict equality coercion (=== true) means anything
// other than an explicit `true` from the DB is treated as off.
async function loadAsyncToolsEnabled(context) {
  if (context._frozenAsyncToolsEnabled !== undefined) return context._frozenAsyncToolsEnabled;

  let asyncToolsEnabled = false;
  try {
    if (context.userId) {
      const UserModel = (await import('../../models/UserModel.js')).default;
      const settings = await UserModel.getUserSettings(context.userId);
      asyncToolsEnabled = settings.asyncToolsEnabled === true;
    }
  } catch (e) {
    console.warn('[chatConfigs] Failed to load asyncToolsEnabled:', e.message);
  }

  context._frozenAsyncToolsEnabled = asyncToolsEnabled;
  return asyncToolsEnabled;
}

// Resolve the agent's assignedSkills (ids, names, or slugs) to catalog
// entries so the prompt can highlight them as the agent's specialty. Returns
// '' when the agent has no assigned skills or resolution fails.
async function buildSpecialtySkillsSection(assignedSkills) {
  if (!Array.isArray(assignedSkills) || assignedSkills.length === 0) return '';
  try {
    const entries = [];
    const seenNames = new Set();
    const assignedSet = new Set(assignedSkills);

    try {
      const SkillDiscoveryService = (await import('../SkillDiscoveryService.js')).default;
      if (SkillDiscoveryService.initialized) {
        for (const ds of SkillDiscoveryService.getSkillCatalog()) {
          if (assignedSet.has(ds.name) || assignedSet.has(ds.slug)) {
            entries.push({ name: ds.name, description: ds.description });
            seenNames.add(ds.name);
          }
        }
      }
    } catch {
      // Discovery service may not be initialized.
    }

    const SkillModel = (await import('../../models/SkillModel.js')).default;
    const records = await SkillModel.findByIds(assignedSkills);
    for (const s of records) {
      const key = s.slug || s.name;
      if (!seenNames.has(key)) {
        entries.push({ name: key, description: s.description });
        seenNames.add(key);
      }
    }

    if (entries.length === 0) return '';
    const lines = entries.map((e) => `- ${e.name}: ${e.description || ''}`).join('\n');
    return `## Your Specialty Skills\nThese skills are your assigned domain expertise. Activate them proactively with the activate_skill tool whenever a request touches their domain — do not recreate their contents from memory:\n${lines}`;
  } catch (e) {
    console.warn('[chatConfigs] Failed to build specialty skills section:', e.message);
    return '';
  }
}

async function loadAgentOverride(context) {
  const isSavedAgent = context.agentId && context.agentId !== 'agent-chat';
  if (!isSavedAgent) return null;

  // DB-first: the saved agent record is the single source of truth for the
  // persona. Entry points (AgentService, agnt_chat tool, external bridges)
  // historically passed a pre-built mega-prompt in agentContext.systemPrompt
  // that duplicated platform blocks the unified builder already supplies —
  // preferring the DB row keeps the persona clean regardless of caller.
  try {
    const AgentModel = (await import('../../models/AgentModel.js')).default;
    const agent = await AgentModel.findOne(context.agentId);
    if (agent) {
      context.agentContext = {
        ...context.agentContext,
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt || '',
      };
      const assignedTools = Array.isArray(agent.assignedTools) ? agent.assignedTools : [];
      // Wording must match the actual tool surface: in restricted mode the
      // assigned list (plus baseline primitives) IS the complete toolset —
      // claiming a "full platform surface" would instruct the model to call
      // tools it cannot see.
      const isOpen = agent.toolAccessMode === 'open';
      let pinnedToolsSection = '';
      if (assignedTools.length > 0) {
        pinnedToolsSection = isOpen
          ? `## Your Core Tools\nThese tools are pinned to you and always available: ${assignedTools.join(', ')}.\nYou also have the full platform tool surface — use discover_tools to browse and load more when a task needs them.`
          : `## Your Core Tools\nYour assigned toolset: ${assignedTools.join(', ')} — plus the baseline tools in your schema list (web_search, memory, skills). This is your complete tool surface; if a request needs a capability outside it, say so plainly instead of improvising.`;
      } else if (!isOpen) {
        pinnedToolsSection = `## Your Tool Surface\nYou have a focused baseline toolset (web_search, memory recall/save, skill activation). If a request needs a capability outside it, say so plainly instead of improvising.`;
      }
      return {
        name: agent.name,
        description: agent.description || '',
        systemPrompt: agent.systemPrompt || '',
        toolAccessMode: isOpen ? 'open' : 'restricted',
        specialtySkillsSection: await buildSpecialtySkillsSection(agent.assignedSkills),
        pinnedToolsSection,
      };
    }
  } catch (e) {
    console.warn(`[chatConfigs] Failed to load agent ${context.agentId} from DB:`, e.message);
  }

  // Fallback for transient DB failures: use whatever the caller supplied.
  if (context.agentContext?.systemPrompt || context.agentContext?.name) {
    return {
      name: context.agentContext.name,
      description: context.agentContext.description || '',
      systemPrompt: context.agentContext.systemPrompt || '',
    };
  }
  return null;
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
  // Tutorial / in-app guidance — every chat surface should be able to point
  // at UI elements or run a guided tour, regardless of specialty.
  'list_tutorial_targets',
  'highlight_element',
  'start_guided_tour',
  'end_guided_tour',
  'scan_page_elements',
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

// "All tools" is a MODE, not a list. The frontend historically enumerated
// every tool as the orchestrator default, so a whitelist covering (nearly)
// the entire registry doesn't mean the user narrowed anything — it means "no
// opinion", persisted eagerly. Honouring it verbatim routes around the lazy
// discovery system (DEFAULT_TOOLS + keyword groups + discover_tools) and
// ships the full ~300-schema surface (~120k tokens) on every turn. At or
// above this coverage the whitelist degrades to auto/discovery mode; any
// explicitly unchecked names survive as a deny-list so deliberate opt-outs
// still stick. 0.95 catches stale "everything" saves and legacy global lists
// while leaving genuinely curated selections alone.
const FULL_COVERAGE_AUTO_THRESHOLD = 0.95;

// Append-only tool ordering for the discovery path. Without this, a newly
// matched keyword group interleaves its tools at their registry positions,
// shifting every later schema and invalidating the provider's cached prompt
// prefix from the first moved entry onward. We remember first-seen order per
// conversation (_toolOrder — persisted across turns like _loadedToolGroups)
// and emit previously seen tools in their original order, then new arrivals
// appended — so each turn's tools array is an exact prefix-extension of the
// last. discover_tools mid-turn appends register their names directly (see
// OrchestratorService dynamic loading) so the next turn replays the same
// order.
// Record WHY each tool made it into the request, plus the shape of the
// surface as a whole. The selection rules already know all of this — without
// capturing it here the reason is lost by the time the panel renders, and
// "why is my context 120k" becomes unanswerable from the UI.
function recordToolManifest(context, { schemas, registryTotal, mode, provenance, groups, deniedCount }) {
  context._toolProvenance = provenance || {};
  context._toolSurfaceMeta = {
    registryTotal: registryTotal || 0,
    mode,
    groups: groups ? [...groups] : [],
    deniedCount: deniedCount || 0,
  };
  return schemas;
}

function applyStableToolOrder(context, schemas) {
  const priorOrder = Array.isArray(context._toolOrder) ? context._toolOrder : [];
  const byName = new Map();
  const unnamed = [];
  for (const s of schemas) {
    const n = s.function?.name;
    if (n && !byName.has(n)) byName.set(n, s);
    else if (!n) unnamed.push(s);
  }
  const ordered = [];
  const seen = new Set();
  for (const n of priorOrder) {
    const s = byName.get(n);
    if (s && !seen.has(n)) {
      ordered.push(s);
      seen.add(n);
    }
  }
  const appended = [];
  for (const [n, s] of byName) {
    if (!seen.has(n)) {
      ordered.push(s);
      seen.add(n);
      appended.push(n);
    }
  }
  // Names absent this turn (e.g. a plugin briefly uninstalled) keep their
  // slot in _toolOrder so a later return doesn't reshuffle the array.
  const priorSet = new Set(priorOrder);
  context._toolOrder = [...priorOrder, ...appended.filter((n) => !priorSet.has(n))];
  return [...ordered, ...unnamed];
}

// mcp_client is a universal capability — every sidebar chat needs awareness
// of MCP servers regardless of its specialty. Including it in every list so
// the strict-scoping introduced in v0.5.7 doesn't accidentally hide it.
// Memory recall tools — default-on for every sidebar chat. They're not
// "specialty" in the page-specific sense (the page works without them) but
// they're useful enough across surfaces that we include them in the default
// tool list so first-open chats have them. The frontend treats them as
// regular toggleable tools — users can turn them off per-channel.
const MEMORY_DEFAULTS = ['recall', 'list_recent', 'get_trace'];

const SIDEBAR_SPECIALTY = {
  agent: ['generate_agent', 'modify_agent', 'save_agent', 'load_agent', 'delete_agent', 'list_agents', 'run_agent', 'get_agnt_api', 'mcp_client', ...MEMORY_DEFAULTS],
  workflow: ['update_workflow', 'revert_workflow', 'list_workflow_versions', 'create_checkpoint', 'get_available_tool_node_types', 'get_node_type_schema', 'start_workflow', 'stop_workflow', 'get_agnt_api', 'mcp_client', ...MEMORY_DEFAULTS],
  tool: ['generate_tool_update', 'save_tool', 'load_tool', 'delete_tool', 'list_tools', 'run_tool', 'get_agnt_api', 'mcp_client', ...MEMORY_DEFAULTS],
  widget: ['edit_widget_code', 'generate_widget', 'update_widget_config', 'save_widget', 'load_widget', 'get_agnt_api', 'mcp_client', ...MEMORY_DEFAULTS],
  artifact: ['read_file', 'write_file', 'edit_file', 'list_files', 'grep_files', 'glob_files', 'query_data', 'get_agnt_api', 'mcp_client', ...MEMORY_DEFAULTS],
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

  // RESTRICTED mode (the DEFAULT): assignedTools are the ceiling — the agent
  // sees only its assigned tools + agent defaults + universal primitives.
  // The assigned checklist in the editor reads as a boundary, so it behaves
  // as one unless the user explicitly opts the agent into 'open' via the
  // Tool Access toggle in the agent editor.
  if (agent?.toolAccessMode !== 'open') {
    const allowedToolNames = new Set([...AGENT_DEFAULT_TOOLS, ...assignedToolNames, ...UNIVERSAL_TOOLS]);
    let restrictedSchemas = allSchemas.filter((tool) => {
      const name = tool.function?.name;
      return name && (allowedToolNames.has(name) || isUniversalToolName(name));
    });
    if (context.enabledTools) {
      const runtimeAllowed = new Set([...context.enabledTools, ...UNIVERSAL_TOOLS]);
      restrictedSchemas = restrictedSchemas.filter((s) => {
        const name = s.function?.name;
        return name && runtimeAllowed.has(name);
      });
    }
    console.log(
      `[UnifiedChat] Saved-agent (restricted) tool surface for ${context.agentId}: ${restrictedSchemas.length} tools`
    );
    return restrictedSchemas;
  }

  // OPEN mode (opt-in via toolAccessMode='open'): a saved agent gets the
  // SAME dynamic tool system as the main orchestrator chat — DEFAULT_TOOLS
  // always on, keyword-triggered groups per message, discover_tools loads
  // persisted across turns via _loadedToolGroups — PLUS its assignedTools as
  // pins that are guaranteed present every turn regardless of keyword
  // matching. In this mode assignedTools is not a ceiling; it is the agent's
  // always-on core kit.
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

  const pinned = new Set(assignedToolNames);
  let filteredSchemas = allSchemas.filter((schema) => {
    const name = schema.function?.name;
    if (!name) return false;
    if (pinned.has(name)) return true;
    if (DEFAULT_TOOLS.has(name)) return true;
    if (AGENT_DEFAULT_TOOLS.has(name)) return true;
    if (isUniversalToolName(name)) return true;
    return groupToolNames.has(name);
  });

  context._loadedToolGroups = allGroups;

  // Runtime enabledTools (per-channel tool selector) still narrows — the
  // user's checkboxes are the single source of truth when present. Universal
  // primitives ride along as always.
  if (context.enabledTools) {
    const runtimeAllowed = new Set([...context.enabledTools, ...UNIVERSAL_TOOLS]);
    filteredSchemas = filteredSchemas.filter((s) => {
      const name = s.function?.name;
      return name && runtimeAllowed.has(name);
    });
  }

  console.log(
    `[UnifiedChat] Saved-agent tool surface for ${context.agentId}: ${filteredSchemas.length} tools (${assignedToolNames.length} pinned, groups: [${[...allGroups].join(', ')}])`
  );
  const agentProv = {};
  const assigned = new Set(assignedToolNames);
  for (const s of filteredSchemas) {
    const n = s.function?.name;
    if (!n) continue;
    if (assigned.has(n)) agentProv[n] = { reason: 'assigned' };
    else if (AGENT_DEFAULT_TOOLS.has(n)) agentProv[n] = { reason: 'default' };
    else if (isUniversalToolName(n)) agentProv[n] = { reason: 'universal' };
    else agentProv[n] = { reason: 'group' };
  }
  return recordToolManifest(context, {
    schemas: applyStableToolOrder(context, filteredSchemas),
    registryTotal: allSchemas.length,
    mode: 'agent',
    provenance: agentProv,
    groups: allGroups,
  });
}

async function getUnifiedToolSchemas(context) {
  const asyncEnabled = await loadAsyncToolsEnabled(context);
  const allSchemas = await getAvailableToolSchemas({ asyncEnabled, userId: context.userId || null });

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
  let denyNames = null;
  if (context.enabledTools instanceof Set) {
    const namedSchemas = allSchemas.filter((s) => s.function?.name);
    const coveredCount = namedSchemas.reduce(
      (acc, s) => acc + (context.enabledTools.has(s.function.name) ? 1 : 0),
      0
    );
    const coverage = namedSchemas.length > 0 ? coveredCount / namedSchemas.length : 1;
    if (coverage >= FULL_COVERAGE_AUTO_THRESHOLD) {
      // Near-full coverage = "all tools" mode, not a curated list. Degrade to
      // the lazy discovery path below; keep explicit opt-outs as a deny-list.
      denyNames = new Set();
      for (const s of namedSchemas) {
        const name = s.function.name;
        if (!context.enabledTools.has(name) && !isUniversalToolName(name)) denyNames.add(name);
      }
      console.log(
        `[UnifiedChat] enabledTools covers ${(coverage * 100).toFixed(1)}% of ${namedSchemas.length} tools -> auto (discovery) mode${denyNames.size ? ` with ${denyNames.size} opt-outs` : ''}`
      );
    } else {
      const allowed = new Set([...context.enabledTools, ...UNIVERSAL_TOOLS]);
      const filteredSchemas = allSchemas.filter((s) => {
        const name = s.function?.name;
        return name && allowed.has(name);
      });
      console.log(`[UnifiedChat] enabledTools whitelist (${context.enabledTools.size} requested + ${UNIVERSAL_TOOLS.size} universal) -> ${filteredSchemas.length} tools`);
      const prov = {};
      for (const s of filteredSchemas) {
        const n = s.function?.name;
        if (n) prov[n] = { reason: isUniversalToolName(n) && !context.enabledTools.has(n) ? 'universal' : 'selected' };
      }
      return recordToolManifest(context, {
        schemas: filteredSchemas, registryTotal: namedSchemas.length, mode: 'whitelist', provenance: prov,
      });
    }
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
    const prov = {};
    for (const s of filteredSchemas) {
      const n = s.function?.name;
      if (n) prov[n] = { reason: specialty.has ? (specialty.has(n) ? 'specialty' : 'universal') : 'specialty' };
    }
    return recordToolManifest(context, {
      schemas: filteredSchemas, registryTotal: allSchemas.length, mode: 'specialty', provenance: prov,
    });
  }

  const latestUserMessage = context.latestUserMessage || '';
  const { matchedGroups } = selectTools(allSchemas, latestUserMessage);
  const forcedGroups = getForcedToolGroups(context);
  const previousGroups = context._loadedToolGroups || new Set();
  const allGroups = new Set([...previousGroups, ...matchedGroups, ...forcedGroups]);

  const groupToolNames = new Set();
  // First group to contribute a tool is the one credited in the manifest.
  const groupOfTool = new Map();
  for (const group of allGroups) {
    const tools = getToolsForCategories(allSchemas, [group]);
    for (const t of tools) {
      const n = t.function?.name;
      if (!n) continue;
      groupToolNames.add(n);
      if (!groupOfTool.has(n)) groupOfTool.set(n, group);
    }
  }

  const filteredSchemas = allSchemas.filter((schema) => {
    const name = schema.function?.name;
    if (!name) return false;
    // Auto-degraded whitelist: explicitly unchecked tools stay off even in
    // discovery mode — the deny-list wins over DEFAULT_TOOLS and groups.
    if (denyNames && denyNames.has(name)) return false;
    if (DEFAULT_TOOLS.has(name)) return true;
    // UNIVERSAL_TOOLS ride along on the orchestrator/keyword path too —
    // without this the tutorial tools only loaded when the user message
    // matched the `tutorial` trigger regex, which meant the assistant
    // couldn't proactively offer to highlight things mid-conversation.
    if (isUniversalToolName(name)) return true;
    return groupToolNames.has(name);
  });

  context._loadedToolGroups = allGroups;
  console.log(`[UnifiedChat] Tool groups: [${[...allGroups].join(', ')}] -> ${filteredSchemas.length} tools`);

  const loadedNames = context._loadedToolNames || new Set();
  const prov = {};
  for (const s of filteredSchemas) {
    const n = s.function?.name;
    if (!n) continue;
    // Order matters: a tool pulled in mid-conversation by discover_tools is
    // reported as discovered even if a group later covers it, because that is
    // the event that actually changed the surface.
    if (loadedNames.has(n)) prov[n] = { reason: 'discovered' };
    else if (DEFAULT_TOOLS.has(n)) prov[n] = { reason: 'default' };
    else if (groupOfTool.has(n)) prov[n] = { reason: 'group', group: groupOfTool.get(n) };
    else if (isUniversalToolName(n)) prov[n] = { reason: 'universal' };
    else prov[n] = { reason: 'default' };
  }
  return recordToolManifest(context, {
    schemas: applyStableToolOrder(context, filteredSchemas),
    registryTotal: allSchemas.length,
    mode: denyNames ? 'auto-degraded' : 'auto',
    provenance: prov,
    groups: allGroups,
    deniedCount: denyNames ? denyNames.size : 0,
  });
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
    const asyncToolsEnabled = await loadAsyncToolsEnabled(context);

    // Size each dynamic section BEFORE assembly. These are the parts that
    // vary per user/conversation; the panel subtracts them from the total to
    // show how much is the hand-written prompt itself.
    context._promptSections = [
      { id: 'memory', label: 'Memory', tokens: estimateTokens(memorySection || ''), frozen: true },
      { id: 'skills', label: 'Skills catalog', tokens: estimateTokens(skillsCatalogSection || ''), frozen: true },
      { id: 'custom', label: 'Custom instructions', tokens: estimateTokens(customInstructionsSection || ''), frozen: true },
      { id: 'workspace', label: 'Workspace context', tokens: estimateTokens(workspaceSection || ''), frozen: false },
      { id: 'agent', label: 'Agent override', tokens: estimateTokens(agentOverride || ''), frozen: true },
    ];

    return buildUnifiedSystemPrompt(context, {
      skillsCatalogSection,
      memorySection,
      customInstructionsSection,
      workspaceSection,
      agentOverride,
      asyncToolsEnabled,
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
