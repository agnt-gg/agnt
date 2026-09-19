/**
 * Turn continuity: keeping a tool loop alive without teaching the model to
 * stop.
 *
 * THE BUG THIS MODULE CLOSES
 * --------------------------
 * Anthropic requires strict user/assistant alternation and documents that a
 * user message shaped [tool_result..., text] causes degenerate 2-3 token
 * end_turn responses (PRD-082). Two earlier repairs satisfied both rules by
 * inserting a FABRICATED assistant turn between the tool results and the
 * user's text:
 *
 *   assistant: "(Continuing.)"                        (adapter bridge)
 *   assistant: "(Mid-run instruction received ...)"   (steer bridge)
 *
 * Claude is a few-shot imitator. A history that demonstrates a legal
 * assistant turn consisting of one short parenthetical and no tool call is a
 * history that teaches the model to produce exactly that. A text-only turn
 * has zero tool calls, so the orchestrator's tool loop exits, and the work
 * stops mid-task with "(Continuing.)" on screen. Because that turn is then
 * persisted as genuine model output, every later request carries the pattern
 * as the model's own prior behaviour - it compounds.
 *
 * THE CONTRACT
 * ------------
 * 1. NEVER fabricate an assistant turn. User text that lands after tool
 *    results is folded INTO the last tool_result block's content, behind a
 *    label that identifies it as user input. That shape is legal, is not the
 *    PRD-082 anti-pattern, and cannot be imitated because it is not an
 *    assistant turn at all. (`foldBlocksIntoLastToolResult`)
 * 2. Scrub the legacy bridges and their imitations out of outbound history
 *    so already-poisoned conversations stop re-teaching the pattern.
 *    (`isImitableStatusTurn`)
 * 3. If the model still ends a round on a bare status line, treat that as a
 *    pause, not a finish: nudge once or twice with tools available and let
 *    the loop continue. (`isNonTerminalStatus`, `CONTINUATION_NUDGE_TEXT`)
 */

/**
 * Label prefixed to user content that has been folded into a tool_result
 * block. Names the provenance so the model reads it as an instruction, not as
 * output of the tool, and so prompt-injection heuristics keyed on tool output
 * do not discount it.
 */
export const USER_AFTER_TOOL_RESULT_LABEL =
  '[Message from the user, received after this tool result. This is user input, not tool output, and takes priority over the result above.]';

/** Historic fabricated bridge strings. Scrubbed on sight. */
const LEGACY_BRIDGE_TEXTS = new Set([
  '(Continuing.)',
  '(Mid-run instruction received from the user.)',
]);

/**
 * A short status line with no substance: the shape the model learned from the
 * legacy bridges. Deliberately tight - it must never match a real answer.
 *   "(Continuing.)"  "Continuing."  "Continuing now..."  "(Proceeding)"
 *   "Moving on."     "Next."        "On it."
 */
const STATUS_ONLY_PATTERN =
  /^[([]?\s*(continuing|proceeding|moving on|carrying on|next|on it|working on it|one moment|resuming)(\s+(now|with the task|the task|the work))?\s*[.!…]*\s*[)\]]?$/i;

const MAX_STATUS_LINE_CHARS = 80;

/**
 * Normalize a message's content to a single trimmed string when, and only
 * when, it is text-only. Returns null for tool calls, images, multi-block
 * content, or anything else that carries substance.
 */
function textOnlyContent(message) {
  if (!message || typeof message !== 'object') return null;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return null;
  const { content } = message;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    if (content.length !== 1) return null;
    const [block] = content;
    if (!block || block.type !== 'text' || typeof block.text !== 'string') return null;
    return block.text.trim();
  }
  return null;
}

/**
 * True for an assistant turn that is either a legacy fabricated bridge or the
 * model's imitation of one. Such turns carry no information and actively
 * teach the model to end turns early, so outbound sanitizers drop them.
 *
 * @param {Object} message Provider-agnostic history message.
 * @returns {boolean}
 */
export function isImitableStatusTurn(message) {
  if (!message || message.role !== 'assistant') return false;
  const text = textOnlyContent(message);
  if (text === null || text === '') return false;
  if (LEGACY_BRIDGE_TEXTS.has(text)) return true;
  return text.length <= MAX_STATUS_LINE_CHARS && STATUS_ONLY_PATTERN.test(text);
}

