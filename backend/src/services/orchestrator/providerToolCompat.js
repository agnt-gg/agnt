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

/**
 * ---------------------------------------------------------------------------
 * ONE MALFORMED TOOL MUST NOT KILL THE WHOLE REQUEST
 * ---------------------------------------------------------------------------
 * Anthropic validates every tool schema and rejects the ENTIRE request when any
 * one of them is malformed:
 *
 *     400 invalid_request_error
 *     "tools.357.custom.input_schema.properties: Property keys should match
 *      pattern '^[a-zA-Z0-9_.-]{1,64}$'"
 *
 * Observed in production. The blast radius is total and the diagnosis is a
 * numeric index into an array nobody can see: chat 400s on every retry, fails
 * over to the next provider, then the next, and the user gets a turn that
 * completes with zero tool calls and no explanation.
 *
 * The offending schemas come from MCP servers, which are third-party processes
 * this repo does not control and cannot review. Their tool definitions are
 * whatever the server author wrote. So this is not a bug to fix once upstream
 * — it is a class of input we must be resilient to, permanently.
 *
 * Dropping the tool, rather than renaming its keys, is deliberate: a renamed
 * argument would be sent to an MCP server that has never heard of it, turning
 * a loud 400 into a silently broken tool. Losing one tool is recoverable and
 * visible in the log; losing the conversation is neither.
 */
const ANTHROPIC_PROPERTY_KEY = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Providers that enforce the pattern above. */
const STRICT_SCHEMA_PROVIDERS = new Set(['anthropic', 'claude-code']);

/**
 * Property keys Anthropic will reject, from a schema in either shape.
 *
 * Both call sites build OpenAI-shaped schemas, but reading the native shape too
 * means a future caller cannot bypass the check by passing what Anthropic
 * actually wants.
 */
function invalidPropertyKeys(schema) {
  const parameters = schema?.function?.parameters ?? schema?.input_schema ?? schema?.parameters;
  const properties = parameters?.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.keys(properties).filter((key) => !ANTHROPIC_PROPERTY_KEY.test(key));
}

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

  const providerKey = String(provider || '').toLowerCase();
  const matchers = INCOMPATIBLE_TOOL_MATCHERS[providerKey];
  const enforcesSchemaPattern = STRICT_SCHEMA_PROVIDERS.has(providerKey);
  if (!matchers && !enforcesSchemaPattern) return schemas;

  // Collected so the log NAMES the tool. The provider's own error identifies it
  // only as `tools.357`, an index into an array that exists for one request —
  // useless for finding which MCP server needs fixing.
  const reasons = [];

  const kept = schemas.filter((schema) => {
    const name = toolName(schema);

    if (name && matchers?.some((matches) => matches(name))) {
      reasons.push(`${name} (name rejected by this provider)`);
      return false;
    }

    if (enforcesSchemaPattern) {
      const badKeys = invalidPropertyKeys(schema);
      if (badKeys.length > 0) {
        reasons.push(`${name || '<unnamed>'} (invalid property key(s): ${badKeys.join(', ')})`);
        return false;
      }
    }

    return true;
  });

  // Nothing matched: hand back the original array, not a copy. Keeps the
  // "same reference when nothing is removed" contract true on every path,
  // including a restricted provider that simply had no offending tool.
  if (kept.length === schemas.length) return schemas;

  console.warn(
    `[providerToolCompat] ${provider}: withheld ${reasons.length} tool(s) — ${reasons.join('; ')}`
  );
  return kept;
}

/** Exposed for tests and diagnostics — never mutate the result. */
export function providersWithToolRestrictions() {
  return Object.keys(INCOMPATIBLE_TOOL_MATCHERS);
}
