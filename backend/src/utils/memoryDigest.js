import { skillCatalogGist } from './skillCatalogGist.js';

/**
 * Budgeted agent-memory section.
 *
 * WHY THIS EXISTS: the memory section was unbounded — 15 rows of arbitrary
 * length, frozen onto turn 1 and re-sent on every subsequent turn. Measured
 * live 2026-07-31 on the main orchestrator chat: 16,256 tokens, 58% of the
 * entire system prompt and 8x the (already-compressed) skills catalog. The
 * largest single memory was 2,916 tokens.
 *
 * The fix is the same one the skills catalog already uses: full text for what
 * fits, a gist plus a pointer for the rest. Memory is not lost — every
 * memory remains retrievable in full via `get_agent_memories`, and the note
 * emitted below tells the model exactly that. Unlike the skills catalog the
 * gist here is generous (600 chars), because these entries are dossiers whose
 * opening lines carry the actual finding.
 *
 * Pure function, no imports beyond the gist helper: unit-testable and
 * probe-measurable without booting models or the database.
 */

// Derived, not invented: the whole point is that the prompt's dynamic
// sections stay proportionate to each other. The skills catalog costs ~1.9k
// for 51 skills and custom instructions ~2.3k; 6k lets memory stay the
// largest dynamic section by a wide margin while cutting the measured 16.3k
// by ~62%. Anything above this is reachable, just not resident.
export const MEMORY_SECTION_BUDGET_TOKENS = 6000;

const GIST_CHARS = 600;

/**
 * @param {Array<{memory_type?: string, content?: string, agent_id?: string}>} memories
 *   Ordered most-relevant/most-recent first — the caller's query ranking is
 *   respected verbatim, so the entries most likely to matter are the ones
 *   kept in full.
 * @param {object} opts
 * @param {(text: string) => number} opts.estimate  Token estimator.
 * @param {number} [opts.budgetTokens]
 * @returns {{ text: string, fullCount: number, gistCount: number, totalCount: number }}
 */
export function buildMemoryDigest(memories, { estimate, budgetTokens = MEMORY_SECTION_BUDGET_TOKENS } = {}) {
  const rows = Array.isArray(memories) ? memories.filter(Boolean) : [];
  if (rows.length === 0) return { text: '', fullCount: 0, gistCount: 0, totalCount: 0 };

  const est = typeof estimate === 'function' ? estimate : (s) => Math.ceil(String(s).length / 4);

  const label = (m) => {
    const source = m.agent_id && m.agent_id !== 'orchestrator' ? ' (from agent)' : '';
    return { prefix: `- [${m.memory_type || 'context'}] `, suffix: source };
  };

  const lines = [];
  let used = 0;
  let fullCount = 0;
  let gistCount = 0;
  // Once the budget is spent on full entries every REMAINING entry is gisted.
  // Deliberately not "keep packing whatever still fits": that would reorder
  // relevance by length, quietly promoting short trivia over the long dossier
  // the ranking put first.
  let budgetSpent = false;

  for (const m of rows) {
    const { prefix, suffix } = label(m);
    const content = String(m.content || '').trim();
    if (!content) continue;

    if (!budgetSpent) {
      const line = `${prefix}${content}${suffix}`;
      const cost = est(line);
      if (used + cost <= budgetTokens) {
        lines.push(line);
        used += cost;
        fullCount++;
        continue;
      }
      budgetSpent = true;
    }

    const gist = skillCatalogGist(content, GIST_CHARS);
    if (!gist) continue;
    lines.push(`${prefix}${gist}${suffix}`);
    gistCount++;
  }

  if (lines.length === 0) return { text: '', fullCount: 0, gistCount: 0, totalCount: 0 };

  const header = gistCount > 0
    ? `\n\n## Memory\nRelevant learnings from previous activity. ${gistCount} of these ${lines.length} entries are shown as one-line gists (ending in "...") to keep the prompt small — call get_agent_memories to read any of them in full before acting on a partial recollection.\n`
    : `\n\n## Memory\nRelevant learnings from previous activity:\n`;

  return {
    text: header + lines.join('\n'),
    fullCount,
    gistCount,
    totalCount: lines.length,
  };
}
