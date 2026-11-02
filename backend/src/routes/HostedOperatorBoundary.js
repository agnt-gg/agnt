import {CloudTeamClient} from '../services/CloudTeamClient.js';
import {hostedToolBoundaryRequired} from '../services/security/toolRunAuthority.js';
import {MEDIA_ROUTE_PREFIXES} from '../utils/mediaRoutes.js';
import {requireAuthMedia, extractToken} from '../utils/authGuard.js';
// browser-agent: the launched browser is one per instance and holds the owner's signed-in sites, so
// viewing or driving it is the owner's (or an admin's), never a member's.
const machineApis=new Set(['plugins','mcp','npm','filesystem','local-file','local-preview','cluster','system','pairing','browser-agent']);

// A browser loads these itself (<img>, <iframe>, relative URLs inside served HTML), and a browser
// subresource can never carry an Authorization header: it carries the media cookie. Authenticating
// them header-only here meant no artifact preview or raw file ever loaded on a hosted instance.
// Read-only methods only; every mutating machine API stays header-authenticated.
const MEDIA_METHODS=new Set(['GET','HEAD']);

// What every member's app reads at start to show and use the tools this instance
// already has. Reading that list is not administration: a member was refused it
// ("/plugins/installed returned 403") and their app failed to load plugins.
// Installing, removing, updating and reading plugin source or packages stay
// owner/admin only.
const MEMBER_READABLE=[/^\/plugins\/installed(\/[^/]+)?$/,/^\/plugins\/(marketplace|tools|updates|update-status|requests|install-policy)$/];
function isMemberReadable(req){return MEDIA_METHODS.has(req.method)&&MEMBER_READABLE.some(pattern=>pattern.test(req.path));}
// Switching on, for yourself, a plugin package already on this instance. No new code reaches
// the machine: pluginAccountBoundary marks the request activation-only and the install route
// refuses it unless the exact package (same version, same integrity) is already installed.
function isMemberActivation(req){return req.method==='POST'&&req.path==='/plugins/install';}
// A member removing a plugin THEY added: the route removes only their own account's install (PluginRoutes).
// A teammate watching, steering and managing the sign-ins of THEIR OWN browser (memberBrowsers.js): every one of
// these routes passes the caller as the actor and keys viewers and streams by the caller. The desktop sign-in
// window, surface registration and the owner's browser stay owner-only.
const MEMBER_BROWSER_ROUTES=[/^\/browser-agent\/view-capabilities$/,/^\/browser-agent\/view(\/[^/]+)?$/,/^\/browser-agent\/control(\/[^/]+)?$/,/^\/browser-agent\/sites(\/forget)?$/];
function isMemberBrowserRoute(req){return hostedToolBoundaryRequired()&&MEMBER_BROWSER_ROUTES.some(pattern=>pattern.test(req.path));}
function isMemberPluginRemoval(req){return req.method==='DELETE'&&/^\/plugins\/[^/]+$/.test(req.path);}
// A member dismissing their own decided plugin request. Deciding one, and the policy, stay owner/admin.
function isMemberRequestSeen(req){return req.method==='POST'&&/^\/plugins\/requests\/[^/]+\/seen$/.test(req.path);}
function isMediaRequest(req){
 if(!MEDIA_METHODS.has(req.method))return false;
 const pathname=String(req.originalUrl||'').split('?')[0];
 return MEDIA_ROUTE_PREFIXES.some(prefix=>pathname===prefix||pathname.startsWith(prefix+'/'));
}

/** Member collaboration never implies shell/filesystem or installation administration. */
export function createHostedOperatorBoundary(authenticate,cloud=new CloudTeamClient(),authenticateMedia=requireAuthMedia){return async(req,res,next)=>{
 if(!process.env.AGNT_TENANT_SLUG||!machineApis.has(req.path.split('/')[1]))return next();
 const media=isMediaRequest(req);
 return (media?authenticateMedia:authenticate)(req,res,async()=>{try{const user=req.user?.id||req.user?.userId;
 if(user===process.env.AGNT_TENANT_OWNER||isMemberReadable(req)||isMemberActivation(req)||isMemberPluginRemoval(req)||isMemberBrowserRoute(req)||isMemberRequestSeen(req))return next();
 // The control plane is asked with the same credential the caller authenticated with.
 const authorization=req.headers.authorization||(media?'Bearer '+extractToken(req,{allowCookie:true,allowQuery:true}):undefined);
 const teams=await cloud.request(authorization,'');const team=teams.find(t=>t.tenantSlug===process.env.AGNT_TENANT_SLUG);
 if(!team||!['owner','admin'].includes(team.role))return res.status(403).json({error:'Tenant administrator required'});
 await cloud.access(authorization,team.id);next();
 }catch(error){res.status(error.status||503).json({error:'Tenant administrator authorization unavailable'});}});
};}
