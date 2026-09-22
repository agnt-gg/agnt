import express from 'express';
import db,{dbReady} from '../models/database/index.js';
import {databaseRepository,ensureSharedScope} from '../services/authorization/ScopeRepository.js';
import {NativeTeamResources} from '../services/NativeTeamResources.js';
import {NativeTeamExecution,initializeNativeTeamExecution} from '../services/NativeTeamExecution.js';
import { CloudTeamClient } from '../services/CloudTeamClient.js';
import { TeamWorkspaceRepository, initializeTeamWorkspaces, DEFAULT_PROJECT_NAME } from '../services/TeamWorkspaceRepository.js';
import { CAPABILITIES, syncProjectAccess } from '../services/TeamAccess.js';
import sqlite3 from 'sqlite3';
import pathManager from '../utils/PathManager.js';
import {
  authenticateToken
} from './Middleware.js';
import {
  TeamRepository
} from '../services/TeamRepository.js';

// Separate serialized connection: team transactions never interleave with personal-resource writes.
let repository;

export function getTeamRepository() {
  if (!repository) repository = new TeamRepository(new sqlite3.Database(pathManager.getDataPath('teams.db')));
  return repository
}
export function createTeamRouter(getRepository = getTeamRepository, authenticate = authenticateToken, cloud = new CloudTeamClient()) {
  const router = express.Router();
  router.use(authenticate);
  // Membership and entitlement always come from the cloud. Never use local membership as authority.
  router.use(async (req, res, next) => {
    res.set('Cache-Control','no-store');
    if (!(req.user?.id || req.user?.userId)) return res.status(401).json({error:'Sign in required'});
    try {
      const path = req.path;
      const assetRequest = /^\/[^/]+\/(assets|activity|workspaces|access)(\/|$)/.test(path);
      if (!assetRequest) {
        const result = await cloud.request(req.headers.authorization, path, {
          method: req.method,
          ...(['GET','HEAD'].includes(req.method) ? {} : {body: JSON.stringify(req.body || {})})
        });
        res.set('Cache-Control','no-store');
        return res.json(result);
      }
      const teamId = path.split('/')[1];
      const team = await cloud.access(req.headers.authorization, teamId);
      if (!process.env.AGNT_TENANT_SLUG) return res.status(409).json({error:'Open the team cloud instance to access its shared assets',code:'team_instance_required',tenantUrl:team.tenantUrl});
      const parts=path.split('/');
      if(parts[2]==='workspaces'&&parts[3]&&parts[3]!=='default'){
        const capability=parts.at(-1)==='run'?'runs.execute':parts.at(-1)==='authorize'||parts.at(-1)==='archive'||parts.includes('capabilities')||parts.at(-1)==='overrides'?'access.manage':req.method==='GET'?'resources.read':'resources.write';
        await cloud.request(req.headers.authorization,'/'+encodeURIComponent(teamId)+'/instances/'+encodeURIComponent(team.tenantSlug)+'/workspaces/'+encodeURIComponent(parts[3])+'/access/'+capability);
      }
      req.cloudTeam = team;
      next();
    } catch(error) {
      if (!error.status) console.error('[Teams cloud]', error.message);
      res.status(error.status || 503).json({error:error.status ? error.message : 'Team authority is temporarily unavailable',code:error.code});
    }
  });
  const handler = fn => async (req, res) => {
    try {
      const user = req.user?.id || req.user?.userId;
      if (!user) return res.status(401).json({
        error: 'Sign in required'
      });
      res.set('Cache-Control', 'no-store');
      const repository = getRepository();
      // Request-bound adapter: no cached member row can outlive cloud revocation.
      const scoped = Object.create(repository);
      scoped.transaction = repository.transaction.bind(repository);
      scoped.member = async (teamId, userId, roles = null) => {
        if (!req.cloudTeam || teamId !== req.cloudTeam.id || userId !== user) throw Object.assign(new Error('Team not found'), {status:404});
        if (roles && !roles.includes(req.cloudTeam.role)) throw Object.assign(new Error('Your role does not allow this operation'), {status:403});
        return {team_id:teamId,user_id:userId,role:req.cloudTeam.role};
      };
      await repository.ready;
      if (!repository.workspacesReady) repository.workspacesReady = repository.transaction(() => initializeTeamWorkspaces(repository));
      await repository.workspacesReady;
      if(!repository.executionReady)repository.executionReady=repository.transaction(()=>initializeNativeTeamExecution(repository));
      await repository.executionReady;
      await repository.transaction(() => repository.run('INSERT OR IGNORE INTO teams(id,name,owner_id,created_at) VALUES(?,?,?,?)',[req.cloudTeam.id,req.cloudTeam.name,'cloud-authority',new Date().toISOString()]));
      const result = await fn(scoped, req, user);
      res.json(result ?? {
        success: true
      })
    } catch (error) {
      if (!error.status) console.error('[Teams]', error);
      res.status(error.status || 500).json({
        error: error.status ? error.message : 'Team operation failed'
      })
    }
  };
  router.get('/', handler((repo, req, user) => repo.list(user)));
  router.post('/', handler((repo, req, user) => repo.create(user, req.user.email, req.body?.name)));
  router.post('/accept', handler((repo, req, user) => repo.accept(user, req.user.email, req.body?.token)));
  router.get('/:teamId/members', handler((repo, req, user) => repo.members(req.params.teamId, user)));
  router.delete('/:teamId/members/:memberId', handler((repo, req, user) => repo.removeMember(req.params.teamId, user, req.params.memberId)));
  router.get('/:teamId/invitations', handler((repo, req, user) => repo.invitations(req.params.teamId, user)));
  router.post('/:teamId/invitations', handler((repo, req, user) => repo.invite(req.params.teamId, user, req.body?.email, req.body?.role)));
  router.delete('/:teamId/invitations/:id', handler((repo, req, user) => repo.revoke(req.params.teamId, user, req.params.id)));
  router.get('/:teamId/assets', handler((repo, req, user) => repo.assets(req.params.teamId, user)));
  router.get('/:teamId/assets/:id', handler((repo, req, user) => repo.asset(req.params.teamId, user, req.params.id, req.query.revision ? Number(req.query.revision) : undefined)));
  router.post('/:teamId/assets', handler((repo, req, user) => repo.save(req.params.teamId, user, req.body || {})));
  router.post('/:teamId/assets/:id/authorize',(_req,res)=>res.status(410).json({error:'Library definitions must be installed in a cloud workspace before execution'}));
  router.post('/:teamId/assets/:id/run',(_req,res)=>res.status(410).json({error:'Library definitions cannot execute'}));
  router.get('/:teamId/activity', handler((repo, req, user) => repo.history(req.params.teamId, user)));
  const nativeScope=async(repo,req)=>{const workspace=await repo.get('SELECT * FROM shared_workspaces WHERE id=? AND team_id=? AND archived_at IS NULL',[req.params.workspaceId,req.params.teamId]);if(!workspace)throw Object.assign(new Error('Workspace not found'),{status:404});await dbReady;return ensureSharedScope(databaseRepository(db),req.params.teamId,workspace.id);};
  router.get('/:teamId/workspaces/:workspaceId/native',handler(async(repo,req)=>{const scope=await nativeScope(repo,req);return new NativeTeamResources(databaseRepository(db),repo).list(scope);}));
  router.post('/:teamId/workspaces/:workspaceId/native/:kind/:id/:action',handler(async(repo,req,user)=>{
    const scope=await nativeScope(repo,req);const resources=new NativeTeamResources(databaseRepository(db),repo);await resources.initialize();const assetId=await resources.snapshot(req.params.teamId,user,scope,req.params.kind,req.params.id);const executor=new NativeTeamExecution(repo,cloud);
    if(req.params.action==='authorize')return executor.bind(req.cloudTeam,user,req.headers.authorization,assetId,{...req.body,workspaceId:req.params.workspaceId});
    if(req.params.action==='run')return executor.run(req.cloudTeam,user,assetId,req.body?.input,scope,req.headers.authorization);
    throw Object.assign(new Error('Unknown execution action'),{status:404});
  }));
  const projectPath=(req,workspaceId)=>'/'+encodeURIComponent(req.params.teamId)+'/instances/'+encodeURIComponent(req.cloudTeam.tenantSlug)+'/workspaces/'+encodeURIComponent(workspaceId);
  const requireManager=req=>{if(!['owner','admin'].includes(req.cloudTeam.role))throw Object.assign(new Error('Only owners and admins manage access'),{status:403});};
  /** Everyone on the team gets their role's access to the listed projects. */
  const syncAccess=async(repo,req,workspaceIds)=>{
    const projects=new TeamWorkspaceRepository(repo);
    const members=await cloud.request(req.headers.authorization,'/'+encodeURIComponent(req.params.teamId)+'/members');
    return syncProjectAccess({cloud,authorization:req.headers.authorization,team:{id:req.params.teamId,tenantSlug:req.cloudTeam.tenantSlug},workspaceIds,members:Array.isArray(members)?members:[],overridesFor:(workspaceId,userId)=>projects.overrides(workspaceId,userId)});
  };
  /** Registers the project with the cloud, then grants the whole team access by role. Archives on failure. */
  const createProject=async(repo,req,user,name)=>{
    if(req.cloudTeam.role!=='owner')throw Object.assign(new Error('Only the owner can create a project'),{status:403});
    const projects=new TeamWorkspaceRepository(repo);
    const workspace=await projects.create(req.params.teamId,user,name);
    try{
      await cloud.request(req.headers.authorization,projectPath(req,workspace.id),{method:'PUT',body:'{}'});
      await syncAccess(repo,req,[workspace.id]);
      return workspace;
    }catch(error){await projects.archive(req.params.teamId,user,workspace.id);throw error;}
  };
  // Concurrent first loads by the owner must create exactly one General project.
  const ensuringDefault=new Map();
  const ensureDefault=(repo,req,user)=>{
    const teamId=req.params.teamId;
    if(ensuringDefault.has(teamId))return ensuringDefault.get(teamId);
    const pending=(async()=>{
      const projects=new TeamWorkspaceRepository(repo);
      const existing=await projects.defaultFor(teamId);if(existing)return existing;
      const oldest=(await projects.list(teamId,user))[0];
      if(oldest){await projects.markDefault(teamId,oldest.id);return oldest;}
      if(req.cloudTeam.role!=='owner')return null;
      const created=await createProject(repo,req,user,DEFAULT_PROJECT_NAME);
      await projects.markDefault(teamId,created.id);return created;
    })().finally(()=>ensuringDefault.delete(teamId));
    ensuringDefault.set(teamId,pending);return pending;
  };
  router.get('/:teamId/workspaces/default',handler(async(repo,req,user)=>{
    const project=await ensureDefault(repo,req,user);
    if(!project)throw Object.assign(new Error('The team owner has not opened this team yet'),{status:404,code:'no_default_project'});
    return project;
  }));
  router.post('/:teamId/access/sync',handler(async(repo,req,user)=>{
    requireManager(req);
    const projects=await new TeamWorkspaceRepository(repo).list(req.params.teamId,user);
    const requested=Array.isArray(req.body?.workspaceIds)?new Set(req.body.workspaceIds):null;
    return syncAccess(repo,req,projects.filter(p=>!requested||requested.has(p.id)).map(p=>p.id));
  }));
  /** Advanced: one capability for one person on one project. Recorded as an override so a role change keeps it. */
  const setCapability=granted=>handler(async(repo,req)=>{
    requireManager(req);
    const {id,userId,capability}=req.params;
    if(!CAPABILITIES.includes(capability))throw Object.assign(new Error('Unknown capability'),{status:400});
    const projects=new TeamWorkspaceRepository(repo);await projects.find(req.params.teamId,id);
    await cloud.request(req.headers.authorization,projectPath(req,id)+'/members/'+encodeURIComponent(userId)+'/capabilities/'+capability,{method:granted?'PUT':'DELETE',body:'{}'});
    await projects.setOverride(id,userId,capability,granted);
    return {success:true};
  });
  router.put('/:teamId/workspaces/:id/members/:userId/capabilities/:capability',setCapability(true));
  router.delete('/:teamId/workspaces/:id/members/:userId/capabilities/:capability',setCapability(false));
  router.delete('/:teamId/workspaces/:id/members/:userId/overrides',handler(async(repo,req)=>{
    requireManager(req);
    const projects=new TeamWorkspaceRepository(repo);await projects.find(req.params.teamId,req.params.id);
    await projects.clearOverrides(req.params.id,req.params.userId);
    return syncAccess(repo,req,[req.params.id]);
  }));
  router.get('/:teamId/workspaces/:id/members/:userId/overrides',handler(async(repo,req)=>{
    const projects=new TeamWorkspaceRepository(repo);await projects.find(req.params.teamId,req.params.id);
    return projects.overrides(req.params.id,req.params.userId);
  }));
  router.get('/:teamId/workspaces',handler(async(repo,req,user)=>{
    await ensureDefault(repo,req,user);
    const defaultProject=await new TeamWorkspaceRepository(repo).defaultFor(req.params.teamId);
    const workspaces=(await new TeamWorkspaceRepository(repo).list(req.params.teamId,user)).map(w=>({...w,is_default:w.id===defaultProject?.id}));const visible=[];
    for(const workspace of workspaces){try{await cloud.request(req.headers.authorization,'/'+encodeURIComponent(req.params.teamId)+'/instances/'+encodeURIComponent(req.cloudTeam.tenantSlug)+'/workspaces/'+encodeURIComponent(workspace.id)+'/access/resources.read');visible.push(workspace);}catch(error){if(![403,404].includes(error.status))throw error;}}
    return visible;
  }));
  router.post('/:teamId/workspaces',handler((repo,req,user)=>createProject(repo,req,user,req.body?.name)));
  router.patch('/:teamId/workspaces/:id',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).update(req.params.teamId,user,req.params.id,req.body||{})));
  router.put('/:teamId/workspaces/:id/preferences',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).close(req.params.teamId,user,req.params.id,req.body?.isOpen)));
  router.post('/:teamId/workspaces/:id/archive',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).archive(req.params.teamId,user,req.params.id)));
  router.get('/:teamId/workspaces/:id/resources',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).resources(req.params.teamId,user,req.params.id)));
  router.post('/:teamId/workspaces/:id/resources',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).attach(req.params.teamId,user,req.params.id,req.body?.assetId)));
  return router;
}
export default createTeamRouter();
