import db from '../models/database/index.js';
import {ResourceAuthorization} from '../services/authorization/ResourceAuthorization.js';
import {scopeApiAction,TEAM_ASSET_APIS} from '../services/authorization/ScopeApiPolicy.js';
import {databaseRepository} from '../services/authorization/ScopeRepository.js';
import {assetApiReferences} from '../services/authorization/AssetApiReferences.js';
import {teamResourcePolicy} from '../services/authorization/ApplicationAuthorization.js';
const defaultRepository=databaseRepository(db);
/**
 * Hosted installations never let an unscoped request act on a team-owned row.
 *
 * ONE EXCEPTION, AND IT IS A READ. A personal route (a chat: chats stay yours
 * inside a team) names the page it was opened from in its body: the workflow
 * being edited, the agent being viewed. That is context, not an operation on the
 * row. Refusing it answered every chat opened from a team workflow with "Resource
 * not found" (bravo, 2026-10-27). Such a reference is authorized as a VIEW of the
 * row's own workspace: live team membership via the control plane, nothing cached.
 * Anything the chat then changes goes through the asset APIs and their own checks.
 */
export function createPersonalAssetBoundary(authenticate,{repository=defaultRepository,teamPolicy=teamResourcePolicy}={}){return async(req,res,next)=>{
 if(!process.env.AGNT_TENANT_SLUG||req.headers['x-agnt-team-id'])return next();
 const references=assetApiReferences(req.path,req.body);if(!references.length)return next();
 const api=req.path.split('/').filter(Boolean)[0]||'';
 const pageContext=!TEAM_ASSET_APIS.has(api);
 return authenticate(req,res,async()=>{try{
  const actorId=req.user.userId||req.user.id;
  for(const {table,id} of references){const row=await repository.get(`SELECT * FROM "${table}" WHERE id=?`,[id]);if(!row)continue;
   if(row.scope_id){const scope=await repository.get('SELECT * FROM ownership_scopes WHERE id=?',[row.scope_id]);
    if(scope&&['team','workspace'].includes(scope.kind)&&pageContext){
     try{await teamPolicy({actorId,authorization:req.headers.authorization,scopeId:scope.id},'view',scope);continue;}
     catch{return res.status(404).json({error:'Resource not found'});}
    }
    if(!scope||(['team','workspace'].includes(scope.kind)))return res.status(404).json({error:'Resource not found'});if(scope.kind==='system'&&req.method==='GET')continue;}
   if(req.method==='GET'&&(row.is_shareable||row.is_shared))continue;
   await new ResourceAuthorization(repository).require({actorId},pageContext?'view':scopeApiAction(req.method,req.path),table,id);
  }
  next();
 }catch(error){console.error('[Asset boundary]',error.message);res.status(error.status||503).json({error:error.status?error.message:'Resource authority unavailable'});}});
};}
