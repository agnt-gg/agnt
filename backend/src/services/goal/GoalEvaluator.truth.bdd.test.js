vi.mock('../../models/database/index.js',()=>({default:{get:vi.fn((_sql,_params,cb)=>cb(null,null))}}));
vi.mock('../../models/GoalEvaluationCommit.js',()=>({staleEvaluation:()=>new Error('stale'),commitGoalEvaluation:vi.fn(async input=>({evaluationId:'ev',status:input.passed?'validated':'needs_review'}))}));
import {commitGoalEvaluation} from '../../models/GoalEvaluationCommit.js';
import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('../../models/GoalModel.js',()=>({default:{findOne:vi.fn(),updateStatus:vi.fn()}}));
vi.mock('../../models/TaskModel.js',()=>({default:{findByGoalId:vi.fn()}}));
vi.mock('../../models/GoalEvaluationModel.js',()=>({default:{create:vi.fn(async()=> 'ev')}}));
vi.mock('../../models/TaskEvaluationModel.js',()=>({default:{create:vi.fn()}}));
import Evaluator from './GoalEvaluator.js';
import Goal from '../../models/GoalModel.js';
import Task from '../../models/TaskModel.js';
import Evaluation from '../../models/GoalEvaluationModel.js';
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();Goal.findOne.mockResolvedValue({id:'g',user_id:'u',lifecycle_revision:1,title:'G',success_criteria:{}});vi.spyOn(Evaluator,'generateEvaluationFeedback').mockResolvedValue('Review');vi.spyOn(Evaluator,'calculateOverallScores').mockReturnValue({overall:95});});
describe('evaluator cannot persist false validation',()=>{
 it.each(['failed','blocked-output','grading-error','valid'])('Given %s and aggregate95, Then only valid evidence can pass',async kind=>{
  Task.findByGoalId.mockResolvedValue([{id:'t',title:'T',status:kind==='failed'?'failed':'completed',output:JSON.stringify({content:kind==='blocked-output'?'## Status: Blocked — tools unavailable':'Fixture completed'})}]);
  vi.spyOn(Evaluator,'aiEvaluateTaskOutput').mockResolvedValue({score:95,criteriaMet:kind==='grading-error'?{evaluated:false,error:true}:{deliverable:true},feedback:'Fixture'});
  const result=await Evaluator.evaluateGoal('g','u','automatic','openai','test');
  expect(result.passed).toBe(kind==='valid');
  expect(commitGoalEvaluation.mock.calls[0][0].passed).toBe(kind==='valid');
  expect(result.status).toBe(kind==='valid'?'validated':'needs_review');
  expect(Goal.updateStatus).not.toHaveBeenCalled();
 });
});
