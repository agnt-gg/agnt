/**
 * Async execution parameters, and the rule for which schemas carry them.
 *
 * TWO THINGS MAKE THIS BLOCK EXPENSIVE, AND BOTH ARE MULTIPLICATIVE:
 *   1. how long each description is, and
 *   2. how many schemas it is stamped onto.
 *
 * A first pass only fixed (1) — descriptions went from 193 to 132 tokens per
 * tool. Measured on a live DRY turn ("hey", 31 resident tools) that was still
 * 4,108 raw / 5,957 calibrated tokens: 38% OF THE ENTIRE TOOL SURFACE, spent
 * describing six optional background-execution flags on tools like `read_file`,
 * `glob_files` and `highlight_element` that complete in microseconds and that
 * nobody has ever wanted to schedule. Shrinking the text while still stamping
 * it on everything fights the wrong term.
 *
 * SO WHY IS GATING SAFE? Because the schema is documentation, not capability.
 * OrchestratorService reads `_executeAsync` straight off the parsed tool
 * arguments ("REMOVED: isAsyncTool() ... ANY tool can be run async by the LLM
 * adding: _executeAsync: true") and strips the control params before dispatch.
 * Nothing consults the schema. Declaring the params on a tool only REMINDS the
 * model the option exists there; omitting them removes a reminder, never an
 * ability. The prompt guidance says so explicitly, so the model still knows it
 * can async anything.
 *
 * The result is a surface that scales with genuinely long-running work instead
 * of with registry size: adding fifty instant plugin tools now adds zero async
 * boilerplate.
 */

/**
 * KEEP THESE AT A HANDFUL OF WORDS EACH.
 *
 * The prose that teaches the semantics ("Async & Periodic Tool Execution") is
 * emitted ONCE per request; this block is emitted once PER ELIGIBLE TOOL.
 * Anything worth more than a few words belongs in the prose, where it costs
 * O(1) instead of O(tools).
 *
 * UNITS ARE THE EXCEPTION and are stated inline. `_interval` in seconds vs
 * minutes is a 60x error the model cannot recover from by reasoning, and it
 * would produce a task that runs an hour late rather than an obvious failure.
 * Two words each is cheap insurance.
 */
export const ASYNC_TOOL_PARAMS = {
  _executeAsync: {
    type: 'boolean',
    description: 'Run in background; see async guidance.',
  },
  _interval: {
    type: 'number',
    description: 'Repeat every N SECONDS.',
  },
  _stopAfter: {
    type: 'integer',
    description: 'Max iterations.',
  },
  _duration: {
    type: 'number',
    description: 'Max MINUTES.',
  },
  _delayFirst: {
    type: 'boolean',
    description: 'Skip first run.',
  },
  _estimatedMinutes: {
    type: 'number',
    description: 'UI hint.',
  },
};

/**
 * Budget for the serialized block, in characters.
 *
 * Characters rather than tokens so the guard needs no tokenizer and cannot
 * drift with one. MEASURED, not guessed: the block serializes to 400 chars
 * (~92 tokens by o200k). 450 leaves room for one genuinely necessary
 * clarification while still failing loudly on a paragraph. If you need more
 * room than this, extend the prompt section instead — one copy, not one per
 * tool.
 */
export const ASYNC_TOOL_PARAMS_MAX_CHARS = 450;

/**
 * Native tools worth reminding the model about.
 *
 * MEMBERSHIP BAR: the tool can plausibly run long enough that a user would
 * want it backgrounded, or is the kind of thing people schedule (poll this,
 * re-run that every N minutes). Network I/O, subprocesses, model calls, and
 * anything that kicks off an agent or goal qualify. Pure local computation and
 * UI affordances do not.
 *
 * Being absent from this list does NOT prevent async execution — see the
 * module header. It only means the schema does not spend ~80 tokens saying so.
 */
export const LONG_RUNNING_TOOL_NAMES = new Set([
  // Subprocess / arbitrary code
  'execute_shell_command',
  'execute_javascript_code',
  'execute_javascript',
  'execute_python',
  'file_system_operation',
  // Network egress
  'web_search',
  'web_scrape',
  'send_email',
  'custom_api',
  'ai_browser_use',
  // The unified tool's action="run" is the same long-running delegation.
  'browser',
  'slop_connector',
  'mcp_client',
  // Model calls
  'generate_image',
  'analyze_image',
  'text_to_speech',
  'generate_with_ai_llm',
  'agnt_chat',
  'agnt_agent',
  'run_agent',
  'generate_agent',
  'generate_widget',
  'generate_tool_update',
  'update_workflow',
  // Orchestration that runs work of its own
  'agnt_goals',
  'agnt_workflows',
  'create_and_run_goal',
  'execute_goal',
  'execute_goal_autonomous',
  'evaluate_goal',
  'run_tool',
  'execute_custom_agnt_tool',
]);

/**
 * Should this schema carry the async control params?
 *
 * Plugin, registry and MCP tools opt in by setting `longRunning: true` on
 * their definition (checked on both the schema root and the function object,
 * since different producers build the wrapper differently). Default is OFF:
 * an unknown tool is assumed instant, so the expensive case has to be
 * declared rather than assumed. That is the direction that keeps a growing
 * registry from silently re-inflating this cost.
 */
export function isAsyncCapableSchema(schema) {
  const fn = schema?.function;
  if (!fn) return false;
  if (schema.longRunning === true || fn.longRunning === true) return true;
  return LONG_RUNNING_TOOL_NAMES.has(fn.name);
}

/** Does this resolved surface contain anything the async guidance applies to? */
export function surfaceHasAsyncCapableTool(schemas) {
  return Array.isArray(schemas) && schemas.some(isAsyncCapableSchema);
}
