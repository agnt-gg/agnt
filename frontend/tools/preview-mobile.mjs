#!/usr/bin/env node
// Serve THIS worktree's built frontend without replacing the running AGNT app.
// All authenticated API/Socket.IO requests use the existing local backend.
import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Build this worktree first: cd frontend && npx vite build');
const port = Number(process.env.AGNT_MOBILE_PREVIEW_PORT || 5181);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('AGNT_MOBILE_PREVIEW_PORT must be an integer from 1024 to 65535');
const server = await preview({ configFile: false, root, build: { outDir: 'dist' }, preview: {
  host: '127.0.0.1', port, strictPort: true,
  proxy: {
    '/api': { target: 'http://127.0.0.1:3333', changeOrigin: true },
    '/socket.io': { target: 'http://127.0.0.1:3333', changeOrigin: true, ws: true },
  },
} });
console.log(`AGNT-One MOBILE CHILD preview: http://127.0.0.1:${port}/chat`);
console.log(`Frontend: ${root}`);
console.log('API: existing local AGNT backend. Sign in normally; real account actions are real. Ctrl+C stops only this preview.');
function stop() { server.httpServer.close(() => process.exit(0)); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
