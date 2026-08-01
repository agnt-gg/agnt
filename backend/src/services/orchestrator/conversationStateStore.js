import crypto from 'crypto';
import db from '../../models/database/index.js';

/**
 * Durable prompt-prefix state, so a backend restart does not cost a cache write
 * on every open conversation.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The provider's prompt cache is keyed on the literal token prefix, so the
 * system block has to be BYTE-identical turn over turn. Several of its
 * sections are not naturally stable — the memory digest re-ranks, the skills
 * catalog re-reads the DB, the workspace section re-reads DISK — so they are
 * computed once and frozen onto the conversation context. Same for the tool
 * ordering, the eviction watermark and the resident-prose gate decisions.
 *
 * All of that lived only in ConversationManager's in-memory Map. Every restart
 * therefore re-derived the whole prefix for every live conversation, and the
 * next turn paid the full write rate (2.0x) instead of the read rate (0.1x).
 * Measured on a real conversation: one such break on a 147k-token thread wrote
 * 69,617 tokens that would otherwise have been read from cache.
 *
 * That is exactly one avoidable write per conversation per restart — cheap in
 * isolation, expensive during a day of development restarts.
 *
 * ── WHAT THIS IS NOT FOR ──────────────────────────────────────────────────
 * It is NOT what makes phone / remote access share a cache. A paired phone and
 * the desktop are two CLIENTS of the same backend process (see PairingRoutes:
 * pairing hands the phone a code that resolves to this server's own token), so
 * they already share ConversationManager's Map and already share the prefix.
 * This closes the restart gap, and as a side effect makes the state portable
 * if the backend ever runs as more than one process.
 *
 * ── DESIGN ────────────────────────────────────────────────────────────────
 * ALLOW-LIST, never a deny-list. The conversation context also carries
 * `authToken`, the abort signal, the full message array and the resolved tool
 * schemas. An allow-list means a secret added to the context later cannot
 * silently start being written to disk; a deny-list would have to be updated
 * every time, and would fail open.
 *
 * FAILS OPEN in both directions. A read error returns null and the caller
 * re-derives exactly as it does today; a write error is logged and dropped.
 * This is an optimisation in front of a correct-but-costlier path, and it must
 * never be able to break a turn.
 */

/**
 * Every key OrchestratorService restores from `priorContext`, and nothing else.
 *
 * `kind` drives revival: JSON has no Set, so Set-valued keys round-trip as
 * arrays and are rebuilt on the way back in. They are rebuilt as real Sets
 * rather than left as arrays so that a context restored from disk is
 * INDISTINGUISHABLE from one restored from memory — otherwise a later
 * `.has(...)` would work on one path and throw on the other.
 */
export const PERSISTED_STATE_KEYS = [
  // Frozen system-prompt sections (byte-identity of the cached prefix).
  { key: '_frozenSkillsCatalog', kind: 'value' },
  { key: '_frozenMemorySection', kind: 'value' },
  { key: '_frozenCustomInstructions', kind: 'value' },
  { key: '_frozenWorkspaceSection', kind: 'value' },
  { key: '_frozenAsyncToolsEnabled', kind: 'value' },
  { key: '_frozenPromptGates', kind: 'value' },
  // Tool-surface ordering and pinning (byte-identity of the cached tool array).
  { key: '_loadedToolGroups', kind: 'set' },
  { key: '_loadedToolNames', kind: 'set' },
  { key: '_pinnedToolNames', kind: 'value' },
  { key: '_toolOrder', kind: 'value' },
  // Compression watermark. Losing this re-cuts the history at a different
  // point, which moves the message prefix as well as the system block.
  { key: '_evictedUnits', kind: 'value' },
  // Learned estimator correction + the panel's prior-turn fingerprints.
  { key: '_estimateCalibration', kind: 'value' },
  { key: '_residualDrift', kind: 'value' },
  { key: '_manifestFingerprints', kind: 'value' },
  // Progressive skill disclosure — a re-activated skill would re-inject its
  // playbook into the message stream.
  { key: 'activatedSkills', kind: 'set' },
];

/**
 * Skip persisting anything larger than this.
 *
 * The frozen sections are text (skills catalog ~26KB, custom instructions
 * ~17KB), so a normal row is well under 64KB. The cap exists so that a
 * pathological context cannot turn a cache optimisation into unbounded DB
 * growth — the failure mode is "no cache benefit", never "runaway table".
 */
export const MAX_STATE_BYTES = 256 * 1024;

/**
 * Rows older than this are pruned.
 *
 * Matches ConversationManager's 24h in-memory expiry. The provider's cache TTL
 * is one hour, so a conversation untouched for a day has no live prefix to
 * preserve and its row is pure overhead.
 */
