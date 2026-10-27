import {CloudTeamClient} from '../CloudTeamClient.js';
import {currentTeamExecution} from './TeamExecutionContext.js';
import {credentialUserId} from '../auth/tenantOwnership.js';
import {isToolToken,verifyToolToken} from '../security/toolRunAuthority.js';
/**
 * A hosted member's direct tool calls need current membership of this
 * instance's team, and nothing more here. WHICH tools a member may run is
 * decided per tool by memberIsolation (owner-only: shell, code, files,
 * database). An owner/admin-only role gate here refused members every tool,
 * search and email included ("direct machine tools require tenant
 * administration"), while adding no protection memberIsolation lacks.
 */
export async function requireHostedToolAuthority(actorId,authorization){
 if(!process.env.AGNT_TENANT_SLUG||currentTeamExecution())return;
 // The owner, and a team workspace acting for the owner (credentialUserId), run tools directly.
 if(credentialUserId(actorId)===process.env.AGNT_TENANT_OWNER)return;
 if(typeof authorization!=='string')throw new Error('Hosted tool execution requires current team authority');
 const bearer=authorization.startsWith('Bearer ')?authorization:'Bearer '+authorization;
 // A turn-scoped token this instance minted for this very member (a text answered as them,
 // mobileReceiver). The auth middleware admitted it only for a current member; the issuer
 // cannot verify it, so it never goes there.
 const raw=bearer.slice(7);
 if(isToolToken(raw)){if(verifyToolToken(raw).sub===credentialUserId(actorId))return;throw new Error('Tool authority does not match the caller');}
 const cloud=new CloudTeamClient();
 const teams=await cloud.request(bearer,'');const team=teams.find(t=>t.tenantSlug===process.env.AGNT_TENANT_SLUG);
 if(!team)throw new Error("You are not a member of this instance's team");
 await cloud.access(bearer,team.id);
}
