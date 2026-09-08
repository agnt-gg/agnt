/** Voice selection is a per-turn destination constraint, not provider-account
 * attestation. Never infer a payer from a model name or accept client account
 * claims. No credentials are read here. Ordinary text routing is unchanged.
 */
const selected = value => typeof value === 'string' && value.length <= 256 && value.trim() === value && value.length > 0;
export class VoiceDestinationError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export function voiceDestinationPolicy(req) {
  const body = req.body || {};
  const hasRequestId = Object.hasOwn(req.headers || {}, 'x-agnt-voice-request-id');
  // voiceMode alone is the pre-existing answer-register hint, not a native
  // receipt request. Preserve that legacy contract until its transport binds.
  const isVoice = hasRequestId || body.voiceMetadata != null;
  if (!isVoice) return null;
  if (!selected(req.user?.id)) throw new VoiceDestinationError('voice_authenticated_user_required', 401);
  const requestId = req.headers?.['x-agnt-voice-request-id'];
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new VoiceDestinationError('voice_request_identity_invalid');
  if (!selected(body.provider) || !selected(body.model)) throw new VoiceDestinationError('voice_destination_required');
  if (body.routingMode != null && body.routingMode !== 'pinned') throw new VoiceDestinationError('voice_routing_requires_selection');
  if (['accountId', 'accountProvider', 'voiceAccountId'].some(key => Object.hasOwn(body, key))) throw new VoiceDestinationError('voice_account_selection_unsupported');
  return Object.freeze({ requestId, provider: body.provider.toLowerCase(), model: body.model, fallback: 'none', accountBinding: 'unattested' });
}
export function assertVoiceDestination(policy, provider, model) {
  if (policy && (typeof provider !== 'string' || provider.toLowerCase() !== policy.provider || model !== policy.model)) {
    throw new VoiceDestinationError('voice_destination_changed');
  }
}
