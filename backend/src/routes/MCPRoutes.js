import express from 'express';
import MCPService from '../services/MCPService.js';
import MCPOAuthService from '../services/MCPOAuthService.js';
import { authenticateToken } from './Middleware.js';

const MCPRoutes = express.Router();

// All routes require authentication - bind methods to preserve 'this' context
MCPRoutes.get('/servers', authenticateToken, MCPService.getServers.bind(MCPService));
MCPRoutes.post('/servers', authenticateToken, MCPService.addServer.bind(MCPService));
MCPRoutes.put('/servers/:name', authenticateToken, MCPService.updateServer.bind(MCPService));
MCPRoutes.delete('/servers/:name', authenticateToken, MCPService.deleteServer.bind(MCPService));
MCPRoutes.get('/servers/:name/capabilities', authenticateToken, MCPService.getServerCapabilities.bind(MCPService));
MCPRoutes.post('/servers/:name/test', authenticateToken, MCPService.testConnection.bind(MCPService));

/* ----------------------------------------------------------------------
 * OAuth 2.1 for remote MCP servers
 *
 * The redirect URI must be a fixed, pre-registrable value, so it points at
 * this backend rather than at an ephemeral port.
 * -------------------------------------------------------------------- */

const redirectUriFor = (req) => {
  const configured = process.env.MCP_OAUTH_REDIRECT_URI;
  if (configured) return configured;
  // Loopback only: this URL is handed to an external authorization server,
  // and req.headers.host is attacker-controllable in general.
  const port = process.env.PORT || 3333;
  return `http://localhost:${port}/api/mcp/oauth/callback`;
};

/** Credential status for one server. Never returns token material. */
MCPRoutes.get('/oauth/:name/status', authenticateToken, (req, res) => {
  try {
    res.json({ success: true, ...MCPOAuthService.status(req.params.name) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** Begin authorization: discover + dynamically register + return the URL. */
MCPRoutes.post('/oauth/:name/connect', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const config = await MCPService.readMCPFile();
    const server = (config.servers || []).find((s) => s.name === name);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    const endpoint = server.transport?.endpoint || server.transport?.url;
    if (!endpoint) {
      return res.status(400).json({ success: false, error: 'Server has no remote endpoint to authorize against' });
    }

    const result = await MCPOAuthService.beginAuthorization({
      serverName: server.auth?.identity || name,
      endpoint,
      redirectUri: redirectUriFor(req),
      clientName: 'AGNT',
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[MCPRoutes] OAuth connect failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Authorization callback.
 *
 * Deliberately NOT behind authenticateToken: this is a browser redirect from
 * the provider and carries no AGNT session. CSRF protection is the `state`
 * parameter, which is 24 bytes of CSPRNG output held server-side, consumed
 * once, and expired after 10 minutes.
 */
MCPRoutes.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  const page = (ok, title, detail) => `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<style>
 body{background:#0b0d10;color:#e8eaed;font:15px/1.6 -apple-system,Segoe UI,sans-serif;
      display:grid;place-items:center;height:100vh;margin:0}
 .c{text-align:center;max-width:440px;padding:2rem}
 .b{font-size:2.5rem;margin-bottom:.5rem;color:${ok ? '#34a853' : '#ea4335'}}
 .m{color:#9aa0a6}
</style>
<div class="c"><div class="b">${ok ? '&#10003;' : '&#10007;'}</div>
<h2>${title}</h2><p class="m">${detail}</p></div>`;

  if (error) {
    return res.status(400).send(page(false, 'Authorization failed', `${error}: ${errorDescription || ''}`));
  }
  if (!code || !state) {
    return res.status(400).send(page(false, 'Invalid callback', 'Missing code or state parameter.'));
  }

  try {
    const result = await MCPOAuthService.completeAuthorization({ state: String(state), code: String(code) });

    // Tools become available only after a schema refresh against the now-
    // authenticated server, so trigger it rather than making the user click.
    try {
      const { default: MCPToolService } = await import('../services/MCPToolService.js');
      MCPToolService.invalidate();
    } catch (err) {
      console.warn('[MCPRoutes] Schema refresh after OAuth failed:', err.message);
    }

    res.send(page(true, `Connected to ${result.serverName}`, 'You can close this tab and return to AGNT.'));
  } catch (err) {
    console.error('[MCPRoutes] OAuth callback failed:', err.message);
    res.status(400).send(page(false, 'Could not complete authorization', err.message));
  }
});

/** Revoke and forget stored credentials. */
MCPRoutes.post('/oauth/:name/disconnect', authenticateToken, async (req, res) => {
  try {
    await MCPOAuthService.disconnect(req.params.name);
    try {
      const { default: MCPToolService } = await import('../services/MCPToolService.js');
      MCPToolService.invalidate();
    } catch { /* non-fatal */ }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('MCP Routes Started...');

export default MCPRoutes;
