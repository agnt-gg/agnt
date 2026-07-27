/**
 * Local static UI + reverse proxy for external-backend desktop mode.
 *
 * Why:
 *  - Always serve *this* app's frontend (Settings → Connection, etc.)
 *  - Proxy /api and /socket.io to the remote AGNT host so the page is
 *    same-origin: auth tokens in localStorage, no CORS headaches, Socket.IO works.
 *  - Fixed port (default 19333) so localStorage survives app restarts.
 *
 * TLS: certificates are verified by default. For LAN self-signed remotes set
 * AGNT_PROXY_INSECURE_TLS=1 (or NODE_TLS_REJECT_UNAUTHORIZED=0).
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';

/** Default loopback port for the desktop UI (stable localStorage origin). */
export const DEFAULT_LOCAL_UI_PORT = 19333;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function shouldProxy(pathname) {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/socket.io' ||
    pathname.startsWith('/socket.io/')
  );
}

/**
 * Whether outbound HTTPS to the remote should skip certificate verification.
 * Default is verify (secure). Opt-out only for known self-signed LAN servers.
 */
export function shouldRejectUnauthorized() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return false;
  const v = process.env.AGNT_PROXY_INSECURE_TLS;
  if (v === '1' || v === 'true' || v === 'yes') return false;
  return true;
}

function requestTlsOptions() {
  return { rejectUnauthorized: shouldRejectUnauthorized() };
}

/**
 * Strip leading slashes so path.join(distDir, relative) never treats the
 * segment as an absolute path (path.join('/dist', '/app.js') === '/app.js').
 */
export function pathnameToRelative(pathname) {
  return String(pathname || '').replace(/^\/+/, '') || 'index.html';
}

/**
 * Forward an HTTP request to the remote backend.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} targetBase remote origin e.g. http://192.168.1.10:3333
 */
