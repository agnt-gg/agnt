// workflowBroadcast — the addressing contract for live canvas updates.
//
// WHY THIS EXISTS
// ---------------
// `update_workflow` (orchestrator tool) does not write to the database. It
// broadcasts the new canvas state over socket.io via broadcastToUser(), which
// fans out to EVERY tab, window, and panel the user has open — that fan-out is
// intentional and required for multi-tab sync.
//
// The danger is that a broadcast is a *fan-out*, not a *delivery*. A payload
// for workflow A reaches a canvas showing workflow B. If the consumer applies
// it blind, workflow B is silently replaced on screen AND
// WorkflowDesigner.handleWorkflowGenerator() reassigns activeWorkflowId to A —
// so the next save writes to A. The user loses unsaved work in B and can
// unknowingly overwrite A.
//
// That is exactly what happened: WorkflowForge's `workflow-updated` handler was
// the only consumer missing the id check its sibling handlers
// (workflow-started-from-chat / workflow-stopped-from-chat) already performed.
//
// THE CONTRACT
// ------------
// Every workflow-update event is ADDRESSED. Producers must stamp the target
// workflow id onto the payload; consumers must refuse anything not addressed to
// them. Both halves live here so a future consumer cannot forget the check —
// there is one obvious function to call, and it is named after the question it
// answers.

export const WORKFLOW_UPDATED_EVENT = 'workflow-updated';

/**
 * Emit an addressed workflow-update event.
 *
 * @param {string|null} targetWorkflowId  The workflow this state belongs to.
 * @param {object|null} workflowState     The full canvas state.
 * @returns {boolean} true if dispatched; false if it was unaddressable.
 */
export function dispatchWorkflowUpdated(targetWorkflowId, workflowState) {
  if (!workflowState || typeof workflowState !== 'object') return false;

  const id = targetWorkflowId || workflowState.id || null;
  if (!id) {
    console.warn('[workflowBroadcast] Refusing to dispatch an unaddressed workflow update (no workflow id).');
    return false;
  }

  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return false;

  // Stamp the authoritative id so the consumer can always verify the target,
  // even if the state blob carries a stale or missing one.
  window.dispatchEvent(new CustomEvent(WORKFLOW_UPDATED_EVENT, { detail: { ...workflowState, id } }));
  return true;
}

/**
 * Should this canvas apply the incoming update?
 *
 * Rules, in order:
 *   1. No payload, or payload carries no id  -> REFUSE. Unverifiable.
 *   2. Canvas has no active workflow         -> ACCEPT. Nothing to clobber;
 *                                               this is the fresh-canvas adopt
 *                                               case (new workflow from chat).
 *   3. Ids match                             -> ACCEPT.
 *   4. Ids differ                            -> REFUSE. Cross-workflow clobber.
 *
 * @param {object|null} detail            The CustomEvent detail.
 * @param {string|null} activeWorkflowId  The workflow currently on the canvas.
 * @returns {boolean}
 */
export function isAddressedToWorkflow(detail, activeWorkflowId) {
  if (!detail || typeof detail !== 'object') return false;

  const incomingId = detail.id || null;
  if (!incomingId) return false;

  if (!activeWorkflowId) return true;

  return incomingId === activeWorkflowId;
}
