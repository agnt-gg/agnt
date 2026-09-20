/** Existing native APIs receive a non-login resource owner, never another member's identity. */
export const TEAM_ASSET_APIS = new Set(['agents','workflows','custom-tools','content-outputs','goals','layouts','workspaces','widget-definitions','skills','skillforge','experiments','insights','memory','groups','conversations','schedules','wallets','ledger','routing','contracts','mutations','evolution','executions']);
export function scopeApiAction(method,path){
 if(/\/(execute|execute-autonomous|run|fire-now|start|chat|chat-stream|suggestions|evaluate|review|evolve)(\/|$)/.test(path))return 'run';
 if(method==='GET'||method==='HEAD')return 'view';
 if(method==='DELETE')return 'delete';return 'edit';
}
export function requireScopeApiRole(role,action){
 if(!['owner','admin','member','viewer'].includes(role))throw Object.assign(new Error('Team role required'),{status:403});
 if(action!=='view'&&role==='viewer')throw Object.assign(new Error('Workspace is read-only'),{status:403});
}
