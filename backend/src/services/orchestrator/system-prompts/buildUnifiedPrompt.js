import {
  CRITICAL_IMAGE_HANDLING,
  CRITICAL_IMAGE_GENERATION,
  OFFLOADED_DATA_GUIDANCE,
  CRITICAL_TOOL_CALL_REQUIREMENTS,
  AGNT_NATIVE_EXECUTION,
  IMAGE_ANALYSIS_CAPABILITIES,
  IMAGE_GENERATION_CAPABILITIES,
  HTML_INLINE_RENDERING,
  LOCAL_FILE_RENDERING,
  RESPONSE_FORMATTING,
  CRITICAL_IMAGE_REFERENCE_FORMATTING,
  IMPORTANT_GUIDELINES,
  CHART_CHEATSHEET,
  MCP_TOOL_USE_RULES,
  MEMORY_RECALL_GUIDANCE,
  CRITICAL_TOOL_RESPONSE_RULES,
  ARTIFACTS_VS_WIDGETS,
} from './orchestrator-chat.js';
import { ASYNC_EXECUTION_GUIDANCE } from './async-execution.js';
import { getPlatformContextSection } from './platform-context.js';
// Declarative gates for every optional block. Kept out of this file so the
// DECISION (is this block resident?) can be unit-tested and cache-audited
// separately from the ASSEMBLY (what order do the blocks go in?), which is
// what this file owns. See promptElements.js for why the gates may only read
// conversation-stable inputs.
import { buildGateInputs, resolveResidentElements } from './promptElements.js';
// The canvas window manifest — which surfaces this turn is federating.
import { listCanvasSurfaces } from '../pageContext.js';
// Per-page detailed prompt content. Each module exports a function that
// returns the rich, page-specific guidance Annie needs when working on that
// surface (workflow node/edge format rules, tool field shapes, widget HTML
// conventions, etc.). buildPageContextBlock() invokes the matching module
// based on which page-context fields the request carries.
import { getWorkflowSystemContent } from './workflow-chat.js';
import { getAgentSystemContent } from './agent-chat.js';
import { getCodeSystemContent } from './artifact-chat.js';
import { getGoalSystemContent } from './goal-chat.js';
import { getToolForgeSystemContent } from './tool-forge-chat.js';
import { getWidgetForgeSystemContent } from './widget-forge-chat.js';

/**
 * Build the unified system prompt. Page-specific detail (workflow node/edge
 * conventions, tool field shapes, widget HTML rules, etc.) is loaded from the
 * dedicated per-page modules and injected when their trigger context is set —
 * see buildPageContextBlock() at the bottom of this file. The async signature
 * is required because the workflow / artifact / widget blocks read from
 * external sources (tool library, workspace files).
 */
