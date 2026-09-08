import { beforeAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTurnReceipt } from './turnReceipt.js';
import { savedTranscriptAuthority } from './savedTranscriptAuthority.js';
vi.mock('../../utils/realtimeSync.js',()=>({broadcastToUser:vi.fn(),RealtimeEvents:{CONTENT_UPDATED:'updated'}}));
let outputs,persist;
const user='TEST-batch16-writers';
beforeAll(async()=>{
 expect(process.env.USER_DATA_PATH).toContain('agnt-vitest-');
 const mod=await import('../../models/database/index.js');await mod.dbReady;
 await new Promise((r,j)=>mod.default.run('INSERT INTO users(id,email) VALUES (?,?)',[user,user+'@test.invalid'],e=>e?j(e):r()));
 outputs=(await import('../../models/ContentOutputModel.js')).default;
 persist=(await import('./persistTurnTranscript.js')).persistTurnTranscript;
});
async function fixture(text='No.') {
 const id=randomUUID(),conversationId=randomUUID();
 const messages=[{id:'u',role:'user',content:'May I proceed?'},{id:'a',role:'assistant',content:text}];
 const save=(body,rowId=id,owner=user)=>outputs.createOrUpdate(rowId,owner,null,null,JSON.stringify(body),false,'conversation',conversationId,'TEST',{channelKey:'workspace:test'});
 await save({messages});
 const r=createTurnReceipt({userId:user,conversationId});
 r.observe('agent_execution_started',{executionId:randomUUID()});r.observe('assistant_message',{id:'a'});r.observe('final_content',{assistantMessageId:'a',content:text});
 expect((await persist({conversationId,userId:user,providerMessages:messages,completionReceipt:r.finish({executionPersisted:true,transcriptPersisted:true})})).written).toBe(true);
 return {id,conversationId,messages,save};
}
it('ordinary append retains seal and metadata, but no longer advertises prior completion as current',async()=>{
 const f=await fixture(); const later=[...f.messages,{id:'u2',role:'user',content:'What about tomorrow?'}];
 expect((await f.save({messages:later,custom:'kept'})).changes).toBe(1);
 const row=await outputs.findOne(f.id), body=JSON.parse(row.content);
 expect(row.server_revision).toBe(1);expect(row.channel_key).toBe('workspace:test');
 expect(body.custom).toBe('kept');expect(body.serverCompletion.revision).toBe(1);
 expect(savedTranscriptAuthority(row)).toBeNull();
 expect((await f.save({messages:f.messages})).changes).toBe(0);
 expect(JSON.parse((await outputs.findOne(f.id)).content).messages.at(-1).id).toBe('u2');
});
it('rejects stale, malformed, truncating and cross-owner writes atomically',async()=>{
 const f=await fixture(),before=await outputs.findOne(f.id);
 for(const messages of [[],[f.messages[0],{...f.messages[1],content:'Yes.'.repeat(100)}]])
   expect((await f.save({messages})).changes).toBe(0);
 expect((await outputs.createOrUpdate(f.id,user,null,null,'broken',false,'conversation',f.conversationId)).changes).toBe(0);
 expect((await f.save({messages:f.messages},f.id,'not-owner')).changes).toBe(0);
 expect((await outputs.findOne(f.id)).content).toBe(before.content);
});
it('forged duplicate seal cannot manufacture revision or win canonical reads',async()=>{
 const f=await fixture(),row=await outputs.findOne(f.id),fake=JSON.parse(row.content);
 fake.serverCompletion.revision=999999;fake.messages[1].content='Yes.'.repeat(1000);
 const duplicate=randomUUID(); await f.save(fake,duplicate);
 const stored=await outputs.findOne(duplicate);
 expect(stored.server_revision).toBe(0);expect(JSON.parse(stored.content).serverCompletion).toBeUndefined();
 expect((await outputs.findByConversationId(f.conversationId,user)).id).toBe(f.id);
 expect((await outputs.findMetaByConversationId(f.conversationId,user)).id).toBe(f.id);
 expect(savedTranscriptAuthority(stored)).toBeNull();
});
it('twelve concurrent stale saves after completion retain the completed result',async()=>{
 const f=await fixture();
 const attempts=await Promise.all(Array.from({length:12},()=>f.save({messages:[f.messages[0],{...f.messages[1],content:'Yes, stale.'}]})));
 expect(attempts.every(r=>r.changes===0)).toBe(true);
 expect(savedTranscriptAuthority(await outputs.findOne(f.id)).messages.at(-1).content).toBe('No.');
});
it('exposes exact empty completed answer with durable revision',async()=>{
 const f=await fixture('');const authority=savedTranscriptAuthority(await outputs.findOne(f.id));
 expect(authority).toMatchObject({status:'completed',revision:1,conversationId:f.conversationId,savedRowPersisted:true});
 expect(authority.messages.at(-1).content).toBe('');
});
