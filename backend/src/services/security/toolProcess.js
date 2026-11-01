import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { currentToolActor, hostedToolBoundaryRequired, issueToolToken } from './toolRunAuthority.js';
import { createToolNetwork } from './toolNetwork.js';
import { getWorkspaceRootSync } from '../../utils/workspaceRoot.js';

export const TOOL_WORKSPACE = '/app/data/projects';
/** Member folders: the only roots besides the install folder the launcher will mount. */
const MEMBER_ROOT = /^\/app\/data\/workspaces\/[A-Za-z0-9_-]{1,80}$/;
const isInside = (child, parent) => child === parent || child.startsWith(parent + '/');
const refuseWorkspace = (message) => Object.assign(new Error(message), { code: 'tool_workspace_required' });

/**
 * The one folder a hosted tool run may see: the acting account's own workspace (the owner's is the
 * install folder; a member's is /app/data/workspaces/<id>). The launcher mounts only this folder, so a
 * member's code can never read the owner's files or another member's. Runs with no actor (internal
 * helpers) get the install folder. Anything else fails closed.
 */
export function toolRootFor(actor, workspaceFor = getWorkspaceRootSync) {
  const root = path.posix.resolve(String(workspaceFor(actor)).replace(/\\/g, '/'));
  if (isInside(root, TOOL_WORKSPACE) || MEMBER_ROOT.test(root)) return root;
  throw refuseWorkspace(`Hosted tools must execute inside the workspace: ${root} is not a folder the tool sandbox can mount`);
}
const LAUNCHER = '/usr/local/bin/agnt-tool-run';
// AGNT_TOOL_EXPOSE: '<port>=<socket>' asks sandbox-network.cjs to expose one loopback port as a Unix
// socket in the run's workspace (the launched browser's debugging port; see hostedCdpBridge.js).
const SAFE_ENV = ['LANG', 'LC_ALL', 'TZ', 'TERM', 'PYTHONIOENCODING', 'PYTHONUTF8', 'AGNT_JS_EXECUTOR_CHILD', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE', 'AGNT_TOOL_EXPOSE'];

/**
 * A folder both the server and a sandboxed tool process see at the same path. On a hosted instance tool
 * processes must run inside the workspace and see a private /tmp, so a file a tool writes to os.tmpdir()
 * never reaches the code that reads it. Elsewhere this is just the temp folder.
 */
export function toolWorkDir(...parts) {
  const base = hostedToolBoundaryRequired() ? path.posix.join(toolRootFor(currentToolActor()), '.tool-work') : os.tmpdir();
  const dir = path.join(base, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sandboxPlan(command, args = [], options = {}, { hosted = hostedToolBoundaryRequired(), actor = currentToolActor(), networkFactory = createToolNetwork, issueProxyKey = issueToolToken, workspaceFor = getWorkspaceRootSync, ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true }) } = {}) {
  if (!hosted) return { command, args, options };
  if (!fs.existsSync(LAUNCHER)) throw Object.assign(new Error('Hosted tool sandbox is unavailable; execution refused'), { code: 'tool_sandbox_unavailable' });
  const root = toolRootFor(actor, workspaceFor);
  const cwd = path.posix.resolve(root, String(options.cwd || root).replace(/\\/g, '/'));
  if (!isInside(cwd, root)) throw refuseWorkspace(`Hosted tools must execute inside the workspace (${root}); ${cwd} is outside it`);
  ensureDir(root);
  // The launcher (scripts/agnt-tool-run.py) re-validates this and mounts only this folder.
  const environment = { PATH: '/usr/local/bin:/usr/bin:/bin', AGNT_TOOL_WORKSPACE: root };
  for (const key of SAFE_ENV) if (options.env?.[key] !== undefined) environment[key] = String(options.env[key]);
  // NEVER forward a caller-supplied bearer. This run gets a socket bound to
  // the authenticated actor; API credentials stay in the trusted broker.
  const lifetimeMs = options.timeout || 3600000;
  const broker = networkFactory(actor, { lifetimeMs });
  environment.AGNT_TOOL_SOCKET = broker.socketPath;
  // The run's proxy key: a temporary stand-in for the user's session, valid
  // only on this instance and only for this run, so code can call the AGNT API
  // exactly as documented. The real session token never enters the sandbox.
  if (actor) {
    try { environment.AGNT_AUTH_TOKEN = issueProxyKey(actor, { ttlSeconds: lifetimeMs / 1000 }); }
    catch (error) { console.error('[toolProcess] proxy key unavailable; API calls still go through the broker:', error.message); }
  }
  const invocation = options.shell ? ['/bin/sh', '-c', [command, ...args].join(' ')] : [command, ...args];
  return { command: LAUNCHER, args: invocation, options: { ...options, shell: false, env: environment, cwd }, dispose: broker.close };
}

/** A one-shot tool printing more than this over its life is runaway output, and is stopped. */
export const DEFAULT_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;

function trackedSpawn(plan, outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES) {
  try {
    const child = childProcess.spawn(plan.command, plan.args, plan.options);
    child.once('close', () => plan.dispose?.());
    child.once('error', () => plan.dispose?.());
    if (plan.dispose) {
      let bytes = 0;
      const count = (chunk) => { bytes += chunk.length; if (bytes > outputLimitBytes) child.kill('SIGKILL'); };
      child.stdout?.on('data', count); child.stderr?.on('data', count);
    }
    return child;
  } catch (error) { plan.dispose?.(); throw error; }
}

/**
 * options.outputLimitBytes: lifetime output cap on a hosted instance (default 8 MB). A long-lived server
 * whose output is consumed as it streams (an MCP stdio session) passes a higher cap; it is never unbounded.
 */
export function spawn(command, args, options) {
  if (!Array.isArray(args)) { options = args || {}; args = []; }
  const { outputLimitBytes, ...spawnOptions } = options || {};
  const plan = sandboxPlan(command, args, spawnOptions);
  return trackedSpawn(plan, outputLimitBytes);
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
