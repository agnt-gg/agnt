/** Called only by the existing transport, before fetch. The nonce is correlation,
 * not authentication: the backend still obtains userId exclusively from auth.
 * No token decoding, account inference, or model fallback is permitted here.
 */
export function bindVoiceRequestOrigin(bind, { userId, provider, model, conversationId }, randomUUID = () => globalThis.crypto.randomUUID()) {
  if (typeof bind !== 'function') return null;
  const requestId = randomUUID();
  const identity = { userId, requestId, provider: typeof provider === 'string' ? provider.toLowerCase() : provider, model };
  if (typeof conversationId === 'string' && conversationId && !conversationId.startsWith('temp-')) identity.conversationId = conversationId;
  bind(identity);
  return requestId;
}
export function verifiedVoiceUser(rootState) {
  return rootState?.userAuth?.sessionState === 'valid' ? rootState.userAuth.user?.id : undefined;
}
