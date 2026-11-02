import db from '../../models/database/index.js';
import {trustedScopeRequest} from './ScopeRequestContext.js';
import {ResourceAuthorization} from './ResourceAuthorization.js';
import {CloudTeamClient} from '../CloudTeamClient.js';
import {databaseRepository} from './ScopeRepository.js';
import {creatorOf} from './ResourceCreators.js';
import {publishRequiredError} from './ScopeApiPolicy.js';
const repository=databaseRepository(db);
const cloud=new CloudTeamClient();
const isAdmin=role=>['owner','admin'].includes(role);
/**
 * May this caller do `action` on a team-workspace resource? Throws when not.
 *
 * Delete: an owner or admin, or the member who created it (ResourceCreators), the rule board
 * cards and docs already follow. A member who can create something can clean it up; nobody
 * else's work is theirs to remove.
 */
export async function teamResourcePolicy(context,action,scope,teams=cloud,resource=null,creators=(table,id)=>creatorOf(repository,table,id)){
 if(!process.env.AGNT_TENANT_SLUG)throw Object.assign(new Error('Team resources require their cloud instance'),{status:403});
 const team=await teams.access(context.authorization,scope.team_id);
 // The instance owner runs the workspace on their own connections (credentialUserId);
 // a member's run still goes through a published version with approved connections.
 if(action==='run'&&context.actorId!==process.env.AGNT_TENANT_OWNER)throw publishRequiredError(team.role);
 if(context.scopeId!==scope.id)throw Object.assign(new Error('Select the resource workspace'),{status:403});
 if(action==='manage_access'&&!isAdmin(team.role))throw Object.assign(new Error('Team administrator required'),{status:403});
 if(action==='delete'&&!isAdmin(team.role)){
  const ownWork=team.role==='member'&&resource?.table&&resource?.id&&await creators(resource.table,resource.id)===context.actorId;
  if(!ownWork)throw Object.assign(new Error('Only the person who created this, or a team owner or admin, can delete it'),{status:403});
 }
 if(['edit','run'].includes(action)&&!['owner','admin','member'].includes(team.role))throw Object.assign(new Error('Team editor required'),{status:403});
}
export const applicationAuthorization=new ResourceAuthorization(repository,(context,action,scope,resource)=>teamResourcePolicy(context,action,scope,cloud,resource));
export function requireResourceAccess(table,action,idOf=req=>req.params.id){return async(req,res,next)=>{
 try{
  const resource=await applicationAuthorization.require(trustedScopeRequest(req)||{actorId:req.user?.userId||req.user?.id,authorization:req.headers.authorization},action,table,idOf(req));
  req.authorizedResource=resource;
  next();
 }catch(error){if(!error.status)console.error('[ResourceAuthorization]',error.message);res.status(error.status||500).json({error:error.status?error.message:'Unable to authorize resource',...(error.status&&error.code?{code:error.code}:{}),...(error.status&&typeof error.canPublish==='boolean'?{canPublish:error.canPublish}:{})});}
};}
