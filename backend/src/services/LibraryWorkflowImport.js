import {importWorkflow} from './WorkflowImportService.js';
const forbidden=/^(password|passwd|secret|token|access_token|refresh_token|api_?key|authorization|credentials?|connection_?id|principal_?secret)$/i;
function inspect(value,location='payload',depth=0){
 if(depth>40)throw new Error('Package exceeds nesting limit');
 if(Array.isArray(value)){value.forEach((entry,index)=>inspect(entry,`${location}[${index}]`,depth+1));return;}
 if(!value||typeof value!=='object')return;
 for(const [key,entry]of Object.entries(value)){
  if(forbidden.test(key)&&entry!==null&&entry!==undefined&&entry!=='')throw new Error('Package contains a credential or connection binding at '+location+'.'+key);
  inspect(entry,location+'.'+key,depth+1);
 }
}
/** Imports definitions only. Does not call an engine, scheduler or connection API.
 * Free-form prompts/code can contain pasted secrets; the publish review remains mandatory.
 */
export async function importLibraryWorkflow(envelope,actorId){
 if(!actorId)throw new Error('Import requires an authenticated actor');
 if(envelope?._format!=='agnt-workflow'||envelope?._version!=='1.0'||!envelope.payload||typeof envelope.payload!=='object')throw new Error('Unsupported workflow package');
 inspect(envelope.payload);
 const source=envelope.payload;
 const payload={name:source.name,description:source.description,category:source.category,nodes:structuredClone(source.nodes||[]),edges:structuredClone(source.edges||[]),isShareable:false,customTools:[]};
 if(!Array.isArray(payload.nodes)||!Array.isArray(payload.edges))throw new Error('Invalid workflow graph');
 // Imported timers remain definitions, but cannot fire on a later accidental activation.
 for(const node of payload.nodes){if(node.type==='trigger-timer')node.parameters={...node.parameters,fireOnStart:'No'};}
 return importWorkflow(payload,actorId);
}
