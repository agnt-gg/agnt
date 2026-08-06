/**
 * Display names for ledger origins — the single place AGNT decides what a
 * `llm_calls.origin` / `agent_executions.origin` value is CALLED in the UI.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Three surfaces rendered origins and each did it differently:
 *
 *   1. SpendLedger.vue  — a 7-entry map with `ORIGIN_LABELS[b] || b`
 *   2. TracesPanel.vue  — `{{ node.origin }}`, the raw column value
 *   3. TracesPanel.vue  — `u.origin === 'goal_task' ? 'Goal tasks' : 'Goal evaluation'`
 *
 * The backend vocabulary then grew from 6 origins to 13 when the chat surfaces
 * were split apart (orchestrator/agent/workflow/tool/widget/goal/artifact),
 * and none of the three sites learned about it. Site 1 fell back to printing
 * the database token verbatim, so the dashboard showed "Chat" next to
 * "orchestrator" and "Workflows" next to "workflow" — a naming convention that
 * changed halfway down a single list. Site 3 is worse than a case mismatch: it
 * labels ANY unattached origin that is not `goal_task` as "Goal evaluation",
 * so an `insight` or `system` row is silently reported as something it is not.
 *
 * Two mechanisms replace the three conventions:
 *
 *   - Every origin in the backend's ORIGINS gets an EXPLICIT entry here, and
 *     `originLabels.mirror.spec.js` fails the build if one is missing. Adding
 *     a surface to the backend cannot silently reach the UI unnamed.
 *   - The fallback HUMANISES rather than passes through, so even an origin
 *     that somehow escapes the guard renders as "Some thing", never as
 *     "some_thing". A raw database token is not a label.
 *
 * ALIASES
 * -------
 * Some origins are the SAME PLACE to the person reading the dashboard even
 * though they are different values in the database. `chat` is the pre-split
 * value every chat surface wrote before they were told apart; `orchestrator`
 * is what that same surface writes now. Showing them as two rows asks the user
 * to add two numbers together to learn what one thing cost.
 *
 * So they are declared aliases and FOLDED — summed into a single row — rather
 * than merely relabelled, because two rows sharing one name is worse than two
 * rows with two names. The fold is a DISPLAY concern only: `llm_calls.origin`
 * keeps its raw values, so feature-usage analytics can still tell a pre-split
 * row from a post-split one.
 */

/**
 * Keep these in sync with `backend/src/models/LlmCallModel.js` → ORIGINS.
 * The guard spec enforces it; this comment just says where to look.
 *
 * Naming rules, so the list reads as one vocabulary:
 *   - A product surface uses its product name ("Workflow Forge").
 *   - Everything else is sentence case ("Goal tasks").
 * `workflow` and `workflow_node` are DIFFERENT things — chatting in Workflow
 * Forge versus LLM nodes inside a running workflow — and are named apart so
 * two adjacent rows can never read as the same source spelled two ways.
 */
export const ORIGIN_LABELS = Object.freeze({
  // Chat surfaces (mirror of CHAT_SURFACE_ORIGINS).
  orchestrator: 'Chat',
  agent: 'Agents', // agent chat AND agents delegated as a tool — not just the Forge
  workflow: 'Workflow Forge',
  tool: 'Tool Forge',
  widget: 'Widget Forge',
  goal: 'Goals',
  artifact: 'Artifacts',

  // Everything else.
  goal_task: 'Goal tasks',
  goal_eval: 'Goal evaluation',
  workflow_node: 'Workflow runs',
  insight: 'Insights',
  system: 'System',
});

/**
 * Origins that are the same surface under two names. Key is the value written
 * to the database, value is the origin it is displayed and totalled as.
 *
 * `chat` covered every surface before they were split apart, so a legacy row
 * is not provably orchestrator — but it is provably CHAT, which is the name
 * both sides now share, and it cannot be sub-attributed after the fact.
 */
export const ORIGIN_ALIASES = Object.freeze({
  chat: 'orchestrator',
});

/** The origin a value is displayed and totalled as. */
export function canonicalOrigin(origin) {
  const key = origin == null ? '' : String(origin).trim();
  return ORIGIN_ALIASES[key] || key;
}

/**
 * Human-readable name for an origin. Never returns a raw database token and
 * never returns an empty string.
 */
export function originLabel(origin) {
  const key = canonicalOrigin(origin);
  if (!key) return 'Unknown';
  if (ORIGIN_LABELS[key]) return ORIGIN_LABELS[key];

  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'Unknown';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Fold breakdown rows onto their canonical origins, summing every numeric
 * field. Order of first appearance is preserved; callers sort afterwards.
 *
 * Numeric fields are summed GENERICALLY rather than by name. The backend row
 * carries thirteen additive measures today (cost, notional, savings, calls,
 * four token counts, …) and gains more over time; a hand-listed sum would
 * silently drop the next one and under-report a merged row with no error.
 */
export function mergeOriginRows(rows) {
  const merged = new Map();

  for (const row of rows || []) {
    if (!row) continue;
    const bucket = canonicalOrigin(row.bucket);
    const existing = merged.get(bucket);

    if (!existing) {
      merged.set(bucket, { ...row, bucket });
      continue;
    }

    for (const [key, value] of Object.entries(row)) {
      if (key === 'bucket') continue;
      if (typeof value === 'number' && typeof existing[key] === 'number') {
        existing[key] += value;
      } else if (existing[key] === undefined) {
        // A field only the later row carries: keep it rather than lose it.
        existing[key] = value;
      }
    }
  }

  return [...merged.values()];
}

export default originLabel;
