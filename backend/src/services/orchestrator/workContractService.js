import { createHash } from 'node:crypto';
import { createRequirementContract } from './requirementValidators.js';

/** Interpret scope once; only registered checks supply completion evidence. */
export class WorkContractService {
  constructor({ interpret, validators, snapshots }) { Object.assign(this, {interpret,validators,snapshots}); }
  async create(work, signal) {
    signal?.throwIfAborted();
    const proposal = await this.interpret({objective:work.objective,signal});
    const contract = createRequirementContract(work.objective, proposal.spans);
    for (let index=0;index<contract.requirements.length;index++) {
      const requirement=contract.requirements[index];
      const proposed=proposal.spans.find(span=>span.start===requirement.start && span.end===requirement.end);
      // Keep the kind explicit. Unknown and subjective requirements never gain
      // fabricated mechanical receipts merely to make the loop terminate.
      requirement.kind=proposed.kind==='mechanical' ? 'mechanical' : 'judgment';
      requirement.check=proposed.check || null;
      if(requirement.kind==='judgment') requirement.validator=null;
    }
    const immutable={...contract,revision:work.revision,sourceHash:createHash('sha256').update(work.objective).digest('hex')};
    return this.snapshots.forWork(work).write(immutable);
  }
  async verify({work,checkpoint,signal}) {
    const storage=this.snapshots.forWork(work);
    const contract=await storage.read(checkpoint.contractRef);
    const sourceHash=createHash('sha256').update(work.objective).digest('hex');
    if(contract.revision!==work.revision || contract.sourceHash!==sourceHash || contract.objective!==work.objective) throw new Error('Contract no longer matches the objective');
    // Revalidate coverage on every load. Stored/model evidence is never accepted.
    createRequirementContract(work.objective,contract.requirements);
    const requirements=await this.validators.verify({work,requirements:contract.requirements,signal});
    const receiptRef=await storage.write({revision:work.revision,requirements});
    checkpoint.validationRef=receiptRef;
    const unmet=requirements.filter(requirement=>!requirement.evidence?.passed);
    checkpoint.continuation=unmet.length ? `The work is still active. Complete and verify these original requirements without reducing their scope:\n${unmet.map(requirement=>requirement.source).join('\n')}` : undefined;
    return {requirements};
  }
}
