import {describe,it,expect,vi,afterEach} from 'vitest';
const probe=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('../../models/database/index.js',()=>({default:{}}));
vi.mock('../../models/LlmCallModel.js',()=>({default:{findByOriginSince:async()=>[]}}));
vi.mock('../goal/AgentTaskMatcher.js',()=>({default:{selectAgentForTask:async()=>({name:'fixture'})}}));
vi.mock('../goal/TaskOrchestrator.js',()=>({default:{prepareTaskMessage:()=> 'fixture',executeTaskViaAgentChat:(...args)=>probe.execute(...args)}}));
import {runTask,getWorkerStats} from './ClusterWorker.js';
const lease={goalId:'g',userId:'u',runId:'r',generation:1,attemptId:'a'};
const assignment={recoveryProtocol:2,runLease:lease,task:{id:'t',goalId:'g',title:'Fixture'},goal:{id:'g'}};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()});
describe('Given remote recovery work has an immutable attempt identity',()=>{
 it('When completion is rejected, Then it is not counted as completed and the task is never replayed',async()=>{
  probe.execute.mockResolvedValue({content:'fixture'});const calls=[];
  vi.stubGlobal('fetch',vi.fn(async(url,o)=>{calls.push(JSON.parse(o.body));return {ok:false,status:409}}));
  const before=getWorkerStats().completed;await runTask(assignment,'u');
  expect(getWorkerStats().completed).toBe(before);expect(probe.execute).toHaveBeenCalledTimes(1);
  expect(calls.every(c=>c.recoveryProtocol===2&&c.runLease.attemptId==='a')).toBe(true);
 });
 it('When primary refuses renewal, Then the local executor receives abort and is not retried',async()=>{
  vi.useFakeTimers();let signal;
  probe.execute.mockImplementation((_a,_m,_u,_p,_model,s)=>new Promise((resolve,reject)=>{signal=s;s.addEventListener('abort',()=>reject(s.reason),{once:true})}));
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:409})));
  const work=runTask(assignment,'u');await vi.advanceTimersByTimeAsync(10001);await work;
  expect(signal.aborted).toBe(true);expect(probe.execute).toHaveBeenCalledTimes(1);
 });
});
