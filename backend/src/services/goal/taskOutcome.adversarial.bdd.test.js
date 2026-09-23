import { describe, it, expect } from 'vitest';
import { taskFailureReason, goalEvaluationPasses } from './taskOutcome.js';
const task = {id:'t',status:'completed',output:{content:'Delivered'}};
const evaluation = (entry={taskId:'t',score:90,criteriaMet:{deliverable:true}}) => ({passed:true,scores:{overall:95},taskEvaluations:[entry]});
describe('completion is earned per task, not averaged',()=>{
 it.each([null,undefined,[],[null]])('Given malformed tasks %j, Then fail closed without throwing',tasks=>expect(goalEvaluationPasses(evaluation(),tasks)).toBe(false));
 it.each([null,{taskId:'t',score:0,criteriaMet:{deliverable:false}},{taskId:'t',score:95,criteriaMet:{deliverable:false}},{taskId:'t',score:95,criteriaMet:{deliverable:'true'}},{taskId:'t',score:101,criteriaMet:{deliverable:true}}])('Given invalid or failed task grade %j, Then high aggregate cannot validate',entry=>expect(goalEvaluationPasses(evaluation(entry),[task])).toBe(false));
 it('Given historical failure wording, Then do not classify it as current blocked status',()=>expect(taskFailureReason({content:'Failed initially, then succeeded. The file is now verified.'})).toBeNull());
 it('Given explicit blocked status, Then optimistic content cannot override it',()=>expect(taskFailureReason({status:'blocked',content:'Done'})).toBeTruthy());
 it('Given failed-only execution evidence, Then optimistic prose cannot prove completion',()=>expect(taskFailureReason({content:'Done',tool_executions:[{name:'write_file',response:{success:false,error:'disk full'}}]})).toBeTruthy());
 it('Given no tools needed for a summary, Then permit text-only evaluation',()=>expect(taskFailureReason({content:'A useful summary.'})).toBeNull());
 it('Given a tool returning a string containing a historical error, Then do not infer execution failure',()=>expect(taskFailureReason({content:'Analysis',tool_executions:[{name:'read_file',response:{success:true,content:'Status: failed in old logs'}}]})).toBeNull());
});