function proxyHttp(req, res, targetBase) {
  const targetUrl = new URL(req.url || '/', targetBase);
  const lib = targetBase.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: targetBase.host };

  // Avoid compressed mismatch issues when piping
  delete headers['accept-encoding'];

  const proxyReq = lib.request(
    {
      protocol: targetBase.protocol,
      hostname: targetBase.hostname,
      port: targetBase.port || (targetBase.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
      ...requestTlsOptions(),
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('[local-ui] API proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: `Proxy to ${targetBase.origin} failed: ${err.message}` }));
  });

  req.pipe(proxyReq);
}

/**
 * WebSocket upgrade proxy (Socket.IO).
 * @param {import('http').IncomingMessage} req
 * @param {import('stream').Duplex} socket
 * @param {Buffer} head
 * @param {URL} targetBase
 */
function proxyUpgrade(req, socket, head, targetBase) {
  const lib = targetBase.protocol === 'https:' ? https : http;
  const targetUrl = new URL(req.url || '/', targetBase);
  const headers = { ...req.headers, host: targetBase.host };

  const proxyReq = lib.request({
    protocol: targetBase.protocol,
    hostname: targetBase.hostname,
    port: targetBase.port || (targetBase.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: 'GET',
    headers,
    ...requestTlsOptions(),
  });

  let settled = false;
  const failClient = (status, message) => {
    if (settled || socket.destroyed) return;
    settled = true;
    try {
      socket.write(
        `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`
      );
    } catch {
      /* ignore */
    }
    socket.destroy();
  };

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    settled = true;
    const statusLine = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n`;
    let responseHeaders = statusLine;
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) responseHeaders += `${key}: ${v}\r\n`;
      } else if (value !== undefined) {
        responseHeaders += `${key}: ${value}\r\n`;
      }
    }
    responseHeaders += '\r\n';
    socket.write(responseHeaders);
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);

    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    proxySocket.on('error', (err) => {
      console.error('[local-ui] WS proxy socket error:', err.message);
      socket.destroy();
    });
    socket.on('error', () => proxySocket.destroy());
  });

  // Backend answered without upgrading (4xx/5xx/200) — must not leave client hanging.
  proxyReq.on('response', (proxyRes) => {
    console.warn(
      `[local-ui] WS upgrade rejected by remote: HTTP ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}`
    );
    proxyRes.resume();
    failClient(502, 'WebSocket upgrade failed');
  });

  proxyReq.on('error', (err) => {
    console.error('[local-ui] WS upgrade proxy error:', err.message);
    failClient(502, err.message || 'WebSocket proxy error');
  });

  proxyReq.end();
}

function serveStatic(req, res, distDir, indexPath, distRoot) {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    // Relative path only — never pass a leading "/" into path.join (absolute segment).
    const relative = pathnameToRelative(pathname);
    const resolved = path.normalize(path.join(distDir, relative));
    const root = distRoot || (distDir.endsWith(path.sep) ? distDir : distDir + path.sep);

    // Allow exact distDir match or files under distRoot
    if (resolved !== distDir && !resolved.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let filePath = resolved;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = indexPath;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[local-ui] serve error:', err.message);
    res.writeHead(500);
    res.end('Internal error');
  }
}

/**
 * @param {string} distDir absolute path to frontend/dist
 * @param {object} [opts]
 * @param {string} [opts.proxyTarget] remote backend base URL (no /api)
 * @param {number} [opts.port] preferred fixed port (default 19333)
 * @returns {Promise<{ server: http.Server, port: number, origin: string }>}
 */
export function startLocalUiServer(distDir, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(distDir)) {
      reject(new Error(`Frontend dist not found at ${distDir}. Build the frontend first.`));
      return;
    }
    const indexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      reject(new Error(`frontend/dist/index.html missing at ${distDir}`));
      return;
    }

    let targetBase = null;
    if (opts.proxyTarget) {
      try {
        targetBase = new URL(opts.proxyTarget);
      } catch {
        reject(new Error(`Invalid proxy target: ${opts.proxyTarget}`));
        return;
      }
    }

    // Allow port 0 (ephemeral) for tests; 0 is falsy so don't use `||`.
    const preferredPort =
      opts.port !== undefined && opts.port !== null
        ? Number(opts.port)
        : Number(process.env.AGNT_UI_PORT || DEFAULT_LOCAL_UI_PORT);

    // Normalize for path-escape checks (trailing sep avoids /dist vs /dist-evil)
    const distRoot = distDir.endsWith(path.sep) ? distDir : distDir + path.sep;

    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (targetBase && shouldProxy(pathname)) {
        proxyHttp(req, res, targetBase);
        return;
      }
      serveStatic(req, res, distDir, indexPath, distRoot);
    });

    if (targetBase) {
      server.on('upgrade', (req, socket, head) => {
        const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
        if (shouldProxy(pathname)) {
          proxyUpgrade(req, socket, head, targetBase);
        } else {
          socket.destroy();
        }
      });
    }

    const onListen = () => {
      const { port } = server.address();
      const origin = `http://127.0.0.1:${port}`;
      console.log(
        `[local-ui] UI at ${origin} (dist=${distDir}` +
          (targetBase ? `, proxy→${targetBase.origin}` : '') +
          ')'
      );
      resolve({ server, port, origin });
    };

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        console.warn(`[local-ui] Port ${preferredPort} in use — falling back to ephemeral port`);
        server.removeAllListeners('error');
        server.once('error', reject);
        server.listen(0, '127.0.0.1', onListen);
        return;
      }
      reject(err);
    });

    server.listen(preferredPort, '127.0.0.1', onListen);
  });
}

/**
 * Resolve frontend/dist for dev vs packaged Electron.
 * @param {{ app: import('electron').App, dirname: string }} opts
 */
export function resolveFrontendDistPath({ app, dirname }) {
  const candidates = [
    path.join(dirname, 'frontend', 'dist'),
    app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'frontend', 'dist') : null,
    app.isPackaged ? path.join(process.resourcesPath, 'frontend', 'dist') : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return candidates[0];
}
