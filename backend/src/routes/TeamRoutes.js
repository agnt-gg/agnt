import express from 'express';
import { CloudTeamClient } from '../services/CloudTeamClient.js';
import { TeamWorkspaceRepository, initializeTeamWorkspaces } from '../services/TeamWorkspaceRepository.js';
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

function repo() {
  if (!repository) repository = new TeamRepository(new sqlite3.Database(pathManager.getDataPath('teams.db')));
  return repository
}
export function createTeamRouter(getRepository = repo, authenticate = authenticateToken, cloud = new CloudTeamClient()) {
  const router = express.Router();
  router.use(authenticate);
  // Membership and entitlement always come from the cloud. Never use local membership as authority.
  router.use(async (req, res, next) => {
    res.set('Cache-Control','no-store');
    if (!(req.user?.id || req.user?.userId)) return res.status(401).json({error:'Sign in required'});
    try {
      const path = req.path;
      const assetRequest = /^\/[^/]+\/(assets|activity|workspaces)(\/|$)/.test(path);
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
  router.get('/:teamId/activity', handler((repo, req, user) => repo.history(req.params.teamId, user)));
  router.get('/:teamId/workspaces',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).list(req.params.teamId,user)));
  router.post('/:teamId/workspaces',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).create(req.params.teamId,user,req.body?.name)));
  router.patch('/:teamId/workspaces/:id',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).update(req.params.teamId,user,req.params.id,req.body||{})));
  router.put('/:teamId/workspaces/:id/preferences',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).close(req.params.teamId,user,req.params.id,req.body?.isOpen)));
  router.post('/:teamId/workspaces/:id/archive',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).archive(req.params.teamId,user,req.params.id)));
  router.get('/:teamId/workspaces/:id/resources',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).resources(req.params.teamId,user,req.params.id)));
  router.post('/:teamId/workspaces/:id/resources',handler((repo,req,user)=>new TeamWorkspaceRepository(repo).attach(req.params.teamId,user,req.params.id,req.body?.assetId)));
  return router;
}
export default createTeamRouter();
