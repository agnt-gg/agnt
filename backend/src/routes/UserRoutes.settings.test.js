/**
 * The settings endpoint, over HTTP, plus a guard on the thing that broke it.
 *
 * `UserService.updateUserSettings` keeps its own allow-list of setting names,
 * and a field has to be threaded through FOUR separate places in that one
 * method: the destructure, the "at least one setting" presence check, the
 * `UserModel.updateUserSettings` call, and the response echo. Miss any one and
 * the field silently does nothing.
 *
 * That is exactly what happened to `subscriptionCosts`: the migration, the
 * model read/write and the UI were all correct, the model-level test passed —
 * and every save returned 400 because the route rejected the body before the
 * model ever saw it. A unit test that calls the model directly cannot catch
 * this; only a request can.
 *
 * So this file does two jobs:
 *   1. round-trips each field through a real HTTP request, and
 *   2. asserts the service's allow-list has not fallen behind the model's,
 *      which is what makes the NEXT field impossible to half-wire.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const USER = 'user-settings-http';

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { isAuthenticated: true, id: USER, userId: USER };
    next();
  },
  authenticateTokenOptional: (req, _res, next) => next(),
  sessionMiddleware: (req, _res, next) => next(),
  getUserTokenFromSession: () => null,
}));

let server;
let baseUrl;
let db;
let TMP;
const savedEnv = {};

const req = async (method, url, body) => {
  const res = await fetch(baseUrl + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body: parsed };
};

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-settings-http-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  await new Promise((res, rej) =>
    db.run('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)',
      [USER, 'settings-http@test.local', 'Settings HTTP'],
      (e) => (e ? rej(e) : res()))
  );

  const UserRoutes = (await import('./UserRoutes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/users', UserRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 120000);

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('subscription costs round-trip over HTTP', () => {
  it('accepts a subscriptionCosts-only body', async () => {
    // The reported bug: this returned 400 "At least one setting … is required",
    // so the Save button appeared to do nothing at all.
    const { status } = await req('PUT', '/users/settings', {
      subscriptionCosts: { 'claude-code': 200, 'openai-codex': 20 },
    });
    expect(status).toBe(200);
  });

  it('persists them, readable on the next GET', async () => {
    const { status, body } = await req('GET', '/users/settings');
    expect(status).toBe(200);
    expect(body.subscriptionCosts).toEqual({ 'claude-code': 200, 'openai-codex': 20 });
  });

  it('clears them when given an empty object', async () => {
    await req('PUT', '/users/settings', { subscriptionCosts: {} });
    const { body } = await req('GET', '/users/settings');
    expect(body.subscriptionCosts).toEqual({});
  });

  it('rejects a non-object shape rather than storing junk', async () => {
    for (const bad of [[], 'free', 42]) {
      const { status } = await req('PUT', '/users/settings', { subscriptionCosts: bad });
      expect(status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('still rejects a body with no settings at all', async () => {
    const { status } = await req('PUT', '/users/settings', {});
    expect(status).toBe(400);
  });

  it('does not disturb other settings', async () => {
    await req('PUT', '/users/settings', { selectedProvider: 'Anthropic', selectedModel: 'test-model' });
    await req('PUT', '/users/settings', { subscriptionCosts: { 'claude-code': 150 } });
    const { body } = await req('GET', '/users/settings');
    expect(body.selectedProvider).toBe('Anthropic');
    expect(body.selectedModel).toBe('test-model');
    expect(body.subscriptionCosts).toEqual({ 'claude-code': 150 });
  });
});

describe('the service allow-list cannot fall behind the model', () => {
  // The systemic half. UserModel.updateUserSettings decides what CAN be
  // persisted; UserService decides what is ALLOWED THROUGH. When the two lists
  // disagree, the field silently does nothing and no unit test notices,
  // because the model works perfectly when called directly.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (p) => fs.readFileSync(path.resolve(here, p), 'utf8');

  /**
   * Names in `const { ... } = <from>;` after `anchor`.
   *
   * Anchored on the assignment source rather than "the next brace", because
   * both methods open an arrow function or a Promise before they destructure
   * and a naive brace scan captures that instead.
   */
  const destructuredFrom = (source, anchor, from) => {
    const at = source.indexOf(anchor);
    if (at === -1) return null;
    const m = new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${from}\\s*;`).exec(source.slice(at));
    if (!m) return null;
    return m[1].split(',').map((s) => s.trim()).filter(Boolean);
  };

  const modelFields = () =>
    destructuredFrom(read('../models/UserModel.js'), 'static updateUserSettings(userId, settings)', 'settings');
  const serviceFields = () =>
    destructuredFrom(read('../services/UserService.js'), 'async updateUserSettings(req, res)', 'req\\.body');

  it('ANTI-VACUITY: both lists parse and are substantial', () => {
    // A scanner that reads nothing passes everything.
    expect(modelFields()?.length).toBeGreaterThan(5);
    expect(serviceFields()?.length).toBeGreaterThan(5);
  });

  it('every field the model persists is accepted by the service', () => {
    const missing = modelFields().filter((f) => !serviceFields().includes(f));
    expect(missing).toEqual([]);
  });

  it('every accepted field is named in the presence check, or it can never arrive alone', () => {
    // A field absent from the "at least one setting" guard is only settable
    // alongside some other field — which is precisely how the Save button
    // could send a valid body and still get a 400.
    const service = read('../services/UserService.js');
    const checkStart = service.indexOf('At least one setting');
    const guard = service.slice(Math.max(0, checkStart - 900), checkStart);
    const missing = serviceFields().filter((f) => !guard.includes(`${f} === undefined`));
    expect(missing).toEqual([]);
  });

  it('every accepted field is forwarded to the model, not silently dropped', () => {
    const service = read('../services/UserService.js');
    const callAt = service.indexOf('UserModel.updateUserSettings(req.user.id, {');
    expect(callAt).toBeGreaterThan(-1);
    const payload = service.slice(callAt, service.indexOf('});', callAt));
    const missing = serviceFields().filter((f) => !payload.includes(f));
    expect(missing).toEqual([]);
  });
});
