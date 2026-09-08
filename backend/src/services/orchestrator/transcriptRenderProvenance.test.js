import { beforeAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTurnReceipt } from './turnReceipt.js';
import { savedTranscriptAuthority } from './savedTranscriptAuthority.js';
vi.mock('../../utils/realtimeSync.js',()=>({broadcastToUser:vi.fn(),RealtimeEvents:{CONTENT_UPDATED:'updated'}}));
let outputs,write;
const user='TEST-batch19-render';
const voice={type:'voice-input',kind:'correlated-delegation',utteranceId:'u',observedTranscript:'May I',delegatedInterpretation:'May I proceed?'};
beforeAll(async()=>{
 expect(process.env.USER_DATA_PATH).toContain('agnt-vitest-');
 const mod=await import('../../models/database/index.js');await mod.dbReady;
 await new Promise((resolve,reject)=>mod.default.run('INSERT INTO users(id,email) VALUES (?,?)',[user,user+'@test.invalid'],e=>e?reject(e):resolve()));
 outputs=(await import('../../models/ContentOutputModel.js')).default;
 write=(await import('./persistTurnTranscript.js')).writeTranscript;
});
async function fixture() {
 const id=randomUUID(),conversationId=randomUUID();
 const messages=[{id:'u',role:'user',content:'May I proceed?',metadata:[voice]},
 {id:'a',role:'assistant',content:'No.',contentParts:[{type:'tool',toolCallId:'t'},{type:'text',text:'No.'}],toolCalls:[{id:'t',name:'read',result:'safe'}],streamFinalized:true}];
 const save=body=>outputs.createOrUpdate(id,user,null,null,JSON.stringify(body),false,'conversation',conversationId,'TEST');
 const complete=async next=>{
  const a=next.at(-1),r=createTurnReceipt({userId:user,conversationId});
  r.observe('agent_execution_started',{executionId:randomUUID()});r.observe('assistant_message',{id:a.id});r.observe('final_content',{assistantMessageId:a.id,content:a.content});
  return write({conversationId,userId:user,messages:next,completionReceipt:r.finish({executionPersisted:true,transcriptPersisted:true})});
 };
 await save({messages});expect((await complete(messages)).written).toBe(true);
 const load=async()=>JSON.parse((await outputs.findOne(id)).content);
 const sealed=(await load()).messages;
 return {id,conversationId,messages:sealed,save,complete,load};
}
it('ordinary save preserves authoritative render projection and provenance, but retains unrelated metadata and later turns',async()=>{
 const f=await fixture(),body=await f.load();
 body.messages[0].metadata=[{...voice,kind:'native-final',delegatedInterpretation:null},{type:'tag',value:'keep'}];
 Object.assign(body.messages[1],{contentParts:[{type:'text',text:'Yes.'}],toolCalls:[],reasoning:'invented',streamFinalized:false});
 body.messages.push({id:'u2',role:'user',content:'Tomorrow?'});body.custom='keep';
 expect((await f.save(body)).changes).toBe(1);
 const loaded=await f.load();expect(loaded.messages[1]).toEqual(f.messages[1]);
 expect(loaded.messages[0].metadata).toEqual([{type:'tag',value:'keep'},voice]);
 expect(loaded.messages[2]).toEqual(body.messages[2]);expect(loaded.custom).toBe('keep');
});
it('later internal completion cannot rewrite the previous render projection or accepted interpretation',async()=>{
 const f=await fixture(),messages=structuredClone(f.messages);
 messages[0].metadata=[{...voice,kind:'native-final'}];messages[1].contentParts=[{type:'text',text:'Yes.'}];messages[1].toolCalls=[];
 messages.push({id:'u2',role:'user',content:'Tomorrow?'},{id:'a2',role:'assistant',content:'Still no.'});
 expect((await f.complete(messages)).written).toBe(true);
 const loaded=await f.load();expect(loaded.messages[0].metadata).toEqual([voice]);expect(loaded.messages[1]).toEqual(f.messages[1]);
 expect(loaded.serverCompletion.revision).toBe(2);expect(loaded.messages.at(-1).content).toBe('Still no.');
});
it('stale ordinary snapshot cannot roll back a concurrently completed later turn',async()=>{
 const f=await fixture(),stale=await f.load(),read=outputs.findOne.bind(outputs);
 let captured,release;
 const capturedPromise=new Promise(r=>captured=r),barrier=new Promise(r=>release=r);
 const spy=vi.spyOn(outputs,'findOne').mockImplementationOnce(async id=>{const row=await read(id);captured();await barrier;return row;});
 const pending=f.save(stale);await capturedPromise;
 try {
  expect((await f.complete([...f.messages,{id:'u2',role:'user',content:'Tomorrow?'},{id:'a2',role:'assistant',content:'Still no.'}])).written).toBe(true);
 } finally {release();spy.mockRestore();}
 expect((await pending).changes).toBe(0);
 const row=await read(f.id);expect(row.server_revision).toBe(2);expect(savedTranscriptAuthority(row).messages.at(-1).content).toBe('Still no.');
});
it('parallel same-content relabel attempts never alter the accepted interpretation or tool order',async()=>{
 const f=await fixture(),body=await f.load();body.messages[0].metadata=[];body.messages[1].contentParts=[{type:'text',text:'Yes.'}];
 const attempts=await Promise.all(Array.from({length:12},()=>f.save(body)));
 expect(attempts.every(r=>r.changes===0||r.changes===1)).toBe(true);
 const loaded=await f.load();expect(loaded.messages[0].metadata).toEqual([voice]);expect(loaded.messages[1]).toEqual(f.messages[1]);
});
