import express from 'express';
import { authenticateToken } from './Middleware.js';

/**
 * The account's cloud instances, as api.agnt.gg knows them.
 *
 * The Teams page manages the instance behind a team — who has a seat, what
 * the URL is — and that record lives on api.agnt.gg under /tenants. This is a
 * straight pass-through with the caller's own session token, so the desktop
 * never needs a second credential and never becomes a second authority on
 * who is a member. Only the routes the page uses are forwarded.
 */
const REMOTE = () => (process.env.REMOTE_URL || 'https://api.agnt.gg').replace(/\/$/, '');
const ALLOWED = [
  { method: 'GET', test: (p) => p === '/' },
  { method: 'GET', test: (p) => /^\/[a-z0-9-]+$/.test(p) },
  { method: 'POST', test: (p) => /^\/[a-z0-9-]+\/members$/.test(p) },
  { method: 'DELETE', test: (p) => /^\/[a-z0-9-]+\/members\/[a-f0-9]{32}$/.test(p) },
];

const TenantProxyRoutes = express.Router();
TenantProxyRoutes.use(authenticateToken);
TenantProxyRoutes.all('*', async (req, res) => {
  if (!req.user?.isAuthenticated && !req.user?.id) return res.status(401).json({ error: 'Sign in required' });
  const path = req.path.replace(/\/$/, '') || '/';
  if (!ALLOWED.some((r) => r.method === req.method && r.test(path))) return res.status(404).json({ error: 'Not found' });
  try {
    const response = await fetch(REMOTE() + '/tenants' + (path === '/' ? '' : path), {
      method: req.method,
      headers: { Authorization: req.headers.authorization || '', 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    res.status(response.status).set('Cache-Control', 'no-store').type('application/json').send(text || '{}');
  } catch (error) {
    res.status(502).json({ error: 'Cloud unreachable: ' + error.message });
  }
});

export default TenantProxyRoutes;
