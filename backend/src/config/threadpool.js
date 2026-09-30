/**
 * Size libuv's thread pool before anything uses it.
 *
 * The pool (default 4 threads) runs every SQLite query, file read, gzip and
 * dynamic import(). node-sqlite3 holds a thread for a query's whole duration,
 * so a few slow queries at boot left nothing for module loading: a 19-module
 * import took 30 s on 2026-09-30.
 *
 * libuv reads UV_THREADPOOL_SIZE once, when the pool is first used, so this
 * must be the FIRST import of server.js. The desktop app sets it in the
 * backend's environment already (main.js); this covers `npm run dev` and
 * hosted runs. An explicit value from the environment always wins.
 */
export const DEFAULT_THREADPOOL_SIZE = 16;

if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(DEFAULT_THREADPOOL_SIZE);
}
