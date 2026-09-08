import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeechOut } from './speechOut.js';
import { createRequestVoiceBridge } from './requestVoiceBridge.js';
let outs = [];
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('URL', {createObjectURL: () => 'blob:synthetic', revokeObjectURL: vi.fn()}); });
afterEach(() => { outs.forEach(o => o.cancel()); outs = []; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function playing(options = {}) {
  const audios = [];
  const out = createSpeechOut({ engine: 'provider', playbackTimeoutMs: 30, ...options }, {
    fetch: async () => ({ok: true, status: 200, headers: {get: () => 'audio/wav'}, blob: async () => new Blob(['fixture'])}),
    createAudio: src => { const a = {src, pause: vi.fn(), play: vi.fn(async () => {})}; audios.push(a); return a; },
  });
  outs.push(out);
  const p = out.speak('No, do not do it.');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  audios[0].onplaying();
  return {out, audios, p};
}
describe('review6 provider playback ownership', () => {
  it('cancel pauses/detaches before settling, exactly once', async () => {
    const {out,audios,p} = await playing(); out.cancel();
    expect(audios[0].pause).toHaveBeenCalledTimes(1); expect(audios[0].src).toBe('');
    expect(await p).toMatchObject({ok:false,reason:'stale'}); expect(audios[0].onended).toBeNull();
  });
  it('deadline pauses and detaches, reports timeout not success', async () => {
    const {audios,p} = await playing(); await vi.advanceTimersByTimeAsync(31);
    expect(await p).toMatchObject({ok:false,reason:'timeout'});
    expect(audios[0].pause).toHaveBeenCalledTimes(1); expect(audios[0].src).toBe('');
  });
  it('stale callbacks cannot clear or stop newer audio', async () => {
    const {out,audios,p} = await playing(); const stale = audios[0].onended;
    out.cancel(); await p; const newer = out.speak('New turn.');
    for(let i=0;i<20;i++) await Promise.resolve(); audios[1].onplaying(); stale();
    expect(audios[1].src).toBe('blob:synthetic'); expect(audios[1].pause).not.toHaveBeenCalled();
    out.cancel(); await newer; expect(audios[1].pause).toHaveBeenCalledTimes(1);
  });
  it('playback error tears down without replay after audio started', async () => {
    const {audios,p} = await playing(); audios[0].onerror();
    expect(await p).toMatchObject({ok:false,reason:'playback'}); expect(audios[0].src).toBe(''); expect(audios).toHaveLength(1);
  });
});
function accepted(b) { b.event('conversation_started',{conversationId:'c'}); b.event('agent_execution_started',{executionId:'e'}); b.event('assistant_message',{id:'m'}); b.event('final_content',{assistantMessageId:'m',content:'No.'}); }
describe('review6 terminal lifecycle', () => {
  it('terminal before acceptance cannot be repaired by late identity', () => { const onSpeech=vi.fn(), b=createRequestVoiceBridge({onSpeech}); b.event('done',{}); accepted(b); expect(b.finish()).toMatchObject({accepted:false,completed:false}); expect(onSpeech).not.toHaveBeenCalled(); });
  it('missing expected wire identities fail without representing expectations as observations', () => { const b=createRequestVoiceBridge({expected:{accountId:'a',requestId:'r'}}); accepted(b); b.event('done',{}); const receipt=b.finish(); expect(receipt).toMatchObject({accepted:true,completed:false,reason:'request_identity_unattested'}); expect(receipt.requestIdentity.accountId).toBeUndefined(); });
  it('identity appearing after terminal never upgrades a failed receipt', () => { const b=createRequestVoiceBridge({expected:{accountId:'a'}}); accepted(b); b.event('done',{}); b.event('agent_execution_started',{executionId:'e',accountId:'a'}); expect(b.finish()).toMatchObject({accepted:true,completed:false}); });
});
