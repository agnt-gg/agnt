import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('../../models/GoalModel.js',()=>({default:{findOne:vi.fn(),updateStatus:vi.fn()}}));
vi.mock('../../models/TaskModel.js',()=>({default:{findByGoalId:vi.fn()}}));
vi.mock('../../models/GoalEvaluationModel.js',()=>({default:{create:vi.fn(async()=> 'ev')}}));
vi.mock('../../models/TaskEvaluationModel.js',()=>({default:{create:vi.fn()}}));
import Evaluator from './GoalEvaluator.js';
import Goal from '../../models/GoalModel.js';
import Task from '../../models/TaskModel.js';
import Evaluation from '../../models/GoalEvaluationModel.js';
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();Goal.findOne.mockResolvedValue({id:'g',title:'G',success_criteria:{}});vi.spyOn(Evaluator,'generateEvaluationFeedback').mockResolvedValue('Review');vi.spyOn(Evaluator,'calculateOverallScores').mockReturnValue({overall:95});});
describe('evaluator cannot persist false validation',()=>{
 it.each(['failed','blocked-output','grading-error','valid'])('Given %s and aggregate95, Then only valid evidence can pass',async kind=>{
  Task.findByGoalId.mockResolvedValue([{id:'t',title:'T',status:kind==='failed'?'failed':'completed',output:JSON.stringify({content:kind==='blocked-output'?'## Status: Blocked — tools unavailable':'Fixture completed'})}]);
  vi.spyOn(Evaluator,'aiEvaluateTaskOutput').mockResolvedValue({score:95,criteriaMet:kind==='grading-error'?{evaluated:false,error:true}:{deliverable:true},feedback:'Fixture'});
  const result=await Evaluator.evaluateGoal('g','u','automatic','openai','test');
  expect(result.passed).toBe(kind==='valid');
  expect(Evaluation.create.mock.calls[0][3]).toBe(kind==='valid');
  expect(Goal.updateStatus).toHaveBeenCalledWith('g',kind==='valid'?'validated':'needs_review');
 });
});
