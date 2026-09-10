import {describe,it,expect} from 'vitest';
import {goalEvaluationPasses} from './taskOutcome.js';
const tasks=[{id:'t',status:'completed',output:{content:'Fixture result'}}];
describe('complete evaluation coverage',()=>{
 it.each([undefined,[],[{taskId:'other',score:95,criteriaMet:{ok:true}}],[{taskId:'t',score:95}],[{taskId:'t',score:95,criteriaMet:{ok:true}},{taskId:'t',score:95,criteriaMet:{ok:true}}]])('Given incomplete or duplicated evaluations %j, Then no validation',taskEvaluations=>expect(goalEvaluationPasses({passed:true,scores:{overall:95},taskEvaluations},tasks)).toBe(false));
 it('Given matching successful evaluation, Then it can pass',()=>expect(goalEvaluationPasses({passed:true,scores:{overall:95},taskEvaluations:[{taskId:'t',score:95,criteriaMet:{ok:true}}]},tasks)).toBe(true));
});
