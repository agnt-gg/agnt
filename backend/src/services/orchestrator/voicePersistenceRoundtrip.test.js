import { beforeAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hydrateMessage } from '../../../../frontend/src/services/chatStreamReducer.js';
import { serializeTranscript } from './transcriptProjection.js';
import { attachCurrentVoiceMetadata, cloneLedgerMessage } from '../voice/currentTurnMetadata.js';
vi.mock('../../utils/realtimeSync.js',()=>({broadcastToUser:vi.fn(),RealtimeEvents:{CONTENT_UPDATED:'updated'}}));
let db, outputs, logs, persist;
const user='TEST-voice-batch8-user', other='TEST-voice-batch8-other';
const metadata=[{type:'voice-input',kind:'correlated-delegation',utteranceId:'test-utterance',observedTranscript:'Move the file',delegatedInterpretation:'Move the file only after making a backup.'}];
beforeAll(async()=>{
 expect(process.env.AGNT_TEST_USE_REAL_DATA).not.toBe('1');
 expect(process.env.USER_DATA_PATH).toContain('agnt-vitest-');
 const mod=await import('../../models/database/index.js'); db=mod.default; await mod.dbReady;
 outputs=(await import('../../models/ContentOutputModel.js')).default;
 logs=(await import('../../models/ConversationLogModel.js')).default;
 persist=(await import('./persistTurnTranscript.js')).persistTurnTranscript;
 for(const u of [user,other]) await new Promise((resolve,reject)=>db.run('INSERT INTO users (id,email) VALUES (?,?)',[u,u+'@test.invalid'],e=>e?reject(e):resolve()));
 console.log('ISOLATED_DATABASE',process.env.USER_DATA_PATH);
});
it('actual SQLite saved-row projection preserves qualified voice metadata through frontend hydration',async()=>{
 const conversationId='TEST-voice-'+randomUUID(), outputId=randomUUID();
 const current=attachCurrentVoiceMetadata([{role:'user',content:metadata[0].delegatedInterpretation}],JSON.stringify(metadata)).map(cloneLedgerMessage);
 const messages=[{id:'u',...current[0]},{id:'a',role:'assistant',content:'No, do not move it without a backup.'}];
 await outputs.createOrUpdate(outputId,user,null,null,serializeTranscript({conversationId,messages}),false,'conversation',conversationId,'TEST voice batch8 isolated');
 await logs.create({conversationId,userId:user,initial_prompt:messages[0].content,full_history:JSON.stringify(messages),final_response:messages[1].content,tool_calls:'[]',errors:null});
 const log=await logs.getByConversationId(conversationId,user);
 expect(log.messages[0].metadata).toEqual(metadata);
 const result=await persist({conversationId,userId:user,providerMessages:log.messages});
 expect(result.written).toBe(true);
 const row=await outputs.findByConversationId(conversationId,user);
 const hydrated=JSON.parse(row.content).messages.map(hydrateMessage);
 expect(hydrated[0].metadata).toEqual(metadata);
 expect(hydrated[0].content).toBe(messages[0].content);
 expect(hydrated[1].content).toBe(messages[1].content);
 expect(row.is_shareable).toBe(0);
 expect(await outputs.findByConversationId(conversationId,other)).toBeFalsy();
 expect(await logs.getByConversationId(conversationId,other)).toBeNull();
 console.log('ISOLATED_ROUNDTRIP',JSON.stringify({conversationId,outputId,metadataPreserved:true}));
});


async function correctionFixture(final = 'No.') {
 const conversationId='TEST-voice-correction-'+randomUUID();
 const messages=[{role:'user',content:'Should I move it?',metadata}, {role:'assistant',content:'Yes, move it now. You should definitely proceed with the move without any hesitation.'}];
 await outputs.createOrUpdate(randomUUID(),user,null,null,serializeTranscript({conversationId,messages}),false,'conversation',conversationId,'User renamed this');
 const {createTurnReceipt}=await import('./turnReceipt.js');
 const receipt=createTurnReceipt({userId:user,conversationId});
 receipt.observe('agent_execution_started',{executionId:randomUUID()});
 receipt.observe('assistant_message',{id:'assistant-final'});
 receipt.observe('final_content',{assistantMessageId:'assistant-final',content:final});
 const completionReceipt=receipt.finish({executionPersisted:true,transcriptPersisted:true,provider:'selected-provider',model:'selected-model'});
 return {conversationId,messages,completionReceipt};
}
for (const final of ['No, do not do it.', '']) {
 it('actual SQLite replaces a longer draft with completed authoritative final '+JSON.stringify(final),async()=>{
  const {conversationId,messages,completionReceipt}=await correctionFixture(final);
  const providerMessages=[messages[0],{id:'assistant-final',role:'assistant',content:final}];
  const result=await persist({conversationId,userId:user,providerMessages,completionReceipt});
  expect(result.written).toBe(true);
  const row=await outputs.findByConversationId(conversationId,user);
  const restored=JSON.parse(row.content).messages.map(hydrateMessage);
  expect(restored.filter(m=>m.role==='assistant').map(m=>m.content).join('')).toBe(final);
  expect(restored[0].metadata).toEqual(metadata);
  expect(row.title).toBe('User renamed this');
  expect(row.workflow_id).toBeNull();
  expect(row.tool_id).toBeNull();
  expect(row.is_shareable).toBe(0);
 });
}
for (const patch of [{receiptVersion:0},{binding:'client-reported'},{accepted:false},{success:false},{requestId:''},{assistantMessageId:''},{status:'unknown'},{status:'failed'},{status:'cancelled'},{completed:false},{executionPersisted:false},{transcriptPersisted:false},{executionId:''},{executionId:'x'.repeat(257)},{userId:other},{conversationId:'wrong'}]) {
 it('does not authorize shortening with incomplete/mismatched receipt '+JSON.stringify(patch),async()=>{
  const {conversationId,messages,completionReceipt}=await correctionFixture();
  const result=await persist({conversationId,userId:user,providerMessages:[messages[0],{id:'assistant-final',role:'assistant',content:'No.'}],completionReceipt:{...completionReceipt,...patch}});
  expect(result.written).toBe(false);
  const row=await outputs.findByConversationId(conversationId,user);
  expect(JSON.parse(row.content).messages[1].content).toBe(messages[1].content);
 });
}
it('journal appendTurn cannot use a completion receipt to bypass its conservative merge',async()=>{
 const {conversationId,messages,completionReceipt}=await correctionFixture();
 const {writeTranscript}=await import('./persistTurnTranscript.js');
 const result=await writeTranscript({conversationId,userId:user,messages:[messages[0],{role:'assistant',content:'No.'}],mode:'appendTurn',completionReceipt});
 expect(result).toMatchObject({written:false,reason:'saved_copy_is_richer'});
});
it('completed correction cannot drop a newer user turn, even with a much larger answer',async()=>{
 const {conversationId,messages,completionReceipt}=await correctionFixture('Old run '.repeat(1000));
 const row=await outputs.findByConversationId(conversationId,user);
 await outputs.createOrUpdate(row.id,user,null,null,serializeTranscript({conversationId,messages:[...messages,{role:'user',content:'New request after that run'}]}),false,'conversation',conversationId,row.title);
 const result=await persist({conversationId,userId:user,providerMessages:[messages[0],{id:'assistant-final',role:'assistant',content:'Old run '.repeat(1000)}],completionReceipt});
 expect(result).toMatchObject({written:false,reason:'would_drop_user_turns'});
 expect(JSON.parse((await outputs.findByConversationId(conversationId,user)).content).messages.at(-1).content).toBe('New request after that run');
});
