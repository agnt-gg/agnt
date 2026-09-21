import { createHash } from 'node:crypto';

/** Validators are registered by trusted application code, never by model output. */
export class RequirementValidators {
  constructor(entries = []) { this.validators = new Map(entries); }
  async verify({ work, requirements, signal }) {
    const results = [];
    for (const requirement of requirements) {
      signal?.throwIfAborted();
      const validator = this.validators.get(requirement.validator);
      if (!validator) { results.push({ ...requirement, evidence: undefined }); continue; }
      const receipt = await validator({ work, requirement, signal });
      signal?.throwIfAborted();
      if (!receipt || typeof receipt.passed !== 'boolean' || typeof receipt.targetVersion !== 'string' ||
          typeof receipt.reference !== 'string' || !receipt.reference) throw new Error('Validator returned an invalid receipt');
      results.push({ ...requirement, evidence: {
        passed: receipt.passed, revision: work.revision, validator: requirement.validator,
        receipt: receipt.reference, targetVersion: receipt.targetVersion,
      } });
    }
    return results;
  }
}

/** Preserve exact request spans. Extraction can subdivide, never omit source text. */
export function createRequirementContract(objective, spans) {
  if (typeof objective !== 'string' || !objective.trim()) throw new Error('Original objective required');
  if (!Array.isArray(spans) || !spans.length) throw new Error('Requirement coverage required');
  const ordered = [...spans].sort((left, right) => left.start - right.start);
  let cursor = 0;
  const requirements = ordered.map(({ start, end, validator, targetVersion }) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start !== cursor || end <= start || end > objective.length) {
      throw new Error('Requirement spans must cover the exact original instruction');
    }
    cursor = end;
    const source = objective.slice(start, end);
    return {
      id: createHash('sha256').update(`${start}:${end}:${source}`).digest('hex'),
      source, start, end, validator: typeof validator === 'string' ? validator : null,
      targetVersion: typeof targetVersion === 'string' ? targetVersion : null,
    };
  });
  if (cursor !== objective.length) throw new Error('Original instruction coverage is incomplete');
  return { objective, requirements };
}
