import db from '../models/database/index.js';
import {ResourceAuthorization} from '../services/authorization/ResourceAuthorization.js';
import {scopeApiAction} from '../services/authorization/ScopeApiPolicy.js';
import {databaseRepository} from '../services/authorization/ScopeRepository.js';
import {assetApiReferences} from '../services/authorization/AssetApiReferences.js';
const repository=databaseRepository(db);
/** Hosted installations never let an unscoped request address a team-owned row. */
export function createPersonalAssetBoundary(authenticate){return async(req,res,next)=>{
 if(!process.env.AGNT_TENANT_SLUG||req.headers['x-agnt-team-id'])return next();
 const references=assetApiReferences(req.path,req.body);if(!references.length)return next();
 return authenticate(req,res,async()=>{try{
  for(const {table,id} of references){const row=await repository.get(`SELECT * FROM "${table}" WHERE id=?`,[id]);if(!row)continue;
   if(row.scope_id){const scope=await repository.get('SELECT * FROM ownership_scopes WHERE id=?',[row.scope_id]);if(!scope||(['team','workspace'].includes(scope.kind)))return res.status(404).json({error:'Resource not found'});if(scope.kind==='system'&&req.method==='GET')continue;}
   if(req.method==='GET'&&(row.is_shareable||row.is_shared))continue;
   await new ResourceAuthorization(repository).require({actorId:req.user.userId||req.user.id},scopeApiAction(req.method,req.path),table,id);
  }
  next();
 }catch(error){console.error('[Asset boundary]',error.message);res.status(error.status||503).json({error:error.status?error.message:'Resource authority unavailable'});}});
};}
