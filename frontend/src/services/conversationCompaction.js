/**
 * conversationCompaction — the fold between what the user sees and what the
 * model is sent.
 *
 * THE RULE
 * --------
 * Nothing is deleted. Compressing a conversation inserts ONE marker message
 * (role 'compaction') into the transcript. Everything above the marker stays
 * on screen, folded; everything the model receives from then on is the
 * marker's summary plus the messages below it. The marker IS the fold line,
 * so the screen can never show the model something the model is not seeing
 * without also showing the line that says so. Undo removes the marker and the
 * full history is sent again.
 *
 * Every history builder (main chat, unified channels, mobile) folds through
 * `foldHistorySource` so the three cannot disagree about what was sent.
 */

import { API_CONFIG } from '@/tt.config.js';
import { WIRE_PREAMBLE, WIRE_ACK } from '../../../backend/src/utils/compactedTranscript.js';
export { WIRE_PREAMBLE, WIRE_ACK };

export const COMPACTION_ROLE = 'compaction';

/** Messages kept verbatim below the fold so the model keeps its footing. */
export const DEFAULT_KEEP_TAIL = 4;

/** A fold has to hide at least one full exchange to be worth a marker. */
const MIN_FOLDED_MESSAGES = 2;

/**
 * What the model reads in place of the folded history. Stable text: it is the
 * start of the message prefix on every later turn, so it must not vary.
 */
// Wire framing is shared with the server/client recovery path.

export function isCompactionMessage(msg) {
  return !!msg && msg.role === COMPACTION_ROLE;
}

/** Index of the marker in force (the last one), or -1. */
export function activeCompactionIndex(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactionMessage(messages[i])) return i;
  }
  return -1;
}

/** The marker in force, or null. */
export function activeCompaction(messages = []) {
  const i = activeCompactionIndex(messages);
  return i === -1 ? null : messages[i];
}

/** Is this message above the fold (summarised, not sent)? */
export function isFoldedMessage(messages, msg) {
  const i = activeCompactionIndex(messages);
  if (i === -1) return false;
  const idx = messages.indexOf(msg);
  return idx !== -1 && idx < i;
}

/**
 * Where to cut. Returns the index of the first message to KEEP verbatim —
 * the marker is inserted there — or -1 when there is not enough to fold.
 *
 * The kept tail always starts on a user turn: the wire history becomes
 * user(summary) → assistant(ack) → user(tail…), which every provider accepts.
 * Starting the tail on an assistant turn would put two assistant messages
 * back to back.
 */
export function chooseFoldIndex(messages = [], { keepTail = DEFAULT_KEEP_TAIL } = {}) {
  const n = messages.length;
  if (n === 0) return -1;
  let keepFrom = Math.max(0, n - Math.max(1, keepTail));
  while (keepFrom > 0 && messages[keepFrom]?.role !== 'user') keepFrom -= 1;
  // Count only real turns above the cut; a previous marker and inline pills
  // are not conversation.
  let folded = 0;
  for (let i = 0; i < keepFrom; i++) {
    const r = messages[i]?.role;
    if (r === 'user' || r === 'assistant') folded += 1;
  }
  return folded >= MIN_FOLDED_MESSAGES ? keepFrom : -1;
}

/**
 * Cheap token estimate for the panel's before/after numbers. The backend's
 * calibrated count arrives with the next turn's context_status and replaces
 * this; it only needs to be honest about magnitude.
 */
export function estimateTokens(text) {
  const s = typeof text === 'string' ? text : (text == null ? '' : JSON.stringify(text));
  return Math.ceil(s.length / 4);
}

export function estimateMessageTokens(msg) {
  if (!msg) return 0;
  let t = estimateTokens(msg.content);
  for (const tc of msg.toolCalls || []) {
    t += estimateTokens(tc.args) + Math.min(500, estimateTokens(tc.result ?? tc.error ?? ''));
  }
  return t;
}

export function estimateMessagesTokens(messages = []) {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/** The two synthetic turns a marker becomes on the wire. */
export function compactionWireMessages(marker) {
  const summary = typeof marker?.content === 'string' ? marker.content : '';
  return [
    { id: `${marker.id}:summary`, role: 'user', content: `${WIRE_PREAMBLE}\n\n${summary}`, timestamp: marker.timestamp },
    { id: `${marker.id}:ack`, role: 'assistant', content: WIRE_ACK, timestamp: marker.timestamp },
  ];
}

/**
 * The message list a history builder should read. With no marker it is the
 * input itself (same identity — callers that memoise on it are unaffected).
 * With one, it is the marker's wire turns followed by the live tail.
 */
export function foldHistorySource(messages = []) {
  const i = activeCompactionIndex(messages);
  if (i === -1) return messages;
  return [...compactionWireMessages(messages[i]), ...messages.slice(i + 1)];
}

/**
 * Build the marker. `compaction` carries the stats the panel and the card
 * show; `content` is the summary and is editable in place.
 */
export function createCompactionMessage({
  summary,
  foldedCount,
  tokensBefore,
  tokensAfter,
  estimatedCost = null,
  provider = null,
  model = null,
  executionId = null,
  tokenUsage = null,
}) {
  return {
    id: `compaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: COMPACTION_ROLE,
    content: summary,
    timestamp: Date.now(),
    compaction: {
      foldedCount: Number(foldedCount) || 0,
      tokensBefore: Number(tokensBefore) || 0,
      tokensAfter: Number(tokensAfter) || 0,
      estimatedCost: estimatedCost == null ? null : Number(estimatedCost),
      provider,
      model,
      executionId,
      tokenUsage,
    },
  };
}

const authHeaders = () => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Ask the server to distil `messages` (wire format) into a summary.
 * @returns {Promise<{summary:string, estimatedCost:number|null, tokenUsage:object, provider:string, model:string, executionId:string|null}>}
 */
export async function requestCompaction({ conversationId, messages, provider, model, targetTokens, signal } = {}) {
  const res = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/compress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ conversationId, messages, provider, model, targetTokens }),
    signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || `Compression failed (HTTP ${res.status})`);
  }
  return json;
}

export default {
  COMPACTION_ROLE,
  isCompactionMessage,
  activeCompactionIndex,
  activeCompaction,
  isFoldedMessage,
  chooseFoldIndex,
  estimateTokens,
  estimateMessagesTokens,
  compactionWireMessages,
  foldHistorySource,
  createCompactionMessage,
  requestCompaction,
};
