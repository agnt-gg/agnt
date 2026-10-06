import crypto from 'crypto';
import { CACHE_CAUSES, MAX_CACHE_ROUNDS, normalizeExecutionTelemetry } from '../ai/executionTelemetry.js';
import { promptCacheTtlMs } from '../../utils/promptCacheTtl.js';

export { CACHE_CAUSES, MAX_CACHE_ROUNDS };

/**
 * Per-request prompt-cache attribution.
 *
 * WHY THIS EXISTS. Cache writes are a few percent of Claude input tokens but
 * roughly half of Claude input spend (a write bills 2.0x, a read 0.1x). The
 * ledger stores one aggregate per turn, so a 200k-token write could not be
 * attributed to anything: a tool-surface change, a system-prompt change, a
 * rewritten history message, an idle gap, or the provider simply not serving
 * a prefix we sent byte-for-byte. This module records, for every request, a
 * content-free fingerprint of what was sent and classifies the cache outcome
 * against the previous request in the same conversation.
 *
 * CONTENT-FREE BY CONSTRUCTION. Only counts, 12-char hashes, indices and
 * roles leave this module. No message text, tool arguments or prompt bytes.
 *
 * Usage is strictly sequential: `stamp()` immediately before a request is
 * sent, `observe()` with that request's usage. The orchestrator awaits each
 * stream before accumulating usage, so the latest stamp is always the request
 * the usage belongs to. A stamp with no usage (failed tier before failover)
 * is simply superseded by the next stamp.
 */

// A read short of the previous prompt by less than this is block-granularity
// noise, not a miss.
const MISS_TOLERANCE_MIN_TOKENS = 1024;
const MISS_TOLERANCE_RATIO = 0.02;

const sha = (text, length = 12) => crypto.createHash('sha1').update(text).digest('hex').slice(0, length);

// Cache markers are placed by the transports, and they mutate shared message
// objects in place. The marker position does not change the cache key, so it
// must not change the fingerprint either.
const withoutCacheMarkers = (key, value) => (key === 'cache_control' ? undefined : value);
const stable = (value) => JSON.stringify(value ?? null, withoutCacheMarkers);

function countBlocks(message) {
  const contentBlocks = Array.isArray(message?.content) ? message.content.length : 1;
  const toolCallBlocks = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0;
  return contentBlocks + toolCallBlocks;
}

/** Content-free fingerprint of one outbound request. Pure. */
export function fingerprintRequest({ provider, model, messages = [], tools = [] }) {
  const system = [];
  const history = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    (message?.role === 'system' ? system : history).push(message);
  }
  return {
    provider: String(provider || ''),
    model: String(model || ''),
    systemFp: sha(stable(system.map((m) => m.content))),
    toolsFp: sha(stable(tools)),
    messageHashes: history.map((m) => sha(stable(m), 10)),
    messageRoles: history.map((m) => String(m?.role || '')),
    blocks: history.reduce((sum, m) => sum + countBlocks(m), 0),
  };
}

/** Index of the first previous message that is not repeated verbatim, or -1. */
export function findHistoryDivergence(previousHashes = [], currentHashes = []) {
  for (let i = 0; i < previousHashes.length; i += 1) {
    if (currentHashes[i] !== previousHashes[i]) return i;
  }
  return -1;
}

/**
 * Decide why a request's cache outcome was what it was. Pure.
 * Order matters: a cause earlier in the list makes later ones moot (fixing a
 * tool change does not help a request that was idle past the TTL).
 */
export function classifyCacheRound({ previous, current, ttlMs }) {
  if (!previous) return { cause: 'cold', divergeAt: null };
  if (previous.provider !== current.provider || previous.model !== current.model) {
    return { cause: 'model_changed', divergeAt: null };
  }
  if (Number.isFinite(ttlMs) && current.msSincePrev > ttlMs) return { cause: 'ttl_expired', divergeAt: null };
  if (previous.toolsFp !== current.toolsFp) return { cause: 'tools_changed', divergeAt: null };
  if (previous.systemFp !== current.systemFp) return { cause: 'system_changed', divergeAt: null };
  const divergeAt = findHistoryDivergence(previous.messageHashes, current.messageHashes);
  if (divergeAt !== -1) return { cause: 'history_rewritten', divergeAt };
  const tolerance = Math.max(MISS_TOLERANCE_MIN_TOKENS, previous.promptTokens * MISS_TOLERANCE_RATIO);
  if (current.read + tolerance >= previous.promptTokens) return { cause: 'ok', divergeAt: null };
  return { cause: 'unexplained_miss', divergeAt: null };
}

