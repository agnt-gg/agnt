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

  // ── Orchestrator: no execution sink at all ───────────────────────────────
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
  analyze_image: { capabilities: [], sink: [] },
  generate_image: { capabilities: [], sink: [] },

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
  return resolveDynamic(toolName, args) || REGISTRY[toolName] || null;
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
