#!/usr/bin/env node
/** Local source-checkout lifecycle client. Never a second process supervisor. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { selectTransport, localRequest } from '../electron/localLifecycle.mjs';

const filename = fileURLToPath(import.meta.url);
const CHECKOUT = path.resolve(path.dirname(filename), '..');
const HELP = `Local AGNT lifecycle (Node 20+)
  npm run app:status -- [--json] [--url http://127.0.0.1:3333]
  npm run restart:backend -- [--timeout-ms 60000] [--json] [--url ...]
  npm run build:frontend -- [Vite build arguments]
  npm run dev:frontend -- [Vite dev arguments]

Restart auto-selects API for supplied AGNT_AUTH_TOKEN / AGNT context, otherwise
private OS-user local control. --transport auto|api|local; --preflight checks
readiness without restarting. API rejection never falls back. Local control
requires one desktop relaunch after installation. Linux source Electron only.
Timeout range: 100-300000 ms. Status is read-only and sends no credentials.
See docs/NPM_APP_LIFECYCLE.md. Building is not restarting or reloading.
`;

function localOrigin(value) {
  // Reject alternate IP spellings and DNS names before URL normalizes them.
  if (!/^http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/?$/.test(value)) {
    throw new Error('Expected a plain IPv4 loopback origin: http://127.0.0.1:3333');
  }
  try {
    const url = new URL(value);
    if (url.port === '0') throw new Error();
    return url.origin;
  } catch { throw new Error('Invalid loopback origin port'); }
}

export function parseOptions(args) {
  const options = { command: 'status', url: 'http://127.0.0.1:3333', timeoutMs: 60000, requestTimeoutMs: 3000, pollMs: 250, json: false };
  const rest = [...args];
  if (rest[0] && !rest[0].startsWith('-')) options.command = rest.shift();
  if (!['status', 'restart'].includes(options.command)) throw new Error('Expected status or restart; use --help');
  const seen = new Set();
  while (rest.length) {
    const flag = rest.shift();
    if (seen.has(flag)) throw new Error('Duplicate option; use --help');
    seen.add(flag);
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--preflight') options.preflight = true;
    else if (flag === '--transport') { options.transport = rest.shift(); if (!['auto','api','local'].includes(options.transport)) throw new Error('Invalid transport'); }
    else if (flag === '--url') options.url = localOrigin(rest.shift() ?? '');
    else if (flag === '--timeout-ms') {
      const value = rest.shift() ?? '';
      if (!/^\d+$/.test(value) || +value < 100 || +value > 300000) throw new Error('Timeout must be 100-300000 integer milliseconds');
      options.timeoutMs = +value;
    } else throw new Error('Unknown option; use --help (tokens are environment-only)');
  }
  return options;
}

function processStat(text) {
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
  if (!/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[19])) throw new Error('Invalid process stat');
  return { ppid: Number(fields[1]), start: fields[19] };
}

async function ownsSocket(pid, port, io) {
  const inodes = new Set();
  for (const fd of await io.readdir(`/proc/${pid}/fd`)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(await io.readlink(`/proc/${pid}/fd/${fd}`));
      if (match) inodes.add(match[1]);
    } catch { /* Descriptors can close during inspection; the listener must remain. */ }
  }
  const tcp = await io.readFile(`/proc/${pid}/net/tcp`, 'utf8');
  return tcp.split('\n').slice(1).some(line => {
    const fields = line.trim().split(/\s+/);
    const [address, hexPort] = (fields[1] || '').split(':');
    return ['0100007F', '00000000'].includes(address) && parseInt(hexPort, 16) === port && fields[3] === '0A' && inodes.has(fields[9]);
  });
}

