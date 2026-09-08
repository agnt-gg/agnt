import {describe,it,expect,vi,afterEach} from 'vitest';
import {createRequestVoiceBridge} from './requestVoiceBridge.js';
import {createSpeechOut} from './speechOut.js';
import {voiceErrorMessage} from './voiceErrorMessage.js';
import {createCodexFinalTurnBridge} from './codexFinalTurnBridge.js';
import {createAssistantMessage,applyStreamEvent} from '../services/chatStreamReducer.js';
import {serializeTranscript,parseTranscript} from '../services/conversationTranscript.js';
afterEach(()=>vi.useRealTimers());
function terminal(extra={},expected={}) {
 const speech=vi.fn();const b=createRequestVoiceBridge({onSpeech:speech,expected});
 b.event('conversation_started',{conversationId:'c'});b.event('agent_execution_started',{executionId:'e'});b.event('assistant_message',{id:'m'});
 b.event('final_content',{assistantMessageId:'m',content:'No, do not do it.'});b.event('done',extra);return {receipt:b.finish(),speech};
}
describe('review3 terminal bindings',()=>{
 it.each([{conversationId:'other'},{assistantMessageId:'other'},{executionId:'other'},{status:'unknown'},{status:'accepted'},{completed:false},{success:'true'},{conversationId:null}])('rejects contradictory terminal %j while preserving acceptance',extra=>{
  const {receipt,speech}=terminal(extra);expect(receipt.accepted).toBe(true);expect(receipt.completed).toBe(false);expect(speech).not.toHaveBeenCalled();
 });
 it.each(['requestId','accountId','userId','provider'])('binds caller %s and rejects conflicts',key=>{const {receipt,speech}=terminal({[key]:'other'},{[key]:'bound'});expect(receipt.completed).toBe(false);expect(speech).not.toHaveBeenCalled();});
 it('binds an existing conversation before first event',()=>{expect(terminal({}, {conversationId:'different'}).receipt.completed).toBe(false);});
 it('supports the current production done payload but labels stream-local binding',()=>{const {receipt,speech}=terminal({message:'Stream ended'});expect(receipt.completed).toBe(true);expect(speech).toHaveBeenCalledOnce();expect(receipt.binding).toBe('stream-local');});
 it('rejects identity contradictions on final events too',()=>{const b=createRequestVoiceBridge();b.event('conversation_started',{conversationId:'c'});b.event('agent_execution_started',{executionId:'e'});b.event('assistant_message',{id:'m'});b.event('final_content',{assistantMessageId:'m',conversationId:'bad',content:'Wrong.'});b.event('done');expect(b.finish().completed).toBe(false);});
});
describe('review3 authoritative UI final',()=>{
 it('replaces text parts, keeps tools, and serializes/hydrates the exact correction',()=>{
  const m=createAssistantMessage({id:'m'});applyStreamEvent(m,'content_delta',{delta:'Yes, '});applyStreamEvent(m,'tool_start',{toolCall:{id:'t',name:'read'}});applyStreamEvent(m,'content_delta',{delta:'do it.'});
  const tool=m.contentParts.find(p=>p.type!=='text');applyStreamEvent(m,'final_content',{content:'No, do not do it.'});
  expect(m.content).toBe('No, do not do it.');expect(m.contentParts.filter(p=>p.type==='text').map(p=>p.text).join('')).toBe(m.content);expect(m.contentParts).toContainEqual(tool);
  const restored=parseTranscript(serializeTranscript({messages:[m]})).messages[0];expect(restored.content).toBe(m.content);expect(restored.contentParts).toEqual(m.contentParts);
 });
 it('authoritative empty content clears drafts',()=>{const m=createAssistantMessage();applyStreamEvent(m,'content_delta',{delta:'Draft'});applyStreamEvent(m,'final_content',{content:''});expect(m.content).toBe('');expect(m.contentParts).toEqual([]);});
});
describe('review3 synthesis receipts',()=>{
 it('maps failures to actionable UI text without losing unknown codes',()=>{expect(voiceErrorMessage('voice_narration_unavailable')).toContain('Read the answer in chat');expect(voiceErrorMessage('voice_narration_timeout')).toContain('not cancelled');expect(voiceErrorMessage('other_code')).toBe('other_code');});
 it('provider PCM/media receipt follows actual onplaying and ended, not fetch completion',async()=>{
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=vi.fn();
  let audio,t=0;const o=createSpeechOut({engine:'provider'}, {now:()=>t,fetch:async()=>({ok:true,headers:{get:()=> 'audio/wav'},blob:async()=>new Blob(['audio-fixture'])}),createAudio:()=>audio={play:async()=>{},pause:vi.fn(),duration:2}});
  try{const p=o.speak('one two three four');for(let i=0;i<8;i++)await Promise.resolve();t=10000;expect(o.spokenPrefix()).toBe('');audio.onplaying();t+=700;expect(o.spokenPrefix()).not.toBe('');audio.onended();expect((await p).ok).toBe(true);expect(o.spokenPrefix()).toBe('one two three four');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');}finally{o.cancel();URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
 });
 class U{constructor(text){this.text=text;}}
 it('unavailable synthesis has typed failure and no heard prefix',async()=>{const o=createSpeechOut({}, {speechSynthesis:{},SpeechSynthesisUtterance:U});expect(await o.speak('Never heard.')).toMatchObject({ok:false,reason:'unavailable'});expect(o.spokenPrefix()).toBe('');expect(o.pending).toEqual([]);});
 it('does not count synthesis waiting time; starts progress only on playback start',async()=>{
  let u,t=0;const o=createSpeechOut({}, {speechSynthesis:{speak:x=>u=x,cancel(){}},SpeechSynthesisUtterance:U,now:()=>t});const p=o.speak('one two three four five six');await Promise.resolve();t=10000;expect(o.spokenPrefix()).toBe('');u.onstart();t+=500;expect(o.spokenPrefix()).not.toBe('');u.onend();expect(await p).toMatchObject({ok:true});expect(o.spokenPrefix()).toBe('one two three four five six');
 });
 it('end without any playback start cannot mark zero audio heard',async()=>{const o=createSpeechOut({}, {speechSynthesis:{speak:u=>u.onend()},SpeechSynthesisUtterance:U});expect(await o.speak('not heard')).toEqual({ok:false,reason:'zero-audio'});expect(o.spokenPrefix()).toBe('');});
 it('failure before start and synchronous throw do not poison the queue',async()=>{let calls=0;const o=createSpeechOut({}, {speechSynthesis:{speak(u){if(++calls===1)throw Error('broken');u.onstart();u.onend();}},SpeechSynthesisUtterance:U});expect((await o.speak('failed')).ok).toBe(false);expect(o.spokenPrefix()).toBe('');expect((await o.speak('played')).ok).toBe(true);expect(o.spokenPrefix()).toBe('played');});
 it('times out and cancels a synth that never reports progress',async()=>{vi.useFakeTimers();const cancel=vi.fn();const o=createSpeechOut({playbackTimeoutMs:30},{speechSynthesis:{speak(){},cancel},SpeechSynthesisUtterance:U});const p=o.speak('silent');await vi.advanceTimersByTimeAsync(31);expect(await p).toMatchObject({ok:false,reason:'timeout'});expect(cancel).toHaveBeenCalled();expect(o.spokenPrefix()).toBe('');});
 it('cancel settles an ignored network abort without waiting for the deadline',async()=>{const o=createSpeechOut({engine:'provider'}, {fetch:()=>new Promise(()=>{})});const p=o.speak('pending network');await Promise.resolve();o.cancel();expect(await p).toMatchObject({ok:false,reason:'stale'});expect(o.spokenPrefix()).toBe('');});
 it('cancel settles even if the engine never emits an event',async()=>{const o=createSpeechOut({}, {speechSynthesis:{speak(){},cancel(){}},SpeechSynthesisUtterance:U});const p=o.speak('pending');await Promise.resolve();o.cancel();expect(await p).toMatchObject({ok:false,reason:'stale'});expect(o.spokenPrefix()).toBe('');});
});
describe('review3 paused input generations',()=>{
 it('tombstones partial turns without blocking fresh turns',async()=>{const submitTurn=vi.fn(async()=>({accepted:false}));const b=createCodexFinalTurnBridge({submitTurn,emit(){}});await b.handle({type:'user-turn-start',id:'old'});await b.handle({type:'transcript',role:'user',id:'old',text:'Old',final:false});b.invalidateInput();await b.handle({type:'transcript',role:'user',id:'old',text:'Old command',final:true});expect(submitTurn).not.toHaveBeenCalled();await b.handle({type:'user-turn-start',id:'new'});await b.handle({type:'transcript',role:'user',id:'new',text:'New command',final:true});expect(submitTurn).toHaveBeenCalledOnce();});
 it('accepted task survives input invalidation',async()=>{let args,resolve;const emit=vi.fn();const b=createCodexFinalTurnBridge({submitTurn:a=>{args=a;return new Promise(r=>resolve=r);},emit});const pending=b.handle({type:'transcript',role:'user',id:'u',text:'Accepted',final:true});args.onAccepted({accepted:true,conversationId:'c',assistantMessageId:'m'});b.invalidateInput();args.onSpeech('Done.','m');resolve({accepted:true,completed:true});await pending;expect(emit).toHaveBeenCalledWith('Done.',null);});
});
