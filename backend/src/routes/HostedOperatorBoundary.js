import {CloudTeamClient} from '../services/CloudTeamClient.js';
const machineApis=new Set(['plugins','mcp','npm','filesystem','local-file','local-preview','cluster','system','pairing']);
/** Member collaboration never implies shell/filesystem or installation administration. */
export function createHostedOperatorBoundary(authenticate,cloud=new CloudTeamClient()){return async(req,res,next)=>{
 if(!process.env.AGNT_TENANT_SLUG||!machineApis.has(req.path.split('/')[1]))return next();
 return authenticate(req,res,async()=>{try{const user=req.user?.id||req.user?.userId;
 if(user===process.env.AGNT_TENANT_OWNER)return next();
 const teams=await cloud.request(req.headers.authorization,'');const team=teams.find(t=>t.tenantSlug===process.env.AGNT_TENANT_SLUG);
 if(!team||!['owner','admin'].includes(team.role))return res.status(403).json({error:'Tenant administrator required'});
 await cloud.access(req.headers.authorization,team.id);next();
 }catch(error){res.status(error.status||503).json({error:'Tenant administrator authorization unavailable'});}});
};}
