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
  orchestrator: 'Orchestrator',
  agent: 'Agents', // agent chat AND agents delegated as a tool — not just the Forge
  workflow: 'Workflow Forge',
  tool: 'Tool Forge',
  widget: 'Widget Forge',
  goal: 'Goals',
  artifact: 'Artifacts',

  // Everything else.
  chat: 'Chat (legacy)', // pre-split rows: a real surface we can no longer name
  goal_task: 'Goal tasks',
  goal_eval: 'Goal evaluation',
  workflow_node: 'Workflow runs',
  insight: 'Insights',
  system: 'System',
});

/**
 * Human-readable name for an origin. Never returns a raw database token and
 * never returns an empty string.
 */
export function originLabel(origin) {
  const key = origin == null ? '' : String(origin).trim();
  if (!key) return 'Unknown';
  if (ORIGIN_LABELS[key]) return ORIGIN_LABELS[key];

  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'Unknown';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default originLabel;