/** /proc inspection is deliberately conservative: unsupported means no POST. */
export async function inspectOwnership(pid, checkout, port, overrides = {}) {
  const io = { ...fs, platform: process.platform, ...overrides };
  let observedCheckout;
  if (io.platform !== 'linux') return { verified: false, reason: 'Restart ownership verification requires Linux /proc' };
  try {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid PID');
    const expectedRoot = await io.realpath(checkout);
    const initial = processStat(await io.readFile(`/proc/${pid}/stat`, 'utf8'));
    const cwd = await io.readlink(`/proc/${pid}/cwd`);
    observedCheckout = path.dirname(cwd);
    const argv = (await io.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    if (cwd !== path.join(expectedRoot, 'backend') || argv.length !== 2 || path.resolve(cwd, argv[1]) !== path.join(cwd, 'server.js')) {
      throw new Error('Backend is not this source checkout');
    }
    const ppid = initial.ppid;
    const parent = processStat(await io.readFile(`/proc/${ppid}/stat`, 'utf8'));
    const parentCwd = await io.readlink(`/proc/${ppid}/cwd`);
    const parentExe = await io.readlink(`/proc/${ppid}/exe`);
    const parentArgv = (await io.readFile(`/proc/${ppid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    const expectedExe = await io.realpath(path.join(expectedRoot, 'node_modules/electron/dist/electron'));
    // Electron can rewrite argv into a single process.title string on Linux.
    // Match only its exact default source-launch title, never split on spaces.
    const normalArgs = parentArgv.length === 2 && path.resolve(parentCwd, parentArgv[1]) === expectedRoot;
    const sourceTitle = parentArgv.length === 1 && [expectedExe + ' .', expectedExe + ' ' + expectedRoot].includes(parentArgv[0]);
    if (parentCwd !== expectedRoot || parentExe !== expectedExe || path.basename(parentExe) !== 'electron' || (!normalArgs && !sourceTitle)) {
      throw new Error('Direct parent is not this source Electron supervisor');
    }
    if (!(await ownsSocket(pid, port, io))) throw new Error('Backend does not own the target loopback listening socket');
    const final = processStat(await io.readFile(`/proc/${pid}/stat`, 'utf8'));
    const finalParent = processStat(await io.readFile(`/proc/${ppid}/stat`, 'utf8'));
    if (initial.start !== final.start || initial.ppid !== final.ppid || parent.start !== finalParent.start) throw new Error('Process identity changed during inspection');
    return { verified: true, checkout: expectedRoot, supervisorPid: ppid, supervisorStart: parent.start, backendStart: initial.start };
  } catch {
    // Do not relay filesystem errors, argv or arbitrary process-supplied text.
    return { verified: false, ...(observedCheckout ? { observedCheckout } : {}), reason: 'Cannot verify this checkout, direct Electron supervisor and listening socket via /proc' };
  }
}

function validStatus(body) {
  if (!body || !['running', 'draining'].includes(body.state) || !Number.isSafeInteger(body.pid) || body.pid <= 0 || !Number.isFinite(body.uptimeMs) || body.uptimeMs < 0) {
    throw new Error('Invalid system status response');
  }
  return { state: body.state, pid: body.pid, uptimeMs: body.uptimeMs };
}

async function requestJSON(origin, route, { method = 'GET', token, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(origin + route, {
      method, redirect: 'manual', signal: controller.signal,
      headers: method === 'POST' ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      ...(method === 'POST' ? { body: JSON.stringify({ reason: 'npm restart:backend' }) } : {}),
    });
    if (res.status !== (method === 'POST' ? 202 : 200)) {
      await res.body?.cancel();
      throw new Error(`${route}: HTTP ${res.status}${res.status === 401 || res.status === 403 ? '; check your existing AGNT_AUTH_TOKEN' : ''}`);
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.byteLength;
      if (bytes > 16384) { controller.abort(); throw new Error('Oversized API response'); }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Invalid JSON response'); }
  } catch (error) {
    if (controller.signal.aborted && error.message !== 'Oversized API response') throw new Error(`${route}: request timed out`);
    // Never echo a fetch error containing request headers or response content.
    if (/^(\/api\/|Oversized API|Invalid JSON)/.test(error.message)) throw error;
    throw new Error(`${route}: connection unavailable`);
  } finally { clearTimeout(timer); }
}

async function boundedInspection(inspect, pid, checkout, port, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      inspect(pid, checkout, port),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Ownership inspection timed out')), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function executeLifecycle(options, { token, checkout = CHECKOUT, inspect = inspectOwnership, managed = false, localControl = localRequest } = {}) {
  const origin = localOrigin(options.url);
  if (!['status', 'restart'].includes(options.command)) throw new Error('Expected status or restart');
  const started = Date.now(), deadline = started + options.timeoutMs;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new Error('Operation timed out; inspect app:status before retrying');
    return ms;
  };
  const request = (route, method = 'GET') => requestJSON(origin, route, { method, token, timeoutMs: Math.min(options.requestTimeoutMs, remaining()) });
  const ownership = pid => boundedInspection(inspect, pid, checkout, Number(new URL(origin).port || 80), remaining());
  const health = async pid => {
    const body = await request('/api/health');
    if (body?.status !== 'OK' || body.pid !== pid) throw new Error('Health response is unhealthy or disagrees with status PID');
  };
  const transport = options.command === 'restart' ? selectTransport({ mode: options.transport || 'auto', token, managed }) : null;
  const before = validStatus(await request('/api/system/status'));
  await health(before.pid);
  const owner = await ownership(before.pid);
  if (options.command === 'status') {
    return { success: before.state === 'running', url: origin, checkout, ...before, healthy: true, ownership: owner };
  }
  if (before.state !== 'running') throw new Error('Backend is already draining; inspect app:status before retrying');
  if (!owner.verified) throw new Error('Restart refused: ownership / Electron supervision unverified. Use app:status and your existing installation supervisor');
  if (options.preflight) {
    if (transport === 'local') await localControl({ checkout, supervisorPid: owner.supervisorPid, pid: before.pid, operation: 'preflight', timeoutMs: remaining() });
    return { success: true, preflight: true, transport, url: origin, checkout, ...before, healthy: true, ownership: owner, authenticationValidated: false };
  }
  let accepted;
  let localResult;
  try {
    if (transport === 'local') {
      localResult = await localControl({ checkout, supervisorPid: owner.supervisorPid, pid: before.pid, operation: 'restart', timeoutMs: remaining() });
      if (localResult.previousPid !== before.pid || localResult.pid === before.pid || localResult.frontendReloaded !== true) throw new Error('Local recovery receipt invalid');
      accepted = localResult;
    } else accepted = await request('/api/system/restart', 'POST');
  }
  catch (error) {
    throw new Error(`${error.message}; restart outcome may be uncertain: inspect app:status before retrying (no automatic retry)`);
  }
  if (accepted?.success !== true) throw new Error('Invalid restart acceptance response; inspect app:status before retrying');
  while (Date.now() < deadline) {
    let current;
    try {
      current = validStatus(await request('/api/system/status'));
      if (current.state !== 'running' || current.pid === before.pid) { await sleep(Math.min(options.pollMs, remaining())); continue; }
      await health(current.pid);
    } catch {
      // A drain intentionally interrupts connections. This loop never retries POST.
      await sleep(Math.min(options.pollMs, Math.max(0, deadline - Date.now())));
      continue;
    }
    const nextOwner = await ownership(current.pid);
    if (!nextOwner.verified || nextOwner.checkout !== owner.checkout || nextOwner.supervisorPid !== owner.supervisorPid || nextOwner.supervisorStart !== owner.supervisorStart) {
      throw new Error('Recovery ownership / Electron supervisor changed; inspect app:status');
    }
    if (localResult && current.pid !== localResult.pid) throw new Error('Local recovery PID changed after receipt');
    return { success: true, transport, ...(localResult ? { frontendReloaded: true } : {}), url: origin, checkout, previousPid: before.pid, ...current, healthy: true, ownership: nextOwner, elapsedMs: Date.now() - started };
  }
  throw new Error('Restart accepted but recovery timed out; inspect app:status before retrying (no rollback or automatic retry)');
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
    if (options.help) { console.log(HELP); return; }
    const result = await executeLifecycle(options, { token: process.env.AGNT_AUTH_TOKEN, managed: Boolean(process.env.AGNT_CONVERSATION_ID || process.env.AGNT_TOOL_RUNNER) });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.preflight ? 'Restart preflight (no restart sent)' : result.previousPid ? 'Restart verified' : 'Backend status'}: ${result.state}, PID ${result.pid}${result.previousPid ? ` (was ${result.previousPid})` : ''}`);
      console.log(`Target: ${result.url}\nHelper checkout: ${result.checkout}\nHealth: ${result.healthy ? 'OK' : 'not healthy'}`);
      console.log(result.ownership.verified ? `Verified source Electron supervisor: PID ${result.ownership.supervisorPid}` : `Restart unavailable: ${result.ownership.reason}${result.ownership.observedCheckout ? `\nObserved checkout: ${result.ownership.observedCheckout}` : ''}`);
    }
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    if (options?.json) console.log(JSON.stringify({ success: false, error: error.message }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) await main();
