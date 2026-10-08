import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { currentToolActor, hostedToolBoundaryRequired } from './toolRunAuthority.js';
import { createToolNetwork } from './toolNetwork.js';

export const TOOL_WORKSPACE = '/app/data/projects';
const LAUNCHER = '/usr/local/bin/agnt-tool-run';
const SAFE_ENV = ['LANG', 'LC_ALL', 'TZ', 'TERM', 'PYTHONIOENCODING', 'PYTHONUTF8', 'AGNT_JS_EXECUTOR_CHILD', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'];

export function sandboxPlan(command, args = [], options = {}, { hosted = hostedToolBoundaryRequired(), actor = currentToolActor(), networkFactory = createToolNetwork } = {}) {
  if (!hosted) return { command, args, options };
  if (!fs.existsSync(LAUNCHER)) throw Object.assign(new Error('Hosted tool sandbox is unavailable; execution refused'), { code: 'tool_sandbox_unavailable' });
  const cwd = path.posix.resolve(options.cwd || TOOL_WORKSPACE);
  if (cwd !== TOOL_WORKSPACE && !cwd.startsWith(TOOL_WORKSPACE + '/')) throw Object.assign(new Error('Hosted tools must execute inside the workspace'), { code: 'tool_workspace_required' });
  const environment = { PATH: '/usr/local/bin:/usr/bin:/bin' };
  for (const key of SAFE_ENV) if (options.env?.[key] !== undefined) environment[key] = String(options.env[key]);
  // NEVER forward a caller-supplied bearer. This run gets a socket bound to
  // the authenticated actor; API credentials stay in the trusted broker.
  const broker = networkFactory(actor, { lifetimeMs: options.timeout || 3600000 });
  environment.AGNT_TOOL_SOCKET = broker.socketPath;
  const invocation = options.shell ? ['/bin/sh', '-c', [command, ...args].join(' ')] : [command, ...args];
  return { command: LAUNCHER, args: invocation, options: { ...options, shell: false, env: environment, cwd }, dispose: broker.close };
}

function trackedSpawn(plan) {
  try {
    const child = childProcess.spawn(plan.command, plan.args, plan.options);
    child.once('close', () => plan.dispose?.());
    child.once('error', () => plan.dispose?.());
    if (plan.dispose) {
      let bytes = 0;
      const count = (chunk) => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) child.kill('SIGKILL'); };
      child.stdout?.on('data', count); child.stderr?.on('data', count);
    }
    return child;
  } catch (error) { plan.dispose?.(); throw error; }
}

export function spawn(command, args, options) {
  if (!Array.isArray(args)) { options = args || {}; args = []; }
  const plan = sandboxPlan(command, args, options || {});
  return trackedSpawn(plan);
}
export function spawnSync(command, args, options) {
  if (!Array.isArray(args)) { options = args || {}; args = []; }
  const plan = sandboxPlan(command, args, options || {});
  try { return childProcess.spawnSync(plan.command, plan.args, { timeout: 120000, ...plan.options }); }
  finally { plan.dispose?.(); }
}
export function execFile(file, args, options, callback) {
  if (typeof args === 'function') { callback = args; args = []; options = {}; }
  else if (!Array.isArray(args)) { callback = options; options = args || {}; args = []; }
  else if (typeof options === 'function') { callback = options; options = {}; }
  const plan = sandboxPlan(file, args, options || {});
  try { const child = childProcess.execFile(plan.command, plan.args, plan.options, callback); child.once('close', () => plan.dispose?.()); child.once('error', () => plan.dispose?.()); return child; }
  catch (error) { plan.dispose?.(); throw error; }
}
export function exec(command, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (!hostedToolBoundaryRequired()) return childProcess.exec(command, options, callback);
  return execFile('/bin/sh', ['-c', command], options || {}, callback);
}
for (const fn of [exec, execFile]) {
  fn[promisify.custom] = (...args) => {
    let child;
    const promise = new Promise((resolve, reject) => {
      child = fn(...args, (error, stdout, stderr) => {
        if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
        else resolve({ stdout, stderr });
      });
    });
    promise.child = child;
    return promise;
  };
}
export function execSync(command, options = {}) {
  if (!hostedToolBoundaryRequired()) return childProcess.execSync(command, options);
  const plan = sandboxPlan('/bin/sh', ['-c', command], options);
  try { return childProcess.execFileSync(plan.command, plan.args, { timeout: 120000, ...plan.options }); }
  finally { plan.dispose?.(); }
}
export function execFileSync(file, args = [], options = {}) {
  if (!Array.isArray(args)) { options = args || {}; args = []; }
  const plan = sandboxPlan(file, args, options);
  try { return childProcess.execFileSync(plan.command, plan.args, { timeout: 120000, ...plan.options }); }
  finally { plan.dispose?.(); }
}
export function fork(modulePath, args = [], options = {}) {
  if (!Array.isArray(args)) { options = args || {}; args = []; }
  if (!hostedToolBoundaryRequired()) return childProcess.fork(modulePath, args, options);
  // IPC is a dedicated pipe to the trusted parent, not access to the server's
  // process. bubblewrap keeps this one descriptor; all others are closed.
  const stdio = options.stdio || ['pipe', 'pipe', 'pipe', 'ipc'];
  const plan = sandboxPlan(process.execPath, [...(options.execArgv || []), modulePath, ...args], { ...options, stdio });
  return trackedSpawn(plan);
}
export default { spawn, spawnSync, exec, execFile, execSync, execFileSync, fork };