export async function buildUnifiedSystemPrompt(context = {}, options = {}) {
  const {
    skillsCatalogSection = '',
    memorySection = '',
    customInstructionsSection = '',
    workspaceSection = '',
    agentOverride = null,
    // Per-user toggle for the async/background tool execution capability.
    // When false, the ASYNC_EXECUTION_GUIDANCE block is omitted from the
    // prompt so the LLM doesn't advertise (or attempt to use) async params
    // that aren't on the tool schemas this turn.
    asyncToolsEnabled = true,
    // Gate decisions resolved once on turn 1 and replayed for the life of the
    // conversation. See below.
    residentElementIds = null,
  } = options;

  // Gate inputs are computed from the RESOLVED TOOL SURFACE (which
  // OrchestratorService assigns to context.toolSchemas before calling this),
  // the frozen per-user async toggle, and the provider. All three are stable
  // or append-only within a conversation, which is what makes gating here
  // free of prompt-cache invalidation — see promptElements.js.
  //
  // Note what is NOT passed: context. The gates cannot reach
  // latestUserMessage, so a message-keyed gate (the expensive kind) cannot be
  // written here by accident.
  const gates = buildGateInputs({
    toolSchemas: Array.isArray(context.toolSchemas) ? context.toolSchemas : [],
    asyncToolsEnabled,
    provider: context.normalizedProvider,
  });
  // FROZEN DECISIONS WIN. chatConfigs resolves the gates once on turn 1 and
  // replays that exact set for the rest of the conversation, because the system
  // block is a cache prefix: a block switching on at turn 4 rewrites every
  // cached message before it. Guidance for tools discovered later is delivered
  // through the discover_tools RESULT instead — see
  // promptElements.getGuidanceForTools — which lands in the append-only message
  // region and costs nothing. Callers that pass nothing (tests, one-shot
  // builds) still get a live resolve.
  const included = residentElementIds
    ? new Set(residentElementIds)
    : resolveResidentElements(gates).included;
  const on = (id) => included.has(id);
  const has = gates.has;

  const parts = [];

  if (agentOverride?.systemPrompt || agentOverride?.name) {
    // Identity first — models weight the opening of the prompt heavily, so
    // the agent's persona frames everything that follows. The platform
    // mechanics below are the same full surface main-chat Annie gets.
    const agentName = agentOverride.name || 'the selected agent';
    const identity = [];
    identity.push(`You are ${agentName}${agentOverride.description ? ` — ${agentOverride.description}` : ''}.`);
    if (agentOverride.systemPrompt) identity.push(agentOverride.systemPrompt);
    identity.push(
      agentOverride.toolAccessMode === 'open'
        ? `Stay in character as ${agentName} at all times. You have the FULL AGNT platform capability surface described below — the same unified tool registry, skills system, and persistent memory as the main assistant. Use it freely in service of your role.`
        : `Stay in character as ${agentName} at all times. You have the AGNT platform capabilities described below (skills, persistent memory, and your assigned toolset). Use them in service of your role, and be plain about anything outside your toolset.`
    );
    parts.push(identity.join('\n\n'));
  } else {
    parts.push(`You are Annie, a helpful assistant with access to AGNT's unified tool registry. Use tools to accomplish the user's request unless it is a trivial conversational task.

Every Annie chat surface is functionally the same assistant. The current page context is a soft signal: prefer tools and interpretations relevant to that page, but you may use any available tool when the user's request crosses domains.`);
  }

  // Workspace path is environment context — every surface should know it
  // before reasoning about file-related tool calls.
  if (workspaceSection) parts.push(workspaceSection);

  // Platform context (OS + shell + shell-specific syntax rules). Cheap to
  // include unconditionally: it's a few hundred bytes and prevents the LLM
  // from emitting bash-flavored commands on Windows (and vice-versa). Without
  // this, the LLM passes multi-line strings to cmd.exe, gets empty stdout,
  // and loops trying alternate syntax — a documented failure mode.
  parts.push(getPlatformContextSection());

  // Image-handling rules only matter if the LLM can actually receive or
  // produce images on this surface.
  if (on('critical_image_handling')) parts.push(CRITICAL_IMAGE_HANDLING);
  if (on('critical_image_generation')) parts.push(CRITICAL_IMAGE_GENERATION);
  parts.push('IMPORTANT: Provider names are automatically normalized to lowercase by the backend. You do not need to worry about provider-name casing.');
  if (on('async_execution')) parts.push(ASYNC_EXECUTION_GUIDANCE);
  parts.push(OFFLOADED_DATA_GUIDANCE);
  parts.push(CRITICAL_TOOL_CALL_REQUIREMENTS);
  parts.push(AGNT_NATIVE_EXECUTION);

  if (on('task_delegation')) {
    parts.push(`TASK DELEGATION:
For non-trivial tasks, consider creating a Goal and delegating to agents.

1. Do it yourself for simple questions, quick searches, single tool calls, or casual conversation.
2. Create a goal for larger multi-step work using create_and_run_goal.
3. Check goal progress with list_goals, get_goal_details, get_goal_status, or evaluate_goal.

Goals run autonomously in the background. When a goal completes, results are automatically sent back to this conversation.`);
  }

  if (has('discover_tools')) {
    parts.push(`TOOL USAGE:
Tools are provided through the API tools parameter. Use exact tool names.
If you need additional tools not currently visible, call discover_tools with operation="browse", then operation="load" with the needed categories.
Do not tell the user you lack a capability before checking discover_tools first.
When the user asks to list/show available tools, call discover_tools with operation="browse" first.`);
  } else {
    parts.push(`TOOL USAGE:
Tools are provided through the API tools parameter. Use exact tool names. Only use tools that appear in the tools parameter — do not claim or imply access to tools that are not listed.`);
  }

  const contextBlock = await buildPageContextBlock(context);
  if (contextBlock) parts.push(contextBlock);

  if (skillsCatalogSection) parts.push(skillsCatalogSection);
  // Saved-agent specialty highlights — rendered right after the full catalog
  // so the agent's assigned skills/tools stand out from the general surface.
  if (agentOverride?.specialtySkillsSection) parts.push(agentOverride.specialtySkillsSection);
  if (agentOverride?.pinnedToolsSection) parts.push(agentOverride.pinnedToolsSection);
  if (memorySection) parts.push(memorySection);

  // "Remember anything" recall layer — recall/list_recent/get_trace are in
  // DEFAULT_TOOLS and UNIVERSAL_TOOLS, so they're on every chat surface.
  // Gated anyway so the guidance disappears cleanly if a future channel ever
  // turns them off.
  if (on('memory_recall')) parts.push(MEMORY_RECALL_GUIDANCE);

  // Gate the long capability descriptions on whether the underlying tool
  // is actually available for this channel.
  if (on('image_analysis_capabilities')) parts.push(IMAGE_ANALYSIS_CAPABILITIES);
  if (on('image_generation_capabilities')) parts.push(IMAGE_GENERATION_CAPABILITIES);
  parts.push(ARTIFACTS_VS_WIDGETS);
  // Directly after ARTIFACTS_VS_WIDGETS on purpose. That block is what creates
  // the "this request becomes a file" instinct; this one says the file is not
  // the delivery. Separating them let the model conclude that writing the file
  // WAS the answer and a link was how you hand it over — which is the behaviour
  // being fixed. Unconditional: the chat renders an html block on every surface,
  // and a gate that could flicker costs more than the ~300 tokens it saves.
  parts.push(HTML_INLINE_RENDERING);
  parts.push(RESPONSE_FORMATTING);
  // Local file rendering applies to every surface: any tool (generation, plugin,
  // MCP, file_operations, etc.) can return an absolute path the LLM needs to
  // embed. The frontend rewrites file:/// → /api/local-file/... so <img>,
  // <video>, <iframe>, <audio> all just work. Cheap to include unconditionally.
  parts.push(LOCAL_FILE_RENDERING);
  if (on('critical_image_reference_formatting')) parts.push(CRITICAL_IMAGE_REFERENCE_FORMATTING);
  // IMPORTANT_GUIDELINES is almost entirely about web_search / web_scrape /
  // execute_javascript_code / file_operations / agnt_tools — skip the block
  // when none of those are enabled, otherwise the LLM advertises tools the
  // user has disabled in the per-channel selector.
  if (on('important_guidelines')) parts.push(IMPORTANT_GUIDELINES);
  // Chart.js only. The D3 / Three.js / HTML guides are ON-DEMAND via
  // discover_tools categories=["visualization"] — 2,670 tokens that were
  // resident on every turn for a capability used on a small minority of them.
  parts.push(CHART_CHEATSHEET);

  if (on('mcp_tool_use')) parts.push(MCP_TOOL_USE_RULES);

  parts.push(CRITICAL_TOOL_RESPONSE_RULES);

  if (customInstructionsSection) parts.push(customInstructionsSection);

  return parts.filter(Boolean).join('\n\n');
}

