import {CloudTeamClient} from '../CloudTeamClient.js';
import {currentTeamExecution} from './TeamExecutionContext.js';
/** Ordinary hosted members run automation through the approved team entry point. */
export async function requireHostedToolAuthority(actorId,authorization){
 if(!process.env.AGNT_TENANT_SLUG||currentTeamExecution())return;
 if(actorId===process.env.AGNT_TENANT_OWNER)return;
 if(typeof authorization!=='string')throw new Error('Hosted tool execution requires current team authority');
 const cloud=new CloudTeamClient();const bearer=authorization.startsWith('Bearer ')?authorization:'Bearer '+authorization;
 const teams=await cloud.request(bearer,'');const team=teams.find(t=>t.tenantSlug===process.env.AGNT_TENANT_SLUG);
 if(!team||!['owner','admin'].includes(team.role))throw new Error('Use an owner-approved shared run; direct machine tools require tenant administration');
 await cloud.access(bearer,team.id);
}
