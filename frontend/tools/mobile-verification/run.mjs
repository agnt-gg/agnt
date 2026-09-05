import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { frontendRoot, evidence } from './paths.mjs';

// A bundled verification build prevents Chromium's unbundled dev-module request
// fanout from exhausting request slots. It uses the real Vue components and
// stores, but the harness intercepts HTTP/SSE/EventSource with local fixtures.
if (fs.existsSync(evidence)) throw Error('Evidence directory must be new: ' + evidence);
fs.mkdirSync(evidence, { recursive: true });
const { build } = await import(pathToFileURL(path.join(frontendRoot, 'node_modules/vite/dist/node/index.js')));
const { default: vue } = await import(pathToFileURL(path.join(frontendRoot, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')));
const { aliases } = await import(pathToFileURL(path.join(frontendRoot, 'build/aliases.js')));
await build({ configFile: false, root: frontendRoot, base: '/', publicDir: path.join(frontendRoot, 'public'), plugins: [vue()], resolve: { alias: aliases }, build: {
  target: 'esnext', copyPublicDir: false, outDir: path.join(evidence, 'bundle'), emptyOutDir: false,
  rollupOptions: { input: { all: path.join(frontendRoot, '_harness/mobile-all.html'), chat: path.join(frontendRoot, '_harness/mobile.html') } },
} });
for (const script of ['matrix.mjs', 'journeys.mjs', 'nested.mjs', 'docs.mjs']) {
  const result = spawnSync(process.execPath, [new URL(script, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { cwd: frontendRoot, stdio: 'inherit', env: process.env, timeout: 300000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(script + ' failed with exit code ' + result.status);
}
console.log('All bundled mobile checks passed. Evidence: ' + evidence);
