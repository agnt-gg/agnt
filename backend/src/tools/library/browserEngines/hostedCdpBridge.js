/**
 * The launched browser on a hosted instance.
 *
 * Every tool process there runs in the kernel sandbox, which has its own network namespace: Chromium's
 * debugging port inside it cannot be reached from the server. A Unix socket CAN cross that boundary
 * when its file is in a folder both sides mount, so:
 *
 *   Chromium --remote-debugging-port=9222 (inside)
 *     <- sandbox-network.cjs exposes 127.0.0.1:9222 as <dir>/cdp.sock     (AGNT_TOOL_EXPOSE)
 *     <- this bridge listens on 127.0.0.1:<free port> on the server and pipes each connection to it.
 *
 * Every existing consumer keeps using an ordinary ws://127.0.0.1:<port>/devtools/... URL.
 *
 * One browser per instance, holding the owner's signed-in sites, so it lives in the owner's folder and
 * the launch pins cwd there: the sandbox refuses that cwd for anyone else's run.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { TOOL_WORKSPACE } from '../../../services/security/toolProcess.js';

/** Fixed: each sandbox has its own network namespace, so nothing else can hold it. */
export const HOSTED_CDP_PORT = 9222;

export function hostedBrowserPaths(root = TOOL_WORKSPACE) {
  const dir = path.posix.join(root, '.tool-work', 'browser');
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir, profilePath: path.posix.join(dir, 'browser_control_profile'), socketPath: path.posix.join(dir, 'cdp.sock') };
}

/**
 * Locks a previous browser left in the profile. Safe only because no other browser can hold it: the
 * session is per process and every sandboxed child dies with the server. Left in place, a lock naming
 * "tool-<pid>" can match a live pid in the NEW sandbox's pid namespace and Chromium refuses the profile.
 */
export function clearStaleProfileLocks(profilePath) {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
    try { fs.rmSync(path.join(profilePath, name), { force: true }); } catch { /* not there */ }
  }
}

/** Listen on a free loopback port and pipe every connection to the socket. */
export function openCdpBridge(socketPath, { connect = (target) => net.connect(target) } = {}) {
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    const server = net.createServer((client) => {
      const upstream = connect(socketPath);
      sockets.add(client); sockets.add(upstream);
      const drop = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
      client.on('error', drop); upstream.on('error', drop);
      client.on('close', drop); upstream.on('close', drop);
      client.pipe(upstream); upstream.pipe(client);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close() { for (const socket of sockets) socket.destroy(); server.close(); },
      });
    });
  });
}

/** The browser's websocket endpoint as reachable through the bridge, or null if not answering yet. */
export async function readBridgedEndpoint(port, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const { webSocketDebuggerUrl } = await response.json();
    const wsPath = typeof webSocketDebuggerUrl === 'string' ? webSocketDebuggerUrl.match(/^ws:\/\/[^/]+(\/devtools\/browser\/[A-Za-z0-9-]+)$/)?.[1] : null;
    return wsPath ? `ws://127.0.0.1:${port}${wsPath}` : null;
  } catch {
    return null;
  }
}
