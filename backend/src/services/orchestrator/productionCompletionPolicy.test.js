import {it,expect} from 'vitest';
import {createProductionCompletionPolicy} from './productionCompletionPolicy.js';
import {evaluateCompletion} from './completionGate.js';
it('reviewer saying complete cannot replace missing trusted checks',async()=>{
 const policy=createProductionCompletionPolicy({loadRequirements:async()=>null,validators:{verify:async()=>[]}});
 await expect(policy({work:{objective:'Finish',revision:1},checkpoint:{},verdict:{complete:true}})).rejects.toMatchObject({code:'verification_required'});
});
it('semantic review can veto but cannot overwrite a failed mechanical check',async()=>{
 const work={objective:'Finish',revision:1};
 const requirement={id:'check',start:0,end:6,targetVersion:'v1',evidence:{passed:false,revision:1,validator:'fixed',receipt:'receipt',targetVersion:'v1'}};
 const policy=createProductionCompletionPolicy({loadRequirements:async()=>({...work,requirements:[requirement]}),validators:{verify:async()=>[requirement]}});
 const result=await policy({work,checkpoint:{},verdict:{complete:true},operations:[]});
 expect(evaluateCompletion({revision:1,...result}).status).toBe('queued');
});
