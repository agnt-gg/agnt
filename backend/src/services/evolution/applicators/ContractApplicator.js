import InsightModel from '../../../models/InsightModel.js';
import ContractModel from '../../../models/ContractModel.js';

/**
 * ContractApplicator — installs a `contract_proposal` insight as an active
 * contract (PRD-091 Layer 5). Idempotent: re-applying just reinforces the
 * existing contract.
 *
 * Insight shape contract:
 *   - category: 'contract_proposal'
 *   - target_type: 'tool' | 'workflow' | 'agent' | 'skill'
 *   - target_id: the bound identifier (e.g., tool name)
 *   - evidence.predicate: the predicate JSON to install
 */
class ContractApplicator {
  static async apply(insightId, userId) {
    const insight = await InsightModel.findOne(insightId);
    if (!insight) throw new Error(`Insight not found: ${insightId}`);
    if (insight.category !== 'contract_proposal') {
      throw new Error(`ContractApplicator expects category=contract_proposal, got: ${insight.category}`);
    }
    const predicate = insight.evidence && insight.evidence.predicate
      ? insight.evidence.predicate
      : null;
    if (!predicate || typeof predicate !== 'object') {
      throw new Error('Contract proposal insight is missing evidence.predicate');
    }

    const existing = await ContractModel.findActiveByTarget(insight.target_type, insight.target_id);
    const name = insight.title.replace(/^Contract:\s*/, '') || `${insight.target_id}.${predicate.field || 'predicate'}`;
    const dup = existing.find((c) => c.name === name);
    let contractId = dup ? dup.id : null;
    if (dup) {
      await ContractModel.incrementEvidence(dup.id);
    } else {
      contractId = await ContractModel.create({
        userId,
        targetType: insight.target_type,
        targetId: insight.target_id,
        name,
        predicate,
        source: 'mined',
        confidence: insight.confidence || 0.5,
      });
    }

    await InsightModel.updateStatus(insightId, 'applied', {
      autoApplied: true,
      type: 'contract_installed',
      contractId,
      predicate,
    });
    return { applied: true, type: 'contract_installed', contractId, reused: !!dup };
  }
}

export default ContractApplicator;