export const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** conversationId -> hash of the last state written. */
const lastWrittenHash = new Map();
let lastPruneAt = 0;

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); });
});

/**
 * Extract the persistable subset of a conversation context.
 * @returns {object|null} null when there is nothing worth storing.
 */
export function serializeConversationState(context) {
  if (!context || typeof context !== 'object') return null;
  const out = {};
  for (const { key, kind } of PERSISTED_STATE_KEYS) {
    const value = context[key];
    if (value === undefined || value === null) continue;
    if (kind === 'set') {
      const arr = value instanceof Set ? [...value] : (Array.isArray(value) ? value : null);
      if (arr && arr.length > 0) out[key] = arr;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Rebuild a context-shaped object from a stored blob.
 *
 * The result is fed to the SAME restore code that consumes an in-memory prior
 * context — one restore path, two sources — so the two can never drift apart.
 */
export function reviveConversationState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const { key, kind } of PERSISTED_STATE_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (value === undefined || value === null) continue;
    out[key] = kind === 'set' ? new Set(Array.isArray(value) ? value : []) : value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Persist the prefix-critical state for a conversation.
 *
 * Skips the write when nothing changed. The frozen sections are settled on
 * turn 1 and never move again, so the steady state is one write per
 * conversation rather than one per turn.
 */
export async function saveConversationState(conversationId, userId, context) {
  if (!conversationId || typeof conversationId !== 'string') return false;
  // Optimistic client ids are replaced once the server assigns a real one, so
  // a row keyed on one would be stranded forever.
  if (conversationId.startsWith('temp-')) return false;

  const state = serializeConversationState(context);
  if (!state) return false;

  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch {
    return false;
  }
  if (serialized.length > MAX_STATE_BYTES) {
    console.warn(
      `[ConversationState] Skipping ${conversationId}: state is ${serialized.length} bytes ` +
      `(cap ${MAX_STATE_BYTES}).`
    );
    return false;
  }

  const stateHash = hash(serialized);
  if (lastWrittenHash.get(conversationId) === stateHash) return false;

  try {
    await dbRun(
      `INSERT INTO conversation_prompt_state (conversation_id, user_id, state, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         user_id = excluded.user_id,
         state = excluded.state,
         state_hash = excluded.state_hash,
         updated_at = excluded.updated_at`,
      [conversationId, userId || null, serialized, stateHash, new Date().toISOString()]
    );
    lastWrittenHash.set(conversationId, stateHash);
    await maybePrune();
    return true;
  } catch (err) {
    console.error('[ConversationState] Save failed (non-critical):', err.message);
    return false;
  }
}

/**
 * Load persisted state for a conversation.
 * @returns {Promise<object|null>} a context-shaped object, or null.
 */
export async function loadConversationState(conversationId) {
  if (!conversationId || typeof conversationId !== 'string') return null;
  try {
    const row = await dbGet(
      'SELECT state, state_hash FROM conversation_prompt_state WHERE conversation_id = ?',
      [conversationId]
    );
    if (!row?.state) return null;
    const revived = reviveConversationState(JSON.parse(row.state));
    if (revived && row.state_hash) {
      // Seed the write-skip cache so an unchanged turn does not rewrite the
      // row it just read.
      lastWrittenHash.set(conversationId, row.state_hash);
    }
    if (revived) {
      console.log(`[ConversationState] Restored prompt state for ${conversationId} from disk`);
    }
    return revived;
  } catch (err) {
    console.error('[ConversationState] Load failed, re-deriving:', err.message);
    return null;
  }
}

/** Drop rows for conversations that can no longer have a live cached prefix. */
export async function pruneConversationState(maxAgeMs = STATE_MAX_AGE_MS) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  try {
    const res = await dbRun('DELETE FROM conversation_prompt_state WHERE updated_at < ?', [cutoff]);
    if (res?.changes > 0) {
      console.log(`[ConversationState] Pruned ${res.changes} expired row(s)`);
    }
    return res?.changes || 0;
  } catch (err) {
    console.error('[ConversationState] Prune failed (non-critical):', err.message);
    return 0;
  }
}

/**
 * Prune at most once an hour, piggybacked on a save.
 *
 * Deliberately NOT a setInterval: a timer is a process-lifetime resource that
 * has to be owned, cleaned up and reasoned about in tests, and this work has no
 * deadline of its own.
 */
async function maybePrune() {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  await pruneConversationState();
}

/** Test seam. */
export function __resetConversationStateCache() {
  lastWrittenHash.clear();
  lastPruneAt = 0;
}

export default {
  saveConversationState,
  loadConversationState,
  pruneConversationState,
  serializeConversationState,
  reviveConversationState,
};