/**
 * Stateful wrapper for one turn. `carried` is the previous turn's
 * `carryState()`; it lets the first request of a turn be compared against the
 * last request of the previous turn, which is where most expensive breaks sit.
 */
export function createCacheRoundTracker({ carried = null, now = () => Date.now() } = {}) {
  let previous = carried && typeof carried === 'object' ? carried : null;
  let pending = null;
  let requestsStamped = 0;
  let observedCount = 0;
  const rounds = [];

  return {
    stamp({ provider, model, messages, tools }) {
      requestsStamped += 1;
      pending = { ...fingerprintRequest({ provider, model, messages, tools }), sentAt: now() };
    },

    /**
     * @param {object} measured provider-reported counts for the stamped request
     * @param {number|null} ttlMs cache lifetime requested for this provider/model
     * @returns {object|null} the recorded round, or null when nothing was stamped
     */
    observe({ promptTokens = 0, read = 0, write5m = 0, write1h = 0, output = 0 }, ttlMs = null) {
      if (!pending) return null;
      const current = {
        ...pending,
        promptTokens,
        read,
        msSincePrev: previous ? Math.max(0, pending.sentAt - previous.sentAt) : null,
      };
      const { cause, divergeAt } = classifyCacheRound({ previous, current, ttlMs });
      const round = {
        round: rounds.length + 1,
        firstOfTurn: rounds.length === 0,
        msSincePrev: current.msSincePrev,
        promptTokens,
        uncached: Math.max(0, promptTokens - read - write5m - write1h),
        read,
        write5m,
        write1h,
        output,
        // Tokens the previous request had cached that this one did not read.
        lostTokens: previous && cause !== 'ok' ? Math.max(0, previous.promptTokens - read) : 0,
        blocksAdded: previous ? current.blocks - previous.blocks : null,
        toolsFp: current.toolsFp,
        systemFp: current.systemFp,
        cause,
        divergeAt: divergeAt === null ? null : divergeAt,
        divergeRole: divergeAt === null ? null : previous.messageRoles[divergeAt] || null,
        historyLength: current.messageHashes.length,
      };
      observedCount += 1;
      if (rounds.length < MAX_CACHE_ROUNDS) rounds.push(round);
      previous = current;
      pending = null;
      return round;
    },

    /**
     * Whether the NEXT request starts from a cold cache whatever it sends:
     * nothing cached yet, another provider/model, or idle past the TTL. Such
     * a request re-writes its whole prompt anyway, so changing old history
     * on it costs nothing extra (toolResultAging uses this).
     */
    isColdFor(provider, model, ttlMs = promptCacheTtlMs(provider, model)) {
      if (!previous) return true;
      if (previous.provider !== provider || previous.model !== model) return true;
      return Number.isFinite(ttlMs) && now() - previous.sentAt > ttlMs;
    },

    rounds: () => rounds.slice(),
    requestsStamped: () => requestsStamped,
    observedCount: () => observedCount,

    /** Minimal state for the next turn. Hashes and counts only. */
    carryState() {
      if (!previous) return null;
      const { provider, model, systemFp, toolsFp, messageHashes, messageRoles, blocks, sentAt, promptTokens } = previous;
      return { provider, model, systemFp, toolsFp, messageHashes, messageRoles, blocks, sentAt, promptTokens };
    },
  };
}

/**
 * The v2 execution-telemetry envelope for a chat turn, or null.
 *
 * Validated HERE rather than left to AgentExecutionModel.update, because that
 * call throws on an invalid envelope and it is the call that moves the run out
 * of `running`. A measurement bug must cost us the measurement, never the
 * run's terminal status. Tool-call counts are not tracked on this path, so
 * they are reported as unknown rather than as a guessed number.
 */
export function buildCacheTelemetry(status, tokenAccumulator, tracker) {
  try {
    const observed = tracker.observedCount();
    const stamped = tracker.requestsStamped();
    const hasUsage = tokenAccumulator && tokenAccumulator.totalTokens > 0;
    return normalizeExecutionTelemetry({
      version: 2,
      outcome: status === 'completed' ? 'completed' : 'failed',
      requestMetrics: null,
      usage: hasUsage ? {
        inputTokens: tokenAccumulator.inputTokens,
        outputTokens: tokenAccumulator.outputTokens,
        totalTokens: tokenAccumulator.totalTokens,
      } : null,
      usageCoverage: observed === 0 ? 'unknown' : observed === stamped ? 'complete' : 'partial',
      toolCalls: null,
      cacheRounds: tracker.rounds(),
    });
  } catch (error) {
    console.warn('[CacheTelemetry] Measurement discarded, run status unaffected:', error.message);
    return null;
  }
}
