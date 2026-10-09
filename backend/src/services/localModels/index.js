/**
 * The Local provider's one entry point: the routed client options, the status
 * the renderer polls, and the managed runtime's actions.
 *
 * Everything the renderer used to learn by fetching 127.0.0.1:1234 itself now
 * comes from GET /api/local-models/status, built here. The backend is the only
 * thing that can probe arbitrary localhost ports (no CORS), see the hardware
 * and start processes, and on a phone or another browser "localhost" is not
 * this computer at all.
 */
import path from 'node:path';
import { hostedInstanceSlug } from '../agntServices.js';
import { createLocalModelRuntime } from '../localModelRuntime.js';
import { createManagedRuntime } from './managedRuntime.js';
import { createLocalRouter, LOCAL_ROUTER_BASE_URL } from './localServers.js';

export { getLocalBaseURL, LOCAL_ROUTER_BASE_URL, KNOWN_SERVERS } from './localServers.js';

/** Same fallback as the plugin system when Electron has not set USER_DATA_PATH. */
function userDataPath() {
  if (process.env.USER_DATA_PATH) return process.env.USER_DATA_PATH;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'AGNT');
  if (process.platform === 'darwin') return path.join(process.env.HOME || '', 'Library', 'Application Support', 'AGNT');
  return path.join(process.env.HOME || '', '.config', 'AGNT');
}

const hosted = () => !!hostedInstanceSlug();

import { createLocalInference } from './inference.js';

export const managedRuntime = createManagedRuntime({ rootDir: path.join(userDataPath(), 'local-models'), hosted });
export const localRouter = createLocalRouter({ managed: managedRuntime });
export const localInference = createLocalInference({ resolve: (options) => localRouter.resolve(options) });
export const lmStudio = createLocalModelRuntime({ hosted });

/** Options for an OpenAI client that reaches whichever local server has the requested model. */
export function localClientOptions() {
  return { baseURL: LOCAL_ROUTER_BASE_URL, fetch: localRouter.createFetch() };
}

/** Model ids the Local provider can use right now. */
export const listLocalModelIds = () => localRouter.listModelIds();

/** Called from the backend's graceful shutdown: never leave llama-server holding the GPU. */
export function stopManagedRuntime() {
  managedRuntime.stop();
}

/**
 * Everything the renderer needs about local models, in one read.
 *   ready     a Local model can be used now (one is served, or AGNT's own can start)
 *   running   some local server is answering right now
 *   models    ids for the model picker
 *   server    the server Local resolves to, when one answers
 *   servers   every known server and what it serves
 *   installed / canStart / downloadUrl   LM Studio (the "start LM Studio" path)
 *   managed   AGNT's own runtime: hardware, catalog with fit, setup progress
 */
export async function localModelsStatus() {
  const [servers, managed, lms, models] = await Promise.all([
    localRouter.probeAll({ fresh: true }),
    managedRuntime.status(),
    lmStudio.status(),
    localRouter.listModelIds(),
  ]);
  const managedServer = managed.server ? { id: 'agnt', name: 'AGNT local runtime', baseURL: managed.server.baseURL, running: true, models: [managed.server.modelId] } : null;
  const all = managedServer ? [managedServer, ...servers] : servers;
  const server = all.find((entry) => entry.models.length) || all.find((entry) => entry.running) || null;
  return {
    ready: models.length > 0,
    running: all.some((entry) => entry.running),
    models,
    server: server ? { id: server.id, name: server.name, baseURL: server.baseURL } : null,
    servers: all,
    installed: lms.installed,
    canStart: lms.canStart,
    downloadUrl: lms.downloadUrl,
    managed,
  };
}
