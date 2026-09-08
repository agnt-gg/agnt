import { it, expect } from 'vitest';
import { createCodexFinalTurnBridge } from './codexFinalTurnBridge.js';
for(const nativePlayback of [undefined,true,false]) it(`permission separates exact TTS from generative native mode (${nativePlayback})`,async()=>{
 const allow=[],emitted=[];const receipt={accepted:true,completed:true,conversationId:'c',assistantMessageId:'m'};
 const b=createCodexFinalTurnBridge({...(nativePlayback===undefined?{}:{nativePlayback}),setPlaybackAllowed:x=>allow.push(x),emit:t=>emitted.push(t),submitTurn:async a=>{a.onAccepted(receipt);a.onSpeech('No.','m');return receipt;}});
 await b.handle({type:'transcript',role:'user',final:true,id:'u',text:'Question'});
 expect(emitted).toEqual(['No.']);expect(allow.includes(true)).toBe(nativePlayback===false);
 b.close();expect(allow.at(-1)).toBe(false);
});
it('native mode remains muted through created, stale done and queued response flush',async()=>{
 const allow=[];let args,finish;const b=createCodexFinalTurnBridge({setPlaybackAllowed:x=>allow.push(x),emit:()=>{},submitTurn:a=>{args=a;return new Promise(r=>finish=r);}});
 const p=b.handle({type:'transcript',role:'user',final:true,id:'u',text:'Question'});
 await b.handle({type:'assistant-turn-start',id:'native'});args.onAccepted({accepted:true,conversationId:'c',assistantMessageId:'m'});args.onSpeech('No.','m');
 for(const id of ['stale','native','native']) await b.handle({type:'transcript',role:'assistant',final:true,id,text:'filler'});
 finish({accepted:true,completed:true});await p;b.close();expect(allow.includes(true)).toBe(false);
});
