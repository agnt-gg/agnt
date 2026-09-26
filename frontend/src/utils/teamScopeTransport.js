// Shared with the team. Chats, chat folders and memory are deliberately absent: they stay yours
// inside a team. Mirrors backend ScopeApiPolicy.TEAM_ASSET_APIS (parity is tested).
const assetApis=new Set(['agents','workflows','custom-tools','goals','layouts','workspaces','widget-definitions','skills','skillforge','experiments','insights','schedules','wallets','ledger','routing','contracts','mutations','evolution','executions']);
export function teamScopeHeaders(url,baseUrl,scope){
 if(!scope?.teamId)return {};
 const target=new URL(url,baseUrl),base=new URL(baseUrl);
 if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))return {};
 const api=target.pathname.slice(base.pathname.replace(/\/$/,'').length+1).split('/')[0];
 if(!assetApis.has(api))return {};
 return {'X-AGNT-Team-ID':scope.teamId,...(scope.workspaceId?{'X-AGNT-Workspace-ID':scope.workspaceId}:{})};
}
/**
 * THE TEAM THIS INSTANCE BELONGS TO, as last learned from the team list.
 *
 * A team's cloud instance is only ever that team (the backend enforces it in
 * routes/TeamInstanceScope.js). Remembered per origin so the page is the team
 * from its first paint on every later load, not "Personal" until the team list
 * arrives. Never an authority: the server decides scope; this only labels.
 */
const INSTANCE_KEY='agnt.instanceTeam';
export function instanceTeam(host=window){
 try{const saved=JSON.parse(host.localStorage.getItem(INSTANCE_KEY)||'null');return saved?.origin===host.location.origin&&saved.teamId?{teamId:String(saved.teamId),name:String(saved.name||'')}:null;}catch{return null;}
}
export function rememberInstanceTeam(team,host=window){
 try{if(team?.id)host.localStorage.setItem(INSTANCE_KEY,JSON.stringify({origin:host.location.origin,teamId:team.id,name:team.name||''}));else host.localStorage.removeItem(INSTANCE_KEY);}catch{}
}
/**
 * The scope a page load runs in. The URL wins; then this instance's own team,
 * which no address can turn personal; then the scope this tab was opened with,
 * so a router navigation or reload that drops the query string cannot silently
 * turn a team page personal.
 */
export function resolveTeamScope(host=window){
 const params=new URLSearchParams(host.location.search);
 const teamId=params.get('team');
 // Where this tab came from, so "Personal" can go back there. Recorded first, and
 // for the same reason as the scope: the router drops the query string. Validated
 // where it is used (useSpaces.homeOrigin), never trusted as stored.
 try{const home=params.get('home');if(teamId&&home)host.sessionStorage.setItem('agnt.homeOrigin',home);}catch{}
 const own=instanceTeam(host);
 if(own&&(!teamId||teamId===own.teamId))return {teamId:own.teamId,workspaceId:params.get('workspace')||null};
 if(teamId){
  const scope={teamId,workspaceId:params.get('workspace')||null};
  try{host.sessionStorage.setItem('agnt.teamScope',JSON.stringify(scope));}catch{}
  return scope;
 }
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
