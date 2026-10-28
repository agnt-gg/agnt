// signInCards — which tool calls render as a sign-in card.
//
// When a page needs the person, the agent calls browser { action: 'signin' }
// and the call WAITS until they have signed in. As a raw tool row that wait is
// an unexplained spinner — the 2026-10-28 failure was a person looking for a
// sign-in they could not find. The card says where to sign in and offers the
// answers (here, in a window, done, cancel), right where the conversation is.

function parseArgs(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args !== 'string') return null;
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // Arguments still streaming in: not a card yet.
    return null;
  }
}

/**
 * What a sign-in call asked for, or null when the call is not a sign-in.
 * @param {{ name?: string, args?: object|string }} toolCall
 * @returns {{ url: string|null, mode: string }|null}
 */
export function signInTarget(toolCall) {
  if (!toolCall || toolCall.name !== 'browser') return null;
  const args = parseArgs(toolCall.args);
  if (!args || String(args.action || '').trim() !== 'signin') return null;
  const url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : null;
  const mode = ['here', 'window'].includes(args.mode) ? args.mode : 'auto';
  return { url, mode };
}

/** The finished call's answer, or null while it is still waiting. */
export function signInOutcome(toolCall) {
  if (!toolCall) return null;
  if (toolCall.error) return { signedIn: false, error: String(toolCall.error) };
  const result = typeof toolCall.result === 'string' ? parseArgs(toolCall.result) : toolCall.result;
  if (!result || typeof result !== 'object') return null;
  const inner = result.result && typeof result.result === 'object' && 'signedIn' in result.result ? result.result : result;
  return {
    signedIn: inner.signedIn === true,
    error: inner.success === false ? (inner.error || 'The sign-in did not complete.') : null,
    url: inner.url || null,
  };
}

/** "accounts.google.com" from a URL; '' when there is none. */
export function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}
