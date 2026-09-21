import express from 'express';
import pathManager from '../utils/PathManager.js';
import {authenticateToken} from './Middleware.js';
import {CloudTeamClient} from '../services/CloudTeamClient.js';
import {WorkspaceFileService} from '../services/WorkspaceFileService.js';
export function createWorkspaceFileRoutes({authenticate=authenticateToken,cloud=new CloudTeamClient(),root=pathManager.getDataPath('workspace-files')}={}){
 const router=express.Router();router.use(authenticate);
 const service=new WorkspaceFileService({root,authorize:async(context,capability)=>{
  if(!process.env.AGNT_TENANT_SLUG||context.tenantSlug!==process.env.AGNT_TENANT_SLUG)throw Object.assign(Error('Cloud workspace required'),{status:403});
  const base='/'+encodeURIComponent(context.teamId)+'/instances/'+encodeURIComponent(context.tenantSlug)+'/workspaces/'+encodeURIComponent(context.workspaceId);
  await cloud.request(context.authorization,base+'/access/'+capability);
 }});
 const handle=operation=>async(req,res)=>{res.set('Cache-Control','no-store');try{const actorId=req.user?.userId||req.user?.id;if(!actorId)return res.status(401).json({error:'Authentication required'});const context={actorId,teamId:req.params.teamId,tenantSlug:process.env.AGNT_TENANT_SLUG,workspaceId:req.params.workspaceId,authorization:req.headers.authorization};await operation(context,req,res);}catch(error){if(!error.status&&error.code!=='ENOENT')console.error('[Workspace files]',error.code||error.name);res.status(error.status||(error.code==='ENOENT'?404:500)).json({error:error.status?error.message:'Workspace file unavailable'});}};
 router.get('/:teamId/:workspaceId/content',handle(async(context,req,res)=>{const bytes=await service.read(context,req.query.path);res.set({'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="download"','X-Content-Type-Options':'nosniff'}).send(bytes);}));
 router.put('/:teamId/:workspaceId/content',express.raw({type:'application/octet-stream',limit:'10mb'}),handle(async(context,req,res)=>res.json(await service.write(context,req.query.path,req.body))));
 return router;
}
export default createWorkspaceFileRoutes();
