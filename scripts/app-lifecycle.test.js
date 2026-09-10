import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, inspectOwnership, executeLifecycle } from './app-lifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = { verified: true, checkout: root, supervisorPid: 8, supervisorStart: '900', backendStart: '1000' };
const before = { state: 'running', pid: 101, uptimeMs: 4000 };
const after = { state: 'running', pid: 102, uptimeMs: 20 };
const token = 'fixture-only-not-a-real-credential';
const options = (url, command = 'restart') => ({ command, url, timeoutMs: 500, requestTimeoutMs: 100, pollMs: 10 });

async function fixture(handler, run) {
  const calls = [];
  const server = createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    await handler(req, res, calls);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`, calls); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function json(res, body, status = 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
function normal(req, res, calls) {
  const restarted = calls.some(c => c.method === 'POST');
  if (req.method === 'POST') return json(res, { success: true }, 202);
  if (req.url === '/api/health') return json(res, { status: 'OK', pid: restarted ? 102 : 101 });
  json(res, restarted ? after : before);
}
const deps = { token, checkout: root, inspect: async () => identity };

// Fake /proc records keep process detection deterministic and portable in CI.
function procFixture(overrides = {}) {
  const backend = `${root}/backend`;
  const electron = `${root}/node_modules/electron/dist/electron`;
  const stat = (pid, ppid, start) => `${pid} (name with ) spaces) S ${ppid} ${Array(17).fill('0').join(' ')} ${start} 0`;
  const records = {
    '/proc/101/stat': stat(101, 8, '1000'), '/proc/8/stat': stat(8, 1, '900'),
    '/proc/101/cmdline': `node\0${backend}/server.js\0`, '/proc/8/cmdline': `${electron}\0.\0`,
    '/proc/101/cwd': backend, '/proc/8/cwd': root, '/proc/8/exe': electron,
    '/proc/101/fd/7': 'socket:[555]',
    '/proc/101/net/tcp': 'sl local_address rem_address st tx rx tr tm retr uid timeout inode\n 0: 0100007F:0D05 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 555 1',
    '/proc/101/net/tcp6': '', ...overrides,
  };
  const read = async p => { if (!(p in records)) throw new Error('missing fixture'); return records[p]; };
  return { platform: 'linux', readFile: read, readlink: read, readdir: async () => ['7'], realpath: async p => p };
}

describe('npm app lifecycle option contract', () => {
  it('defaults to read-only status on explicit loopback', () => {
    expect(parseOptions([])).toMatchObject({ command: 'status', url: 'http://127.0.0.1:3333', timeoutMs: 60000 });
  });
  it('accepts explicit timeout/port and JSON status', () => {
    expect(parseOptions(['status', '--url', 'http://127.0.0.1:4444', '--timeout-ms', '500', '--json'])).toMatchObject({ timeoutMs: 500, json: true });
  });
  it.each(['http://example.com', 'https://127.0.0.1', 'http://localhost:3333', 'http://127.1', 'http://user:pass@127.0.0.1:3333', 'http://127.0.0.1:3333/api', 'http://127.0.0.1:3333/?secret=x', 'http://127.0.0.1:3333/#x'])('rejects unsafe or ambiguous origin %s', url => {
    expect(() => parseOptions(['restart', '--url', url])).toThrow(/loopback|origin/i);
  });
  it.each([['--unknown'], ['restart', '--token', 'x'], ['status', '--timeout-ms', 'NaN'], ['status', '--timeout-ms', '0'], ['status', '--url'], ['status', '--json', '--json'], ['restart', 'status']])('rejects malformed args %j', args => {
    expect(() => parseOptions(args)).toThrow();
  });
});

describe('source Electron process ownership', () => {
  it('verifies direct Electron parent, source path, socket and start identities', async () => {
    expect(await inspectOwnership(101, root, 3333, procFixture())).toMatchObject(identity);
  });
  it('accepts the exact process title Electron writes on Linux', async () => {
    const title = `${root}/node_modules/electron/dist/electron .\0`;
    expect((await inspectOwnership(101, root, 3333, procFixture({ '/proc/8/cmdline': title }))).verified).toBe(true);
  });
  it.each([
    { '/proc/8/cmdline': `${root}/node_modules/electron/dist/electron . --unknown\0` },
    { '/proc/101/cwd': '/other/backend' },
    { '/proc/101/cmdline': 'node\0/other/backend/server.js\0' },
    { '/proc/8/cwd': '/other' },
    { '/proc/8/exe': '/usr/bin/node' },
    { '/proc/8/cmdline': 'node\0supervisor.js\0' },
    { '/proc/101/fd/7': 'socket:[999]' },
    { '/proc/101/net/tcp': '' },
    { '/proc/101/stat': 'invalid' },
  ])('refuses ambiguous/wrong ownership %j', async override => {
    expect((await inspectOwnership(101, root, 3333, procFixture(override))).verified).toBe(false);
  });
  it('refuses PID reuse while inspecting ownership', async () => {
    const io = procFixture(); const read = io.readFile; let seen = 0;
    io.readFile = async p => {
      const value = await read(p);
      return p === '/proc/101/stat' && ++seen > 1 ? value.replace('1000 0', '1001 0') : value;
    };
    expect((await inspectOwnership(101, root, 3333, io)).verified).toBe(false);
  });
  it('refuses an inaccessible process table', async () => {
    expect((await inspectOwnership(101, root, 3333, { platform: 'linux', realpath: async () => { throw new Error('EACCES'); } })).verified).toBe(false);
  });
  it('does not inspect foreign OS processes', async () => {
    const readFile = vi.fn();
    expect((await inspectOwnership(101, root, 3333, { platform: 'win32', readFile })).verified).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('HTTP lifecycle behavior', () => {
  it('reads live status without token or POST', async () => {
    await fixture(normal, async (url, calls) => {
      const result = await executeLifecycle(options(url, 'status'), deps);
      expect(result).toMatchObject({ success: true, state: 'running', pid: 101, ownership: identity });
      expect(calls.every(c => c.method === 'GET' && !c.authorization)).toBe(true);
    });
  });
  it('reports ownership unknown on healthy status rather than inventing supervision', async () => {
    await fixture(normal, async url => {
      const result = await executeLifecycle(options(url, 'status'), { ...deps, inspect: async () => ({ verified: false, reason: 'unsupported' }) });
      expect(result.ownership).toMatchObject({ verified: false });
      expect(result.success).toBe(true);
    });
  });
  it('sends exactly one authenticated POST and proves a changed healthy PID', async () => {
    await fixture(normal, async (url, calls) => {
      const result = await executeLifecycle(options(url), deps);
      expect(result).toMatchObject({ success: true, previousPid: 101, pid: 102 });
      expect(calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', path: '/api/system/restart', authorization: `Bearer ${token}` }]);
      expect(calls.filter(c => c.method === 'GET').every(c => !c.authorization)).toBe(true);
    });
  });
  it.each(['', undefined])('refuses missing token before POST (%s)', async credential => {
    await fixture(normal, async (url, calls) => {
      await expect(executeLifecycle({ ...options(url), transport: 'api' }, { ...deps, token: credential })).rejects.toThrow(/AGNT_AUTH_TOKEN/);
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    });
  });
  it('refuses wrong checkout/standalone before POST', async () => {
    await fixture(normal, async (url, calls) => {
      await expect(executeLifecycle(options(url), { ...deps, inspect: async () => ({ verified: false, reason: 'wrong owner' }) })).rejects.toThrow(/ownership|supervis/i);
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    });
  });
  it.each([{ ...before, state: 'draining' }, { ...before, pid: -1 }, { ...before, uptimeMs: 'oops' }, {}])('rejects invalid/non-running preflight %j', async state => {
    await fixture((req, res) => json(res, req.url === '/api/health' ? { status: 'OK', pid: 101 } : state), async (url, calls) => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow();
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    });
  });
  it('refuses disagreeing status/health PID', async () => {
    await fixture((req, res) => json(res, req.url === '/api/health' ? { status: 'OK', pid: 999 } : before), async (url, calls) => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow(/health|PID/i);
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    });
  });
  it.each([401, 403, 409, 500, 200])('does not retry rejected POST %s or disclose response contents', async status => {
    await fixture((req, res, calls) => req.method === 'POST' ? json(res, { secret: token }, status) : normal(req, res, calls), async (url, calls) => {
      try { await executeLifecycle(options(url), deps); throw new Error('unexpected success'); }
      catch (error) { expect(error.message).toMatch(/restart|HTTP/i); expect(error.message).not.toContain(token); }
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    });
  });
  it('never follows a redirect', async () => {
    await fixture((req, res) => { res.writeHead(302, { location: '/redirect-target' }); res.end(); }, async (url, calls) => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow(/HTTP 302/);
      expect(calls.some(c => c.path === '/redirect-target')).toBe(false);
    });
  });
  it('never follows a POST redirect or sends its token elsewhere', async () => {
    await fixture((req, res, calls) => {
      if (req.method === 'POST') { res.writeHead(307, { location: '/redirect-target' }); res.end(); return; }
      normal(req, res, calls);
    }, async (url, calls) => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow(/HTTP 307/);
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
      expect(calls.some(c => c.path === '/redirect-target')).toBe(false);
    });
  });
  it('never retries a POST whose response was lost, and warns of uncertain outcome', async () => {
    await fixture((req, res, calls) => req.method === 'POST' ? req.socket.destroy() : normal(req, res, calls), async (url, calls) => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow(/inspect app:status before retrying/);
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    });
  });
  it('times out ownership inspection before POST', async () => {
    await fixture(normal, async (url, calls) => {
      await expect(executeLifecycle({ ...options(url), timeoutMs: 100 }, { ...deps, inspect: () => new Promise(() => {}) })).rejects.toThrow(/timed out/);
      expect(calls.some(c => c.method === 'POST')).toBe(false);
    });
  });
  it('rejects a 202 body without positive acceptance', async () => {
    await fixture((req, res, calls) => req.method === 'POST' ? json(res, {}, 202) : normal(req, res, calls), async (url, calls) => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow(/acceptance/);
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    });
  });
  it('rejects small malformed JSON without disclosing its contents', async () => {
    await fixture((req, res) => res.end(token), async url => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow('Invalid JSON response');
    });
  });
  it('does not treat same-PID health as restart success', async () => {
    await fixture((req, res) => req.method === 'POST' ? json(res, { success: true }, 202) : json(res, req.url === '/api/health' ? { status: 'OK', pid: 101 } : before), async (url, calls) => {
      await expect(executeLifecycle({ ...options(url), timeoutMs: 150 }, deps)).rejects.toThrow(/recovery|timed out/i);
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    });
  });
  it('waits across transient disconnection and draining', async () => {
    let polls = 0;
    await fixture((req, res, calls) => {
      if (req.url === '/api/system/status' && calls.some(c => c.method === 'POST')) {
        polls++;
        if (polls === 1) { req.socket.destroy(); return; }
        if (polls === 2) { json(res, { ...before, state: 'draining' }); return; }
      }
      normal(req, res, calls);
    }, async url => expect(await executeLifecycle(options(url), deps)).toMatchObject({ pid: 102, success: true }));
  });
  it('does not accept a new PID with unhealthy status', async () => {
    await fixture((req, res, calls) => {
      if (req.url === '/api/health' && calls.some(c => c.method === 'POST')) return json(res, { status: 'starting', pid: 102 });
      normal(req, res, calls);
    }, async url => {
      await expect(executeLifecycle({ ...options(url), timeoutMs: 150 }, deps)).rejects.toThrow(/recovery timed out/);
    });
  });
  it('refuses a replacement supervisor after acceptance', async () => {
    await fixture(normal, async url => {
      await expect(executeLifecycle(options(url), { ...deps, inspect: async pid => ({ ...identity, supervisorStart: pid === 101 ? '900' : '901' }) })).rejects.toThrow(/supervisor|ownership/i);
    });
  });
  it('bounds hung response bodies as well as connection waits', async () => {
    await fixture((req, res) => { res.writeHead(200); res.write('{'); }, async url => {
      const started = Date.now();
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow(/timeout|timed out/i);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });
  it('rejects oversized or invalid JSON without echoing it', async () => {
    await fixture((req, res) => { res.end(token.repeat(1000)); }, async url => {
      await expect(executeLifecycle(options(url), deps)).rejects.toThrow(/response|JSON/i);
    });
  });
});

function cli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env }; delete childEnv.AGNT_AUTH_TOKEN;
    const child = spawn(process.execPath, [path.join(root, 'scripts/app-lifecycle.mjs'), ...args], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
describe('CLI and npm wiring', () => {
  it('wires the four entry points without changing existing start/dev behavior', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts).toMatchObject({ 'app:status': 'node scripts/app-lifecycle.mjs status', 'restart:backend': 'node scripts/app-lifecycle.mjs restart', 'build:frontend': 'npm --prefix frontend run build --', 'dev:frontend': 'npm --prefix frontend run dev --', start: 'electron .', dev: 'node backend/server.js' });
    expect(pkg.scripts.restart).toBeUndefined();
  });
  it('offers help without network or auth', async () => {
    const result = await cli(['--help']);
    expect(result.code).toBe(0); expect(result.stdout).toContain('AGNT_AUTH_TOKEN');
  });
  it('exits nonzero for invalid arguments', async () => {
    expect((await cli(['restart', '--token', 'secret'])).code).toBe(1);
  });
  it('prints parseable read-only JSON against a real ephemeral HTTP server', async () => {
    await fixture(normal, async (url, calls) => {
      const result = await cli(['status', '--url', url, '--json']);
      expect(result.code).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ success: true, pid: 101, ownership: { verified: false } });
      expect(calls.every(c => c.method === 'GET' && !c.authorization)).toBe(true);
    });
  });
  it('returns structured JSON and nonzero exit when status is draining', async () => {
    await fixture((req, res) => json(res, req.url === '/api/health' ? { status: 'OK', pid: 101 } : { ...before, state: 'draining' }), async url => {
      const result = await cli(['status', '--url', url, '--json']);
      expect(result.code).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ success: false, state: 'draining' });
    });
  });
  it('refuses CLI restart without credentials without issuing POST', async () => {
    await fixture(normal, async (url, calls) => {
      const result = await cli(['restart', '--transport', 'api', '--url', url]);
      expect(result.code).toBe(1); expect(result.stderr).toContain('AGNT_AUTH_TOKEN');
      expect(calls.some(c => c.method === 'POST')).toBe(false);
    });
  });
});
