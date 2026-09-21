/** Pure policy: model prose is never evidence of objective completion. */
export function evaluateCompletion({ revision, requirements, operations = [], paused = false }) {
  if (paused) return { status: 'paused', reason: 'user_control' };
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid contract revision');
  if (!Array.isArray(requirements) || requirements.length === 0) {
    return { status: 'queued', reason: 'contract_required' };
  }
  const identifiers = requirements.map((requirement) => requirement.id);
  if (identifiers.some((id) => typeof id !== 'string' || !id) || new Set(identifiers).size !== identifiers.length) {
    throw new Error('Requirements must have unique stable identities');
  }
  if (operations.some((operation) => operation.required !== false && operation.status === 'unknown')) {
    return { status: 'waiting_dependency', reason: 'reconciliation_required' };
  }
  if (operations.some((operation) => operation.required !== false && ['queued', 'running'].includes(operation.status))) {
    return { status: 'waiting_dependency', reason: 'operations_pending' };
  }
  const unmet = requirements.filter((requirement) => {
    const evidence = requirement.evidence;
    return !evidence || evidence.passed !== true || evidence.revision !== revision ||
      typeof evidence.validator !== 'string' || !evidence.validator ||
      typeof evidence.receipt !== 'string' || !evidence.receipt ||
      typeof requirement.targetVersion !== 'string' || !requirement.targetVersion ||
      evidence.targetVersion !== requirement.targetVersion;
  });
  if (unmet.length) return { status: 'queued', reason: 'requirements_unmet', unmet: unmet.map(({ id }) => id) };
  if (operations.some((operation) => operation.required !== false && operation.status !== 'completed')) {
    return { status: 'queued', reason: 'operations_unsatisfied' };
  }
  return { status: 'succeeded', reason: 'requirements_verified' };
}
