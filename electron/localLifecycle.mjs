// Local source-desktop control. OS directory/socket permissions authorize the user.
// This is not an HTTP auth bypass and never reads application credentials.
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function selectTransport({ mode = 'auto', token, managed = false } = {}) {
  if (!['auto', 'api', 'local'].includes(mode)) throw new Error('Invalid transport');
  if (mode === 'local' && (managed || token !== undefined)) throw new Error('Local transport cannot override supplied API credentials or AGNT context');
  const selected = mode === 'auto' ? (managed || token !== undefined ? 'api' : 'local') : mode;
  if (selected === 'api' && (typeof token !== 'string' || !token.trim() || /\s/.test(token))) throw new Error('AGNT API caller requires a valid AGNT_AUTH_TOKEN environment value');
  return selected;
}

async function privateDirectory(dir) {
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error('Local control directory is not private to this OS user');
}
export async function controlAddress(checkout, supervisorPid, { runtime = `/run/user/${process.getuid?.()}` } = {}) {
  if (process.platform !== 'linux') throw new Error('Local control currently supports Linux source Electron only');
  if (!Number.isSafeInteger(supervisorPid) || supervisorPid < 1) throw new Error('Invalid supervisor PID');
  await privateDirectory(runtime);
  const root = await fs.realpath(checkout);
  const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const dir = path.join(runtime, `agnt-${key}-${supervisorPid}`);
  const socket = path.join(dir, 'control.sock');
  if (Buffer.byteLength(socket) > 103) throw new Error('Local socket path too long');
  return { root, dir, socket };
}

export async function startLocalControl({ checkout, getPid, restart, runtime }) {
  const address = await controlAddress(checkout, process.pid, { runtime });
  try { await fs.mkdir(address.dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  await privateDirectory(address.dir);
  // Never unlink a pre-existing socket; a collision is a blocker, not stale proof.
  let busy = false;
  const clients = new Set();
  const server = net.createServer(socket => {
    clients.add(socket); socket.on('close', () => clients.delete(socket)); socket.on('error', () => {});
    socket.setTimeout(65000, () => socket.destroy());
    let input = '', handled = false;
    socket.on('data', async chunk => {
      if (handled) return;
      input += chunk.toString('utf8');
      if (Buffer.byteLength(input) > 2048) { handled = true; socket.destroy(); return; }
      if (!input.includes('\n')) return;
      handled = true;
      const reply = body => { if (!socket.destroyed) socket.end(JSON.stringify(body) + '\n'); };
      let request;
      try { request = JSON.parse(input.trim()); } catch { reply({ success: false, error: 'Malformed local request' }); return; }
      if (!request || request.checkout !== address.root || request.supervisorPid !== process.pid || request.pid !== getPid() || !['preflight', 'restart'].includes(request.operation)) {
        reply({ success: false, error: 'Local target identity mismatch' }); return;
      }
      if (busy) { reply({ success: false, error: 'Local restart already in progress' }); return; }
      if (request.operation === 'preflight') { reply({ success: true, pid: request.pid, supervisorPid: process.pid }); return; }
      busy = true;
      try {
        const result = await restart(request.pid);
        reply({ success: true, ...result, supervisorPid: process.pid });
      } catch {
        reply({ success: false, error: 'Local restart did not verify backend and renderer recovery; inspect status before retrying' });
      } finally { busy = false; }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address.socket, resolve); });
  await fs.chmod(address.socket, 0o600);
  const identity = await fs.lstat(address.socket);
  server.on('error', () => {});
  return {
    address,
    async close() {
      for (const socket of clients) socket.destroy();
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 500);
        server.close(() => { clearTimeout(timer); resolve(); });
      });
      // Node unlinks its own listening socket. Never recursively remove a directory.
      try { const st = await fs.lstat(address.socket); if (st.dev === identity.dev && st.ino === identity.ino) await fs.unlink(address.socket); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      try { await fs.rmdir(address.dir); } catch (e) { if (!['ENOENT', 'ENOTEMPTY'].includes(e.code)) throw e; }
    },
  };
}

export async function localRequest({ checkout, supervisorPid, pid, operation, timeoutMs = 60000, runtime }) {
  const address = await controlAddress(checkout, supervisorPid, { runtime });
  try {
    await privateDirectory(address.dir);
    const st = await fs.lstat(address.socket);
    if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error('Unsafe local socket');
  } catch {
    throw new Error('Local desktop control is unavailable. Quit and relaunch Electron once to load it; no restart was sent');
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address.socket);
    let result = '', sent = false, settled = false;
    const finish = (error, data) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(data); };
    const uncertain = () => new Error(sent ? 'Local restart outcome uncertain; inspect status before retrying (no retry)' : 'Local control connection unavailable; no request sent');
    const timer = setTimeout(() => finish(uncertain()), timeoutMs);
    socket.on('error', () => finish(uncertain()));
    socket.on('end', () => { if (!settled) finish(uncertain()); });
    socket.on('connect', () => {
      sent = true;
      socket.write(JSON.stringify({ checkout: address.root, supervisorPid, pid, operation }) + '\n');
    });
    socket.on('data', chunk => {
      result += chunk.toString('utf8');
      if (Buffer.byteLength(result) > 8192) { finish(uncertain()); return; }
      if (!result.includes('\n')) return;
      try {
        const body = JSON.parse(result.trim());
        if (body.success !== true) { finish(new Error('Local control refused or failed recovery; inspect status before retrying')); return; }
        if (body.supervisorPid !== supervisorPid) throw new Error();
        finish(null, body);
      } catch { finish(uncertain()); }
    });
  });
}
