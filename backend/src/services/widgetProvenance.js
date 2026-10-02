/**
 * Does this update change what a plugin-installed widget IS?
 *
 * PRD-057 marks a plugin widget `is_user_modified = 1` so plugin updates never
 * overwrite a user's own edits. That flag must mean "the user edited the
 * widget", not "something wrote to the row": every metadata write (placing it
 * on a canvas, a thumbnail capture, a resize) used to set it, after which the
 * widget silently stopped receiving plugin updates forever.
 *
 * Only the widget's behaviour counts: its source, config and data bindings.
 * Values are compared the way updateWidget stores them (objects as JSON, absent
 * fields left untouched by COALESCE), so a write that resends the same content
 * is not an edit either.
 *
 * @param {{source_code?: string|null, config?: string|null, data_bindings?: string|null}} existing  stored row
 * @param {object} body  the update request body
 * @returns {boolean}
 */
export function isWidgetContentChange(existing, body = {}) {
  const row = existing || {};
  if (body.source_code !== undefined && body.source_code !== null && body.source_code !== (row.source_code ?? null)) {
    return true;
  }
  for (const key of ['config', 'data_bindings']) {
    const value = body[key];
    // updateWidget stores only truthy values (COALESCE keeps the old one otherwise).
    if (!value) continue;
    if (JSON.stringify(value) !== (row[key] ?? null)) return true;
  }
  return false;
}
