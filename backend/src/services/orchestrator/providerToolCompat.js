/**
 * Tools that a provider will refuse to accept, removed before the request.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SHARED MODULE AND NOT AN INLINE FILTER
 * ---------------------------------------------------------------------------
 * It was an inline filter, in OrchestratorService only, and the second place
 * that builds a tool list never got it. That second place is
 * LlmExecutionService.executeWithTools — the goal-task path and the
 * `run_agent` tool — so on Claude Code every goal task and every delegated
 * agent call failed while the chat beside it worked perfectly.
 *
 * The two lists are built independently and will keep being built
 * independently, so the rule has to live somewhere both of them reach rather
 * than being copied into each. Copying it is what produced the bug.
 *
 * ---------------------------------------------------------------------------
 * WHAT ANTHROPIC IS ACTUALLY REJECTING
 * ---------------------------------------------------------------------------
 * A Claude Code OAuth token is only honoured for requests Anthropic classifies
 * as the real Claude Code CLI. A request that fails that classification is
 * billed to "extra usage" — which is zero — and refused:
 *
 *     400 invalid_request_error
 *     "Third-party apps now draw from your extra usage, not your plan limits."
 *
 * That message reads like an exhausted quota and is not one. The subscription
 * and the token are both fine; the request was simply not recognised. Anyone
 * debugging this from the error text alone will chase the wrong thing, which
 * is why it is written down here.
 *
 * ---------------------------------------------------------------------------
 * THE TRIGGER IS THE TOOL NAME. IT IS NOT THE SCHEMA.
 * ---------------------------------------------------------------------------
 * Measured against api.anthropic.com with one real token, one request shape,
 * and exactly one tool swapped per trial:
 *
 *     no extra tool                                   200
 *     name `mcp_client`, full MCP schema              400
 *     name `mcp_client`, trivial schema               400
 *     name `mcp_client`, EMPTY schema                 400
 *     name `mcp_clientx`                              400   <- substring
 *     name `mcp__notion__search`                      200
 *     name `notion_search`                            200
 *     description "Call a tool on an MCP server"      200
 *     schema with serverName/toolName/toolArgs        200
 *     schema with the MCP `operation` enum            200
 *
 * So: a substring match on the NAME, and nothing else. The previous comment at
 * this rule's old home attributed it to "mcp_client's shape", which is
 * measurably wrong and would have sent a future fix after the schema — both
 * too broad (it would strip the namespaced `mcp__*` tools, which are fine) and
 * ineffective (renaming the field names changes nothing).
 *
 * `mcp__<server>__<tool>` does not contain `mcp_client`, so per-server MCP
 * tools keep working on Claude Code. Only the legacy dispatcher is dropped.
 */

/** Provider key -> tool-name predicates that must not be sent to it. */
const INCOMPATIBLE_TOOL_MATCHERS = Object.freeze({
  'claude-code': [(name) => name.includes('mcp_client')],
});

function toolName(schema) {
  // Both call sites build OpenAI-shaped schemas ({ function: { name } }), but
  // reading a bare `name` too costs nothing and means a native-schema caller
  // cannot silently bypass the rule.
  return schema?.function?.name ?? schema?.name ?? '';
}

/**
 * Remove tools the provider is known to reject.
 *
 * Returns the SAME array when nothing matches, so the overwhelmingly common
 * case — every provider that is not Claude Code — costs one object lookup and
 * allocates nothing.
 *
 * @param {Array<object>} schemas  tool schemas, OpenAI-shaped or native
 * @param {string} provider        provider key, any casing ('Claude-Code' ok)
 * @returns {Array<object>}
 */
export function stripProviderIncompatibleTools(schemas, provider) {
  if (!Array.isArray(schemas) || schemas.length === 0) return schemas;

  const matchers = INCOMPATIBLE_TOOL_MATCHERS[String(provider || '').toLowerCase()];
  if (!matchers) return schemas;

  const kept = schemas.filter((schema) => {
    const name = toolName(schema);
    if (!name) return true; // not ours to judge; the adapter will complain
    return !matchers.some((matches) => matches(name));
  });

  // Nothing matched: hand back the original array, not a copy. Keeps the
  // "same reference when nothing is removed" contract true on every path,
  // including a restricted provider that simply had no offending tool.
  if (kept.length === schemas.length) return schemas;

  console.log(
    `[providerToolCompat] ${provider}: withheld ${schemas.length - kept.length} incompatible tool(s)`
  );
  return kept;
}

/** Exposed for tests and diagnostics — never mutate the result. */
export function providersWithToolRestrictions() {
  return Object.keys(INCOMPATIBLE_TOOL_MATCHERS);
}
