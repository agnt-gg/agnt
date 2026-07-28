/**
 * Tool argument guard — the universal pre-execution check.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every tool declares `required: [...]` in its JSON schema, and until this
 * module nothing enforced it at the point of execution.
 *
 * AJV validation DID exist (toolValidator.js) but was wired into exactly one
 * adapter — `OpenAiLikeAdapter`. `AnthropicAdapter`, `GeminiAdapter`,
 * `OpenAIResponsesAdapter` and `CodexResponsesAdapter` never called it and
 * never returned `invalidToolCalls`, so the orchestrator's whole
 * validation-feedback recovery pipeline was dead code for those providers.
 *
 * The observable consequence, measured over 3,519 production `edit_file`
 * calls: 73 executed with `{}` — every parameter missing — and 100% of them
 * came from Anthropic-family adapters. `edit_file` then resolved its absent
 * `path` to the workspace ROOT DIRECTORY and `fs.readFile` raised
 * `EISDIR: illegal operation on a directory, read` — an error that describes
 * nothing about the actual fault and sent debugging in the wrong direction
 * for months.
 *
 *
 * THE PREDICATE, AND WHY IT IS THIS ONE
 * -------------------------------------
 * This gate blocks a call only when EVERY declared-required parameter is
 * absent — i.e. the model supplied nothing at all that the schema asked for.
 *
 * That is deliberately narrower than "a required parameter is missing", and
 * the narrowing was forced by measurement, not chosen by taste. Replaying all
 * 87,843 historical tool calls in the production database through both
 * candidate predicates:
 *
 *   predicate                    blocks   FALSE REJECTIONS   real failures caught
 *   ---------------------------  -------  -----------------  --------------------
 *   any required param missing      445          248                  197
 *   ALL required params missing     102            0                  102
 *
 * A false rejection is a call that COMPLETED SUCCESSFULLY in production and
 * would now be blocked. 248 of them is not a rounding error — it is broken
 * functionality on providers that never had the bug, which is strictly worse
 * than the bug itself.
 *
 * All 248 came from three plugin schemas that over-declare `required`:
 *
 *   seedance_api             227  lists 5 optional enrichments (seed,
 *                                 referenceImageUrls, ...) as required; a
 *                                 text-to-video call needs only a prompt
 *   proofkit_counterexample   19  lists `counterexample` as required, but it
 *                                 applies only to action=ADD, not to
 *                                 MARK_ADVERSARIAL_COMPLETE / MARK_REPRODUCTION
 *   stripe_invoice             2  lists BOTH `lineItems` AND `amount`+
 *                                 `description` — mutually exclusive modes
 *
 * Those three could be patched. That would be the wrong fix. Tool authors —
 * especially third-party plugin and MCP authors, who supply 206 of the 304
 * schemas on this install — reasonably use `required` to mean "the model
 * should think about this". Making that array load-bearing retroactively
 * reinterprets every schema in the ecosystem, and the next plugin installed
 * re-creates the outage. A choke point in front of every tool call must not
 * depend on the quality of schemas it does not control.
 *
 * "Every required parameter is absent" is immune to that by construction, not
 * merely by measurement: an over-declaring schema still receives its
 * semantically necessary parameters on a real call, so the predicate cannot
 * fire on one. It fires only on total argument loss — which is precisely the
 * truncation signature this guard exists to stop.
 *
 * WHAT THIS GIVES UP, AND WHY THAT IS ACCEPTABLE
 * ----------------------------------------------
 * A partially-truncated call that keeps one required parameter and loses
 * another will pass this gate. That is a conscious trade:
 *
 *   - The adapter fix (llmAdapters.js) already stops partial truncation at
 *     the source — incomplete argument JSON is never emitted as a tool call.
 *     This gate is the last-line backstop for arguments that PARSE cleanly
 *     but arrived empty, which is the case that reached production.
 *   - The tool's own implementation still validates its inputs; `codeTools`
 *     now raises a truthful "Missing required parameter 'path'" instead of
 *     EISDIR.
 *
 * Catching every conceivable partial failure would require trusting schema
 * quality across 206 third-party definitions. Refusing to execute a tool that
 * received literally nothing does not.
 *
 *
 * FAIL-OPEN ON UNKNOWN SCHEMAS
 * ----------------------------
 * If the tool's schema is not in the supplied list, this returns "nothing to
 * block". The gate may only reject what it can positively prove is invalid.
 * Tools arriving via `discover_tools` mid-turn, MCP servers, and dynamically
 * registered plugins must never be blocked by a stale schema snapshot.
 *
 * Full AJV schema validation is likewise NOT applied here. Some registry and
 * plugin schemas declare `additionalProperties: false`, which would reject the
 * orchestrator's own injected `_executeAsync` control params; others carry
 * enum/type drift that is tolerated today. Enforcing those at this choke point
 * would convert latent schema debt into live outages.
 */

