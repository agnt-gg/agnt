/** Existing native APIs receive a non-login resource owner, never another member's identity. */
export const TEAM_ASSET_APIS = new Set(['agents','workflows','custom-tools','goals','layouts','workspaces','widget-definitions','skills','skillforge','experiments','insights','schedules','wallets','ledger','routing','contracts','mutations','evolution','executions']);
/**
 * Private by default, even inside a team: your chats, chat folders and memory stay YOURS on the
 * team's instance. They are never pooled under the team's shared owner, where every teammate
 * would read them. Sharing a thread is a deliberate act, not a side effect of being in a team.
 * Mirrored in frontend/src/utils/teamScopeTransport.js (parity is tested).
 */
export const PRIVATE_IN_TEAM_APIS = new Set(['content-outputs','conversations','memory','groups']);
export function scopeApiAction(method,path){
 if(/\/(execute|execute-autonomous|run|fire-now|start|chat|chat-stream|suggestions|evaluate|review|evolve)(\/|$)/.test(path))return 'run';
 if(method==='GET'||method==='HEAD')return 'view';
 if(method==='DELETE')return 'delete';return 'edit';
}
export function requireScopeApiRole(role,action){
 if(!['owner','admin','member','viewer'].includes(role))throw Object.assign(new Error('Team role required'),{status:403});
 if(action!=='view'&&role==='viewer')throw Object.assign(new Error('Workspace is read-only'),{status:403});
}
