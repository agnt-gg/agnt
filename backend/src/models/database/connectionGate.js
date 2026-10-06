import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Connection gate: one statement in flight per SQLite connection, with every
 * other statement waiting in a JavaScript queue.
 *
 * WHY. node-sqlite3 runs each statement on a libuv pool thread and keeps that
 * thread for the statement's whole life, INCLUDING the time it spends asleep in
 * SQLite's busy handler (up to busy_timeout, 10 s here) waiting for a write
 * lock. A single connection can only execute one statement at a time anyway,
 * so concurrent statements on it queue on the connection mutex — each one
 * pinning a pool thread while it waits. When the waiters fill the pool, the
 * code holding the lock (a transaction on another connection, or anything
 * else that needs a pool thread) can no longer run, and every waiter fails
 * with SQLITE_BUSY, one roughly every 11 s. That convoy is the "database is
 * locked" storm behind dropped conversation saves, tool records and ledger
 * rows (investigation 2026-10-06: 16 concurrent writes on a 16-thread pool
 * held a commit for 177 s; through this gate, 200 writes finished in 0.2 s).
 *
 * Queuing in JavaScript costs no thread, and it costs no throughput either:
 * the connection could only run one statement at a time to begin with. FIFO
 * order also preserves program order, so a write that is fired without being
 * awaited is still applied before any statement issued after it.
 *
 * TRANSACTIONS. A transaction on a shared connection is only atomic if nothing
 * else can run statements on that connection while it is open. Before this,
 * code either opened a second connection (which is what made the deadlock
 * possible) or issued BEGIN on the shared handle and let unrelated writes
 * silently join its transaction. `db.transaction(fn)` holds the gate for its
 * whole life; statements issued from inside `fn` (tracked with
 * AsyncLocalStorage) bypass the queue and run inside the transaction, and
 * everything else waits.
 *
 * Not gated: db.prepare / db.each / db.map (prepared statements run on the
 * connection directly). Callers that need gating use run/get/all/exec.
 */

const GATED_METHODS = ['run', 'get', 'all', 'exec'];
const DEFAULT_SLOW_HOLDER_MS = 15000;

