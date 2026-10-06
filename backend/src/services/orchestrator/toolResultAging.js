/**
 * toolResultAging.js — old tool output leaves the request in batches.
 *
 * WHY THIS EXISTS
 * ---------------
 * A tool result is sent again on every later request of the conversation. On
 * a 1M-token model nothing ever trims it (eviction only starts near the
 * window), so a long session re-sends every scrape, trace and log it ever
 * produced: measured over 30 days, re-sent tool output was 2.8B tokens, 38% of
 * all prompt tokens, and the median prompt at round 60 was 444k tokens.
 *
 * WHAT IT DOES
 * ------------
 * The most recent KEEP_RECENT results are always sent whole. Once the older,
 * not-yet-aged results add up to HIGH_WATER_TOKENS, ALL of them are replaced
 * by a short stub in one step, and their full text is stored where query_data
 * reads it. Nothing is lost: the call (name + arguments) stays in history and
 * the result is one query_data call away.
 *
 * WHY IT IS CACHE-SAFE
 * --------------------
 * - It changes the REQUEST, never the ledger: the stored transcript, the
 *   user's saved conversation and history rehydration all keep full results.
 * - The aged set is a watermark (`_agedToolCallIds`) that only grows and is
 *   persisted with the conversation, so every request replays the same stubs.
 * - A stub depends only on the call id and tool name, so it is byte-identical
 *   whichever copy of the result this request carries.
 * - It advances in batches of >= HIGH_WATER_TOKENS, never every round.
 *
 * WHEN A BATCH IS ALLOWED
 * -----------------------
 * Stubbing a result changes its message, so the cache re-writes from the
 * first newly aged result to the end of the request (at 2x input price,
 * instead of reading it at 0.1x). Measured 2026-10-06 over 17 mid-run batches:
 * net positive overall, but 7 of 17 lost money, each one rewriting a long
 * tail to remove little. So a batch runs only when it is free or pays back:
 * - the cache is cold for this request anyway (first request, other model,
 *   idle past the TTL): nothing extra is re-written; or
 * - what it removes is at least PAYBACK_RATIO of what it re-writes, which
 *   recovers the write within ~18 later rounds (see agingPaysBack).
 */

import { assistantToolCalls } from './historyRehydration.js';
import { USER_AFTER_TOOL_RESULT_LABEL } from './turnContinuity.js';
import { TOOL_LOAD_FIELD } from './deferredTools.js';

/** Results always sent whole: the working set of the current task. */
export const KEEP_RECENT = 12;
/** Older output that must accumulate before a batch is aged. */
export const HIGH_WATER_TOKENS = 40_000;
/** Results this small cost less than their stub's round trip; never aged. */
export const MIN_AGE_CHARS = 2_000;
/** Results the model keeps following for the whole task. */
export const NEVER_AGED_TOOLS = new Set(['activate_skill', 'discover_tools']);
/**
 * On a warm cache, a batch must remove at least this share of the tokens it
 * re-writes. Re-writing costs 1.9x per token over a read; each later round
 * saves 0.1x per removed token, plus the removed tokens are never written
 * again: break-even ratio = 1.9 / (2 + 0.1 * laterRounds), 0.5 at ~18 rounds.
 */
export const PAYBACK_RATIO = 0.5;

const CHARS_PER_TOKEN = 4;

/** Serialized length of a message, the unit the payback rule compares. */
function messageChars(message) {
  const { content } = message || {};
  if (typeof content === 'string') return content.length;
  try { return JSON.stringify(content ?? '').length + JSON.stringify(message.tool_calls ?? '').length; } catch { return 0; }
}

/**
 * Whether stubbing `removedChars` pays for re-writing every message from
 * `firstAt` to the end of `messages`.
 */
export function agingPaysBack(messages, firstAt, removedChars) {
  let rewrittenChars = 0;
  for (let i = firstAt; i < messages.length; i += 1) rewrittenChars += messageChars(messages[i]);
  return rewrittenChars > 0 && removedChars >= PAYBACK_RATIO * rewrittenChars;
}

export const agedDataId = (toolCallId) => `data-${toolCallId}-aged`;

export function agedStub(toolCallId, toolName) {
  return `[Earlier ${toolName || 'tool'} result moved out of context to keep requests small. `
    + `It is stored in full: query_data with dataId="${agedDataId(toolCallId)}" can search, slice or json_path it.]`;
}

