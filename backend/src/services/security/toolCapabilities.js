/**
 * toolCapabilities — what each tool can actually DO, and which of its
 * arguments can reach an execution sink.
 *
 * WHY THIS EXISTS
 * ---------------
 * NOPE's rules were written as if every action were a command line. Its
 * matcher walks every string in every argument, so a rule that detects a
 * dangerous *command* also fires on any argument that merely *describes* one.
 * In practice that blocked a memory note about restarting the backend, a
 * read-only search for a rule's own id, and a runbook file write — while the
 * one call that genuinely restarted something was blocked for the same
 * reason, indistinguishably.
 *
 * The fix is to tell the gate two things it could not previously know:
 *
 *   capabilities  what this tool can do at all. A rule about destroying a
 *                 disk is irrelevant to a tool that can only append to a
 *                 memory row.
 *   sink          which arguments select an operation, destination,
 *                 executable, query or path. Everything else — `content`,
 *                 `body`, `message`, `pattern` — is data. Data is still
 *                 fully scanned for secrets; it is just no longer parsed as
 *                 shell syntax.
 *
 * FAIL-CLOSED BY CONSTRUCTION
 * ---------------------------
 * An unregistered tool (a plugin, a custom tool, anything new) resolves to
 * null and is checked exactly as it was before this file existed: no
 * capability declaration, so NOPE evaluates every rule against every field.
 * Narrowing is opt-in per tool and never happens by default.
 *
 * WHAT IS DELIBERATELY NOT SCOPED
 * -------------------------------
 * Credential and DLP rules carry no `appliesTo` in the library, so they keep
 * seeing full `params` for every tool here. A live API key pasted into a note
 * is a real leak and is still caught. Scoping applies to rules about ACTION,
 * never to rules about DATA.
 */

/** Tools that can run an arbitrary command or evaluate arbitrary code. */
const EXECUTES = ['shell', 'code-eval'];

/**
 * toolName / workflow node type -> capability profile.
 *
 * `sink` lists argument names that can influence what actually runs. Adding a
 * field here widens what action rules inspect; omitting one narrows it. When
 * in doubt, include it — a false positive is cheaper than a missed execution.
 */
