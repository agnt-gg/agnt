#!/usr/bin/env node
// Serve THIS worktree's built frontend without replacing the running AGNT app.
// All authenticated API/Socket.IO requests use the existing local backend.
import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Build this worktree first: cd frontend && npx vite build');
const port = Number(process.env.AGNT_MOBILE_PREVIEW_PORT || 5181);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('AGNT_MOBILE_PREVIEW_PORT must be an integer from 1024 to 65535');
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const review = {
  name: 'mobile-review-only',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = req.url?.split('?')[0];
      if (pathname === '/mobile-review') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(fs.readFileSync(path.join(root, 'tools', 'mobile-review.html'), 'utf8'));
      } else if (pathname === '/__mobile_provenance__') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ branch, commit, indexSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'dist', 'index.html'))).digest('hex') }));
      } else next();
    });
  },
};
const server = await preview({ configFile: false, root, plugins: [review], build: { outDir: 'dist' }, preview: {
  host: '127.0.0.1', port, strictPort: true,
  proxy: {
    '/api': { target: 'http://127.0.0.1:3333', changeOrigin: true },
    '/socket.io': { target: 'http://127.0.0.1:3333', changeOrigin: true, ws: true },
  },
} });
console.log(`AGNT-One MOBILE CHILD review: http://127.0.0.1:${port}/mobile-review`);
console.log(`Full window: http://127.0.0.1:${port}/chat`);
console.log(`Frontend: ${root}`);
console.log('API: existing local AGNT backend. Sign in normally; real account actions are real. Ctrl+C stops only this preview.');
function stop() { server.httpServer.close(() => process.exit(0)); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