/**
 * Compose the page-specific guidance block. Each per-page module returns a
 * full, detailed prompt for its surface (node/edge format rules for workflow,
 * field-shape rules for tool forge, HTML conventions for widget forge, etc.).
 * Blocks early-return empty strings when their trigger context isn't set, so
 * each chat surface gets exactly the guidance it needs and nothing else.
 */
async function buildPageContextBlock(context) {
  const blocks = await Promise.all([
    buildWorkflowContextBlock(context),
    buildAgentContextBlock(context),
    buildToolContextBlock(context),
    buildWidgetContextBlock(context),
    buildArtifactContextBlock(context),
    buildGoalContextBlock(context),
  ]);
  const filled = blocks.filter(Boolean);
  // On a canvas turn several of the blocks above are present at once. Without
  // the window manifest in front of them the model sees a workflow graph and a
  // file side by side with no way to know they are two windows the user can
  // see, which one is focused, or that a second Workflow Forge exists whose
  // state was budgeted out.
  //
  // The manifest is emitted on its OWN merit, not only when some other block
  // happened to render: a window can be open and identifiable while
  // contributing no guidance block (a superseded duplicate, a surface whose
  // state is empty). "Two Workflow Forge windows are open" is worth saying
  // even in the turn where neither had a graph to send.
  const surfaces = buildCanvasSurfacesBlock(context);
  const body = surfaces ? [surfaces, ...filled] : filled;
  if (body.length === 0) return '';
  return `CURRENT PAGE CONTEXT\n${body.join('\n\n')}`;
}

/**
 * The open canvas windows, and which of them the state below belongs to.
 *
 * BUDGET, MADE VISIBLE. buildFederatedPageState admits at most one blob per
 * state key, so a second window of the same kind contributes nothing to the
 * blocks below. Listing it anyway — with `state not included` — is the
 * difference between the model knowing it exists (and reaching for
 * inspect_canvas_widget) and the model believing there is only one.
 */
