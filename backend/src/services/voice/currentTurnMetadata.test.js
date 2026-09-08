import {it,expect} from 'vitest';
import fs from 'node:fs';
import {attachCurrentVoiceMetadata,cloneLedgerMessage,withoutLedgerMetadata} from './currentTurnMetadata.js';
const entry={type:'voice-input',kind:'correlated-delegation',utteranceId:'TEST-current',observedTranscript:'Move the file',delegatedInterpretation:'Move the file only after backup.'};
it.each([false,true])('attaches only to terminal user and survives ledger clone, multipart=%s',multipart=>{
 const history=[{role:'user',content:'earlier',metadata:[{...entry,utteranceId:'earlier'}]},{role:'assistant',content:'ok'},{role:'user',content:entry.delegatedInterpretation,metadata:[{type:'attachment',name:'test'}]}];
 const before=JSON.stringify(history);
 const result=attachCurrentVoiceMetadata(history,multipart?JSON.stringify([entry]):[entry]);
 expect(JSON.stringify(history)).toBe(before);
 expect(result[0]).toEqual(history[0]);
 expect(result[2].metadata).toEqual([{type:'attachment',name:'test'},entry]);
 expect(cloneLedgerMessage(result[2]).metadata).toEqual(result[2].metadata);
 expect(result[2].content).toBe(entry.delegatedInterpretation);
});
it('does not back-stamp earlier user input or accept nonvoice injected fields',()=>{
 const messages=[{role:'user',content:'old'},{role:'assistant',content:'answer'}];
 expect(attachCurrentVoiceMetadata(messages,[entry])).toEqual(messages);
 const one=[{role:'user',content:'new'}];
 expect(attachCurrentVoiceMetadata(one,[{type:'admin',value:true}])).toEqual(one);
 for(const raw of ['{bad','x'.repeat(300000),{},null])expect(attachCurrentVoiceMetadata(one,raw)).toEqual(one);
});
it('provider boundary strips annotations but retains protocol fields and canonical history',()=>{
 const messages=[{id:'server-ledger-id',role:'user',content:'current',metadata:[entry]},{role:'assistant',content:'',_responsesOutputItems:[{type:'reasoning',id:'r'}],tool_calls:[{id:'tool'}]}];
 const before=JSON.stringify(messages);const wire=withoutLedgerMetadata(messages);
 expect(wire[0]).toEqual({role:'user',content:'current'});expect(wire[1]).toEqual(messages[1]);expect(JSON.stringify(messages)).toBe(before);
});
it('bounds entries and never upgrades an unknown kind',()=>{
 const list=Array.from({length:20},()=>({...entry,kind:'made-up',extra:'discard',observedTranscript:'x'.repeat(20000)}));
 const msg=attachCurrentVoiceMetadata([{role:'user',content:'current'}],list)[0];
 expect(msg.metadata).toHaveLength(8);expect(msg.metadata[0].kind).toBe('unknown');expect(msg.metadata[0].extra).toBeUndefined();expect(msg.metadata[0].observedTranscript).toHaveLength(16384);
});
it('production handler uses attachment before sanitization and the ledger clone',()=>{
 const source=fs.readFileSync(new URL('../OrchestratorService.js',import.meta.url),'utf8');
 expect(source).toContain('messageInput = attachCurrentVoiceMetadata(messageInput, req.body.voiceMetadata)');
 expect(source).toContain('.map(cloneLedgerMessage)');
 expect(source).toContain('withoutLedgerMetadata(messages),');
});
