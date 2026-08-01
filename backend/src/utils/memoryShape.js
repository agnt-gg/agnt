/**
 * Shape key for near-duplicate agent memories.
 *
 * ── WHY EXACT-MATCH DEDUPE DOES NOT WORK ──────────────────────────────────
 * Measured on the live store 2026-07-31: 97,502 memory rows, of which exactly
 * TWO were byte-identical duplicates. Any content-hash dedupe is therefore a
 * no-op. The redundancy is real but every row differs in an execution id, a
 * node id, a timestamp or a duration:
 *
 *   "[bottleneck] Duplicate timer trigger execution: The timer trigger
 *    appears to have executed twice within 43ms (node a3f1c8e2-...)"
 *
 * Normalising ids and numbers away collapses the 80,459 auto-extracted rows to
 * 50,484 distinct shapes; the top 20 shapes alone account for 8,441 rows and
 * the worst single cluster ("Duplicate timer trigger execution") is 1,092.
 * That is one memory written per workflow execution, forever, from a workflow
 * that runs on a timer.
 *
 * ── WHY 120 CHARACTERS ────────────────────────────────────────────────────
 * Long enough that two genuinely different findings do not collide, short
 * enough that the same finding with a different tail still matches. The prefix
 * of these records carries the classification ("[bottleneck] <what>"); the
 * tail carries the instance detail, which is exactly what we want to ignore.
 *
 * Pure function, no imports: unit-testable without a database.
 */

const SHAPE_PREFIX_CHARS = 120;

export function memoryShape(content) {
  return String(content ?? '')
    // UUIDs first — they contain digits, so the digit rule below would
    // otherwise shred them into a less distinctive pattern.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#ID')
    // Bare hex blobs (node ids, short hashes) that are not UUID-shaped.
    .replace(/\b[0-9a-f]{16,}\b/gi, '#HEX')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, SHAPE_PREFIX_CHARS);
}

/**
 * Memory types written by the insight pipeline rather than at the user's
 * direction.
 *
 * ONLY THESE ARE DEDUPED. A shape key is lossy by construction, so collapsing
 * two records means discarding one — acceptable for the 1,092nd copy of an
 * auto-generated bottleneck report, never acceptable for something the user
 * asked to be remembered. Two distinct facts that happened to share a
 * normalised 120-character prefix would silently lose the second, so user-set
 * types always insert.
 *
 * This split is the same one findRelevant already uses for candidate quotas;
 * kept here so the write path and the read path cannot disagree about which
 * memories are authoritative.
 */
export const AUTO_EXTRACTED_MEMORY_TYPES = new Set([
  'pattern',
  'tool_insight',
  'workflow_insight',
]);

export function isAutoExtractedMemoryType(memoryType) {
  return AUTO_EXTRACTED_MEMORY_TYPES.has(memoryType);
}
