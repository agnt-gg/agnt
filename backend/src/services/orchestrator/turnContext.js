/**
 * turnContext — page context and the /skill playbook ride on the user
 * message, never in the system prompt.
 *
 * WHY
 * ---
 * Both change between turns: the page state on every edit in a Forge or
 * canvas, the skill whenever one is bound or released. The system prompt is
 * the cached prefix of every request, and Anthropic caches it as ONE block,
 * so any change there re-writes the system AND the whole message history at
 * cache-write price. Measured over 12 days: 9.7M tokens of system re-writes
 * that were not the voice toggle (turnRegister.js fixed that one).
 *
 * THE RULE
 * --------
 * A block goes on the user message of the turn where it CHANGES, and only
 * then. Unchanged, it is already in the history and is not repeated, so the
 * history does not grow by a workflow graph per turn. Gone (the user left
 * the page, released the skill), a fixed "None." block says so once, because
 * the earlier block would otherwise still read as current.
 *
 * The decorated message is stored exactly as sent and historyRehydration
 * restores it on later turns (the client only has the user's own words), so
 * every later request replays the same bytes.
 *
 * "Already in the history" means in the part the request still CARRIES: the
 * oldest units evicted by the context watermark are not sent, so a block that
 * only lives there is sent again.
 */
import { groupMessageUnits } from '../../utils/contextManager.js';

export const PAGE_CONTEXT_OPEN = '[PAGE CONTEXT]';
export const PAGE_CONTEXT_CLOSE = '[/PAGE CONTEXT]';
export const ACTIVE_SKILL_OPEN = '[ACTIVE SKILL]';
export const ACTIVE_SKILL_CLOSE = '[/ACTIVE SKILL]';
/** Every block header this module puts in front of a user message. */
export const TURN_CONTEXT_HEADERS = Object.freeze([ACTIVE_SKILL_OPEN, PAGE_CONTEXT_OPEN]);

export const NO_PAGE_TEXT = 'None. The user has left the page described earlier in this conversation; that context no longer applies.';
export const NO_SKILL_TEXT = 'None. The skill bound earlier in this conversation is no longer active; stop following its instructions.';

const wrap = (open, close, body) => `${open}\n${body}\n${close}`;

/** The most recent `open`…`close` block in a user message of `history`, or null. */
export function latestBlock(history, open, close) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== 'user' || typeof message.content !== 'string') continue;
    const start = message.content.indexOf(open);
    if (start === -1) continue;
    const end = message.content.indexOf(close, start + open.length);
    if (end === -1) continue;
    return message.content.slice(start, end + close.length);
  }
  return null;
}

function nextBlock(history, open, close, text, noneText) {
  const previous = latestBlock(history, open, close);
  if (!text) {
    // Nothing this turn. Say so only while an earlier block is still in force.
    const none = wrap(open, close, noneText);
    return previous && previous !== none ? none : '';
  }
  const block = wrap(open, close, text);
  return block === previous ? '' : block;
}

/**
 * The blocks this turn's user message needs, in a fixed order (skill, page).
 *
 * @param {Array<object>} history the messages the request will carry BEFORE
 *   this turn's user message (see carriedHistory)
 * @param {{pageText?: string, skillText?: string}} current this turn's state
 * @returns {string[]} zero, one or two blocks
 */
export function turnContextBlocks(history, { pageText = '', skillText = '' } = {}) {
  return [
    nextBlock(history, ACTIVE_SKILL_OPEN, ACTIVE_SKILL_CLOSE, skillText, NO_SKILL_TEXT),
    nextBlock(history, PAGE_CONTEXT_OPEN, PAGE_CONTEXT_CLOSE, pageText, NO_PAGE_TEXT),
  ].filter(Boolean);
}

/**
 * The non-system history the request will carry: the units before the
 * persisted eviction watermark are dropped exactly as manageContext drops
 * them (contextManager.js), so a block that only survives there is re-sent.
 */
export function carriedHistory(messages, evictedUnits = 0) {
  const nonSystem = (messages || []).filter((m) => m?.role !== 'system');
  const cut = Math.max(0, Math.floor(Number(evictedUnits) || 0));
  if (cut === 0) return nonSystem;
  const units = groupMessageUnits(nonSystem);
  return units.slice(Math.min(cut, Math.max(0, units.length - 1))).flat();
}

/**
 * `content` with `blocks` in front, or `content` unchanged. Only a non-empty
 * string is decorated: historyRehydration restores a decorated string on
 * later turns, and nothing else. Every client sends string user content.
 */
export function prependTurnContext(content, blocks) {
  if (!blocks?.length || typeof content !== 'string' || content === '') return content;
  return `${blocks.join('\n\n')}\n\n${content}`;
}

/**
 * After context management evicted MORE history this turn: if the block the
 * turn relied on ("unchanged, already in the history") was in what got
 * evicted, put it back on this turn's user message. Eviction already re-writes
 * the cache, so this costs nothing extra. Returns `messages` itself when
 * nothing is missing, else a copy with the turn message re-decorated.
 *
 * @param {Array<object>} messages request messages containing this turn's user message
 * @param {{pageText?: string, skillText?: string}} current this turn's state
 * @param {number} evictedUnits the watermark after this turn's eviction
 * @param {string} turnContent this turn's user message content as sent; it
 *   names the message to decorate (later rounds may follow it, and a steer
 *   may be a later user message)
 */
export function reassertTurnContext(messages, current, evictedUnits, turnContent) {
  if (typeof turnContent !== 'string' || turnContent === '') return messages;
  const turnAt = messages.findLastIndex((m) => m?.role === 'user' && m.content === turnContent);
  if (turnAt === -1) return messages;
  const turn = messages[turnAt];
  const missing = turnContextBlocks(carriedHistory(messages.slice(0, turnAt), evictedUnits), current)
    .filter((block) => !turn.content.includes(block));
  if (missing.length === 0) return messages;
  const out = messages.slice();
  out[turnAt] = { ...turn, content: prependTurnContext(turn.content, missing) };
  return out;
}

export default { PAGE_CONTEXT_OPEN, reassertTurnContext, ACTIVE_SKILL_OPEN, TURN_CONTEXT_HEADERS, turnContextBlocks, carriedHistory, prependTurnContext, latestBlock };
