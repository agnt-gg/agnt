import { describe, it, expect, vi } from 'vitest';
import { createLocalVoiceController } from './localVoiceController.js';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function setup(overrides = {}) {
 const accepted = { accepted: true, executionId: 'e1', conversationId: 'c1', assistantMessageId: 'a1' };
 const capture = { start: vi.fn(async () => true), finish: vi.fn(() => new Uint8Array([1, 0])), stop: vi.fn() };
 const asr = { transcribe: vi.fn(async ({utteranceId}) => ({ok:true,turn:{text:'Move only after backup.',transcript:'Move only after backup.',commitKind:'local-asr-hard-final',utteranceId}})), stopListening: vi.fn() };
 const narrator = { speak: vi.fn(async () => ({ok:true})), cancel: vi.fn() };
 const submitTurn = vi.fn(async args => { args.onAccepted(accepted); args.onSpeech('No, do not do it.', 'a1'); return {...accepted,completed:true}; });
 const onError = vi.fn(); const c = createLocalVoiceController({createCapture:()=>capture, createAsr:()=>asr,createNarrator:()=>narrator,submitTurn,onError,...overrides});
 return { c,capture,asr,narrator,submitTurn,onError,accepted };
}
describe('explicit local voice input and confirmed narration', () => {
 it('never auto-submits and sends one qualified hard final via existing callback', async () => {
  const s=setup(); await s.c.start(); expect(s.submitTurn).not.toHaveBeenCalled();
  await s.c.commit(); expect(s.submitTurn).toHaveBeenCalledTimes(1);
  expect(s.submitTurn.mock.calls[0][0]).toMatchObject({text:'Move only after backup.',commitKind:'local-asr-hard-final'});
  expect(s.narrator.speak).toHaveBeenCalledWith('No, do not do it.');
  await s.c.commit(); expect(s.submitTurn).toHaveBeenCalledTimes(1);
 });
 it('pause cancels ASR and stale final never submits', async () => {
  const s=setup(), d=deferred(); s.asr.transcribe.mockReturnValue(d.promise); await s.c.start();
  const p=s.c.commit(); s.c.setListening(false); d.resolve({ok:true,turn:{text:'stale'}}); await p;
  expect(s.submitTurn).not.toHaveBeenCalled(); expect(s.asr.stopListening).toHaveBeenCalled();
 });
 it('stop playback preserves task but suppresses late narration', async () => {
  const d=deferred(), s=setup({submitTurn:args=>{args.onAccepted({accepted:true,executionId:'e1',conversationId:'c1',assistantMessageId:'a1'});args.onSpeech('late','a1');return d.promise;}});
  await s.c.start(); const p=s.c.commit(); await Promise.resolve(); s.c.stopPlayback();
  d.resolve({...s.accepted,completed:true}); await p; expect(s.narrator.speak).not.toHaveBeenCalled();
 });
 it('unconfirmed completion cannot speak', async () => {
  const s=setup({submitTurn:async args=>{args.onSpeech('draft','wrong');return {accepted:true,completed:false};}});
  await s.c.start(); await s.c.commit(); expect(s.narrator.speak).not.toHaveBeenCalled(); expect(s.onError).toHaveBeenCalled();
 });
 it('ending pending microphone acquisition discards late success', async () => {
  const s=setup(), d=deferred();s.capture.start.mockReturnValue(d.promise);
  const p=s.c.start();s.c.stop();d.resolve(true);expect(await p).toBe(false);expect(s.c.active).toBe(false);expect(s.capture.stop).toHaveBeenCalled();
 });
 it('old start cannot terminate a newer session', async () => {
  const s=setup(),d=deferred();s.capture.start.mockReturnValueOnce(d.promise);
  const old=s.c.start();s.c.stop();expect(await s.c.start()).toBe(true);d.resolve(true);await old;
  expect(s.c.active).toBe(true);
 });
 it('denied microphone fails without ASR, submit or fallback', async () => {
  const s=setup();s.capture.start.mockResolvedValue(false);expect(await s.c.start()).toBe(false);
  expect(s.asr.transcribe).not.toHaveBeenCalled();expect(s.submitTurn).not.toHaveBeenCalled();
 });
});
