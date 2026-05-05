import {
  CRITICAL_IMAGE_HANDLING,
  CRITICAL_IMAGE_GENERATION,
  OFFLOADED_DATA_GUIDANCE,
  CRITICAL_TOOL_CALL_REQUIREMENTS,
  IMAGE_ANALYSIS_CAPABILITIES,
  IMAGE_GENERATION_CAPABILITIES,
  RESPONSE_FORMATTING,
  CRITICAL_IMAGE_REFERENCE_FORMATTING,
  IMPORTANT_GUIDELINES,
  CHART_CHEATSHEET,
  MCP_TOOL_USE_RULES,
  CRITICAL_TOOL_RESPONSE_RULES,
} from './orchestrator-chat.js';
import { ASYNC_EXECUTION_GUIDANCE } from './async-execution.js';
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
  } = options;

  // Build the set of tool names actually exposed to the LLM this turn.
  // OrchestratorService computes context.toolSchemas BEFORE calling this,
  // so we can use it to gate every capability section that names specific
  // tools — otherwise the LLM advertises tools the user has disabled in
  // the per-channel tool selector and parrots them as available.
  const enabledToolNames = new Set();
  if (Array.isArray(context.toolSchemas)) {
    for (const s of context.toolSchemas) {
      const n = s?.function?.name;
      if (n) enabledToolNames.add(n);
    }
  }
  const has = (name) => enabledToolNames.has(name);

  const parts = [];

  if (agentOverride?.systemPrompt) {
    parts.push(agentOverride.systemPrompt);
    parts.push(`You are responding as ${agentOverride.name || 'the selected agent'}. Respect the agent's assigned tool constraints. The platform-provided capability and tool-use rules below still apply.`);
  } else {
    parts.push(`You are Annie, a helpful assistant with access to AGNT's unified tool registry. Use tools to accomplish the user's request unless it is a trivial conversational task.

Every Annie chat surface is functionally the same assistant. The current page context is a soft signal: prefer tools and interpretations relevant to that page, but you may use any available tool when the user's request crosses domains.`);
  }

  // Workspace path is environment context — every surface should know it
  // before reasoning about file-related tool calls.
  if (workspaceSection) parts.push(workspaceSection);

  // Image-handling rules only matter if the LLM can actually receive or
  // produce images on this surface.
  if (has('analyze_image')) parts.push(CRITICAL_IMAGE_HANDLING);
  if (has('generate_image')) parts.push(CRITICAL_IMAGE_GENERATION);
  parts.push('IMPORTANT: Provider names are automatically normalized to lowercase by the backend. You do not need to worry about provider-name casing.');
  if (asyncToolsEnabled) {
    parts.push(ASYNC_EXECUTION_GUIDANCE);
  }
  parts.push(OFFLOADED_DATA_GUIDANCE);
  parts.push(CRITICAL_TOOL_CALL_REQUIREMENTS);

  if (has('create_and_run_goal')) {
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
  if (memorySection) parts.push(memorySection);

  // Gate the long capability descriptions on whether the underlying tool
  // is actually available for this channel.
  if (has('analyze_image')) parts.push(IMAGE_ANALYSIS_CAPABILITIES);
  if (has('generate_image')) parts.push(IMAGE_GENERATION_CAPABILITIES);
  parts.push(RESPONSE_FORMATTING);
  if (has('generate_image')) parts.push(CRITICAL_IMAGE_REFERENCE_FORMATTING);
  // IMPORTANT_GUIDELINES is almost entirely about web_search / web_scrape /
  // execute_javascript_code / file_operations / agnt_tools — skip the block
  // when none of those are enabled, otherwise the LLM advertises tools the
  // user has disabled in the per-channel selector.
  if (
    has('web_search') ||
    has('web_scrape') ||
    has('execute_javascript_code') ||
    has('read_file') ||
    has('write_file') ||
    has('file_operations') ||
    has('agnt_tools') ||
    has('execute_custom_agnt_tool')
  ) {
    parts.push(IMPORTANT_GUIDELINES);
  }
  parts.push(CHART_CHEATSHEET);

  if (context.normalizedProvider !== 'claude-code') {
    parts.push(MCP_TOOL_USE_RULES);
  }

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
  if (filled.length === 0) return '';
  return `CURRENT PAGE CONTEXT\n${filled.join('\n\n')}`;
}

async function buildWorkflowContextBlock({ workflowId, workflowContext, workflowState }) {
  if (!workflowId && !workflowContext && !workflowState) return '';
  return await getWorkflowSystemContent(workflowId, workflowContext, workflowState);
}

async function buildAgentContextBlock({ agentId, agentContext, agentState }) {
  if (!agentId && !agentContext && !agentState) return '';
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
