import {it,expect,vi} from 'vitest';
import sqlite3 from 'sqlite3';
vi.mock('../AsyncToolQueue.js',()=>({default:{}}));
vi.mock('../auth/remoteTokenVerifier.js',()=>({verifyViaIssuer:async()=>({ok:true,user:{id:'owner'}})}));
vi.mock('../auth/tenantOwnership.js',()=>({isPermittedUser:()=>true}));
vi.mock('./semanticWorkReview.js',()=>({reviewWorkSemantics:vi.fn()}));
import {bootConversationWork} from './bootConversationWork.js';
import {mvpCompletionPolicy} from './mvpCompletionPolicy.js';
it('installed MVP boots, admits normal chat, continues an unfinished response, and closes once',async()=>{
 const database=new sqlite3.Database(':memory:');let runtime;let calls=0;
 const transport={start:vi.fn(),send:vi.fn(),finish:vi.fn()};
 try{
  runtime=await bootConversationWork({database,enableScheduling:true,verificationPolicy:mvpCompletionPolicy,
   executeSegment:async input=>{
    calls++;
    return {status:'response_ended',messages:input.preparedHistory||[{role:'system',content:'frozen'},{role:'user',content:'Finish Teams'}],finalContent:calls===1?'Four remain':'Finished',runtimeSelection:{provider:'fixture',model:'fixture'}};
   },
   review:async()=>({kind:'judgment',complete:calls===2,unmet:calls===2?[]:['four remaining requirements'],targetVersion:'v1'}),
  });
  const admitted=await runtime.admit({userId:'owner',authToken:'Bearer fixture',body:{conversationId:'chat',message:'Finish Teams'},chatType:'orchestrator',transport});
  await vi.waitFor(async()=>expect((await runtime.store.find(admitted.workId,'owner')).status).toBe('succeeded'),{timeout:6000});
  await vi.waitFor(()=>expect(transport.finish).toHaveBeenCalledOnce(),{timeout:3000});
  expect(calls).toBe(2);
 }finally{await runtime?.close();await new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));}
},15000);
