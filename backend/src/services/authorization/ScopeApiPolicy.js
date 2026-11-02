/** Existing native APIs receive a non-login resource owner, never another member's identity. */
export const TEAM_ASSET_APIS = new Set(['agents','workflows','custom-tools','goals','layouts','workspaces','widget-definitions','skills','skillforge','experiments','insights','schedules','wallets','ledger','routing','contracts','mutations','evolution','executions']);
/**
 * Private by default, even inside a team: your chats, chat folders and memory stay YOURS on the
 * team's instance. They are never pooled under the team's shared owner, where every teammate
 * would read them. Sharing a thread is a deliberate act, not a side effect of being in a team.
 * Mirrored in frontend/src/utils/teamScopeTransport.js (parity is tested).
 */
export const PRIVATE_IN_TEAM_APIS = new Set(['content-outputs','conversations','memory','groups','checkpoints']);
export function scopeApiAction(method,path){
 if(/\/(execute|execute-autonomous|run|fire-now|start|chat|chat-stream|suggestions|evaluate|review|evolve)(\/|$)/.test(path))return 'run';
 if(method==='GET'||method==='HEAD')return 'view';
 if(method==='DELETE')return 'delete';return 'edit';
}
/**
 * A team member asked to run something that has not been published for the team.
 *
 * Members run a teamspace item through its PUBLISHED version with a team connection, never the
 * instance owner's own connections (tenantOwnership.credentialUserId), so the item must be published
 * first, and only owners and admins publish (NativeTeamExecution.bind). The message says who can do
 * that; `canPublish` lets a client offer the button instead of the text.
 */
export function publishRequiredError(role){
 const canPublish=['owner','admin'].includes(role);
 return Object.assign(new Error(canPublish
  ?'Publish this for the team first (Team → Projects → Publish), then run it there. Publishing approves this version and the team connection it uses.'
  :'This has not been published for the team yet. Ask a team owner or admin to publish it in Team → Projects, then run it there.'),
  {status:409,code:'publish_required',canPublish});
}
export function requireScopeApiRole(role,action){
 if(!['owner','admin','member','viewer'].includes(role))throw Object.assign(new Error('Team role required'),{status:403});
 if(action!=='view'&&role==='viewer')throw Object.assign(new Error('Workspace is read-only'),{status:403});
}
