import {describe,it,expect,vi} from 'vitest';
import {createLocalVoiceController} from './localVoiceController.js';
import {createCodexVoiceController} from './codexVoiceController.js';
import {createCodexVoiceProfiles} from './codexVoiceSettings.js';
describe('explicit local stream provider consumed by production controllers',()=>{
 it.each(['pocket-tts-cpu','faster-qwen-candidate'])('local controller consumes %s',async providerEngine=>{
  const createNarrator=vi.fn(()=>({cancel(){}}));
  const c=createLocalVoiceController({submitTurn:vi.fn(),createNarrator,createAsr:()=>({stopListening(){}}),createCapture:()=>({start:async()=>true,stop(){}})});
  expect(await c.start({output:'local-stream',providerEngine})).toBe(true);
  expect(createNarrator).toHaveBeenCalledWith({engine:'local-stream',providerEngine,apiBase:'/api'});c.stop();
 });
 it.each(['pocket-tts-cpu','faster-qwen-candidate'])('Codex exact-final narrator consumes %s before mic setup',async providerEngine=>{
  const createNarrator=vi.fn(()=>({cancel(){}}));
  const c=createCodexVoiceController({apiBase:'/api',submitTurn:vi.fn(),Peer:class{},createNarrator,getUserMedia:async()=>{throw Error('no room mic');}});
  await c.start({output:'local-stream',providerEngine});
  expect(createNarrator).toHaveBeenCalledWith({engine:'local-stream',providerEngine,apiBase:'/api'});c.stop();
 });
 it.each([undefined,'openai','https://external.test'])('rejects missing/cloud stream destination %s before capture',async providerEngine=>{
  const createCapture=vi.fn(),createNarrator=vi.fn(),getUserMedia=vi.fn();
  const c=createLocalVoiceController({submitTurn:vi.fn(),createCapture,createNarrator});
  expect(await c.start({output:'local-stream',providerEngine})).toBe(false);expect(createCapture).not.toHaveBeenCalled();
  const n=createCodexVoiceController({submitTurn:vi.fn(),getUserMedia,createNarrator});
  expect(await n.start({output:'local-stream',providerEngine})).toBe(false);expect(createNarrator).not.toHaveBeenCalled();expect(getUserMedia).not.toHaveBeenCalled();
 });
 it('persists only explicit allowlisted provider in user/installation scope; defaults unselected',()=>{
  const data=new Map(),p=createCodexVoiceProfiles({storage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}}),scope={userId:'alice',installation:'http://localhost:3333/api'};
  p.setScope(scope);expect(p.settings.providerEngine).toBeUndefined();expect(p.settings.output).toBeUndefined();
  Object.assign(p.settings,{engine:'local',output:'local-stream',providerEngine:'pocket-tts-cpu'});expect(p.save()).toBe(true);
  p.setScope({...scope,userId:'bob'});expect(p.settings.providerEngine).toBeUndefined();p.setScope(scope);expect(p.settings.providerEngine).toBe('pocket-tts-cpu');
  p.settings.providerEngine='openai';expect(p.save()).toBe(false);
 });
});
