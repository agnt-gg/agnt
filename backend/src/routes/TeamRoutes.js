import express from 'express';
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
export function createTeamRouter(getRepository = repo, authenticate = authenticateToken) {
  const router = express.Router();
  router.use(authenticate);
  const handler = fn => async (req, res) => {
    try {
      const user = req.user?.id || req.user?.userId;
      if (!user) return res.status(401).json({
        error: 'Sign in required'
      });
      res.set('Cache-Control', 'no-store');
      const result = await fn(getRepository(), req, user);
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
  return router;
}
export default createTeamRouter();
