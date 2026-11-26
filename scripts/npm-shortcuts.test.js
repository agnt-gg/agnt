import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'));
function run(args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--silent', 'run', ...args], { cwd, env: { ...process.env, AGNT_AUTH_TOKEN: 'must-not-send' }, shell: process.platform === 'win32' });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
async function server(handler, test) {
  const requests = [];
  const app = http.createServer((req, res) => { requests.push({ method: req.method, url: req.url, auth: req.headers.authorization }); handler(req, res); });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await test(`http://127.0.0.1:${app.address().port}`, requests); }
  finally { await new Promise(resolve => app.close(resolve)); }
}
const reply = (res, value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
describe('npm shortcuts', () => {
  it('keeps existing desktop packaging and backend development unchanged', () => {
    expect(pkg.scripts.build).toBe('electron-builder');
    expect(pkg.scripts.dev).toBe('node backend/server.js');
    expect(pkg.scripts['restart:backend']).toBeUndefined();
  });
  for (const action of ['build', 'dev']) {
    it(`${action}:frontend forwards argv once, without dotenv, and propagates failure`, async () => {
      expect(pkg.scripts[`${action}:frontend`]).toBe(`npm --prefix frontend run ${action} --`);
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-shortcuts-'));
      try {
        await fs.mkdir(path.join(dir, 'frontend'));
        await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { shortcut: pkg.scripts[`${action}:frontend`] } }));
        await fs.writeFile(path.join(dir, 'frontend/package.json'), JSON.stringify({ scripts: { [action]: 'node recorder.cjs' } }));
        await fs.writeFile(path.join(dir, '.env'), 'SHORTCUT_SENTINEL=loaded\n');
        await fs.writeFile(path.join(dir, 'frontend/recorder.cjs'), `console.log(JSON.stringify({args:process.argv.slice(2),dotenv:process.env.SHORTCUT_SENTINEL??null}));process.exit(23);`);
        const result = await run(['shortcut', '--', 'file with spaces', '$(not-a-command)', '--mode', 'test'], dir);
        expect(result.code).toBe(23);
        expect(JSON.parse(result.stdout)).toEqual({ args: ['file with spaces', '$(not-a-command)', '--mode', 'test'], dotenv: null });
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
  }
  it('reports running status and matching health using GET only, without credentials', async () => {
    await server((req, res) => reply(res, req.url === '/api/system/status' ? { state: 'running', pid: 123, uptimeMs: 42 } : { status: 'OK', pid: 123 }), async (url, requests) => {
      const result = await run(['app:status', '--', '--json', '--url', url]);
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ success: true, url, state: 'running', pid: 123, uptimeMs: 42, healthy: true });
      expect(requests).toEqual([{ method: 'GET', url: '/api/system/status', auth: undefined }, { method: 'GET', url: '/api/health', auth: undefined }]);
    });
  });
  for (const [name, status, health] of [
    ['draining', { state: 'draining', pid: 123, uptimeMs: 1 }, { status: 'OK', pid: 123 }],
    ['malformed status', { state: 'running', pid: -1, uptimeMs: 1 }, { status: 'OK', pid: -1 }],
    ['PID mismatch', { state: 'running', pid: 123, uptimeMs: 1 }, { status: 'OK', pid: 456 }],
    ['unhealthy', { state: 'running', pid: 123, uptimeMs: 1 }, { status: 'bad', pid: 123 }],
  ]) it(`returns nonzero for ${name}`, async () => {
    await server((req, res) => reply(res, req.url === '/api/system/status' ? status : health), async url => {
      const result = await run(['app:status', '--', '--json', '--url', url]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout).success).toBe(false);
    });
  });
  for (const mode of ['redirect', 'invalid JSON', 'oversized', 'timeout', 'HTTP failure']) it(`fails safely on ${mode}`, async () => {
    await server((req, res) => {
      if (mode === 'timeout') return;
      if (mode === 'redirect') { res.writeHead(302, { Location: '/redirect-target' }); res.end(); }
      else if (mode === 'HTTP failure') { res.writeHead(503); res.end('private body'); }
      else res.end(mode === 'oversized' ? 'x'.repeat(17000) : 'private body');
    }, async (url, requests) => {
      const result = await run(['app:status', '--', '--json', '--url', url, '--timeout-ms', '100']);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout).success).toBe(false);
      expect(result.stdout).not.toContain('private body');
      expect(requests).toHaveLength(1);
    });
  });
  it('rejects remote, credential-bearing and unknown options before making requests', async () => {
    for (const args of [['--url', 'https://example.com'], ['--url', 'http://user:pass@127.0.0.1:3333'], ['--token', 'private'], ['--timeout-ms', '0'], ['--url', 'http://127.0.0.1:0']]) {
      const result = await run(['app:status', '--', '--json', ...args]);
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).not.toContain('private');
    }
  });
  it('prints help without needing a backend', async () => {
    const result = await run(['app:status', '--', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('read-only');
  });
});
