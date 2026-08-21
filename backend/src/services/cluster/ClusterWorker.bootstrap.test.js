/**
 * A worker has to be able to START on a machine nobody has ever signed in to.
 *
 * That is not a corner case, it is the ONLY case: a worker is headless by
 * definition — no browser, no published port, nobody sitting in front of it.
 * The loop used to look for a `users` row that only an interactive sign-in
 * creates, so a correctly-enrolled worker booted healthy, reached its primary,
 * and then silently never polled.
 *
 * These tests drive the real `startClusterWorker` against a stub primary, so
 * "it starts" means the poll loop genuinely made a request — not that a
 * function returned a hopeful object.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';

const ENROLLED_USER = 'user-enrolled-by-the-primary';
const SOMEBODY_ELSE = 'user-already-signed-in-here';

let db;
let dbReady;
let mintNodeToken;
let startClusterWorker;
let stopClusterWorker;
let getWorkerStats;

let server;
let primaryUrl;
let polls = 0;

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this);
    })
  );

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

/** Stop the loop and wait for it to actually be gone, not merely asked to go. */
async function stopAndSettle() {
  stopClusterWorker();
  await vi.waitFor(() => expect(getWorkerStats().running).toBe(false), { timeout: 5000 });
}

beforeAll(async () => {
  const dbModule = await import('../../models/database/index.js');
  db = dbModule.default;
  dbReady = dbModule.dbReady;
  await dbReady;

  ({ mintNodeToken } = await import('./clusterToken.js'));
  ({ startClusterWorker, stopClusterWorker, getWorkerStats } = await import('./ClusterWorker.js'));

  // A primary that is up and has nothing to hand out. 204 is the empty-queue
  // answer, so the loop polls, backs off, and never executes anything.
  server = http.createServer((req, res) => {
    polls += 1;
    res.writeHead(204);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  primaryUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  polls = 0;
  await dbRun(`DELETE FROM users`);
  process.env.AGNT_NODE_ROLE = 'worker';
  process.env.AGNT_CLUSTER_PRIMARY = primaryUrl;
  // Keep the backoff short so a stopped loop exits promptly.
  process.env.AGNT_WORKER_IDLE_MAX_MS = '2000';
});

afterEach(async () => {
  await stopAndSettle();
  delete process.env.AGNT_NODE_ROLE;
  delete process.env.AGNT_CLUSTER_PRIMARY;
  delete process.env.AGNT_CLUSTER_TOKEN;
  delete process.env.AGNT_CLUSTER_WORKER_USER_ID;
  delete process.env.AGNT_WORKER_IDLE_MAX_MS;
});

describe('a headless worker bootstraps itself from its grant', () => {
  it('starts and polls on an install with no user row at all', async () => {
    const { token } = mintNodeToken({ userId: ENROLLED_USER, label: 'fresh-box' });
    process.env.AGNT_CLUSTER_TOKEN = token;

    expect(await dbGet(`SELECT id FROM users`), 'precondition: a brand new install').toBeUndefined();

    const result = await startClusterWorker();

    expect(result.started, 'a correctly enrolled worker must be able to start').toBe(true);
    // "Started" is only worth anything if it actually reached the primary.
    await vi.waitFor(() => expect(polls).toBeGreaterThan(0), { timeout: 5000 });
  });

  it('records the account the PRIMARY enrolled it for', async () => {
    const { token } = mintNodeToken({ userId: ENROLLED_USER, label: 'fresh-box' });
    process.env.AGNT_CLUSTER_TOKEN = token;

    await startClusterWorker();

    // The worker is not deciding who it is — the primary already decided, and
    // this writes that decision down so every `WHERE user_id = ?` resolves.
    const row = await dbGet(`SELECT id, name FROM users WHERE id = ?`, [ENROLLED_USER]);
    expect(row).toBeDefined();
    expect(row.name).toContain('fresh-box');
  });

  it('does not invent an email that a later real sign-in would collide with', async () => {
    const { token } = mintNodeToken({ userId: ENROLLED_USER });
    process.env.AGNT_CLUSTER_TOKEN = token;

    await startClusterWorker();

    const row = await dbGet(`SELECT email FROM users WHERE id = ?`, [ENROLLED_USER]);
    expect(row.email).toBeNull();
  });

  it('leaves an existing row alone rather than overwriting it', async () => {
    await dbRun(`INSERT INTO users (id, email, name) VALUES (?, ?, ?)`, [
      ENROLLED_USER,
      'real@person.test',
      'The Actual Human',
    ]);
    const { token } = mintNodeToken({ userId: ENROLLED_USER, label: 'second-boot' });
    process.env.AGNT_CLUSTER_TOKEN = token;

    await startClusterWorker();

    const row = await dbGet(`SELECT email, name FROM users WHERE id = ?`, [ENROLLED_USER]);
    expect(row.email).toBe('real@person.test');
    expect(row.name).toBe('The Actual Human');
  });

  it('executes as the GRANT\u2019s account, not whoever happens to be signed in', async () => {
    await dbRun(`INSERT INTO users (id, email, name) VALUES (?, ?, ?)`, [
      SOMEBODY_ELSE,
      'someone@else.test',
      'Someone Else',
    ]);
    const { token } = mintNodeToken({ userId: ENROLLED_USER });
    process.env.AGNT_CLUSTER_TOKEN = token;

    await startClusterWorker();

    // The primary only ever hands out work for the grant's account. Running it
    // as a different local user would resolve that user's agents and provider
    // credentials — right up until it resolved none at all.
    expect(await dbGet(`SELECT id FROM users WHERE id = ?`, [ENROLLED_USER])).toBeDefined();
  });

  it('honours an explicit operator override above the grant', async () => {
    const { token } = mintNodeToken({ userId: ENROLLED_USER });
    process.env.AGNT_CLUSTER_TOKEN = token;
    process.env.AGNT_CLUSTER_WORKER_USER_ID = SOMEBODY_ELSE;

    expect((await startClusterWorker()).started).toBe(true);

    // An override is a deliberate act, so nothing is provisioned behind it.
    expect(await dbGet(`SELECT id FROM users WHERE id = ?`, [ENROLLED_USER])).toBeUndefined();
  });
});

describe('a worker that cannot know who it is refuses to start', () => {
  it('refuses when the grant is unreadable and nobody is signed in', async () => {
    process.env.AGNT_CLUSTER_TOKEN = 'not.a.real.token';

    const result = await startClusterWorker();

    // Better to say so than to poll forever as nobody.
    expect(result.started).toBe(false);
    expect(result.reason).toBe('no local user');
  });

  it('still refuses to start with no primary configured', async () => {
    delete process.env.AGNT_CLUSTER_PRIMARY;
    const { token } = mintNodeToken({ userId: ENROLLED_USER });
    process.env.AGNT_CLUSTER_TOKEN = token;

    const result = await startClusterWorker();

    expect(result.started).toBe(false);
    expect(result.reason).toBe('missing primary or token');
    // A worker with no primary must not provision anything either.
    expect(await dbGet(`SELECT id FROM users`)).toBeUndefined();
  });

  it('is inert on a primary, whatever else is configured', async () => {
    process.env.AGNT_NODE_ROLE = 'primary';
    const { token } = mintNodeToken({ userId: ENROLLED_USER });
    process.env.AGNT_CLUSTER_TOKEN = token;

    const result = await startClusterWorker();

    expect(result.started).toBe(false);
    expect(result.reason).toBe('not a worker node');
    expect(await dbGet(`SELECT id FROM users`)).toBeUndefined();
  });
});
