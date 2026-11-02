import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fork, toolRootFor } from './toolProcess.js';
import { currentToolActor, hostedToolBoundaryRequired } from './toolRunAuthority.js';
import { isNonOwnerMember } from './memberIsolation.js';

/**
 * A plugin tool, run for a teammate, in the kernel tool sandbox instead of inside the server.
 *
 * Plugin code is imported into the AGNT process for the owner (PluginManager), next to every stored key,
 * so teammates could only call plugins on a hand-approved list. Here, for anyone but the owner on a hosted
 * instance, the tool runs in a forked worker inside the same sandbox their code and files use: its own
 * user, network and mount namespaces, filtered egress, and only that teammate's folder mounted. The
 * plugin's folder is not inside that boundary, so it is copied into the teammate's folder once per
 * plugin version (content-addressed), and imported from there.
 *
 * What a sandboxed tool gets: its params (with any auth token the caller injected, as for the owner), the
 * input data, and a minimal engine ({ userId, workflowId }). In-process engine helpers are not available
 * there; a plugin that needs them fails with a clear error instead of reaching the server.
 */
const WORKER = fileURLToPath(new URL('./pluginToolWorker.js', import.meta.url));
const TIMEOUT_MS = 120000;

export function shouldSandboxPlugin(actor = currentToolActor(), { hosted = hostedToolBoundaryRequired() } = {}) {
  return Boolean(hosted && isNonOwnerMember(actor));
}

function fingerprint(dir) {
  // Name, size and mtime of every file: a new version or a reinstall gets a fresh copy.
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const stat = fs.statSync(full);
      hash.update(path.relative(dir, full) + ':' + stat.size + ':' + stat.mtimeMs + '\n');
      if (stat.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return hash.digest('hex').slice(0, 16);
}

/** The plugin's folder inside the teammate's own folder (copied once per version). */
export function stagePlugin(pluginName, pluginPath, root) {
  const safeName = String(pluginName).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const target = path.join(root, '.tool-work', 'plugins', `${safeName}-${fingerprint(pluginPath)}`);
  if (fs.existsSync(path.join(target, '.staged'))) return target;
  const staging = target + '.staging-' + randomUUID();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(pluginPath, staging, { recursive: true, dereference: true });
  fs.writeFileSync(path.join(staging, '.staged'), new Date().toISOString());
  try { fs.renameSync(staging, target); } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(path.join(target, '.staged'))) throw error; // a concurrent run staged it first: fine
  }
  return target;
}

const serializable = (value) => { try { return JSON.parse(JSON.stringify(value ?? null)); } catch { return null; } };

/** Run one plugin tool call in the sandbox and return its result. */
export function runPluginInSandbox({ pluginName, pluginPath, entryPoint }, params, inputData, engine, { root = toolRootFor(currentToolActor()), forkWorker = fork } = {}) {
  const dir = stagePlugin(pluginName, pluginPath, root);
  const entry = path.join(dir, entryPoint);
  if (!entry.startsWith(dir + path.sep)) return Promise.reject(new Error('Plugin entry point escapes its folder'));
  return new Promise((resolve, reject) => {
    const child = forkWorker(WORKER, [], { env: {}, execArgv: ['--max-old-space-size=256'] });
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill(); } catch { /* gone */ } if (error) reject(error); else resolve(result); };
    const timer = setTimeout(() => finish(new Error(`Plugin tool ${pluginName} timed out in the sandbox`)), TIMEOUT_MS);
    child.stdout?.resume(); child.stderr?.resume();
    child.on('message', (message) => (message?.error ? finish(new Error(message.error)) : finish(null, message?.result)));
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => finish(new Error(`Plugin sandbox exited (${code}) before answering`)));
    child.send({ entry, params: serializable(params), inputData: serializable(inputData), engine: { userId: engine?.userId || null, workflowId: engine?.workflowId || null } });
  });
}

/**
 * A module with the shape PluginManager.loadTool returns, whose execute runs in the sandbox. Both shapes
 * callers use: chat calls module.execute, the workflow runner calls module.default.execute (NodeExecutor).
 */
export function sandboxedPluginModule(spec) {
  const execute = (params, inputData, engine) => runPluginInSandbox(spec, params, inputData, engine);
  return { sandboxed: true, execute, default: { sandboxed: true, execute } };
}
