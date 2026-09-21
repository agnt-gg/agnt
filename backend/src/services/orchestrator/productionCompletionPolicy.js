import { createRequirementContract } from './requirementValidators.js';

/** Semantic review can veto success, never grant it. Trusted checks grant success. */
export function createProductionCompletionPolicy({ loadRequirements, validators }) {
  if (typeof loadRequirements !== 'function' || !validators) throw new Error('Trusted requirement source and validators required');
  return async ({ work, checkpoint, history, verdict, operations, signal }) => {
    const contract = await loadRequirements(work, checkpoint);
    if (!contract || contract.objective !== work.objective || contract.revision !== work.revision || !Array.isArray(contract.requirements) || !contract.requirements.length) {
      throw Object.assign(new Error('Original request has no verifiable completion contract'), {code:'verification_required'});
    }
    createRequirementContract(work.objective, contract.requirements);
    const requirements = await validators.verify({work,requirements:contract.requirements,signal});
    if (!verdict.complete) {
      requirements.push({id:'semantic-scope-review',kind:'judgment',targetVersion:verdict.targetVersion});
    }
    // A reviewer may not certify unmeasurable requirements by declaring them done.
    return { requirements, operations };
  };
}
