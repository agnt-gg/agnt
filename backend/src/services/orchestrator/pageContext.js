// pageContext — the single source of truth for "which request-body fields
// describe the surface this chat is looking at".
//
// WHY THIS FILE EXISTS
// --------------------
// These field names were written out by hand in TWO places in
// OrchestratorService: once destructured off `req.body`, and again copied onto
// `conversationContext`. Nothing tied the lists together, so they drifted —
// `workspaceState` reached the handler and never reached the context, and every
// One Canvas turn silently lost its workspace identity. That was found only
// because a user reported widgets landing in the wrong workspace.
//
// A list that must be edited in two places to be correct will eventually be
// edited in one. So there is now one list, and `pickPageContext` is the only
// way it is applied. Adding a page-context field is a one-line change here.

/**
 * Every field that describes the chat's surface. Order is documentation:
 * grouped by surface, `workspaceState` last because it is the canvas envelope
 * that can carry all of the others at once.
 */
export const PAGE_CONTEXT_FIELDS = Object.freeze([
  'agentId', 'agentContext', 'agentState',
  'workflowId', 'workflowContext', 'workflowState',
  'toolId', 'toolContext', 'toolState',
  'widgetId', 'widgetContext', 'widgetState',
  'goalId', 'goalContext',
  'codeId', 'codeContext',
  'workspaceState',
  // Not a surface, but the same shape of fact: something about HOW this turn
  // is being consumed that the prompt builder needs. `voiceMode` says the
  // answer will be spoken as well as shown, which changes how it should be
  // written (see system-prompts/voiceRegister.js).
  'voiceMode',
]);

/**
 * Copy exactly the page-context fields off a request body.
 *
 * Absent keys are omitted rather than set to undefined, so `'workflowId' in
 * ctx` stays a meaningful question and spreading this into an existing context
 * cannot blank a field that was already resolved.
 */
export function pickPageContext(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const field of PAGE_CONTEXT_FIELDS) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

/**
 * Is this turn a One Canvas turn — one conversation federating many widget
 * windows, rather than a sidebar bound to a single surface?
 *
 * `workspaceState` is sent by the Workspace canvas and by nothing else, so its
 * presence IS the signal. It matters because two single-winner ladders would
 * otherwise mis-handle a canvas turn the moment it starts carrying a second
 * surface's state:
 *
 *   detectChatType        — would see `workflowState` and call the turn a
 *                           'workflow' chat, cutting maxToolRounds 100 -> 25.
 *   detectSidebarSpecialty — would narrow a full orchestrator surface down to
 *                           the ten workflow tools, losing shell, files,
 *                           search and every other capability the canvas chat
 *                           is expected to have.
 *
 * Both are right for a sidebar and wrong for a canvas. This is how they tell.
 */
export function isCanvasTurn(context) {
  return !!(context && typeof context === 'object' && context.workspaceState);
}

/**
 * The open windows a canvas turn is federating, as declared by the browser.
 * Always an array; empty when the canvas holds nothing but the conversation.
 */
export function listCanvasSurfaces(context) {
  const surfaces = context?.workspaceState?.surfaces;
  return Array.isArray(surfaces) ? surfaces : [];
}
