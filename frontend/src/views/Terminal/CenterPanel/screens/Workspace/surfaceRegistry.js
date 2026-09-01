/**
 * Tool-call → widget mapping for the Workspaces auto-open behaviour.
 *
 * v2: this module no longer resolves components — the widget canvas system
 * (widgetRegistry + WidgetFrame + CustomWidgetRenderer) owns rendering. What
 * remains is the one genuinely load-bearing idea: when Annie touches a domain,
 * which WIDGET should appear on the canvas, and which object should it show?
 *
 *   update_workflow  → the 'workflow-forge' screen widget, pointed (via the
 *                      route query Workflow Forge already reads) at the
 *                      workflow the tool just wrote
 *   generate_widget  → THE WIDGET ITSELF (its definition id renders live
 *                      through CustomWidgetRenderer — not the editor screen)
 *   write_file       → 'artifacts'
 *   create_goal      → 'goals' …and so on.
 */

/**
 * SCREEN_WIDGET_MAP — ScreenName → canvas widget, for translating embedded
 * screens' `screen-change` emissions into canvas actions.
 *
 * Screens embedded in widget windows still emit screen-change exactly as they
 * do standalone (a Workflows panel row click → 'WorkflowForgeScreen' +
 * { workflowId }). Standalone, Terminal.changeScreen navigates the whole app;
 * inside the canvas that would blow away every window, so the event is
 * translated: open (or focus) the corresponding WIDGET and bind the object by
 * writing the route query param the target screen already reads.
 *
 * optionKey → param mirrors Terminal.changeScreen's own mapping verbatim
 * (workflowId→id, toolId→tool-id, selectedExecutionId→executionId), so a
 * screen behaves identically whether its event was handled by the app shell
 * or by the canvas.
 *
 * focusOnly marks the chat widget: it is dedupe-EXEMPT in addWidget (a user
 * adding chat wants a new conversation), so a ChatScreen navigation must
 * focus the existing conversation rather than minting a fresh one.
 *
 * Screens without a registered widget (Skills, Experiments, Autonomy) are
 * deliberately absent — the translator warns and stays put rather than
 * navigating the app away.
 */
export const SCREEN_WIDGET_MAP = {
  WorkflowForgeScreen: { widgetId: 'workflow-forge', param: 'id', optionKey: 'workflowId' },
  ToolForgeScreen: { widgetId: 'tool-forge', param: 'tool-id', optionKey: 'toolId' },
  TracesScreen: { widgetId: 'traces', param: 'executionId', optionKey: 'selectedExecutionId' },
  AgentForgeScreen: { widgetId: 'agent-forge' },
  GoalsScreen: { widgetId: 'goals' },
  DashboardScreen: { widgetId: 'dashboard' },
  ArtifactsScreen: { widgetId: 'artifacts' },
  MemoryScreen: { widgetId: 'memory' },
  WorkflowsScreen: { widgetId: 'workflows' },
  AgentsScreen: { widgetId: 'agents' },
  ToolsScreen: { widgetId: 'tools' },
  SettingsScreen: { widgetId: 'settings' },
  ConnectorsScreen: { widgetId: 'connectors' },
  MarketplaceScreen: { widgetId: 'marketplace' },
  WidgetForgeScreen: { widgetId: 'widget-forge' },
  WidgetManagerScreen: { widgetId: 'widget-manager' },
  ChatScreen: { widgetId: 'workspace-chat', focusOnly: true },
};

/** Fields to lift an object id from a tool's args/result, per domain. */
const ID_FIELDS = {
  workflow: ['workflowId', 'workflow_id', 'id'],
  widget: ['widgetId', 'widget_id', 'id'],
  tool: ['toolId', 'tool_id', 'id'],
  agent: ['agentId', 'agent_id', 'id'],
};

/**
 * tool name → { widgetId | custom:true, idKind?, routeParam? }
 *
 * `custom: true` means "the extracted id IS the widget id" — the generated
 * custom widget itself is placed on the canvas.
 * `routeParam` is how the target screen already accepts an object id today
 * (Workflow Forge reads ?id=, Tool Forge reads ?tool-id=). We reuse that
 * mechanism verbatim rather than inventing a new prop path.
 */