const REGISTRY = {
  // ── Orchestrator: execution ──────────────────────────────────────────────
  execute_shell_command: { capabilities: ['shell'], sink: ['command', 'cwd'] },
  execute_javascript_code: { capabilities: ['code-eval'], sink: ['code'] },

  // ── Orchestrator: filesystem ─────────────────────────────────────────────
  // Writing a file is not running it. The path selects a destination; the
  // content is data. A shell script written to disk is caught at the moment
  // something executes it, which is a call with the `shell` capability.
  write_file: { capabilities: ['fs-write'], sink: ['path'] },
  edit_file: { capabilities: ['fs-write'], sink: ['path'] },
  read_file: { capabilities: ['fs-read'], sink: ['path'] },
  list_files: { capabilities: ['fs-read'], sink: ['path'] },
  grep_files: { capabilities: ['fs-read'], sink: ['path'] },
  glob_files: { capabilities: ['fs-read'], sink: ['path'] },

  // ── Orchestrator: network ────────────────────────────────────────────────
  web_scrape: { capabilities: ['http'], sink: ['url'] },
  web_search: { capabilities: ['http'], sink: ['query'] },
  send_email: { capabilities: ['http'], sink: ['to'] },
  // Only ever to the account owner's own verified phone; the service picks it.
  text_user: { capabilities: ['http'], sink: [] },

  // Runs its command in a fresh, disposable cloud VM (sandbox.agnt.gg). Inputs
  // are inline strings and outputs come back in the result: nothing on this
  // machine is read, written or executed.
  sandbox_run: { capabilities: ['http'], sink: ['command'] },

  // ── Orchestrator: AGNT platform, on the caller's own authority ───────────
  // libs/agnt2.js calls this instance's own API (and api.agnt.gg for auth)
  // with the CALLER's token, so every route check that applies to the caller
  // in the app applies here too. Whatever they start (a workflow, a goal, an
  // agent chat) is policed tool by tool and node by node when it runs.
  agnt_agents: { capabilities: ['http'], sink: ['operation'] },
  agnt_workflows: { capabilities: ['http'], sink: ['operation'] },
  agnt_tools: { capabilities: ['http'], sink: ['operation'] },
  agnt_goals: { capabilities: ['http'], sink: ['operation'] },
  agnt_chat: { capabilities: ['http'], sink: ['operation'] },
  agnt_auth: { capabilities: ['http'], sink: ['operation'] },

  // ── Orchestrator: no execution sink at all ───────────────────────────────
  record_memory_use: { capabilities: [], sink: [] },
  // These cannot run, write, or fetch anything. Their arguments are pure
  // data, so no action rule can meaningfully apply to them.
  save_agent_memory: { capabilities: [], sink: [] },
  get_agent_memories: { capabilities: [], sink: [] },
  recall: { capabilities: [], sink: [] },
  list_recent: { capabilities: [], sink: [] },
  get_trace: { capabilities: [], sink: [] },
  query_data: { capabilities: [], sink: [] },
  discover_tools: { capabilities: [], sink: [] },
  activate_skill: { capabilities: [], sink: [] },
  get_agnt_api: { capabilities: [], sink: [] },
  mention_agent: { capabilities: [], sink: [] },
  // Starts a chat turn; every tool THAT turn calls is policed on its own.
  start_chat: { capabilities: [], sink: [] },
  // Sends the user's answer into a sub-chat as its next turn; same as start_chat.
  continue_chat: { capabilities: [], sink: [] },
  analyze_image: { capabilities: [], sink: [] },
  generate_image: { capabilities: [], sink: [] },

  // ── Orchestrator: workflow and agent builders, on the caller's own records ──
  // Each reads or writes only the caller's rows: WorkflowModel refuses a
  // foreign workflow id, save_agent copies (never overwrites) someone else's
  // agent, load/delete/run_agent check created_by, and the version tools
  // check ownership before touching history (workflowTools.requireOwnWorkflow).
  // Whatever a run starts is policed node by node and tool by tool when it runs.
  // Undeclared, every one of these was refused to every team member.
  get_available_tool_node_types: { capabilities: [], sink: [] },
  get_node_type_schema: { capabilities: [], sink: [] },
  update_workflow: { capabilities: [], sink: [] },
  revert_workflow: { capabilities: [], sink: [] },
  list_workflow_versions: { capabilities: [], sink: [] },
  create_checkpoint: { capabilities: [], sink: [] },
  // Calls this instance's own /api/workflows/:id/start|stop with the caller's token.
  start_workflow: { capabilities: ['http'], sink: [] },
  stop_workflow: { capabilities: ['http'], sink: [] },
  generate_agent: { capabilities: [], sink: [] },
  modify_agent: { capabilities: [], sink: [] },
  save_agent: { capabilities: [], sink: [] },
  load_agent: { capabilities: [], sink: [] },
  delete_agent: { capabilities: [], sink: [] },
  list_agents: { capabilities: [], sink: [] },
  run_agent: { capabilities: [], sink: [] },

  // ── Orchestrator: the caller's own open app tab (UI state over the socket) ──
  get_canvas_state: { capabilities: [], sink: [] },
  inspect_canvas_widget: { capabilities: [], sink: [] },
  open_canvas_widget: { capabilities: [], sink: [] },
  close_canvas_widget: { capabilities: [], sink: [] },
  move_canvas_widget: { capabilities: [], sink: [] },
  list_tutorial_targets: { capabilities: [], sink: [] },
  highlight_element: { capabilities: [], sink: [] },
  start_guided_tour: { capabilities: [], sink: [] },
  scan_page_elements: { capabilities: [], sink: [] },
  end_guided_tour: { capabilities: [], sink: [] },

  // ── Workflow nodes: execution ────────────────────────────────────────────
  'execute-javascript': { capabilities: ['code-eval'], sink: ['code'] },
  'execute-javascript-child': { capabilities: ['code-eval'], sink: ['code'] },
  'execute-python': { capabilities: ['code-eval'], sink: ['code'] },

  // ── Workflow nodes: data / network ───────────────────────────────────────
  'database-operation': { capabilities: ['sql'], sink: ['operation', 'tableName', 'condition', 'columns', 'values'] },
  'custom-api': { capabilities: ['http'], sink: ['url', 'method', 'headers', 'query'] },
  'agnt-api': { capabilities: ['http'], sink: ['url', 'method', 'headers', 'query'] },
  'web-scrape': { capabilities: ['http'], sink: ['url'] },
  'web-search': { capabilities: ['http'], sink: ['query'] },
  'send-email': { capabilities: ['http'], sink: ['to'] },
  'text-to-speech': { capabilities: ['http'], sink: [] },

  // ── Workflow nodes: no execution sink ────────────────────────────────────
  'trigger-timer': { capabilities: [], sink: [] },
  'webhook-listener': { capabilities: [], sink: [] },
  'receive-email': { capabilities: [], sink: [] },
  'stop-workflow': { capabilities: [], sink: [] },
  delay: { capabilities: [], sink: [] },
  counter: { capabilities: [], sink: [] },
  label: { capabilities: [], sink: [] },
  'random-number': { capabilities: [], sink: [] },
  'hello-world': { capabilities: [], sink: [] },
  'data-transformer': { capabilities: [], sink: [] },
  'generate-with-ai-llm': { capabilities: [], sink: [] },

  // Built-ins that act only through the AGNT API or a model call, as the caller: goals, widgets (their
  // code renders in the browser's iframe sandbox, never on the server), Tool Forge definitions, agents,
  // backgrounds. Unprofiled, every one of them was refused to every teammate (memberIsolation fails closed).
  ...Object.fromEntries([
    'create_goal', 'delete_goal', 'evaluate_goal',
    'fetch_goal_tasks', 'get_evaluation_report', 'get_goal_details', 'get_goal_status', 'list_goals', 'pause_goal',
    'save_as_golden_standard', 'task_checkpoint', 'update_task_status',
    'generate_widget', 'edit_widget_code', 'list_widgets', 'load_widget', 'save_widget', 'update_widget_config', 'delete_widget',
    'list_tools', 'load_tool', 'save_tool', 'delete_tool', 'generate_tool_update',
    'set_background_image', 'clear_background_image',
  ].map((name) => [name, { capabilities: [], sink: [] }])),
  // Starting OTHER agents or goals: each of their own tool calls is gated as the caller, so a teammate may.
  // 'delegate' keeps them out of an approved team run, which may run only what its published revision declares.
  ...Object.fromEntries(['agnt_agent', 'create_and_run_goal', 'execute_goal', 'execute_goal_autonomous', 'resume_goal']
    .map((name) => [name, { capabilities: ['delegate'], sink: [] }])),
  // Running a Tool Forge tool: a model call, or its code through execute-javascript / execute-python,
  // which run in the kernel tool sandbox on a hosted instance (customToolCapabilities.js).
  run_tool: { capabilities: ['code-eval'], sink: [] },
  execute_custom_agnt_tool: { capabilities: ['code-eval'], sink: [] },
  // An MCP server is started through the tool sandbox, per acting account (STDIOTransport -> toolProcess).
  mcp_client: { capabilities: ['shell'], sink: [] },
  // The launched browser. On a hosted instance each teammate drives their OWN browser in their sandbox
  // (memberBrowsers.js); anywhere else there is one browser holding the owner's logins.
  ...Object.fromEntries(['browser', 'ai-browser-act', 'ai-browser-control', 'ai-browser-use'].map((name) => [name, { capabilities: ['browser'], sink: [] }])),
};

