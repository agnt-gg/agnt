/** The name a workflow carries until someone gives it one. */
export const DEFAULT_WORKFLOW_NAME = 'My Workflow';

/**
 * Save asks for a name only while the workflow has none of its own. A named
 * workflow (a template, a loaded one, one already saved) saves in one click;
 * renaming is the name in the toolbar.
 */
export function needsName(name) {
  const trimmed = String(name ?? '').trim();
  return !trimmed || trimmed === DEFAULT_WORKFLOW_NAME;
}
