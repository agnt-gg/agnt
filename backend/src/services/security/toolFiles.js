import { fileURLToPath } from 'node:url';
import { fork } from './toolProcess.js';
import { currentToolActor } from './toolRunAuthority.js';

const workers = new Map();
let nextRequest = 0;
const LIMIT = 4;
// Separate workers preserve each caller's read/edit observations without giving
// the trusted backend any direct path through a symlink the workload can race.
function workerFor(actor) {
  if (workers.has(actor)) return workers.get(actor);
  if (workers.size >= LIMIT) {
    const idle = [...workers.values()].find((entry) => entry.pending.size === 0);
    if (!idle) throw new Error('Isolated file workers busy; retry this operation');
    idle.child.kill(); workers.delete(idle.actor);
  }
  const child = fork(fileURLToPath(new URL('./toolFileWorker.js', import.meta.url)), [], { env: {}, execArgv: ['--max-old-space-size=128'] });
  const entry = { actor, child, pending: new Map(), idle: null };
  const fail = (error) => {
    if (workers.get(actor) === entry) workers.delete(actor);
    clearTimeout(entry.idle);
    for (const request of entry.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    entry.pending.clear();
  };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Isolated file worker exited')));
  // Do not stream raw diagnostics back into trusted conversation history.
  child.stdout?.resume(); child.stderr?.resume();
  child.on('message', (message) => {
    const request = entry.pending.get(message?.id);
    if (!request) return;
    clearTimeout(request.timer); entry.pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
    if (!entry.pending.size) {
      entry.idle = setTimeout(() => { if (!entry.pending.size) child.kill(); }, 300000);
      entry.idle.unref();
    }
  });
  workers.set(actor, entry);
  return entry;
}
export function isolatedFileCall(kind, name, args) {
  const entry = workerFor(currentToolActor() || 'internal');
  if (entry.pending.size >= 16) return Promise.reject(new Error('Isolated file queue full'));
  clearTimeout(entry.idle);
  return new Promise((resolve, reject) => {
    const id = ++nextRequest;
    const timer = setTimeout(() => { entry.child.kill(); }, 120000);
    entry.pending.set(id, { resolve, reject, timer });
    entry.child.send({ id, kind, name, args }, (error) => { if (error) { clearTimeout(timer); entry.pending.delete(id); reject(error); } });
  });
}
export function closeToolFileWorkers() { for (const { child } of workers.values()) child.kill(); workers.clear(); }
