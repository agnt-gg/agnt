import { describe, expect, it } from 'vitest';
import { voiceDestinationPolicy, assertVoiceDestination } from './voiceDestinationPolicy.js';
const request = () => ({ user: { id: 'TEST-user' }, headers: { 'x-agnt-voice-request-id': 'TEST-pin' }, body: { provider: 'OpenAI-Codex-2', model: 'user-selected-model', routingMode: 'pinned' } });
describe('native voice destination constraint', () => {
  it('preserves account2 provider key and exact selected model without claiming payer attestation', () => {
    const policy = voiceDestinationPolicy(request());
    expect(policy).toEqual({ requestId: 'TEST-pin', provider: 'openai-codex-2', model: 'user-selected-model', fallback: 'none', accountBinding: 'unattested' });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => assertVoiceDestination(policy, 'OpenAI-Codex-2', 'user-selected-model')).not.toThrow();
  });
  it.each([['openai-codex', 'user-selected-model'], ['openai', 'user-selected-model'], ['openai-codex-2', 'other'], ['openai-codex-2', undefined], [null, 'user-selected-model']])('rejects tier drift %s/%s', (provider, model) => {
    expect(() => assertVoiceDestination(voiceDestinationPolicy(request()), provider, model)).toThrow('voice_destination_changed');
  });
  it('native provenance without nonce fails closed in JSON and multipart forms', () => {
    for (const voiceMetadata of [[], '[]']) expect(() => voiceDestinationPolicy({ user: { id: 'TEST-user' }, headers: {}, body: { voiceMetadata } })).toThrow('voice_request_identity_invalid');
  });
  it('does not redefine the legacy voiceMode answer-register contract', () => {
    expect(voiceDestinationPolicy({ body: { voiceMode: true }, headers: {} })).toBeNull();
    expect(voiceDestinationPolicy({ body: { voiceMode: 'true' }, headers: {} })).toBeNull();
    expect(() => assertVoiceDestination(null, 'other', 'other')).not.toThrow();
  });
  it.each(['accountId', 'accountProvider', 'voiceAccountId'])('refuses unsupported client account claims: %s', key => {
    const req = request(); req.body[key] = 'unattested';
    expect(() => voiceDestinationPolicy(req)).toThrow('voice_account_selection_unsupported');
  });
});
