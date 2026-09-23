// connectCards — which tool calls should render as a Connect button.
//
// When Annie needs an app the person has not connected, she calls
// agnt_auth { operation: 'connect_provider', provider_name }. The backend
// answers with an auth URL, which as a raw tool result is a wall of JSON in a
// collapsed row. The chat renders a one-line Connect card instead, so the
// whole connection happens where the conversation is.

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
 * The provider id a tool call asks the person to connect, or null.
 * @param {{ name?: string, args?: object|string }} toolCall
 */
export function connectTarget(toolCall) {
  if (!toolCall || toolCall.name !== 'agnt_auth') return null;
  const args = parseArgs(toolCall.args);
  if (!args || args.operation !== 'connect_provider') return null;
  const provider = typeof args.provider_name === 'string' ? args.provider_name.trim() : '';
  return provider || null;
}

/** "google-calendar" → "Google Calendar", when the catalog has no display name. */
export function fallbackProviderName(id) {
  return String(id || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}