/**
 * True when a model response that made no tool calls reads as a pause rather
 * than a finish. The orchestrator uses this to decide whether a tool round
 * that ended without tool calls should be nudged back into work.
 *
 * @param {string} text Display text of the final assistant response.
 * @returns {boolean}
 */
export function isNonTerminalStatus(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (LEGACY_BRIDGE_TEXTS.has(trimmed)) return true;
  if (trimmed.length > MAX_STATUS_LINE_CHARS || /\r|\n/.test(trimmed)) return false;
  return STATUS_ONLY_PATTERN.test(trimmed);
}

/**
 * The providers that ever carried the fabricated bridge, and therefore the
 * only ones whose models learned to end a round on it. The continuation
 * guards are scoped to them so every other provider's round-end logic is
 * exactly what it was before this module existed.
 */
const BRIDGE_AFFECTED_PROVIDERS = new Set(['anthropic', 'claude-code']);

/**
 * @param {string} provider Normalized provider key.
 * @returns {boolean} Whether the continuation guards apply to this provider.
 */
export function continuationGuardsApply(provider) {
  return BRIDGE_AFFECTED_PROVIDERS.has(String(provider || '').toLowerCase());
}

/** How many times a single turn may be nudged past a bare status line. */
export const MAX_CONTINUATION_NUDGES = 2;

/**
 * Sent as a user message when the model paused on a status line. Tools stay
 * available on the follow-up call, so the model can either resume the work or
 * deliver a real final answer - both leave the loop in a defined state.
 */
export const CONTINUATION_NUDGE_TEXT =
  '[System: Your previous message was a status line with no tool call, which ends the turn. ' +
  'The task is not finished. Either continue with the next tool call now, or, if the task is ' +
  'complete or genuinely blocked, state the result or the blocker in full.]';

/**
 * Coerce a tool_result block's `content` into the array form Anthropic
 * accepts, without losing anything that was there.
 */
function toolResultContentAsArray(content) {
  if (Array.isArray(content)) return content.slice();
  if (content === undefined || content === null || content === '') return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [{ type: 'text', text: JSON.stringify(content) }];
}

/**
 * tool_result content accepts only text and image blocks. Anything else that
 * arrives as user content is carried as its textual form rather than dropped
 * or rejected at the wire.
 */
function asToolResultBlock(block) {
  if (block && (block.type === 'text' || block.type === 'image')) return block;
  return { type: 'text', text: JSON.stringify(block) };
}

/**
 * Fold user content blocks into the LAST tool_result block of a user message,
 * behind `USER_AFTER_TOOL_RESULT_LABEL`.
 *
 * Returns a NEW message; the input is not mutated (upstream cache-marker
 * identity checks depend on untouched messages passing through by reference,
 * and the caller decides whether this one was touched).
 *
 * @param {Object} carrier  User message whose content ends in tool_result blocks.
 * @param {Array<Object>} blocks  Content blocks to fold (text/image; others stringified).
 * @param {{label?: boolean, toolUseId?: string}} [options]
 *   `label:false` when the blocks already carry their own provenance label.
 *   `toolUseId` targets that tool_result instead of the last one, when present.
 * @returns {Object} The carrier with the blocks folded into the chosen tool_result.
 */
export function foldBlocksIntoLastToolResult(carrier, blocks, options = {}) {
  const content = Array.isArray(carrier?.content) ? carrier.content : [];
  const targetedIdx = options.toolUseId
    ? content.findIndex((b) => b?.type === 'tool_result' && b.tool_use_id === options.toolUseId)
    : -1;
  const lastResultIdx = targetedIdx !== -1
    ? targetedIdx
    : content.map((b) => b?.type).lastIndexOf('tool_result');
  if (lastResultIdx === -1) {
    throw new Error('foldBlocksIntoLastToolResult: carrier has no tool_result block');
  }
  const incoming = (Array.isArray(blocks) ? blocks : []).map(asToolResultBlock);
  if (incoming.length === 0) return carrier;

  const target = content[lastResultIdx];
  const folded = {
    ...target,
    content: [
      ...toolResultContentAsArray(target.content),
      ...(options.label === false ? [] : [{ type: 'text', text: USER_AFTER_TOOL_RESULT_LABEL }]),
      ...incoming,
    ],
  };
  const nextContent = content.slice();
  nextContent[lastResultIdx] = folded;
  return { ...carrier, content: nextContent };
}
