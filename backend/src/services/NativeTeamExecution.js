import {randomUUID} from 'node:crypto';
import {withTeamExecution} from './authorization/TeamExecutionContext.js';
import {TeamBrokerClient} from './authorization/TeamBrokerClient.js';
import {SAFE_TEAM_NODES} from './authorization/TeamToolPolicy.js';
import {encrypt,decrypt} from '../utils/encryption.js';
const refuse=(status,message)=>{throw Object.assign(new Error(message),{status});};
export async function initializeNativeTeamExecution(repository){
 await repository.run('CREATE TABLE IF NOT EXISTS team_native_bindings(asset_id TEXT PRIMARY KEY REFERENCES team_assets(id),team_id TEXT NOT NULL,principal_id TEXT NOT NULL,principal_secret TEXT NOT NULL,connection_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,approved_revision INTEGER NOT NULL,approved_by TEXT NOT NULL)');
 await repository.run('CREATE TABLE IF NOT EXISTS team_native_runs(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,asset_id TEXT NOT NULL,revision INTEGER NOT NULL,actor_id TEXT NOT NULL,principal_id TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT,error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
}
export class NativeTeamExecution {
 constructor(repository,cloud,nativeRepository){Object.assign(this,{repository,cloud,nativeRepository});}
 async bind(team,user,authorization,assetId,{connectionId,provider,model,workspaceId}={}){
  if(!workspaceId||!team.tenantSlug)refuse(400,'A cloud workspace is required; library definitions cannot execute');
  const workspacePath='/'+encodeURIComponent(team.id)+'/instances/'+encodeURIComponent(team.tenantSlug)+'/workspaces/'+encodeURIComponent(workspaceId);
  await this.cloud.request(authorization,workspacePath+'/access/access.manage');
  if(team.role!=='owner')refuse(403,'Only the owner can authorize shared execution');
  if(typeof model!=='string'||!model||model.length>200)refuse(400,'Model is required');
  const asset=await this.repository.asset(team.id,user,assetId);this.validate(asset);
  const connections=await this.cloud.request(authorization,'/'+team.id+'/connections');
  const connection=connections.find(c=>c.id===connectionId&&c.providerId===provider);if(!connection)refuse(404,'Approved connection not found');
  const previous=await this.repository.get('SELECT principal_id FROM team_native_bindings WHERE asset_id=? AND team_id=?',[assetId,team.id]);
  if(previous)await this.cloud.request(authorization,'/'+team.id+'/principals/'+previous.principal_id,{method:'DELETE'});
  const principal=await this.cloud.request(authorization,'/'+team.id+'/principals',{method:'POST',body:JSON.stringify({name:asset.name,connectionIds:[connectionId]})});
  await this.cloud.request(authorization,workspacePath+'/principals/'+encodeURIComponent(principal.id)+'/connections/'+encodeURIComponent(connectionId),{method:'PUT',body:'{}'});
  await this.repository.run('INSERT INTO team_native_bindings VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET principal_id=excluded.principal_id,principal_secret=excluded.principal_secret,connection_id=excluded.connection_id,provider=excluded.provider,model=excluded.model,approved_revision=excluded.approved_revision,approved_by=excluded.approved_by',[assetId,team.id,principal.id,encrypt(principal.token),connectionId,provider,model,asset.revision,user]);
  return{principalId:principal.id,approvedRevision:asset.revision};
 }
 validate(asset){
  if(!['agent','tool','workflow'].includes(asset.kind))refuse(400,'This resource is not executable');
  let definition;try{definition=JSON.parse(asset.content);}catch{refuse(400,'Executable definition must be JSON');}
  if(asset.kind==='tool'&&(definition.code||definition.config?.code||!['AI','ai',undefined].includes(definition.base)||!['AI','ai',undefined].includes(definition.config?.base)))refuse(403,'Code tools require an isolated worker');
  if(asset.kind==='agent'&&(definition.assignedTools?.length||definition.assignedWorkflows?.length||definition.assignedSkills?.length))refuse(403,'Remove unapproved tool/workflow/skill dependencies before authorizing this agent');
  if(asset.kind==='workflow'){if(!Array.isArray(definition.nodes)||definition.nodes.length>100||definition.nodes.some(node=>!SAFE_TEAM_NODES.has(node.type)||node.category==='custom'||node.code||node.base==='CODE_JS'||node.base==='CODE_PYTHON'))refuse(403,'Workflow contains operations not enabled for shared execution');}
  return definition;
 }
 async run(team,user,assetId,input,scope,authorization){
  if(!scope?.id?.startsWith('workspace:')||!team.tenantSlug)refuse(400,'A cloud workspace is required; library definitions cannot execute');
  const workspaceId=scope.id.slice('workspace:'.length);
  const accessPath='/'+encodeURIComponent(team.id)+'/instances/'+encodeURIComponent(team.tenantSlug)+'/workspaces/'+encodeURIComponent(workspaceId)+'/access/';
  const permission=await this.cloud.request(authorization,accessPath+'runs.execute');
  await this.cloud.request(authorization,accessPath+'connections.use');
  if(!['owner','admin','member'].includes(team.role))refuse(403,'Your team role does not allow execution');
  const asset=await this.repository.asset(team.id,user,assetId);const definition=this.validate(asset);
  const binding=await this.repository.get('SELECT * FROM team_native_bindings WHERE asset_id=? AND team_id=?',[assetId,team.id]);if(!binding||binding.approved_revision!==asset.revision)refuse(409,'The owner must authorize this revision and its connection before running');
  const runId=randomUUID();await this.repository.run('INSERT INTO team_native_runs(id,team_id,asset_id,revision,actor_id,principal_id,status) VALUES(?,?,?,?,?,?,?)',[runId,team.id,assetId,asset.revision,user,binding.principal_id,'running']);
  const broker=new TeamBrokerClient({teamId:team.id,tenantSlug:team.tenantSlug,workspaceId,authorization,accessRevision:permission.accessRevision,principalId:binding.principal_id,principalToken:decrypt(binding.principal_secret),connectionId:binding.connection_id});
  const context={teamId:team.id,scopeId:scope.id,actorId:user,principalId:binding.principal_id,provider:binding.provider,broker,allowedTools:new Set()};
  try{const result=await withTeamExecution(context,async()=>{
   if(asset.kind==='agent'){
    const {default:service}=await import('./ai/LlmExecutionService.js');
    return service.executeWithTools({provider:binding.provider,model:binding.model,userId:scope.resourceOwnerId,systemPrompt:definition.systemPrompt||definition.system_prompt||'',messages:[{role:'user',content:typeof input==='string'?input:JSON.stringify(input??{})}],toolSchemas:[],maxToolRounds:1,context:{agentId:assetId}});
   }
   if(asset.kind==='tool'){
    if(typeof input==='string'){try{input=JSON.parse(input);}catch{input={input};}}
    const {runCustomTool}=await import('./orchestrator/customToolRunner.js');
    return runCustomTool({...definition,base:'AI'}, {...(input||{}),instructions:definition.instructions||definition.config?.instructions||'',provider:binding.provider,model:binding.model},scope.resourceOwnerId);
   }
   const {default:WorkflowModel}=await import('../models/WorkflowModel.js');
   const {default:WorkflowEngine}=await import('../workflow/WorkflowEngine.js');
   const nativeId='team-run-'+runId;
   await WorkflowModel.createOrUpdate(nativeId,JSON.stringify({...definition,id:nativeId}),scope.resourceOwnerId,false);
    const workflow={...definition,id:nativeId,nodes:definition.nodes.map(node=>node.type==='generate-with-ai-llm'?{...node,parameters:{...node.parameters,provider:binding.provider,model:binding.model}}:node)};
    const engine=new WorkflowEngine(workflow,nativeId,scope.resourceOwnerId,true,input||{});
   return engine.processWorkflowTrigger(input||{},{waitForCompletion:true});
  });
  const failed=result?.success===false||result?.error;
  await this.repository.run('UPDATE team_native_runs SET status=?,result_json=? WHERE id=?',[failed?'failed':'completed',JSON.stringify(result),runId]);return {runId,status:failed?'failed':'completed',result};
  }catch(error){await this.repository.run('UPDATE team_native_runs SET status=?,error=? WHERE id=?',['failed',error.message,runId]);throw error;}
 }
}
