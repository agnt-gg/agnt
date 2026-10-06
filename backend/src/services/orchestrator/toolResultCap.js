/**
 * The last line of context protection for one tool result.
 *
 * offloadLargeData (OrchestratorService) runs first and moves any single
 * string field over 50k chars into conversationContext.preservedContent. A
 * result can still exceed the cap through many medium fields, e.g. an
 * agnt_chat reply that carries the other agent's answer plus every tool result
 * it produced. This handles that case.
 *
 * Over the cap the result is MOVED, not cut: the whole original goes into the
 * same store query_data reads, and the model gets a compact, valid-JSON view
 * of it plus the reference. The previous cap kept only the top-level key names
 * and stamped success:false on everything, so a successful agent reply arrived
 * as an empty failure and its answer was unrecoverable (#115).
 *
 * The view keeps the shape of the result and shortens it progressively (long
 * strings, then long lists) until it fits, so small, high-value fields such as
 * an agent's `response` survive while bulky tool output is elided in place
 * with a marker saying where the rest is.
 */

// Room left in the cap for the envelope around the view.
const ENVELOPE_RESERVE = 2000;

/**
 * Cap for tools whose output is reference material the model scans rather than
 * quotes: pages, traces, logs, command output. A result over it is stored in
 * full and the model gets a ~12k-char head-and-tail view plus the reference.
 *
 * Measured over 30 days (2026-10-06): tool output re-sent in later rounds was
 * 2.8B tokens, 38% of every prompt token. A 16k view on these tools cuts that
 * by 13% at the source, before history aging (toolResultAging.js) does the
 * rest. Below this size a result is sent whole, exactly as before.
 */
export const REFERENCE_VIEW_CHARS = 16_000;

/**
 * Tools that keep the user's full cap. Their output is quoted back verbatim
 * (edit_file needs exact search strings; skill playbooks and API references
 * are followed literally) or is another agent's answer the user asked for.
 */
export const VERBATIM_RESULT_TOOLS = new Set([
  'read_file', 'grep_files', 'glob_files', 'list_files', 'edit_file', 'write_file',
  'file_operations', 'file_system_operation', 'query_data',
  'activate_skill', 'get_agnt_api',
  'agnt_chat', 'run_agent', 'execute_custom_agnt_tool',
  'codex_exec', 'grok_exec', 'cursor_exec',
]);

/** The character cap for one tool's result. */
export function toolResultCapFor(functionName, userCap) {
  return VERBATIM_RESULT_TOOLS.has(functionName) ? userCap : Math.min(userCap, REFERENCE_VIEW_CHARS);
}

// [longest string kept, most list items kept], tried in order until the view fits.
const SHRINK_LEVELS = [
  [24_000, 50],
  [8_000, 20],
  [2_000, 10],
  [500, 5],
  [120, 3],
];

function defaultSummary(content, dataId) {
  return { dataId, size: content.length, lineCount: content.split('\n').length, type: 'text', preview: content.slice(0, 500) };
}

// Share of a shortened string kept from its END. Command output, test runs
// and logs put the verdict last; a head-only view hid exactly that.
const TAIL_SHARE = 0.3;

function shrink(value, maxString, maxItems, dataId) {
  if (typeof value === 'string') {
    if (value.length <= maxString) return value;
    const tail = Math.floor(maxString * TAIL_SHARE);
    const head = maxString - tail;
    return `${value.slice(0, head)}… [${value.length - maxString} chars omitted, full text in ${dataId}] …${value.slice(value.length - tail)}`;
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, maxItems).map((item) => shrink(item, maxString, maxItems, dataId));
    if (value.length > maxItems) kept.push(`[${value.length - maxItems} more of ${value.length} items in ${dataId}]`);
    return kept;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = shrink(child, maxString, maxItems, dataId);
    return out;
  }
  return value;
}

/** The longest head-and-tail excerpt of `text` whose JSON encoding fits in `budget`. */
function textExcerpt(text, budget, dataId) {
  let length = Math.min(text.length, budget);
  const excerpt = (n) => {
    if (n >= text.length) return text;
    const tail = Math.floor(n * TAIL_SHARE);
    return `${text.slice(0, n - tail)}… [${text.length - n} chars omitted, full text in ${dataId}] …${text.slice(text.length - tail)}`;
  };
  while (length > 0 && JSON.stringify(excerpt(length)).length > budget) length = Math.floor(length * 0.8);
  return excerpt(length);
}

/**
 * @param {string} content  the tool result as sent to the model
 * @param {object} options
 * @param {number} options.cap                 max chars the model may receive
 * @param {string} options.functionName
 * @param {string} options.toolCallId
 * @param {object} options.conversationContext  holds preservedContent / dataRefSummaries
 * @param {(content: string, dataId: string) => object} [options.summarize]
 * @returns {string} `content` unchanged when within the cap, else the envelope
 */
export function capToolResult(content, { cap, functionName, toolCallId, conversationContext, summarize = defaultSummary, now = Date.now }) {
  if (typeof content !== 'string' || content.length <= cap) return content;

  const dataId = `data-${toolCallId}-${now()}-capped`;
  if (!conversationContext.preservedContent) conversationContext.preservedContent = {};
  if (!conversationContext.dataRefSummaries) conversationContext.dataRefSummaries = {};
  conversationContext.preservedContent[dataId] = content;
  conversationContext.dataRefSummaries[dataId] = summarize(content, dataId);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = undefined;
  }

  // The tool's own verdict survives: success stays success, a failure keeps its error.
  const verdict = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.success === 'boolean') {
    verdict.success = parsed.success;
    if (parsed.success === false && parsed.error !== undefined) verdict.error = String(parsed.error).slice(0, 2000);
  }

  const envelope = {
    ...verdict,
    _truncated: true,
    _original_size: content.length,
    _max_size: cap,
    data_ref: dataId,
    reference: `{{DATA_REF:${dataId}}}`,
    note:
      `The full ${functionName} result (${content.length} chars) is over the ${cap}-char context cap. Nothing was dropped: ` +
      `it is stored, and query_data with dataId="${dataId}" can search, slice or json_path it. "view" is a shortened copy.`,
  };
  const budget = cap - JSON.stringify(envelope).length - ENVELOPE_RESERVE;

  let view = `[too large to preview; read it with query_data dataId="${dataId}"]`;
  if (parsed === undefined) {
    view = textExcerpt(content, budget, dataId);
  } else {
    for (const [maxString, maxItems] of SHRINK_LEVELS) {
      const candidate = shrink(parsed, maxString, maxItems, dataId);
      if (JSON.stringify(candidate).length <= budget) {
        view = candidate;
        break;
      }
    }
  }

  return JSON.stringify({ ...envelope, view });
}
