import path from 'path';
import { isStaticAssetRequest } from '../utils/staticAssetRequest.js';

/**
 * The catch-all that backs client-side routing.
 *
 * Three classes of request reach it, and each needs a different answer:
 *
 *   /api/...            -> 404 JSON. Serving the shell here makes every client
 *                          (including LLM agents) JSON.parse HTML and carry on.
 *   a build artefact    -> 404 JSON. This is the stale-chunk case: a renderer
 *                          left open across a rebuild requests a content hash
 *                          that no longer exists. Answering 200 text/html makes
 *                          the browser reject it as a module script, and the
 *                          lazy screen renders blank with no error anywhere.
 *   anything else       -> index.html, i.e. a real SPA route.
 *
 * Extracted from server.js so it can be exercised directly.
 */
export function createSpaFallback({ frontendDistPath }) {
  const indexFile = path.join(frontendDistPath, 'index.html');

  return function spaFallback(req, res) {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found', path: req.path });
    }

    if (isStaticAssetRequest(req.path)) {
      return res.status(404).json({ error: 'Asset not found', path: req.path });
    }

    return res.sendFile(indexFile);
  };
}
