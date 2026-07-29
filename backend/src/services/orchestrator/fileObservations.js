/**
 * What the file tools last saw at each path.
 *
 * WHY
 * ---
 * `edit_file` used to apply happily to a file that had changed on disk since it
 * was read (probe T6). That is a lost update with a success message on top: the
 * caller reasons about content that no longer exists, splices into it, and the
 * other writer's work disappears with nothing anywhere reporting a problem.
 *
 * The per-path lock added in 2026-07-25 closes the window between two AGNT tool
 * calls. It cannot close the window against an external writer — the user's
 * editor, a shell command, a patch script — because those never take the lock.
 * A content hash recorded at observation time does.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a read-before-edit interlock. Measured, 42% of production edits were
 * issued against a file this process had never read, and hard-failing all of
 * them would break far more than it fixed. An unobserved path is therefore
 * allowed through; a MISMATCHED one is not. The rule is "nobody changed this
 * behind your back", not "you must have read it first".
 *
 * Process-global rather than conversation-scoped on purpose: the question being
 * answered is about the FILE, not about who is asking. Two agents editing one
 * path both benefit — whichever writes second observes the first one's result
 * and proceeds against fresh content.
 */

import crypto from 'crypto';

/** Bounded so a long-lived server cannot accumulate an entry per path forever. */
export const MAX_OBSERVATIONS = 2000;

const _observations = new Map();

export function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Record what a tool just saw (or wrote) at `key`.
 * Re-inserting moves the entry to the end, giving the map LRU eviction order.
 */
export function observe(key, content, extra = {}) {
  const record = { hash: hashContent(content), size: content.length, at: Date.now(), ...extra };
  if (_observations.has(key)) _observations.delete(key);
  _observations.set(key, record);
  while (_observations.size > MAX_OBSERVATIONS) {
    _observations.delete(_observations.keys().next().value);
  }
  return record;
}

export function getObservation(key) {
  return _observations.get(key) || null;
}

/**
 * Has `key` changed since it was last observed?
 *
 * Returns `null` when there is nothing to compare against — an unobserved path
 * is not stale, it is simply unknown, and those are different answers.
 */
export function checkStale(key, currentContent) {
  const prior = _observations.get(key);
  if (!prior) return null;
  const hash = hashContent(currentContent);
  if (hash === prior.hash) return null;
  return { priorHash: prior.hash, currentHash: hash, priorSize: prior.size, currentSize: currentContent.length, observedAt: prior.at };
}

/** Test seam. Never called in production. */
export function _resetObservations() {
  _observations.clear();
}
