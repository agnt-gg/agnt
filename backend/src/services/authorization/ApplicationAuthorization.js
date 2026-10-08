import db from '../../models/database/index.js';
import {trustedScopeRequest} from './ScopeRequestContext.js';
import {ResourceAuthorization} from './ResourceAuthorization.js';
import {CloudTeamClient} from '../CloudTeamClient.js';
const repository={get:(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(error,row)=>error?reject(error):resolve(row)))};
const cloud=new CloudTeamClient();
/** May this caller do `action` on a team-workspace resource? Throws a 403 when not. */
export async function teamResourcePolicy(context,action,scope,teams=cloud){
 if(!process.env.AGNT_TENANT_SLUG)throw Object.assign(new Error('Team resources require their cloud instance'),{status:403});
 const team=await teams.access(context.authorization,scope.team_id);
 // The instance owner runs the workspace on their own connections (credentialUserId);
 // a member's run still goes through a published version with approved connections.
 if(action==='run'&&context.actorId!==process.env.AGNT_TENANT_OWNER)throw Object.assign(new Error('Shared execution requires a bound execution principal and approved connections'),{status:403});
 if(context.scopeId!==scope.id)throw Object.assign(new Error('Select the resource workspace'),{status:403});
 if(['manage_access','delete'].includes(action)&&!['owner','admin'].includes(team.role))throw Object.assign(new Error('Team administrator required'),{status:403});
 if(['edit','run'].includes(action)&&!['owner','admin','member'].includes(team.role))throw Object.assign(new Error('Team editor required'),{status:403});
}
export const applicationAuthorization=new ResourceAuthorization(repository,(context,action,scope)=>teamResourcePolicy(context,action,scope));
export function requireResourceAccess(table,action,idOf=req=>req.params.id){return async(req,res,next)=>{
 try{
  const resource=await applicationAuthorization.require(trustedScopeRequest(req)||{actorId:req.user?.userId||req.user?.id,authorization:req.headers.authorization},action,table,idOf(req));
  req.authorizedResource=resource;
  next();
 }catch(error){if(!error.status)console.error('[ResourceAuthorization]',error.message);res.status(error.status||500).json({error:error.status?error.message:'Unable to authorize resource'});}
};}
