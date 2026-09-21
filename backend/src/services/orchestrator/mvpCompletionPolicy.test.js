import {it,expect} from 'vitest';
import {mvpCompletionPolicy} from './mvpCompletionPolicy.js';
import {evaluateCompletion} from './completionGate.js';
const work={revision:1};
const review={kind:'judgment',complete:true,unmet:[],targetVersion:'v1'};
it('finishes only a consistent review with settled operations',()=>{
 const result=mvpCompletionPolicy({work,verdict:review,reference:'receipt',operations:[]});
 expect(evaluateCompletion({revision:1,...result}).status).toBe('succeeded');
 expect(result.requirements[0].kind).toBe('judgment');
});
it('unfinished Teams summary keeps scheduling',()=>{
 const result=mvpCompletionPolicy({work,verdict:{...review,complete:false,unmet:['shared execution']},reference:'receipt',operations:[]});
 expect(evaluateCompletion({revision:1,...result}).status).toBe('queued');
});
it('review cannot dismiss unknown effects',()=>{
 const result=mvpCompletionPolicy({work,verdict:review,reference:'receipt',operations:[{status:'unknown'}]});
 expect(evaluateCompletion({revision:1,...result}).status).toBe('waiting_dependency');
});
