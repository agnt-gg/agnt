import { API_CONFIG } from '@/tt.config.js';

// Independent metadata requests: search must work before any of the library screens mount.
export const SEARCH_SOURCES = [
  ['outputs','Conversations & outputs','/content-outputs','outputs'],
  ['agents','Agents','/agents/','agents'],
  ['workflows','Workflows','/workflows/summary','workflows'],
  ['goals','Goals','/goals/summary','goals'],
  ['tools','Tools','/tools/orchestrator-tools','tools'],
  ['customTools','Custom tools','/custom-tools/','tools'],
  ['skills','Skills','/skills/','skills'],
  ['widgets','Widgets','/widget-definitions','widgets'],
  ['plugins','Plugins','/plugins/installed','plugins'],
];
export async function searchRequest(endpoint,{signal,token,fetcher=fetch}={}) {
  const response=await fetcher(API_CONFIG.BASE_URL+endpoint,{signal,credentials:'include',headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Error('HTTP '+response.status);
  return response.json();
}
export async function loadSearchSources({signal,token,onSource,onError,fetcher=fetch}) {
  if(!token){onError('Catalog','Sign in to search saved items.');return;}
  await Promise.all(SEARCH_SOURCES.map(async([key,label,path,field])=>{
    try {const body=await searchRequest(path,{signal,token,fetcher});if(!Array.isArray(body[field]))throw Error('Invalid response');if(!signal?.aborted)onSource(key,body[field]);}
    catch(error){if(error.name!=='AbortError'&&!signal?.aborted)onError(label,error.message);}
  }));
}
export function historySearchItems(results){
  return results.map(row=>{
    const meta=row.meta||{};
    let action,screen='ArtifactsScreen',id='history:'+row.kind+':'+row.id;
    if(row.kind==='output'){
      const outputId=meta.output_id||row.id;
      if(meta.content_type==='conversation'||meta.conversation_id){screen='ChatScreen';id='chat:'+outputId;action={type:'chat',id:outputId};}
      else action={type:'output',id:outputId};
    }else if(row.kind==='conversation'){screen='ChatScreen';action={type:'conversation',id:meta.conversation_id||row.id};}
    else if(row.kind==='execution'){screen='TracesScreen';action={type:'inspect',kind:'trace',id:meta.execution_id||row.id,screen};}
    else if(row.kind==='memory'){screen='MemoryScreen';action={type:'inspect',kind:'memory',id:meta.memory_id||row.id,screen};}
    else if(row.kind==='version'){screen='WorkflowsScreen';action={type:'inspect',kind:'workflow',id:meta.workflow_id,screen};}
    else {screen='ExperimentsScreen';action={type:'screen',screen,opts:{select:{kind:row.kind,id:row.id}}};}
    return {id,label:row.title||row.kind,icon:screen==='ChatScreen'?'fas fa-comments':'fas fa-file-alt',hint:row.kind,snippet:row.snippet||'',action,screen,serverMatched:true};
  });
}
