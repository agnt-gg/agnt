import { decrypt } from '../../utils/encryption.js';
import { withTeamExecution } from '../authorization/TeamExecutionContext.js';
import { TeamBrokerClient } from '../authorization/TeamBrokerClient.js';

/** Restore an already-approved native binding. Never create or expand a grant. */
export function createTeamWorkResolver({ repository, authorizeActor, validateDefinition, brokerFactory = options => new TeamBrokerClient(options) }) {
  return async (work, binding) => {
    const actor = await authorizeActor(work, binding);
    if (!actor || actor.actorId !== binding.actorId || actor.teamId !== binding.teamId || !['owner','admin','member'].includes(actor.role)) {
      throw Object.assign(new Error('Team membership no longer permits execution'), {code:'waiting_permission'});
    }
    const row=await repository.get(`SELECT * FROM team_native_bindings WHERE asset_id=? AND team_id=?`,[binding.assetId,binding.teamId]);
    const asset=await repository.asset(binding.teamId,binding.actorId,binding.assetId);
    if(!row || row.principal_id!==binding.principalId || row.approved_revision!==asset.revision || row.approved_revision!==binding.approvedRevision) {
      throw Object.assign(new Error('Approved resource revision changed'),{code:'waiting_permission'});
    }
    await validateDefinition(asset);
    const broker=brokerFactory({principalId:row.principal_id,principalToken:decrypt(row.principal_secret),connectionId:row.connection_id});
    // Remote broker rechecks principal and connection revocation for each call.
    const context={teamId:binding.teamId,scopeId:binding.scopeId,actorId:binding.actorId,principalId:row.principal_id,provider:row.provider,broker,allowedTools:new Set()};
    return {run:execute=>withTeamExecution(context,execute),authToken:undefined};
  };
}
