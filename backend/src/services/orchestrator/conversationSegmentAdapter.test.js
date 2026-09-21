import {it,expect,vi} from 'vitest';
import {createConversationSegmentAdapter} from './conversationSegmentAdapter.js';
it('resumes the real segment interface under current authority with exact history',async()=>{
 const messages=[{role:'system',content:'frozen'},{role:'user',content:'finish'},{role:'assistant',content:'remaining'}];
 const snapshot={ownerId:'owner',conversationId:'chat',body:{conversationId:'chat',messages:[]},chatType:'orchestrator'};
 const executeSegment=vi.fn(async request=>{
  expect(request.authToken).toBe('current');
  expect(request.preparedHistory.slice(0,3)).toEqual(messages);
  return {status:'response_ended',messages:request.preparedHistory,executionId:'execution'};
 });
 const run=vi.fn(callback=>callback());
 const adapter=createConversationSegmentAdapter({executeSegment,snapshots:{read:async id=>id==='input'?snapshot:{conversationId:'chat',messages},write:async()=> 'next-history'},credentials:{resolve:async()=>({run,authToken:'current'})},transports:{forWork:async()=>({})},dispatchers:{forWork:async()=>vi.fn()}});
 const result=await adapter({work:{id:'work',owner_id:'owner',conversation_id:'chat'},checkpoint:{snapshotRef:'input',historyRef:'history',continuation:'Continue remaining requirements.'},assertOwnership:async()=>{}});
 expect(run).toHaveBeenCalledOnce();expect(executeSegment).toHaveBeenCalledOnce();
 expect(result.checkpoint.historyRef).toBe('next-history');
});
it('missing execution authority never falls back to personal credentials',async()=>{
 const executeSegment=vi.fn();
 const adapter=createConversationSegmentAdapter({executeSegment,credentials:{resolve:async()=>null}});
 await expect(adapter({work:{},checkpoint:{},assertOwnership:async()=>{}})).rejects.toMatchObject({code:'waiting_auth'});
 expect(executeSegment).not.toHaveBeenCalled();
});
