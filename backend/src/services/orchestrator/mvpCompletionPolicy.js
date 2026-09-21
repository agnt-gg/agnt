/** MVP: scheduler-enforced continuation with explicitly judgment-based acceptance. */
export function mvpCompletionPolicy({work,verdict,reference,operations}) {
  if (verdict.kind !== 'judgment' || typeof verdict.complete !== 'boolean' ||
      !Array.isArray(verdict.unmet) || !verdict.targetVersion || !reference) throw new Error('Invalid review receipt');
  const passed = verdict.complete && verdict.unmet.length === 0;
  return {
    requirements:[{id:'original-request',kind:'judgment',targetVersion:verdict.targetVersion,
      evidence:{passed,revision:work.revision,validator:'semantic-review.judgment',receipt:reference,targetVersion:verdict.targetVersion}}],
    // A failed attempt may be repaired later; an unknown or running effect cannot
    // be dismissed by the reviewer. Keep all receipts for audit.
    operations:operations.map(operation=>({...operation,required:operation.status !== 'failed'})),
  };
}
