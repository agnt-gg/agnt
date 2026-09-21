import {it,expect} from 'vitest';
import {RequirementValidators,createRequirementContract} from './requirementValidators.js';
it('preserves every original character',()=>{
 const contract=createRequirementContract('Fix and test',[{start:0,end:4},{start:4,end:12}]);
 expect(contract.requirements.map(item=>item.source).join('')).toBe('Fix and test');
});
it('refuses omitted scope',()=>expect(()=>createRequirementContract('Fix and test',[{start:0,end:3}])).toThrow());
it('refuses overlapping scope',()=>expect(()=>createRequirementContract('abc',[{start:0,end:2},{start:1,end:3}])).toThrow());
it('does not trust model supplied evidence or unknown validators',async()=>{
 const verifier=new RequirementValidators();
 const result=await verifier.verify({work:{revision:1},requirements:[{id:'one',validator:'made-up',evidence:{passed:true}}]});
 expect(result[0].evidence).toBeUndefined();
});
it('uses a registered validator receipt, not proposed evidence',async()=>{
 const verifier=new RequirementValidators([['fixed-check',async()=>({passed:false,targetVersion:'v1',reference:'raw-result'})]]);
 const result=await verifier.verify({work:{revision:2},requirements:[{id:'one',validator:'fixed-check',evidence:{passed:true}}]});
 expect(result[0].evidence).toMatchObject({passed:false,revision:2,receipt:'raw-result'});
});
it('validator failure is not success',async()=>{
 const verifier=new RequirementValidators([['throws',async()=>{throw Error('Unavailable');}]]);
 await expect(verifier.verify({work:{revision:1},requirements:[{validator:'throws'}]})).rejects.toThrow('Unavailable');
});
