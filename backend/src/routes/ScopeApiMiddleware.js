import {assetApiReferences} from '../services/authorization/AssetApiReferences.js';
import {ResourceAuthorization} from '../services/authorization/ResourceAuthorization.js';
import db,{dbReady} from '../models/database/index.js';
import {databaseRepository,ensureSharedScope} from '../services/authorization/ScopeRepository.js';
import {CloudTeamClient} from '../services/CloudTeamClient.js';
import {TEAM_ASSET_APIS,PRIVATE_IN_TEAM_APIS,scopeApiAction,requireScopeApiRole} from '../services/authorization/ScopeApiPolicy.js';
import {policyRefusalMessage} from '../services/authorization/teamPolicy.js';
import {withScopeRequest} from '../services/authorization/ScopeRequestContext.js';
import {recordRunActor} from '../services/authorization/ResourceCreators.js';
import {teamAssetOwnerFor} from '../services/authorization/teamAssetOwner.js';
import {adoptPersonalWidgets} from '../services/authorization/adoptPersonalWidgets.js';
const repository=databaseRepository(db),cloud=new CloudTeamClient();
// Teamspace items that can run without a request (a trigger, a restart, a schedule running a goal): they run as
// the last person who changed or ran them (runActor.js; read by ProcessWorker and TaskOrchestrator).
const RUN_AS_LAST_TOUCH=new Set(['workflows','goals']);
export function createScopeApiMiddleware(authenticate,getWorkspace,getDefaultWorkspace=async()=>null){return async(req,res,next)=>{
 const teamId=req.headers['x-agnt-team-id'];if(!teamId)return next();
 const api=req.path.split('/')[1];
 // Personal-within-team data: served as the caller's own rows. The header is ignored, never honoured.
 if(PRIVATE_IN_TEAM_APIS.has(api))return next();
 if(!TEAM_ASSET_APIS.has(api))return res.status(403).json({error:'This API is not available in a team scope'});
 return authenticate(req,res,async()=>{try{
  if(!process.env.AGNT_TENANT_SLUG)throw Object.assign(new Error('Open the team cloud instance'),{status:409});
  await dbReady;
  const team=await cloud.access(req.headers.authorization,teamId);
  // No project named: the team's default project. An explicitly named project is never substituted.
  const workspaceId=req.headers['x-agnt-workspace-id']||(await getDefaultWorkspace(teamId))?.id||null;
  if(workspaceId){const workspace=await getWorkspace(workspaceId);if(!workspace||workspace.team_id!==teamId||workspace.archived_at)throw Object.assign(new Error('Workspace not found'),{status:404});}
  const action=scopeApiAction(req.method,req.path);requireScopeApiRole(team.role,action);
  if(!workspaceId)throw Object.assign(new Error('This team has no project yet. The owner creates one by opening the team.'),{status:403,code:'no_default_project'});
  const capability=action==='view'?'resources.read':action==='run'?'runs.execute':'resources.write';
  await cloud.request(req.headers.authorization,'/'+encodeURIComponent(teamId)+'/instances/'+encodeURIComponent(process.env.AGNT_TENANT_SLUG)+'/workspaces/'+encodeURIComponent(workspaceId)+'/access/'+capability);
  const scope=await ensureSharedScope(repository,teamId,workspaceId);
  const context={actorId:req.user.userId||req.user.id,teamId,workspaceId,scopeId:scope.id,resourceOwnerId:scope.resourceOwnerId,role:team.role,authorization:req.headers.authorization};
  const authorization=new ResourceAuthorization(repository,async(_context,_action,resourceScope)=>{if(resourceScope.id!==scope.id)throw Object.assign(new Error('Resource not found in this workspace'),{status:404});});
  // Widgets this person made in their personal space join the team library first, so the Widgets page and
  // the widget tools list the same widgets (adoptPersonalWidgets.js).
  if(api==='widget-definitions'){const teamOwner=await teamAssetOwnerFor(context.actorId);if(teamOwner)await adoptPersonalWidgets(repository,context.actorId,teamOwner);}
  for(const reference of assetApiReferences(req.path,req.body)){
    const existing=await repository.get(`SELECT id FROM "${reference.table}" WHERE id=?`,[reference.id]);
    if(existing){const resolved=await authorization.require(context,action,reference.table,reference.id);if(resolved.scope.id!==scope.id)throw Object.assign(new Error('Resource not found in this workspace'),{status:404});
     // Whoever last changed or ran it is who it runs as when nobody is asking (schedules, triggers, restarts).
     if((action==='edit'||action==='run')&&RUN_AS_LAST_TOUCH.has(reference.table))await recordRunActor(repository,reference.table,reference.id,context.actorId);}
  }
  // Teammates run teamspace items directly, AS THEMSELVES: the run's actor is the member (runActor.js),
  // so memberIsolation puts its code, shell and files in the kernel sandbox, refuses SQL and keeps
  // unapproved plugins off, exactly as for that member's chat. It uses the teamspace's connections, which
  // the owner decides: their team policy ("Run workflows and agents") and the member's connections.use
  // in this teamspace (runs.execute was checked above). The owner runs anything, as on a personal instance.
  if(action==='run'&&context.actorId!==process.env.AGNT_TENANT_OWNER){
   if(team.policy?.permissions?.['workflows.run']===false)throw Object.assign(new Error(policyRefusalMessage('workflows.run')),{status:403,code:'team_policy_denied',permission:'workflows.run'});
   await cloud.request(req.headers.authorization,'/'+encodeURIComponent(teamId)+'/instances/'+encodeURIComponent(process.env.AGNT_TENANT_SLUG)+'/workspaces/'+encodeURIComponent(workspaceId)+'/access/connections.use');
  }
  await repository.run('INSERT INTO scope_api_audit(scope_id,actor_id,action) VALUES(?,?,?)',[scope.id,context.actorId,req.method+' '+api]);
  req.user={...req.user,id:scope.resourceOwnerId,userId:scope.resourceOwnerId};
  return withScopeRequest(req,context,next);
 }catch(error){if(!error.status)console.error('[Scope API]',error.message);res.status(error.status||503).json({error:error.status?error.message:'Scope authority unavailable',...(error.status&&error.code?{code:error.code}:{}),...(error.status&&error.permission?{permission:error.permission}:{})});}});
};}
