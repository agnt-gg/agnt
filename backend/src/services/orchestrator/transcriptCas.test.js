import { beforeAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTurnReceipt } from './turnReceipt.js';
vi.mock('../../utils/realtimeSync.js',()=>({broadcastToUser:vi.fn(),RealtimeEvents:{CONTENT_UPDATED:'updated'}}));
let outputs,persist;
const user='TEST-batch14-cas';
beforeAll(async()=>{
 expect(process.env.USER_DATA_PATH).toContain('agnt-vitest-');
 const mod=await import('../../models/database/index.js');await mod.dbReady;
 await new Promise((r,j)=>mod.default.run('INSERT INTO users(id,email) VALUES (?,?)',[user,user+'@test.invalid'],e=>e?j(e):r()));
 outputs=(await import('../../models/ContentOutputModel.js')).default;
 persist=(await import('./persistTurnTranscript.js')).persistTurnTranscript;
});
async function fixture(){
 const conversationId=randomUUID(),id=randomUUID(),question={id:'u',role:'user',content:'Should I proceed?'};
 const content=JSON.stringify({conversationId,messages:[question,{id:'draft',role:'assistant',content:'Yes, proceed immediately and without checking.'}]});
 await outputs.createOrUpdate(id,user,null,null,content,false,'conversation',conversationId,'My title',{channelKey:'workspace:test'});
 const args=(text='No.',messages=[question],executionId=randomUUID())=>{
  const assistantMessageId='a-'+executionId;
  const r=createTurnReceipt({userId:user,conversationId});
  r.observe('agent_execution_started',{executionId});r.observe('assistant_message',{id:assistantMessageId});
  r.observe('final_content',{assistantMessageId,content:text});
  return {conversationId,userId:user,providerMessages:[...messages,{id:assistantMessageId,role:'assistant',content:text}],completionReceipt:r.finish({executionPersisted:true,transcriptPersisted:true})};
 };
 return {id,conversationId,content,args,question};
}
it('two racing mirror completions admit exactly one and retain seal',async()=>{
 const f=await fixture();const results=await Promise.all([persist(f.args('No.')),persist(f.args('Yes.'))]);
 expect(results.filter(r=>r.written)).toHaveLength(1);
 const row=await outputs.findOne(f.id),body=JSON.parse(row.content);
 expect(body.serverCompletion.revision).toBe(1);expect(row.title).toBe('My title');expect(row.channel_key).toBe('workspace:test');
 expect(['No.','Yes.']).toContain(body.messages.at(-1).content);
});
it('CAS rejects changed content and wrong user without touching row metadata',async()=>{
 const f=await fixture();await outputs.createOrUpdate(f.id,user,null,null,'newer',false,'conversation',f.conversationId,'Renamed');
 expect((await outputs.compareAndSwapTranscript({id:f.id,userId:user,conversationId:f.conversationId,expectedContent:f.content,content:'stale'})).changes).toBe(0);
 expect((await outputs.compareAndSwapTranscript({id:f.id,userId:'wrong',conversationId:f.conversationId,expectedContent:'newer',content:'stale'})).changes).toBe(0);
 expect(await outputs.findOne(f.id)).toMatchObject({content:'newer',title:'Renamed'});
});
it('rejects longer same-ID digest mismatch, duplicate completion and unsealed recovery',async()=>{
 const f=await fixture(),args=f.args();
 const bad={...args,providerMessages:[args.providerMessages[0],{...args.providerMessages[1],content:'Yes '.repeat(100)}]};
 expect((await persist(bad)).written).toBe(false);
 expect((await persist(args)).written).toBe(true);expect((await persist(args)).written).toBe(false);
 expect((await persist({...bad,completionReceipt:undefined})).written).toBe(false);
 expect(JSON.parse((await outputs.findOne(f.id)).content).messages.at(-1).content).toBe('No.');
});
it('accepts a distinct later user turn with monotonic mirror revision',async()=>{
 const f=await fixture(),first=f.args();expect((await persist(first)).written).toBe(true);
 const second=f.args('Still no.',[...first.providerMessages,{id:'u2',role:'user',content:'And now?'}]);
 expect((await persist(second)).written).toBe(true);
 const body=JSON.parse((await outputs.findOne(f.id)).content);
 expect(body.serverCompletion.revision).toBe(2);expect(body.messages.at(-1).content).toBe('Still no.');
});
