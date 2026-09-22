import {assetApiReferences} from '../services/authorization/AssetApiReferences.js';
import {ResourceAuthorization} from '../services/authorization/ResourceAuthorization.js';
import db,{dbReady} from '../models/database/index.js';
import {databaseRepository,ensureSharedScope} from '../services/authorization/ScopeRepository.js';
import {CloudTeamClient} from '../services/CloudTeamClient.js';
import {TEAM_ASSET_APIS,scopeApiAction,requireScopeApiRole} from '../services/authorization/ScopeApiPolicy.js';
import {withScopeRequest} from '../services/authorization/ScopeRequestContext.js';
const repository=databaseRepository(db),cloud=new CloudTeamClient();
export function createScopeApiMiddleware(authenticate,getWorkspace,getDefaultWorkspace=async()=>null){return async(req,res,next)=>{
 const teamId=req.headers['x-agnt-team-id'];if(!teamId)return next();
 const api=req.path.split('/')[1];if(!TEAM_ASSET_APIS.has(api))return res.status(403).json({error:'This API is not available in a team scope'});
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
  for(const reference of assetApiReferences(req.path,req.body)){
    const existing=await repository.get(`SELECT id FROM "${reference.table}" WHERE id=?`,[reference.id]);
    if(existing){const resolved=await authorization.require(context,action,reference.table,reference.id);if(resolved.scope.id!==scope.id)throw Object.assign(new Error('Resource not found in this workspace'),{status:404});}
  }
  // Team runs go through a PUBLISHED version with a team connection (NativeTeamExecution), never the
  // personal execution path, which would reach for credentials the team does not have.
  if(action==='run')throw Object.assign(new Error('Publish this in Team → Projects, then run it from there'),{status:409,code:'publish_required'});
  await repository.run('INSERT INTO scope_api_audit(scope_id,actor_id,action) VALUES(?,?,?)',[scope.id,context.actorId,req.method+' '+api]);
  req.user={...req.user,id:scope.resourceOwnerId,userId:scope.resourceOwnerId};
  return withScopeRequest(req,context,next);
 }catch(error){if(!error.status)console.error('[Scope API]',error.message);res.status(error.status||503).json({error:error.status?error.message:'Scope authority unavailable',...(error.status&&error.code?{code:error.code}:{})});}});
};}
