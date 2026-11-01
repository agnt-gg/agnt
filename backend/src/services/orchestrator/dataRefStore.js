import db from '../../models/database/index.js';

/**
 * Offloaded tool data ({{DATA_REF:…}}), kept so a backend restart does not lose it.
 *
 * Large tool results are swapped for a reference and the bytes are kept on the conversation context,
 * which lives in memory. A restart mid-chat dropped them while the reference stayed in the history,
 * so query_data answered "not found" (bravo, 2026-10-31: a data set was lost this way). Every offload
 * is also written here; query_data reads it back when memory no longer has it.
 *
 * Bounded: one value at most MAX_REF_BYTES, one conversation at most MAX_CONVERSATION_BYTES (oldest
 * refs go first), and rows older than REF_MAX_AGE_MS are pruned. Scoped by user: a conversation id
 * arrives from the client, so a ref is never readable through someone else's id. Fails open: a store
 * error costs the restart guarantee, never a turn.
 */
export const MAX_REF_BYTES = 8 * 1024 * 1024;
export const MAX_CONVERSATION_BYTES = 32 * 1024 * 1024;
export const REF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { return err ? reject(err) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))));

const storable = (conversationId, userId) => typeof conversationId === 'string' && conversationId && !conversationId.startsWith('temp-') && typeof userId === 'string' && userId;

export async function persistDataRef(conversationId, userId, dataId, content, summary = null) {
  if (!storable(conversationId, userId) || typeof dataId !== 'string' || typeof content !== 'string') return false;
  if (content.length > MAX_REF_BYTES) {
    console.warn(`[DataRefs] ${dataId} is ${content.length} chars (cap ${MAX_REF_BYTES}); kept in memory only.`);
    return false;
  }
  try {
    await run(
      `INSERT INTO conversation_data_refs (conversation_id, user_id, data_id, content, summary, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id, data_id) DO NOTHING`,
      [conversationId, userId, dataId, content, summary ? JSON.stringify(summary) : null, content.length, new Date().toISOString()],
    );
    await trimConversation(conversationId);
    await maybePrune();
    return true;
  } catch (error) {
    console.error('[DataRefs] Save failed (non-critical):', error.message);
    return false;
  }
}

async function trimConversation(conversationId) {
  const rows = await all('SELECT data_id, size FROM conversation_data_refs WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC', [conversationId]);
  let total = 0;
  for (const row of rows) {
    total += row.size || 0;
    if (total > MAX_CONVERSATION_BYTES) await run('DELETE FROM conversation_data_refs WHERE conversation_id = ? AND data_id = ?', [conversationId, row.data_id]);
  }
}

/** One ref, or null. */
export async function loadDataRef(conversationId, userId, dataId) {
  if (!storable(conversationId, userId) || typeof dataId !== 'string') return null;
  try {
    const row = await get('SELECT content, summary FROM conversation_data_refs WHERE conversation_id = ? AND user_id = ? AND data_id = ?', [conversationId, userId, dataId]);
    if (!row) return null;
    let summary = null;
    try { summary = row.summary ? JSON.parse(row.summary) : null; } catch { /* a bad summary does not lose the data */ }
    return { content: row.content, summary };
  } catch (error) {
    console.error('[DataRefs] Load failed:', error.message);
    return null;
  }
}

/** The refs stored for a conversation: ids, sizes and summaries, without the data. */
export async function listDataRefs(conversationId, userId) {
  if (!storable(conversationId, userId)) return [];
  try {
    const rows = await all('SELECT data_id, size, summary FROM conversation_data_refs WHERE conversation_id = ? AND user_id = ? ORDER BY created_at', [conversationId, userId]);
    return rows.map((row) => {
      let summary = null;
      try { summary = row.summary ? JSON.parse(row.summary) : null; } catch { /* keep the id */ }
      return { dataId: row.data_id, size: row.size, summary };
    });
  } catch (error) {
    console.error('[DataRefs] List failed:', error.message);
    return [];
  }
}

export async function pruneDataRefs(maxAgeMs = REF_MAX_AGE_MS) {
  try {
    const result = await run('DELETE FROM conversation_data_refs WHERE created_at < ?', [new Date(Date.now() - maxAgeMs).toISOString()]);
    return result?.changes || 0;
  } catch (error) {
    console.error('[DataRefs] Prune failed (non-critical):', error.message);
    return 0;
  }
}

/** At most hourly, piggybacked on a save (no timer to own). */
async function maybePrune() {
  if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = Date.now();
  await pruneDataRefs();
}

/**
 * Hand an offload to the store without making the turn wait. Used where large data is offloaded
 * (OrchestratorService); errors are already contained by persistDataRef.
 */
export function rememberDataRef(context, dataId, content, summary) {
  persistDataRef(context?.conversationId, context?.userId, dataId, content, summary).catch(() => {});
}