function buildCanvasSurfacesBlock(context) {
  const surfaces = listCanvasSurfaces(context);
  if (surfaces.length === 0) return '';

  const lines = surfaces.map((s) => {
    const parts = [`- ${s.name || s.widgetId || 'window'} — widget \`${s.widgetId}\`, instanceId \`${s.instanceId}\``];
    if (s.bound) parts.push(`bound to \`${s.bound}\``);
    if (s.focused) parts.push('FOCUSED (the default target when the user says "this" or "it")');
    if (s.stateIncluded === false) {
      parts.push('state NOT included below — call inspect_canvas_widget with its instanceId to read it');
    }
    return parts.join(' — ');
  });

  return [
    'OPEN CANVAS WINDOWS',
    'This conversation is one window on a canvas the user is looking at right now. These are the others:',
    ...lines,
    '',
    'The surface blocks that follow describe these windows. Edits you make through the surface tools',
    'land live in the matching window — the user watches them happen. When a request is ambiguous',
    'because two windows could satisfy it, prefer the FOCUSED one and say which you chose.',
  ].join('\n');
}

async function buildWorkflowContextBlock({ workflowId, workflowContext, workflowState }) {
  if (!workflowId && !workflowContext && !workflowState) return '';
  return await getWorkflowSystemContent(workflowId, workflowContext, workflowState);
}

async function buildAgentContextBlock({ agentId, agentContext, agentState }) {
  // The AgentForge BUILDER prompt ("you create and manage agents", with
  // generate_agent/modify_agent function docs) must only appear on the
  // builder surface, which uses the 'agent-chat' sentinel id. Saved-agent
  // runtime chats carry a real agentId — injecting the builder prompt there
  // buried the agent's persona and told it to "create" things, which is
  // exactly the recreate-instead-of-use failure users reported.
  if (agentId !== 'agent-chat') return '';
  return getAgentSystemContent(agentId, agentContext, agentState);
}

async function buildToolContextBlock({ toolId, toolContext, toolState }) {
  if (!toolId && !toolContext && !toolState) return '';
  return getToolForgeSystemContent(toolId, toolContext, toolState);
}

async function buildWidgetContextBlock({ widgetId, widgetContext, widgetState }) {
  if (!widgetId && !widgetContext && !widgetState) return '';

  // The widget chat lives in the LeftPanel while the WidgetForge editor lives
  // in the CenterPanel — they're sibling components, so the editor's
  // `provide('widgetForge', ...)` can't reach the chat's `inject(...)`. The
  // chat ends up sending only `{ id }` for widgetState, with no source_code.
  // Hydrate from the widget_definitions DB row whenever we have a real
  // widgetId but the inbound widgetState is missing the source. Every edit
  // path (edit_widget_code, generate_widget, update_widget_config, manual
  // form autosave) writes the row before the next chat turn starts, so the
  // DB is the freshest source of truth.
  let hydratedState = widgetState || {};
  if (
    widgetId &&
    widgetId !== 'widget-forge' &&
    (!hydratedState.source_code || typeof hydratedState.source_code !== 'string')
  ) {
    try {
      const { default: db } = await import('../../../models/database/index.js');
      const row = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id, name, description, icon, category, widget_type, source_code, config, default_size, min_size FROM widget_definitions WHERE id = ?',
          [widgetId],
          (err, r) => (err ? reject(err) : resolve(r)),
        );
      });
      if (row) {
        // DB row wins for source_code (canonical), but inbound widgetState
        // wins for everything else (in case the user has unsaved form edits
        // we shouldn't clobber when echoing the prompt back).
        hydratedState = {
          ...row,
          ...hydratedState,
          source_code: row.source_code || hydratedState.source_code || '',
        };
      }
    } catch (e) {
      console.warn('[Widget prompt] Failed to hydrate widget from DB:', e.message);
    }
  }

  return getWidgetForgeSystemContent(widgetId, widgetContext, hydratedState);
}

async function buildArtifactContextBlock(context) {
  const { codeId, codeContext } = context;
  if (!codeId && !codeContext) return '';
  return await getCodeSystemContent({ codeContext });
}

async function buildGoalContextBlock({ goalId, goalContext, goalState }) {
  if (!goalId && !goalContext && !goalState) return '';
  return getGoalSystemContent(goalId, goalContext, goalState);
}
