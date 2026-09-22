const assetApis=new Set(['agents','workflows','custom-tools','content-outputs','goals','layouts','workspaces','widget-definitions','skills','skillforge','experiments','insights','memory','groups','conversations','schedules','wallets','ledger','routing','contracts','mutations','evolution','executions']);
export function teamScopeHeaders(url,baseUrl,scope){
 if(!scope?.teamId)return {};
 const target=new URL(url,baseUrl),base=new URL(baseUrl);
 if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))return {};
 const api=target.pathname.slice(base.pathname.replace(/\/$/,'').length+1).split('/')[0];
 if(!assetApis.has(api))return {};
 return {'X-AGNT-Team-ID':scope.teamId,...(scope.workspaceId?{'X-AGNT-Workspace-ID':scope.workspaceId}:{})};
}
/**
 * The scope a page load runs in. The URL wins; otherwise the scope this tab was
 * opened with, so a router navigation or reload that drops the query string
 * cannot silently turn a team page personal.
 */
export function resolveTeamScope(host=window){
 const params=new URLSearchParams(host.location.search);
 const teamId=params.get('team');
 if(teamId){const scope={teamId,workspaceId:params.get('workspace')||null};try{host.sessionStorage.setItem('agnt.teamScope',JSON.stringify(scope));}catch{}return scope;}
 try{const stored=JSON.parse(host.sessionStorage.getItem('agnt.teamScope')||'null');return stored?.teamId?{teamId:String(stored.teamId),workspaceId:stored.workspaceId?String(stored.workspaceId):null}:null;}catch{return null;}
}
/** Context changes reload the page: no in-flight personal response can hydrate a team store. */
export function installTeamScopeTransport({baseUrl,axios,host=window}){
 const resolved=resolveTeamScope(host);if(!resolved)return null;
 const scope=Object.freeze(resolved);
 const original=host.fetch.bind(host);
 host.fetch=(input,options={})=>{const url=typeof input==='string'?input:input.url;const headers=teamScopeHeaders(url,baseUrl,scope);return original(input,{...options,headers:new Headers({...Object.fromEntries(new Headers(input?.headers||{})),...Object.fromEntries(new Headers(options.headers||{})),...headers})});};
 axios.interceptors.request.use(config=>{Object.assign(config.headers,teamScopeHeaders(config.url,baseUrl,scope));return config;});
 return scope;
}