/** Names reach here as manifest types ('data-transformer') or LLM names ('data_transformer'): one tool, one profile. */
const spellingsOf = (toolName) => {
  const name = String(toolName || '');
  return [...new Set([name, name.replace(/_/g, '-'), name.replace(/-/g, '_')])];
};

/**
 * Tools whose capability depends on their arguments.
 *
 * `file_operations` is the clearest case in the codebase: the same tool name
 * copies a file (no execution) or runs one (a shell). Resolving it statically
 * would either under-protect the execute path or over-block the other seven
 * operations, which is the bug this whole module exists to remove.
 */
function resolveDynamic(toolName, args) {
  if (toolName === 'file_operations') {
    const executes = args?.operation === 'execute';
    return {
      capabilities: executes ? ['shell', 'fs-write'] : ['fs-write'],
      sink: ['operation', 'path', 'destination', 'args'],
      // argv is a command line even though no single element is dangerous
      // alone. Reconstruct it so command rules can see what will actually run.
      command: executes ? (a) => [a?.path, ...(Array.isArray(a?.args) ? a.args : [])].filter(Boolean).join(' ') : undefined,
    };
  }

  if (toolName === 'file-system-operation') {
    const executes = args?.operation === 'executeFile';
    return {
      capabilities: executes ? ['shell', 'fs-write'] : ['fs-write'],
      sink: ['operation', 'rootDirectory', 'path'],
      command: executes ? (a) => [a?.rootDirectory, a?.path].filter(Boolean).join('/') : undefined,
    };
  }

  return null;
}

/**
 * Resolve a tool's capability profile, or null when the tool is unknown.
 * Null means "scan everything" — see the fail-closed note at the top.
 */
export function resolveToolCapabilities(toolName, args = {}) {
  for (const name of spellingsOf(toolName)) {
    const profile = resolveDynamic(name, args) || (Object.prototype.hasOwnProperty.call(REGISTRY, name) ? REGISTRY[name] : null);
    if (profile) return profile;
  }
  return null;
}

/**
 * Build the NOPE action for a tool call.
 *
 * Always passes full `params` so unscoped credential/DLP rules keep total
 * coverage, and passes `sink` alongside so capability-scoped action rules see
 * only what can actually execute.
 */
export function buildSecurityAction(toolName, args) {
  const profile = resolveToolCapabilities(toolName, args);

  if (!profile) {
    // Unknown tool: behave exactly as the gate did before this registry.
    return { tool: toolName, params: args, command: args?.command, code: args?.code };
  }

  const sink = {};
  for (const field of profile.sink) {
    if (args && args[field] !== undefined) sink[field] = args[field];
  }

  const derived = typeof profile.command === 'function' ? profile.command(args) : undefined;

  return {
    tool: toolName,
    params: args,
    sink,
    capabilities: profile.capabilities,
    // `command` and `code` are sinks by definition, but only for tools that
    // actually declare them — a plain data field named `code` on some other
    // tool must not be promoted into an executable position.
    command: derived || (profile.sink.includes('command') ? args?.command : undefined),
    code: profile.sink.includes('code') ? args?.code : undefined,
  };
}

/** Exported for tests and for the security settings UI. */
export const TOOL_CAPABILITY_REGISTRY = REGISTRY;
export const EXECUTING_CAPABILITIES = EXECUTES;
