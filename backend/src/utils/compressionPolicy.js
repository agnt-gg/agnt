/**
 * Which responses the compression middleware may encode (backend/server.js).
 *
 * STREAMING: compression buffers responses by default, which destroys
 * Server-Sent Events streaming (chat tokens arrive only after the full
 * response, not incrementally). Known streaming route prefixes are excluded
 * up front, and `x-no-compression` lets any new endpoint opt out without
 * touching this file.
 *
 * SSE-bearing route prefixes (verified via grep for `text/event-stream`
 * and `Content-Type: text/event-stream`):
 *   /api/stream/*         — StreamEngine SSE
 *   /api/orchestrator/*   — chat orchestrator SSE (every chat surface)
 *   /api/users/*          — magic-link SSE response
 *   /api/plugins/*        — plugin install/uninstall progress SSE
 *
 * LOCAL FILES TO A LOCAL CALLER: artifacts are often megabytes of HTML.
 * Compressing one costs ~100 ms per request (4.8 MB: 73-112 ms against 13 ms
 * identity) and saves nothing on loopback. Remote callers (Phone Access over
 * a network) still get compression, where the bytes do cost time.
 */
export const STREAMING_PATH_PREFIXES = [
  '/api/stream',
  '/api/orchestrator',
  '/api/users/auth/magic-link',
  '/api/plugins',
];

export const LOCAL_FILE_ROUTES = ['/api/local-file', '/api/local-preview'];

/** A socket address on this machine. */
export const LOOPBACK_ADDRESS = /^(::1|::ffff:127\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+)$/;

const isUnder = (requestPath, route) => requestPath === route || requestPath.startsWith(route + '/');

/** compression's `filter` option; `defaultFilter` is compression.filter. */
export function shouldCompress(req, res, defaultFilter) {
  if (req.headers['x-no-compression']) return false;
  if (STREAMING_PATH_PREFIXES.some((p) => req.path.startsWith(p))) return false;
  if (LOCAL_FILE_ROUTES.some((route) => isUnder(req.path, route)) && LOOPBACK_ADDRESS.test(req.socket?.remoteAddress || '')) return false;
  // Last-resort guard: if the route has already set a streaming
  // content-type by the time the filter runs, skip too.
  const ct = res.getHeader('Content-Type');
  if (typeof ct === 'string' && ct.includes('text/event-stream')) return false;
  return defaultFilter(req, res);
}
