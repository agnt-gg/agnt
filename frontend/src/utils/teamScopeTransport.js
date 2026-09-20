const assetApis=new Set(['agents','workflows','custom-tools','content-outputs','goals','layouts','workspaces','widget-definitions','skills','skillforge','experiments','insights','memory','groups','conversations','schedules','wallets','ledger','routing','contracts','mutations','evolution','executions']);
export function teamScopeHeaders(url,baseUrl,scope){
 if(!scope?.teamId)return {};
 const target=new URL(url,baseUrl),base=new URL(baseUrl);
 if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))return {};
 const api=target.pathname.slice(base.pathname.replace(/\/$/,'').length+1).split('/')[0];
 if(!assetApis.has(api))return {};
 return {'X-AGNT-Team-ID':scope.teamId,...(scope.workspaceId?{'X-AGNT-Workspace-ID':scope.workspaceId}:{})};
}
/** Context changes reload the page: no in-flight personal response can hydrate a team store. */
export function installTeamScopeTransport({baseUrl,axios,host=window}){
 const params=new URLSearchParams(host.location.search);
 const teamId=params.get('team'),workspaceId=params.get('workspace');if(!teamId)return;
 const scope=Object.freeze({teamId,workspaceId});
 const original=host.fetch.bind(host);
 host.fetch=(input,options={})=>{const url=typeof input==='string'?input:input.url;const headers=teamScopeHeaders(url,baseUrl,scope);return original(input,{...options,headers:new Headers({...Object.fromEntries(new Headers(input?.headers||{})),...Object.fromEntries(new Headers(options.headers||{})),...headers})});};
 axios.interceptors.request.use(config=>{Object.assign(config.headers,teamScopeHeaders(config.url,baseUrl,scope));return config;});
}
