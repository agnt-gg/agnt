/**
 * The first message of an empty chat: Annie's welcome when an AI provider is
 * connected, the "pick where she thinks" setup card when none is.
 *
 * WHY THIS IS RE-EVALUATED, NOT DRAWN ONCE
 * ----------------------------------------
 * The greeting used to be a snapshot taken when the chat was created. Signing
 * into another account creates that chat while the new account's settings and
 * connections are still loading, so it always read "not connected", showed the
 * setup card, and nothing ever replaced it. A refresh appeared to fix it only
 * because a cold load happens to finish loading first. Chat.vue now calls
 * reconcile on every change of the connection state.
 */

export const WELCOME_TEXT = "Hi! I'm Annie, your personal AI assistant. What can I help you build today?";

const SETUP_HTML = `<div class="setup-message">
  <div class="setup-header">
    <div class="setup-icon">🚀</div>
    <div>
      <h2>Welcome to AGNT</h2>
      <p class="setup-lede">One step before Annie can talk: pick where she thinks.</p>
    </div>
  </div>
</div>`;

/**
 * @param {boolean} connected  whether the selected provider can answer
 * @param {{ id: string, version?: string }} options
 */
export function buildProviderGreeting(connected, { id, version } = {}) {
  if (connected) {
    return {
      id,
      role: 'assistant',
      content: WELCOME_TEXT,
      timestamp: Date.now(),
      metadata: ['AGNT Status: Online', `Version: ${version || '...'}`],
      isGreeting: true,
    };
  }
  return {
    id,
    role: 'assistant',
    content: SETUP_HTML,
    timestamp: Date.now(),
    showProviderSetup: true,
    showProviderNote: true,
    contentType: 'html',
    isGreeting: true,
  };
}

/** True when a message is one of the two greetings, from any version of the app. */
export function isGreeting(message) {
  if (!message || message.role !== 'assistant') return false;
  return message.isGreeting === true || message.showProviderSetup === true || message.content === WELCOME_TEXT;
}

/**
 * Should a conversation's greeting be swapped for the other one?
 *
 * Only a conversation that is nothing BUT a greeting: once anyone has said
 * anything, the transcript is the user's and is never rewritten.
 */
export function greetingNeedsReplacing(messages, connected) {
  if (!Array.isArray(messages) || messages.length !== 1) return false;
  const [only] = messages;
  if (!isGreeting(only)) return false;
  const showsSetup = only.showProviderSetup === true;
  return showsSetup === Boolean(connected);
}
