/**
 * Which tool calls have a browser PAGE someone could watch?
 *
 * One rule, shared by every place that surfaces a browser: the inline chat
 * card (MessageItem) and the Workspace canvas's Browser widget (both its
 * running-call scan and TOOL_WIDGET_MAP). They used to answer "is this a
 * browser call?" — and a browser call is not the same thing as a page.
 *
 * THE BUG THIS EXISTS FOR (trace c59eb9e9, 2026-10-06). Mid-way through UI
 * work the model ran `browser action="script"` to read an environment
 * variable. No page was involved, but the name alone mounted the live card and
 * the canvas widget, which then sat empty. Across 30 days, 41% of browser calls
 * were scripts — most poking localhost or local files, none with a page worth
 * showing.
 *
 * So a call drives a page when:
 *   - it is a page verb or a delegated `run` — NOT `script` (raw program,
 *     usually no page) and NOT the diagnostics `console`/`errors`/`requests`
 *     (they read a page that is already there; they never make one);
 *   - and it has not failed. A refused navigate (file:, data:) or an error is
 *     nothing to watch. A call still RUNNING has no result yet and counts, so
 *     the surface is ready when the page arrives.
 */

/**
 * Every name a browser call has had. Only `browser` can be called now; the
 * three it consolidated still appear in conversations loaded from history.
 */
export const BROWSER_TOOL_NAMES = new Set([
  'browser',
  'ai_browser_act',
  'ai_browser_use',
  'ai_browser_control',
]);

/** Actions of the `browser` tool that never put a page on screen. */
const ACTIONS_WITHOUT_A_PAGE = new Set(['script', 'console', 'errors', 'requests']);

function parseMaybeJson(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' ? value : null;
}

function actionOf(toolCall) {
  const args = parseMaybeJson(toolCall.args ?? toolCall.arguments ?? toolCall.input) || {};
  return String(args.action || '').trim();
}

function failed(toolCall) {
  if (toolCall.error) return true;
  const result = parseMaybeJson(toolCall.result);
  if (!result) return false;
  return result.success === false || result.result?.success === false;
}

export function drivesBrowserPage(toolCall) {
  if (!toolCall || !BROWSER_TOOL_NAMES.has(toolCall.name)) return false;
  // The legacy name of the script engine: the same reasoning as action=script.
  if (toolCall.name === 'ai_browser_control') return false;
  if (toolCall.name === 'browser' && ACTIONS_WITHOUT_A_PAGE.has(actionOf(toolCall))) return false;
  return !failed(toolCall);
}
