/**
 * One-line gist of a skill description for the Tier-1 skills catalog.
 *
 * Skill descriptions are long trigger blurbs (often 600+ chars of "use this
 * when the user says X / Y / Z..."). At ~100 skills that costs >13k tokens in
 * EVERY system prompt. The catalog only needs enough signal for the model to
 * know WHEN to call activate_skill — activation returns the full playbook —
 * so we keep the first sentence, word-boundary capped.
 *
 * Pure function, no imports: unit-testable and probe-measurable without
 * booting models or the database.
 */
const MAX_GIST_CHARS = 220;
// A sentence boundary before this offset is ignored — guards against "e.g."
// style early periods truncating the gist to a useless fragment.
const MIN_GIST_CHARS = 40;

/**
 * @param {string} description
 * @param {number} [maxChars=220] Hard cap. Callers with a different
 *   pointer-to-full-text mechanism (agent memory, whose full text is one
 *   `get_agent_memories` call away) can afford a longer gist than the skills
 *   catalog, which has ~100 entries competing for the same budget.
 */
export function skillCatalogGist(description, maxChars = MAX_GIST_CHARS) {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const cap = Number.isFinite(maxChars) && maxChars > MIN_GIST_CHARS ? maxChars : MAX_GIST_CHARS;

  let gist = text;
  const boundary = /[.!?](?=\s)/g;
  let match;
  while ((match = boundary.exec(text)) !== null) {
    if (match.index + 1 >= MIN_GIST_CHARS) {
      gist = text.slice(0, match.index + 1);
      break;
    }
  }

  if (gist.length > cap) {
    const cut = gist.lastIndexOf(' ', cap - 1);
    gist = gist.slice(0, cut > MIN_GIST_CHARS ? cut : cap).trimEnd() + '...';
  }
  return gist;
}
