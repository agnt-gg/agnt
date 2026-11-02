import { fileURLToPath } from 'node:url';
import { fork } from './toolProcess.js';
import { currentToolActor } from './toolRunAuthority.js';
import { cachedTeamFolders } from './teamFolders.js';

const workers = new Map();
let nextRequest = 0;
const LIMIT = 4;
// Separate workers preserve each caller's read/edit observations without giving
// the trusted backend any direct path through a symlink the workload can race.
// A worker's mounts are fixed when it starts, so it is keyed by the actor AND their current team folders:
// gaining or losing a teamspace (or a read/write change) starts a fresh worker with the right mounts.
function workerFor(actor) {
  const signature = actor + '|' + cachedTeamFolders(actor).map((f) => `${f.source}:${f.folder}:${f.writable ? 'rw' : 'ro'}`).join(',');
  const current = workers.get(actor);
  if (current && current.signature === signature) return current;
  if (current && current.pending.size === 0) { current.child.kill(); workers.delete(actor); }
  else if (current) return current; // busy: finish its queue first; the next idle call restarts it
  if (workers.size >= LIMIT) {
    const idle = [...workers.values()].find((entry) => entry.pending.size === 0);
    if (!idle) throw new Error('Isolated file workers busy; retry this operation');
    idle.child.kill(); workers.delete(idle.actor);
  }
  const child = fork(fileURLToPath(new URL('./toolFileWorker.js', import.meta.url)), [], { env: {}, execArgv: ['--max-old-space-size=128'] });
  const entry = { actor, signature, child, pending: new Map(), idle: null };
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
