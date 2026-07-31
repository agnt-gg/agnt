/**
 * ONE mention grammar, shared by every consumer.
 *
 * Two things must agree exactly or group chat lies to the user:
 *   - what MessageItem RENDERS as a mention pill
 *   - what chat.js treats as a FLOOR PASS
 * They used to be three separate hand-rolled regex loops (user pills,
 * assistant pills, floor detection). They live here now so they cannot drift.
 */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Agent NAMES are not unique in AGNT (duplicates are legal and real — this
 * install has two "Sol"s and three "Social Media Manager"s). A mention names
 * a SPEAKER, so ambiguity resolves to first-registered: deterministic, and
 * identical for the renderer and the scheduler.
 */
export function uniqueAgentsByName(agents) {
  const out = [];
  const seen = new Set();
  for (const a of agents || []) {
    if (!a || typeof a.name !== 'string' || !a.name) continue;
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    out.push(a);
  }
  return out;
}

/**
 * A single alternation over every known name, longest-first so a longer name
 * always beats a shorter prefix of it (@Solar must not match as @Sol + "ar").
 * The trailing lookahead is the boundary rule: a mention ends at whitespace,
 * sentence punctuation, or a tag/entity boundary.
 */
export function buildMentionRegex(names) {
  const unique = [...new Set((names || []).filter((n) => typeof n === 'string' && n))]
    .sort((a, b) => b.length - a.length);
  if (unique.length === 0) return null;
  return new RegExp(`@(${unique.map(escapeRe).join('|')})(?=[\\s.,!?;:&<]|$)`, 'g');
}

/**
 * Wrap every mention in a pill, in ONE pass.
 *
 * Single-pass is the whole point. String#replace resumes scanning after the
 * matched region of the SOURCE and never re-examines text it has emitted, so
 * an emitted <span class="mention-pill">@Sol</span> can never match again.
 *
 * The old code looped once PER AGENT NAME over the accumulating output. With
 * two agents sharing a name the second iteration re-matched the mention it had
 * just wrapped — `@Sol` was now followed by the `<` of `</span>`, which
 * satisfies the boundary lookahead — producing a pill inside a pill (and a
 * triple nest for the three same-named agents).
 */
export function renderMentionPills(html, agents) {
  const names = [...new Set((agents || []).map((a) => a && a.name).filter((n) => typeof n === 'string' && n))]
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return html;
  const alt = names.map(escapeRe).join('|');
  // The FIRST alternative matches an already-rendered pill and returns it
  // verbatim. Because the scanner consumes it whole, the @Name inside can
  // never be examined — so rendering twice is a no-op instead of a nest.
  const re = new RegExp(
    `<span class="mention-pill">@(?:${alt})</span>|@(${alt})(?=[\\s.,!?;:&<]|$)`,
    'g',
  );
  return html.replace(re, (match, name) => (name === undefined ? match : `<span class="mention-pill">@${name}</span>`));
}

/**
 * Mentions found in a finished message, resolved to agents, in order of first
 * appearance. Deduped by agent id — one pill is one speaker, so repeating a
 * name never queues the same agent twice. `exclude` drops self-mentions.
 */
export function findAgentMentions(content, agents, exclude = null) {
  if (!content || typeof content !== 'string') return [];
  const roster = uniqueAgentsByName(agents).filter((a) => a.id);
  const re = buildMentionRegex(roster.map((a) => a.name));
  if (!re) return [];
  const byName = new Map(roster.map((a) => [a.name, a]));
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    const agent = byName.get(m[1]);
    if (!agent) continue;
    if (exclude && ((exclude.id && agent.id === exclude.id) || (exclude.name && agent.name === exclude.name))) continue;
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    out.push({ id: agent.id, name: agent.name, icon: agent.icon || null, note: null });
  }
  return out;
}
