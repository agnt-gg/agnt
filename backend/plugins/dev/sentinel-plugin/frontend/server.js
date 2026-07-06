// Standalone Sentinel frontend: an ultra-simple Express server + single-page UI so you
// can audit a target WITHOUT building an AGNT workflow. One input, one button, live
// SSE progress, rendered report. Runs independently of AGNT on its own port.
//
// Usage:  node frontend/server.js        (defaults to port 4545)
//         set SENTINEL_PORT=4600 && node frontend/server.js
//
// Zero third-party deps — uses Node's built-in http module.

import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { scan } from '../core/engine.js';
import { generateReportProse } from '../core/llm.js';
import { renderHtml } from '../core/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.SENTINEL_PORT || '4545', 10);
const HOST = process.env.SENTINEL_HOST || '127.0.0.1';

const INDEX = readFileSync(join(__dirname, 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(INDEX);
  }

  // SSE audit stream: /audit?target=...&depth=...&provider=...
  if (req.method === 'GET' && url.pathname === '/audit') {
    const target = (url.searchParams.get('target') || '').trim();
    const depth = url.searchParams.get('depth') || 'standard';
    const provider = url.searchParams.get('provider') || 'none';
    if (!target) { res.writeHead(400); return res.end('target required'); }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send('progress', { msg: `Starting audit of ${target} …` });
    try {
      const scanRes = await scan(target, {
        depth,
        webActiveProbe: true,
        onProgress: (m) => send('progress', { msg: m }),
      });
      if (!scanRes.success) { send('error', { error: scanRes.error }); return res.end(); }

      send('progress', { msg: `Scan complete: ${scanRes.summary.total} finding(s). Writing report …` });
      const prose = await generateReportProse(scanRes.findings, scanRes.summary, provider);
      const html = renderHtml(scanRes.findings, scanRes.summary, prose);

      send('done', {
        summary: scanRes.summary,
        findings: scanRes.findings,
        html,
        narrativeProvider: prose.provider,
      });
    } catch (e) {
      send('error', { error: e.message });
    }
    return res.end();
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🛡️  Sentinel frontend running at  http://${HOST}:${PORT}/\n`);
  console.log('  Drop a git URL, a local directory path, or a live URL and press Audit.\n');
});