/**
 * Orchestrator-injected control parameters. These are added by the runtime,
 * are not part of any tool's declared schema, and must be stripped before a
 * schema is consulted.
 */
export const ASYNC_CONTROL_PARAMS = Object.freeze([
  '_executeAsync',
  '_estimatedMinutes',
  '_interval',
  '_stopAfter',
  '_duration',
  '_delayFirst',
]);

/**
 * Remove orchestrator control params from an argument object.
 * Returns a new object; the input is never mutated.
 */
export function stripControlParams(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const out = { ...args };
  for (const key of ASYNC_CONTROL_PARAMS) delete out[key];
  return out;
}

/**
 * Find the schema entry for a tool name in an OpenAI-format schema array.
 * Returns undefined when the tool is unknown (callers must fail open).
 */
export function findToolSchema(toolName, toolSchemas) {
  if (!Array.isArray(toolSchemas)) return undefined;
  return toolSchemas.find((t) => t?.function?.name === toolName);
}

/**
 * Report which declared-required parameters are absent from `args`.
 *
 * This is INTROSPECTION, not the blocking decision — see
 * `findBlockingMissingParams` for what actually gates execution. Kept separate
 * because "what is missing" and "is that fatal" are different questions, and
 * conflating them is exactly how the first version of this guard produced 248
 * false rejections.
 *
 * A parameter counts as MISSING when it is absent, `undefined`, or `null`.
 *
 * An empty string is deliberately NOT treated as missing: `""` is a legitimate
 * value for some parameters (`write_file` creating an empty file, a cleared
 * search field). Parameters for which blank is meaningless — a filesystem
 * path, for instance — reject it in their own implementation, where the
 * semantics are actually known.
 *
 * @param {string} toolName
 * @param {object} args              Parsed arguments (control params tolerated)
 * @param {Array}  toolSchemas       OpenAI-format tool schema array
 * @returns {string[]}               Missing required parameter names ([] = none)
 */
export function findMissingRequiredParams(toolName, args, toolSchemas) {
  const schema = findToolSchema(toolName, toolSchemas);
  // Fail open: unknown tool, or a schema that declares no requirements.
  const required = schema?.function?.parameters?.required;
  if (!Array.isArray(required) || required.length === 0) return [];

  const clean = stripControlParams(args);
  return required.filter((key) => {
    const value = clean[key];
    return value === undefined || value === null;
  });
}

/**
 * THE BLOCKING DECISION.
 *
 * Returns the missing parameter names ONLY when every declared-required
 * parameter is absent — the model supplied nothing the schema asked for.
 * Returns `[]` (execute normally) in every other case, including when some
 * required parameters are missing.
 *
 * See the module header for the measurement that produced this predicate.
 *
 * @returns {string[]}  Non-empty => block the call. Empty => proceed.
 */
export function findBlockingMissingParams(toolName, args, toolSchemas) {
  const missing = findMissingRequiredParams(toolName, args, toolSchemas);
  if (missing.length === 0) return [];

  const required = findToolSchema(toolName, toolSchemas).function.parameters.required;
  // Partial arguments are the tool's own business — only total loss is
  // unambiguously a transport failure rather than a schema-quality artifact.
  if (missing.length < required.length) return [];

  return missing;
}

/**
 * Build an error payload for a tool call that arrived with no usable arguments.
 *
 * The message is written for the MODEL, not for a log file: it names the tool,
 * names the missing parameters, states what actually arrived, and gives an
 * explicit instruction to re-issue the call. In production the model already
 * self-corrects from this signal — the failing `edit_file` calls were followed
 * by a successful retry ~20s later. This just replaces a misleading `EISDIR`
 * with the truth, so the correction is immediate instead of accidental.
 */
export function formatMissingParamsError(toolName, missing, args) {
  const received = (() => {
    try {
      const keys = Object.keys(stripControlParams(args));
      return keys.length ? keys.join(', ') : '(no parameters at all)';
    } catch {
      return '(unreadable)';
    }
  })();

  return {
    success: false,
    error:
      `Tool '${toolName}' was called without required parameter(s): ${missing.join(', ')}. ` +
      `Received: ${received}.`,
    tool: toolName,
    missingParameters: missing,
    recoverable: true,
    suggestion:
      `The arguments for '${toolName}' did not arrive intact — this usually means the ` +
      `tool call was truncated mid-generation. Re-issue the call with all required ` +
      `parameters (${missing.join(', ')}). If the arguments are large, split the work ` +
      `into smaller calls.`,
  };
}