/** Text of a result's content when it is plain text, else null (images, references). */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.length > 0 && content.every((b) => b?.type === 'text' && typeof b.text === 'string')) {
    return content.map((b) => b.text).join('\n');
  }
  return null;
}

/** Every tool result in order: {id, text, at, block} (block null for role:'tool'). */
function listResults(messages) {
  const results = [];
  messages.forEach((message, at) => {
    if (message?.role === 'tool' && message.tool_call_id && !message[TOOL_LOAD_FIELD]) {
      results.push({ id: message.tool_call_id, text: textOf(message.content), at, block: null });
    } else if (message?.role === 'user' && Array.isArray(message.content)) {
      message.content.forEach((block, b) => {
        if (block?.type === 'tool_result' && block.tool_use_id && !block[TOOL_LOAD_FIELD]) {
          results.push({ id: block.tool_use_id, text: textOf(block.content), at, block: b });
        }
      });
    }
  });
  return results;
}

/**
 * The request copy of `messages` with aged results stubbed, advancing the
 * watermark when the high-water mark is crossed.
 *
 * @param {Array<object>} messages the ledger for this request (not mutated)
 * @param {object} context conversation context: `_agedToolCallIds`, `preservedContent`, `dataRefSummaries`
 * @param {{summarize?: (text: string, dataId: string) => object, cacheCold?: boolean}} [options]
 *   `cacheCold`: this request re-writes its whole prompt anyway (a batch is free)
 * @returns {Array<object>} `messages` itself when nothing is aged, else a copy
 */
export function ageToolResults(messages, context, { summarize = null, cacheCold = false } = {}) {
  if (!Array.isArray(messages) || !context) return messages;
  const aged = new Set(context._agedToolCallIds || []);
  const nameOf = new Map();
  for (const message of messages) for (const call of assistantToolCalls(message)) nameOf.set(call.id, call.name);

  const results = listResults(messages);
  // Never hide text the user folded into a result (a mid-run steer).
  const stubbable = (r) => r.text !== null && !r.text.includes(USER_AFTER_TOOL_RESULT_LABEL);
  // Size and tool decide what ENTERS the aged set; once in, an id is stubbed
  // on every later request whatever copy of the result that request carries.
  const eligible = (r) => stubbable(r) && r.text.length > MIN_AGE_CHARS && !NEVER_AGED_TOOLS.has(nameOf.get(r.id));

  const candidates = results.slice(0, Math.max(0, results.length - KEEP_RECENT)).filter((r) => !aged.has(r.id) && eligible(r));
  const stubLength = 220;
  const removedChars = candidates.reduce((sum, r) => sum + Math.max(0, r.text.length - stubLength), 0);
  const pendingTokens = removedChars / CHARS_PER_TOKEN;
  const affordable = cacheCold || (candidates.length > 0 && agingPaysBack(messages, candidates[0].at, removedChars));
  if (pendingTokens >= HIGH_WATER_TOKENS && affordable) {
    for (const r of candidates) aged.add(r.id);
    context._agedToolCallIds = [...aged];
    console.log(`[ToolResultAging] Aged ${candidates.length} result(s), ~${Math.round(pendingTokens)} tokens, out of the request (${aged.size} aged in total)`);
  }
  if (aged.size === 0) return messages;

  // Copy-on-write: only messages that carry an aged result are replaced.
  const out = messages.slice();
  for (const r of results) {
    if (!aged.has(r.id) || !stubbable(r)) continue;
    const dataId = agedDataId(r.id);
    if (!context.preservedContent) context.preservedContent = {};
    if (!context.dataRefSummaries) context.dataRefSummaries = {};
    if (context.preservedContent[dataId] === undefined) {
      context.preservedContent[dataId] = r.text;
      context.dataRefSummaries[dataId] = summarize ? summarize(r.text, dataId)
        : { dataId, size: r.text.length, lineCount: r.text.split('\n').length, type: 'text', preview: r.text.slice(0, 500) };
    }
    const stub = agedStub(r.id, nameOf.get(r.id));
    const message = out[r.at];
    if (r.block === null) {
      out[r.at] = { ...message, content: stub };
    } else {
      const content = message.content.slice();
      content[r.block] = { ...content[r.block], content: stub };
      out[r.at] = { ...message, content };
    }
  }
  return out;
}
