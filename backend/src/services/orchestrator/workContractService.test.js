import {it,expect} from 'vitest';
import {WorkContractService} from './workContractService.js';
import {RequirementValidators} from './requirementValidators.js';
function storage(){const saved=new Map();return {forWork:()=>({write:async value=>{const id=String(saved.size);saved.set(id,structuredClone(value));return id;},read:async id=>structuredClone(saved.get(id))})};}
it('preserves original coverage and generates continuation from unmet original requirements',async()=>{
 const snapshots=storage();const work={objective:'Build. Test.',revision:1};
 const service=new WorkContractService({snapshots,validators:new RequirementValidators([['fixed',async()=>({passed:false,targetVersion:'v1',reference:'result'})]]),interpret:async()=>({spans:[{start:0,end:7,kind:'mechanical',validator:'fixed',targetVersion:'v1'},{start:7,end:12,kind:'judgment'}]})});
 const contractRef=await service.create(work);const checkpoint={contractRef};
 const result=await service.verify({work,checkpoint});
 expect(result.requirements.map(item=>item.source).join('')).toBe(work.objective);
 expect(result.requirements[1].evidence).toBeUndefined();
 expect(checkpoint.continuation).toContain('Build.');expect(checkpoint.continuation).toContain('Test.');
 expect(checkpoint.validationRef).toBeDefined();
});
it('rejects missing coverage rather than silently accepting a narrower objective',async()=>{
 const service=new WorkContractService({snapshots:storage(),interpret:async()=>({spans:[{start:0,end:3}]})});
 await expect(service.create({objective:'Build and test',revision:1})).rejects.toThrow('incomplete');
});
it('an old contract cannot validate a revised objective',async()=>{
 const service=new WorkContractService({snapshots:storage(),interpret:async()=>({spans:[{start:0,end:4,kind:'judgment'}]})});
 const work={objective:'Test',revision:1};const contractRef=await service.create(work);
 await expect(service.verify({work:{...work,revision:2},checkpoint:{contractRef}})).rejects.toThrow('no longer matches');
});
