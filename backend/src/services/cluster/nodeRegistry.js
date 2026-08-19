/**
 * Who has been talking to this primary lately.
 *
 * ---------------------------------------------------------------------------
 * THIS IS OBSERVATIONAL, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * It is a Map in one process. It empties on restart, and the forked workflow
 * process has its own copy that this one cannot see — the same property that
 * cost two days to find with sessionTokenCache, written down here before it
 * costs them again.
 *
 * A table would fix both, and it is still the wrong trade today. Nothing
 * DECIDES anything from this: enrolment is the grant, the claim is the
 * permission, and the lease is the liveness signal. Every one of those already
 * lives in the database, in the row it protects. This exists only so an
 * operator can answer "is my worker actually talking to me", and for that
 * question a view that resets when the primary resets is not misleading — it
 * is accurate.
 *
 * The moment something starts making a decision from this, it needs to become
 * a table. Nothing does yet.
 */

/** nodeId -> { nodeId, label, userId, lastSeen, claims, completions, failures } */
const nodes = new Map();

/** Beyond this a node is reported as stale rather than dropped. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** Bound the map so a token minting loop cannot grow it without limit. */
const MAX_TRACKED = 500;

/**
 * Record that a node just spoke to us.
 *
 * @param {object} node
 * @param {string} node.nodeId
 * @param {string} [node.userId]
 * @param {string} [node.label]
 * @param {'claim'|'renew'|'complete'|'fail'|'ping'} [event]
 */
export function touchNode({ nodeId, userId = null, label = '' } = {}, event = 'ping') {
  if (!nodeId) return null;

  let entry = nodes.get(nodeId);
  if (!entry) {
    if (nodes.size >= MAX_TRACKED) {
      // Evict the least recently seen. Losing the oldest observation is
      // strictly better than an unbounded map in a long-lived process.
      let oldestId = null;
      let oldestSeen = Infinity;
      for (const [id, value] of nodes) {
        if (value.lastSeen < oldestSeen) {
          oldestSeen = value.lastSeen;
          oldestId = id;
        }
      }
      if (oldestId) nodes.delete(oldestId);
    }
    entry = { nodeId, userId, label, firstSeen: Date.now(), claims: 0, completions: 0, failures: 0 };
    nodes.set(nodeId, entry);
  }

  entry.lastSeen = Date.now();
  if (userId) entry.userId = userId;
  if (label) entry.label = label;
  if (event === 'claim') entry.claims += 1;
  if (event === 'complete') entry.completions += 1;
  if (event === 'fail') entry.failures += 1;
  return entry;
}

/**
 * Every node this process has heard from, most recent first.
 *
 * @param {string|null} userId  restrict to one owner's nodes
 */
export function listNodes(userId = null) {
  const now = Date.now();
  return [...nodes.values()]
    .filter((n) => !userId || n.userId === userId)
    .map((n) => ({ ...n, stale: now - n.lastSeen > STALE_AFTER_MS }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Test seam. */
export function __resetNodeRegistryForTests() {
  nodes.clear();
}
