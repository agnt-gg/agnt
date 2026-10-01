/**
 * Does a click on the chat screen belong to something that wants the keyboard?
 *
 * The chat screen treats a click on dead space (message text, padding) as a
 * request to start typing, and moves focus to the chat input. That rule used
 * to be "anything that is not a form field is dead space", which silently
 * included embedded surfaces with their own keyboard: the live browser canvas
 * focused itself on mousedown, the click bubbled up, and focus was yanked back
 * to the chat input — so typing into a page typed into the chat instead.
 *
 * Anything matching this list keeps the focus the click gave it. A component
 * that hosts its own keyboard surface can opt in with `data-keeps-focus`
 * rather than growing this list.
 *
 * Deliberately NOT `[tabindex]`: the screen root itself carries tabindex="-1",
 * and `closest` would match it for every click, disabling click-to-type.
 */
const KEEPS_FOCUS = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'canvas',
  'iframe',
  'webview',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="dialog"]',
  '[role="textbox"]',
  '[data-keeps-focus]',
].join(', ');

export function clickKeepsFocus(target) {
  return Boolean(target?.closest?.(KEEPS_FOCUS));
}
