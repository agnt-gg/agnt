import { it, expect, vi } from 'vitest';
import { parseOwnerAsrContract, createOwnerAsrResolver } from './ownerAsrBinding.js';
const contract = `WORKSTATION_LANE_CONTRACT_VERSION=1
WORKSTATION_LANE_CONTRACT_GROUP=voice-dictation
VOICE_ASR_ENABLED=true
VOICE_ASR_LANE_ID=asr
VOICE_ASR_RUNTIME_OWNER=unit.service
VOICE_ASR_BIND=127.0.0.1
VOICE_ASR_PROTOCOL=ws
VOICE_ASR_API_SHAPE=speech-stream
VOICE_ASR_CONTRACT_STATUS=ready
NVIDIA_ASR_URL=ws://127.0.0.1:2345
NVIDIA_ASR_HEALTH_URL=http://127.0.0.1:2345/health
`;
it('parses owner primary variables without executing shell or using legacy aliases', () => {
  expect(parseOwnerAsrContract(contract)).toMatchObject({ socketUrl: 'ws://127.0.0.1:2345/', healthUrl: 'http://127.0.0.1:2345/health' });
});
it.each([
  ['VOICE_ASR_ENABLED=true','VOICE_ASR_ENABLED=false'],
  ['VOICE_ASR_API_SHAPE=speech-stream','VOICE_ASR_API_SHAPE=unknown'],
  ['ws://127.0.0.1:2345','ws://example.com:2345'],
  ['ws://127.0.0.1:2345','ws://user:pass@127.0.0.1:2345'],
  ['http://127.0.0.1:2345/health','http://127.0.0.1:9999/health'],
  ['ws://127.0.0.1:2345','$(touch /tmp/never)'],
  ['VOICE_ASR_CONTRACT_STATUS=ready','VOICE_ASR_CONTRACT_STATUS=disabled'],
])('rejects altered contract %s', (from, to) => expect(() => parseOwnerAsrContract(contract.replace(from, to))).toThrow());
it('rejects duplicates, oversized content and absent primary URL despite effective alias', () => {
  for (const text of [contract+'NVIDIA_ASR_URL=ws://127.0.0.1:2345\n', 'x'.repeat(32769), contract.replace('NVIDIA_ASR_URL=', 'VOICE_ASR_EFFECTIVE_WS_URL=')]) expect(() => parseOwnerAsrContract(text)).toThrow();
});
function fixture(extra = {}) {
  const readContract = vi.fn(async () => contract);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'healthy', model_loaded: true, sample_rate: 16000 }), { headers: { 'content-type': 'application/json' } }));
  const openSocket = vi.fn(() => ({}));
  const resolve = createOwnerAsrResolver({ contractPath: '/owner/voice-dictation.env', allowedUsers: ['user-a'], readContract, fetch, openSocket, ...extra });
  return { resolve, readContract, fetch, openSocket };
}
it('disabled and unlisted users do not read configuration or contact services', async () => {
  for (const opts of [{ contractPath: '' }, { allowedUsers: [] }, {}]) {
    const f = fixture(opts); expect(await f.resolve(opts.allowedUsers || opts.contractPath === '' ? 'user-a' : 'other')).toBeNull();
    expect(f.readContract).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  }
});
it('checks health each time and opens only the contract endpoint with payload bounds', async () => {
  const f = fixture(); const b = await f.resolve('user-a');
  expect(b).toMatchObject({ id: 'local-asr-candidate', sampleRate: 16000 });
  expect(f.openSocket).not.toHaveBeenCalled(); b.openSocket();
  expect(f.openSocket).toHaveBeenCalledWith('ws://127.0.0.1:2345/', expect.objectContaining({ maxPayload: 65536, followRedirects: false }));
  await f.resolve('user-a'); expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(f.fetch.mock.calls[0][1].redirect).toBe('error');
});
it.each([{status:'loading'}, {status:'healthy', model_loaded:false}, {status:'healthy', model_loaded:true, sample_rate:8000}])('fails closed on unhealthy or incompatible runtime', async body => {
  const f = fixture({ fetch: async () => new Response(JSON.stringify(body)) }); expect(await f.resolve('user-a')).toBeNull();
});
it('accepts the owner health schema without an optional sample-rate field', async () => {
  const f = fixture({ fetch: async () => new Response(JSON.stringify({status:'healthy',model_loaded:true})) });
  expect(await f.resolve('user-a')).not.toBeNull();
});
it.each(['oversized','invalid-json','redirect','body-stall'])('fails closed on %s health response', async kind => {
  const fetch = async () => {
    if (kind === 'oversized') return new Response('x'.repeat(8193));
    if (kind === 'invalid-json') return new Response('{');
    if (kind === 'redirect') return new Response('', {status:302});
    return new Response(new ReadableStream({start(){}}));
  };
  const f = fixture({ fetch, timeoutMs:20 }); expect(await f.resolve('user-a')).toBeNull();
  expect(f.openSocket).not.toHaveBeenCalled();
});
it('bounds hanging transport and suppresses internal configuration errors', async () => {
  const f = fixture({ timeoutMs: 20, fetch: () => new Promise(() => {}) });
  expect(await f.resolve('user-a')).toBeNull();
  const bad = fixture({ readContract: async () => { throw new Error('private path'); } }); expect(await bad.resolve('user-a')).toBeNull();
});
