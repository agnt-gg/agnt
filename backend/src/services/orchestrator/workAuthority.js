import { withTeamExecution } from '../authorization/TeamExecutionContext.js';

/** Current authority is resolved by trusted application services, not stored model context. */
export class WorkAuthority {
  constructor({ loadBinding, resolvePersonal, resolveTeam, authorize }) {
    Object.assign(this, { loadBinding, resolvePersonal, resolveTeam, authorize });
  }
  async resolve(work) {
    const binding = await this.loadBinding(work);
    if (!binding || binding.ownerId !== work.owner_id) throw Object.assign(new Error('Work binding unavailable'), {code:'waiting_permission'});
    await this.authorize(work, binding);
    if (binding.kind === 'team') {
      const current = await this.resolveTeam(work, binding);
      if (!current || current.teamId !== binding.teamId || current.principalId !== binding.principalId || current.actorId !== work.owner_id) {
        throw Object.assign(new Error('Team execution grant unavailable'), {code:'waiting_permission'});
      }
      return { run: execute => withTeamExecution(current, execute), authToken: undefined };
    }
    if (binding.kind !== 'personal') throw Object.assign(new Error('Unknown work authority'), {code:'waiting_permission'});
    const current = await this.resolvePersonal(work, binding);
    if (!current?.authToken || current.ownerId !== work.owner_id) throw Object.assign(new Error('Current credential required'), {code:'waiting_auth'});
    return { authToken: current.authToken, run: execute => execute() };
  }
}
