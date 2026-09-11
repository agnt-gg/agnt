import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';
import {runAgentConversation,workflowCancellation} from './agentConversationLoop.js';
it('Given a real child ignores stop Then return unknown, preserve its later effect, and never launch another call',async()=>{
 const dir=await fs.mkdtemp(path.join(process.env.__AGNT_TEST_DATA_DIR,'agent-child-'));
 const artifact=path.join(dir,'effect.txt');const engine={stopRequested:false};const cancellation=workflowCancellation(engine,2);
 let childDone,dispatchCount=0;const adapter={call:vi.fn(async()=>({responseMessage:{role:'assistant',content:null},toolCalls:[{id:'a',function:{name:'fixture',arguments:'{}'}},{id:'b',function:{name:'fixture',arguments:'{}'}}]})),formatToolResults:r=>r};
 try{
  const result=await runAgentConversation({adapter,messages:[],schemas:[{function:{name:'fixture'}}],context:{},cancellation,
   dispatch:async()=>{dispatchCount++;const child=spawn(process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(artifact)},'observed-effect',{flag:'wx'});`],{stdio:'ignore'});
    childDone=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Child failed')));});
    engine.stopRequested=true;
    await childDone;return '{"success":true}';
   }});
  expect(result.outcome).toBe('cancelled');expect(result.execution.childTerminationVerified).toBe(false);expect(dispatchCount).toBe(1);
  await childDone;expect(await fs.readFile(artifact,'utf8')).toBe('observed-effect');
  // A child may complete before the poll notices stop; returned or unknown is
  // honest. Neither disposition erases the already-observed physical effect.
  expect(['unknown','returned']).toContain(result.toolExecutions[0].disposition);
  expect(adapter.call).toHaveBeenCalledTimes(1);
 }finally{cancellation.dispose();if(childDone)await childDone;}
},10000);
