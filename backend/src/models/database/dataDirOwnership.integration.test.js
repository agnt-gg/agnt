/**
 * The incident, reproduced with real processes and the real database module.
 *
 * 2026-10-07: a chat tool imported a backend module to read one setting. Because
 * models/database/index.js runs boot work on import, that import executed the
 * startup sweep — UPDATE agent_executions SET status='interrupted' WHERE
 * status='running' — against the live app's database, and two in-flight
 * conversations were stamped 'interrupted'. It had happened before.
 *
 * Contract pinned here:
 *   1. While the app (owner) is alive, a second process importing the module
 *      must not touch the owner's running rows.
 *   2. Once the owner is dead, the next process to boot becomes owner and the
 *      sweep still does its job.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import sqlite3 from 'sqlite3';

const DB_MODULE_URL = pathToFileURL(path.resolve(__dirname, 'index.js')).href;
const RUN_ID = 'live-run-owned-by-the-app';

const ROLE_SCRIPTS = {
  // The running app: boots, starts a run, keeps going.
  owner: `
    const { default: db, dbReady } = await import(${JSON.stringify(DB_MODULE_URL)});
    await dbReady;
    const run = (sql, p = []) => new Promise((ok, no) => db.run(sql, p, (e) => (e ? no(e) : ok())));
    await run('PRAGMA foreign_keys = OFF');
    await run("INSERT INTO agent_executions (id, user_id, status) VALUES (?, 'u', 'running')", [${JSON.stringify(RUN_ID)}]);
    console.log('@@ready');
    setInterval(() => {}, 1 << 30);
  `,
  // Anything else that imports a backend model: a script, a chat tool.
  importer: `
    const { dbReady } = await import(${JSON.stringify(DB_MODULE_URL)});
    await dbReady;
    console.log('@@ready');
    process.exit(0);
  `,
};

function startRole(role, userDataPath) {
  const env = { ...process.env, USER_DATA_PATH: userDataPath, NODE_ENV: 'test' };
  delete env.AGNT_SKIP_DB_INIT;
  delete env.AGNT_HOME;
  const child = spawn(process.execPath, ['--input-type=module', '-e', ROLE_SCRIPTS[role]], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('@@ready')) resolve(output);
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => { if (!output.includes('@@ready')) reject(new Error(`${role} exited ${code} before ready:\n${output}`)); });
  });
  return { child, ready, output: () => output };
}

function exited(child) {
  return new Promise((resolve) => (child.exitCode !== null || child.signalCode ? resolve() : child.on('exit', resolve)));
}

function readRunStatus(dbFile) {
  return new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      handle.get('SELECT status FROM agent_executions WHERE id = ?', [RUN_ID], (err, row) => {
        handle.close();
        return err ? reject(err) : resolve(row?.status);
      });
    });
  });
}

describe('a second process on the live data dir', () => {
  const children = [];
  let rootDir;

  afterEach(async () => {
    for (const child of children.splice(0)) { child.kill('SIGKILL'); await exited(child); }
    if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("leaves the live app's running rows alone, and the sweep still runs once the app is gone", async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-owner-e2e-'));
    const dataDir = path.join(rootDir, 'Data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'agnt.db'), ''); // disarm the legacy-migration shim
    const dbFile = path.join(dataDir, 'agnt.db');

    const app = startRole('owner', rootDir);
    children.push(app.child);
    await app.ready;
    expect(await readRunStatus(dbFile)).toBe('running');

    // The exact incident: something else imports the database module.
    const intruder = startRole('importer', rootDir);
    children.push(intruder.child);
    await intruder.ready;
    await exited(intruder.child);
    expect(intruder.output()).toContain('Startup sweeps skipped: another process owns');
    expect(await readRunStatus(dbFile)).toBe('running');

    // The app dies without cleanup. Its run really is orphaned now.
    app.child.kill('SIGKILL');
    await exited(app.child);

    const nextBoot = startRole('importer', rootDir);
    children.push(nextBoot.child);
    await nextBoot.ready;
    await exited(nextBoot.child);
    expect(nextBoot.output()).not.toContain('Startup sweeps skipped');
    expect(await readRunStatus(dbFile)).toBe('interrupted');
  }, 120_000);
});