export const TOOL_WIDGET_MAP = {
  // Annie browsing in chat should be something you can WATCH. No id to bind:
  // the widget owns its own browser surface, so opening it is the whole job.
  ai_browser_use: { widgetId: 'browser' },
  // Browser Control wants the widget even more than the Browser Agent does. It
  // can fall back to launching a clean browser of its own, but that opens a
  // separate window; opening the widget on the first call keeps the work on the
  // canvas, beside the conversation, where the user is already looking.
  ai_browser_control: { widgetId: 'browser' },
  // Browser Actions is the verbs path — the one agents reach for by default —
  // and it streams into the same widget so the user watches the clicks land.
  ai_browser_act: { widgetId: 'browser' },
  // The unified tool: verbs, run and script all show their work in the widget.
  browser: { widgetId: 'browser' },
  update_workflow: { widgetId: 'workflow-forge', idKind: 'workflow', routeParam: 'id' },
  revert_workflow: { widgetId: 'workflow-forge', idKind: 'workflow', routeParam: 'id' },
  list_workflow_versions: { widgetId: 'workflow-forge', idKind: 'workflow', routeParam: 'id' },
  create_checkpoint: { widgetId: 'workflow-forge', idKind: 'workflow', routeParam: 'id' },
  start_workflow: { widgetId: 'workflow-forge', idKind: 'workflow', routeParam: 'id' },
  stop_workflow: { widgetId: 'workflow-forge', idKind: 'workflow', routeParam: 'id' },

  generate_widget: { custom: true, idKind: 'widget' },
  edit_widget_code: { custom: true, idKind: 'widget' },
  save_widget: { custom: true, idKind: 'widget' },
  update_widget_config: { custom: true, idKind: 'widget' },
  load_widget: { custom: true, idKind: 'widget' },

  generate_tool_update: { widgetId: 'tool-forge', idKind: 'tool', routeParam: 'tool-id' },
  save_tool: { widgetId: 'tool-forge', idKind: 'tool', routeParam: 'tool-id' },
  load_tool: { widgetId: 'tool-forge', idKind: 'tool', routeParam: 'tool-id' },
  run_tool: { widgetId: 'tool-forge', idKind: 'tool', routeParam: 'tool-id' },

  generate_agent: { widgetId: 'agent-forge', idKind: 'agent' },
  modify_agent: { widgetId: 'agent-forge', idKind: 'agent' },
  save_agent: { widgetId: 'agent-forge', idKind: 'agent' },
  load_agent: { widgetId: 'agent-forge', idKind: 'agent' },

  // PRODUCING a file opens the browser; READING one does not.
  //
  // Every other entry here is a mutation — the tool changed something, so show
  // the user what changed. read_file and list_files were the only read-only
  // tools in the table, and they fire during reconnaissance on nearly every
  // turn whatever the topic, so Artifacts appeared on canvases that had
  // nothing to do with files. grep_files / glob_files are absent for the same
  // reason and must stay absent.
  write_file: { widgetId: 'artifacts' },
  edit_file: { widgetId: 'artifacts' },

  create_goal: { widgetId: 'goals' },
  create_and_run_goal: { widgetId: 'goals' },
  execute_goal: { widgetId: 'goals' },
  execute_goal_autonomous: { widgetId: 'goals' },

  get_trace: { widgetId: 'traces' },
  list_recent: { widgetId: 'traces' },
};

function extractId(toolCall, kind) {
  const fields = ID_FIELDS[kind] || ['id'];
  const sources = [];

  let result = toolCall.result;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { result = null; }
  }
  if (result && typeof result === 'object') {
    sources.push(result, result.result, result.data, result.widget, result.workflow, result.tool, result.agent);
  }

  let args = toolCall.args ?? toolCall.arguments ?? toolCall.input;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = null; }
  }
  if (args && typeof args === 'object') sources.push(args);

  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const f of fields) {
      const v = src[f];
      if (typeof v === 'string' && v) return v;
    }
  }
  return '';
}

/**
 * Given an executed tool call, decide which widget to place on the canvas.
 * @returns {null | { widgetId: string, objectId: string, routeParam?: string, custom?: boolean }}
 */
export function widgetForToolCall(toolCall) {
  if (!toolCall || !toolCall.name) return null;
  const entry = TOOL_WIDGET_MAP[toolCall.name];
  if (!entry) return null;

  const objectId = entry.idKind ? extractId(toolCall, entry.idKind) : '';

  if (entry.custom) {
    // The generated widget IS the thing to show. Without an id there is
    // nothing to render — do not fall back to the editor screen.
    return objectId ? { widgetId: objectId, objectId, custom: true } : null;
  }
  return { widgetId: entry.widgetId, objectId, routeParam: entry.routeParam };
}
