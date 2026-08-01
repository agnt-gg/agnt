/**
 * Near-duplicate detection for agent memories.
 *
 * ── WHY LEXICAL HASHING FAILS HERE ────────────────────────────────────────
 * Measured on the live store (97,504 rows): exactly TWO rows are
 * byte-identical, so the original exact-match dedupe caught 0.002%. A
 * normalised shape key (utils/memoryShape.js) does better but only collapses
 * 1.56x, and 47,792 of its shapes are singletons — because the extractor is an
 * LLM and it paraphrases every time:
 *
 *   A: "[pattern] Workflow completed without node errors: All recorded nodes
 *       completed successfully..."
 *   B: "[pattern] All recorded nodes completed successfully: Every recorded
 *       node execution completed..."
 *
 * Same finding, different prefix, different word order. Bag-of-words hashing
 * measured WORSE than the dumb prefix (1.02x) for the same reason. The
 * redundancy is semantic, so the comparison has to be set-based rather than
 * string-based.
 *
 * ── WHY NOT EMBEDDINGS ────────────────────────────────────────────────────
 * A MiniLM probe over a random 250-row sample put semantic clustering at a
 * 43.2% lower bound. Token containment over the FTS index measured 51.6%
 * blocked / 72.8% having a near-duplicate at all — better, with no model
 * download, no vector column, and no new dependency. Embeddings stay on the
 * shelf until this plateaus.
 *
 * Pure functions, no imports: unit-testable without a database.
 */

/**
 * Words that carry no discriminating signal in an insight sentence. Kept
 * deliberately small — an aggressive stoplist would strip the domain nouns
 * ("node", "trigger", "workflow") that make two findings genuinely different.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to',
  'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'it', 'its',
  'has', 'have', 'had', 'not', 'no', 'do', 'does', 'did', 'will', 'would',
  'should', 'could', 'may', 'might', 'can', 'all', 'any', 'each', 'which',
  'when', 'while', 'there', 'their', 'they', 'them', 'also', 'into', 'over',
  'within', 'without', 'appears', 'appear', 'seems', 'same', 'other',
]);

/**
 * Tokens below this length are noise (single letters, unit suffixes).
 */
const MIN_TOKEN_LENGTH = 3;

/**
 * Content tokens required on BOTH sides before similarity is trusted.
 *
 * Two three-word memories trivially "contain" each other. Below this floor we
 * decline to judge and let the row insert — a false duplicate silently
 * discards a memory, which is strictly worse than keeping a redundant one.
 */
export const MIN_TOKENS_FOR_COMPARISON = 8;

/**
 * Containment = |A ∩ B| / min(|A|, |B|).
 * Jaccard    = |A ∩ B| / |A ∪ B|.
 *
 * BOTH gates must pass. Containment alone is fooled by asymmetry: eight tokens
 * fully contained in an eighty-token memory scores 1.00 while adding real
 * information. Jaccard catches exactly that case (0.10 there) and stays high
 * for true paraphrases (0.94 on the pair quoted above). Thresholds are the
 * measured operating point — containment 0.8 blocked 51.6% of writes with the
 * Jaccard floor rejecting the asymmetric false positives.
 */
export const CONTAINMENT_THRESHOLD = 0.8;
export const JACCARD_FLOOR = 0.5;

/**
 * Split content into a set of comparable tokens.
 *
 * Numbers are dropped entirely rather than normalised: durations, node counts
 * and millisecond timings are precisely the part that varies between two
 * reports of the same finding, so keeping them only adds noise on both sides.
 */
export function contentTokens(content) {
  const out = new Set();
  const words = String(content ?? '')
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/);
  for (const w of words) {
    if (w.length < MIN_TOKEN_LENGTH) continue;
    if (STOP_WORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

function intersectionSize(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const t of small) if (large.has(t)) n++;
  return n;
}

/**
 * @returns {{containment: number, jaccard: number, comparable: boolean}}
 */
export function similarity(tokensA, tokensB) {
  const comparable = tokensA.size >= MIN_TOKENS_FOR_COMPARISON
    && tokensB.size >= MIN_TOKENS_FOR_COMPARISON;
  if (tokensA.size === 0 || tokensB.size === 0) {
    return { containment: 0, jaccard: 0, comparable: false };
  }
  const inter = intersectionSize(tokensA, tokensB);
  return {
    containment: inter / Math.min(tokensA.size, tokensB.size),
    jaccard: inter / (tokensA.size + tokensB.size - inter),
    comparable,
  };
}

/** Do these two contents describe the same finding? */
export function isNearDuplicate(tokensA, tokensB) {
  const { containment, jaccard, comparable } = similarity(tokensA, tokensB);
  if (!comparable) return false;
  return containment >= CONTAINMENT_THRESHOLD && jaccard >= JACCARD_FLOOR;
}

/**
 * How many candidates to pull from FTS before verifying.
 *
 * BM25 is the BLOCKER, not the decision: it narrows 97k rows to a handful that
 * share vocabulary, and containment makes the actual call. Twelve is enough
 * that a true duplicate is essentially always in the window while keeping the
 * probe to one indexed query per write.
 */
export const CANDIDATE_LIMIT = 12;

/**
 * Build an FTS5 MATCH expression from content.
 *
 * Every token is double-quoted: FTS5 treats bare AND/OR/NOT/NEAR as operators
 * and bare punctuation as syntax, so an unquoted token from arbitrary LLM
 * prose can throw rather than return no rows — a silent write-path failure.
 * Returns null when there is nothing worth querying, and the caller must treat
 * that as "no opinion" rather than "no duplicate".
 */
export function buildMatchQuery(content, limit = 24) {
  const tokens = [...contentTokens(content)];
  if (tokens.length < MIN_TOKENS_FOR_COMPARISON) return null;
  // Longer tokens are rarer and therefore better blocking keys than common
  // short ones, and BM25 already down-weights whatever is frequent.
  const ranked = tokens.sort((a, b) => b.length - a.length).slice(0, limit);
  return ranked.map((t) => `"${t}"`).join(' OR ');
}