function describe(sql) {
  return String(sql ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Install the gate on a node-sqlite3 Database in place, so every module that
 * already imports the shared handle is covered without changing it.
 *
 * @param {import('sqlite3').Database} db
 * @param {object} [options]
 * @param {number} [options.slowHolderMs] warn when one statement or
 *   transaction holds the gate longer than this
 * @param {(message: string) => void} [options.warn]
 * @param {() => number} [options.now]
 * @returns {{ stats: () => object, insideTransaction: () => boolean }}
 */
export function installConnectionGate(db, {
  slowHolderMs = DEFAULT_SLOW_HOLDER_MS,
  warn = (message) => console.warn(message),
  now = Date.now,
} = {}) {
  if (db.__connectionGate) return db.__connectionGate;

  const original = {};
  for (const name of GATED_METHODS) original[name] = db[name];

  const transactionContext = new AsyncLocalStorage();
  const insideTransaction = () => transactionContext.getStore()?.active === true;

  let tail = Promise.resolve();
  const counters = { waiting: 0, maxWaiting: 0, completed: 0, slowHolders: 0 };
  let holder = null;

  function enqueue(label, task) {
    counters.waiting += 1;
    if (counters.waiting > counters.maxWaiting) counters.maxWaiting = counters.waiting;
    const result = tail.then(async () => {
      counters.waiting -= 1;
      holder = { label, since: now(), warned: false };
      try {
        return await task();
      } finally {
        holder = null;
        counters.completed += 1;
      }
    });
    // The chain must survive a failed task; the caller still sees the failure.
    tail = result.catch(() => {});
    return result;
  }

  for (const name of GATED_METHODS) {
    const call = original[name];
    db[name] = function gatedStatement(sql, ...args) {
      // Inside a transaction the gate is already held by it: run directly, in it.
      if (insideTransaction()) return call.call(db, sql, ...args);

      const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      enqueue(describe(sql), () => new Promise((release) => {
        // Release AFTER the caller's callback, so its `this` (lastID, changes)
        // and any follow-up statement it queues keep their order. A throwing
        // callback still releases, and still throws exactly as it did before.
        const settle = function (...results) {
          try {
            if (callback) callback.apply(this, results);
          } finally {
            release();
          }
        };
        try {
          call.call(db, sql, ...args, settle);
        } catch (error) {
          // A synchronous argument error never reaches sqlite3's callback.
          settle.call(null, error);
        }
      })).catch((error) => {
        // Only a callback that throws synchronously lands here; surface it the
        // way an exception from a sqlite3 callback always surfaced.
        process.nextTick(() => { throw error; });
      });
      return db;
    };
  }

  const runRaw = (sql) => new Promise((resolve, reject) => {
    original.run.call(db, sql, [], (error) => (error ? reject(error) : resolve()));
  });

  /**
   * Run `work` inside BEGIN IMMEDIATE … COMMIT, atomically with respect to
   * every other statement on this connection. A throw rolls back and
   * rethrows; a failed COMMIT rolls back and rethrows with
   * `transactionPhase = 'commit'`, so a caller can tell "nothing was written"
   * from "the outcome is uncertain". Nested calls join the outer transaction.
   */
  db.transaction = function transaction(work, { label = 'transaction' } = {}) {
    if (insideTransaction()) return Promise.resolve().then(work);
    return enqueue(label, () => {
      const store = { active: true };
      return transactionContext.run(store, async () => {
        try {
          await runRaw('BEGIN IMMEDIATE');
          let result;
          try {
            result = await work();
          } catch (error) {
            await runRaw('ROLLBACK').catch(() => {});
            throw error;
          }
          try {
            await runRaw('COMMIT');
          } catch (error) {
            await runRaw('ROLLBACK').catch(() => {});
            if (error && typeof error === 'object') error.transactionPhase = 'commit';
            throw error;
          }
          return result;
        } finally {
          // A callback that fires after this point is outside the transaction.
          store.active = false;
        }
      });
    });
  };

  // Lock tracing: before this, a stall gave no clue who held the connection.
  const watchdog = setInterval(() => {
    if (!holder || holder.warned) return;
    const heldMs = now() - holder.since;
    if (heldMs < slowHolderMs) return;
    holder.warned = true;
    counters.slowHolders += 1;
    warn(`[DB Gate] connection held ${Math.round(heldMs / 1000)}s by: ${holder.label} (${counters.waiting} waiting)`);
  }, Math.max(250, Math.min(slowHolderMs, 5000)));
  if (typeof watchdog.unref === 'function') watchdog.unref();

  const originalClose = db.close;
  db.close = function close(...args) {
    clearInterval(watchdog);
    return originalClose.apply(db, args);
  };

  const gate = {
    insideTransaction,
    stats: () => ({
      ...counters,
      holder: holder ? { label: holder.label, heldMs: now() - holder.since } : null,
    }),
  };
  Object.defineProperty(db, '__connectionGate', { value: gate, enumerable: false });
  return gate;
}

/**
 * Run `work` in a transaction on `database`, whichever kind it is: the gated
 * shared connection (atomic against every other caller), or a plain sqlite3
 * handle such as a test's in-memory database.
 */
export function withTransaction(database, work, options) {
  if (typeof database.transaction === 'function') return database.transaction(work, options);
  // The full (sql, params, callback) form: wrappers and test doubles of `run`
  // commonly assume it, and a two-argument call can lose its callback in them.
  const run = (sql) => new Promise((resolve, reject) => database.run(sql, [], (e) => (e ? reject(e) : resolve())));
  return (async () => {
    await run('BEGIN IMMEDIATE');
    let result;
    try {
      result = await work();
    } catch (error) {
      await run('ROLLBACK').catch(() => {});
      throw error;
    }
    try {
      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK').catch(() => {});
      if (error && typeof error === 'object') error.transactionPhase = 'commit';
      throw error;
    }
    return result;
  })();
}
