import { it, expect } from 'vitest';
import { preserveSealedProjection } from './sealedTranscriptProjection.js';
const voice={type:'voice-input',kind:'correlated-delegation',utteranceId:'u',observedTranscript:'May I',delegatedInterpretation:'May I proceed?'};
const stored={serverCompletion:{assistantMessageId:'a'},messages:[{id:'u',role:'user',content:'May I proceed?',metadata:[voice]},{id:'a',role:'assistant',content:'No.',contentParts:[{type:'tool',toolCallId:'t'},{type:'text',text:'No.'}],toolCalls:[{id:'t',name:'read',result:'safe'}],streamFinalized:true}]};
const restore=incoming=>JSON.parse(preserveSealedProjection(JSON.stringify(stored),JSON.stringify(incoming)));
it('restores exact tool/text ordering and discards invented reasoning and tool aliases',()=>{
 const incoming=structuredClone(stored),a=incoming.messages[1];
 a.contentParts=[{type:'text',text:'Yes.'}];a.toolCalls=[];a.tool_calls=[{id:'fake'}];a.reasoning='invented';a.streamFinalized=false;
 expect(restore(incoming).messages[1]).toEqual(stored.messages[1]);
});
it('retains unrelated metadata and later turns while replacing all conflicting voice claims',()=>{
 const incoming=structuredClone(stored);
 incoming.messages[0].metadata=[{type:'tag',value:'kept'},{...voice,kind:'native-final'},{...voice,utteranceId:'forged'}];
 incoming.messages.push({id:'u2',role:'user',content:'Tomorrow?',metadata:[{type:'voice-input',kind:'native-final',utteranceId:'u2'}]});
 const restored=restore(incoming);
 expect(restored.messages[0].metadata).toEqual([{type:'tag',value:'kept'},voice]);
 expect(restored.messages[2]).toEqual(incoming.messages[2]);
});
it('does not invent voice provenance for an accepted typed turn',()=>{
 const original=structuredClone(stored);delete original.messages[0].metadata;
 const incoming=structuredClone(original);incoming.messages[0].metadata=[voice];
 expect(JSON.parse(preserveSealedProjection(JSON.stringify(original),JSON.stringify(incoming))).messages[0].metadata).toEqual([]);
});
it('does not conceal role/id/content conflicts from atomic writer validation',()=>{
 const incoming=structuredClone(stored);incoming.messages[1].content='Yes.';
 expect(restore(incoming).messages[1].content).toBe('Yes.');
});
