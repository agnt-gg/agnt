/**
 * A local CLI session belongs to the OS user. Disconnect in AGNT ends this
 * AGNT account's access, never the machine's sign-in or another user's access.
 * The opt-out lives in the account's existing, serialized preferences store.
 * No tokens are copied, deleted, logged or revoked here.
 */
// Keep the provider runtime import inert; the account store is opened only
// when an authenticated operation asks about access.
const userModel = async () => (await import('../../models/UserModel.js')).default;

export const LOCAL_PROVIDER_ACCESS_KEYS = Object.freeze({
  'claude-code': 'localClaudeCodeDisconnected',
  'openai-codex': 'localCodexDisconnected',
  'gemini-cli': 'localGeminiCliDisconnected',
  antigravity: 'localAntigravityDisconnected',
  'grok-build': 'localGrokBuildDisconnected',
  'cursor-cli': 'localCursorDisconnected',
});

// Callers pass registry keys, display names ('Claude-Code') or the auth
// scheme ('codex'); all must address the one stored opt-out.
const accessKey = (providerId) => {
  const id = String(providerId || '').toLowerCase();
  return LOCAL_PROVIDER_ACCESS_KEYS[id === 'codex' ? 'openai-codex' : id];
};

export async function isLocalProviderDisconnected(userId, providerId) {
  const key = accessKey(providerId);
  if (!key) return false;
  if (!userId) throw new Error('An account is required for local provider access');
  const preferences = await (await userModel()).getPreferences(userId);
  return preferences.global[key] === true;
}

export async function setLocalProviderDisconnected(userId, providerId, disconnected) {
  const key = accessKey(providerId);
  if (!userId || !key) throw new Error('A valid account and local provider are required');
  await (await userModel()).updatePreferences(userId, { global: { [key]: disconnected === true } });
}

export async function assertLocalProviderAccess(userId, providerId) {
  if (await isLocalProviderDisconnected(userId, providerId)) {
    const error = new Error('This provider is disconnected for your AGNT account. Reconnect it in Connections.');
    error.code = 'PROVIDER_DISCONNECTED';
    throw error;
  }
}
