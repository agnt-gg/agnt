// In-memory registry of in-flight page-scan requests. The tutorial tool
// executor creates a promise here, broadcasts a `tutorial:scan_request`
// over socket.io, and a connected client responds via the server's
// `tutorial:scan_response` socket handler, which resolves the promise.
//
// First response wins; later responses (other tabs) are silently dropped.
// A timer rejects the promise if no client responds.

const pending = new Map();

export function createPendingScan(requestId, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(requestId)) {
        reject(new Error(`Page scan timed out after ${timeoutMs}ms — no client responded. Make sure the user has the app open in an active tab.`));
      }
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
  });
}

export function resolvePendingScan(requestId, elements) {
  const entry = pending.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(elements);
  return true;
}

export function cancelPendingScan(requestId, reason = 'canceled') {
  const entry = pending.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.reject(new Error(`Scan ${requestId} ${reason}`));
  return true;
}
