/**
 * Per-seat subscription costs on user settings (PRD-122).
 *
 * AGNT already knows which providers are flat-rate seats and what their usage
 * would have cost on a metered API. What it cannot know is what the user pays
 * for them — so the spend panel can say "your seats did $18,463 of metered
 * work" but not whether that was a good deal. This column is the missing half.
 *
 * It is optional enrichment for one dashboard panel, which sets the bar for
 * everything below: it must round-trip exactly, it must never break loading a
 * user's settings no matter what is in the column, and it must never store a
 * value that would make the leverage arithmetic lie.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let UserModel;
let TMP;
const savedEnv = {};

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

const USER = 'user-subcosts';

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-subcosts-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install that should inherit an orphaned database, and
  // would try to copy the developer's real database into temp.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  UserModel = (await import('./UserModel.js')).default;

  await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
    USER, 'subcosts@test.local', 'Sub Costs',
  ]);
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('round trip', () => {
  it('defaults to an empty map, not null — "not told" is a normal state', async () => {
    const s = await UserModel.getUserSettings(USER);
    expect(s.subscriptionCosts).toEqual({});
  });

  it('stores and returns fees keyed by provider', async () => {
    await UserModel.updateUserSettings(USER, {
      subscriptionCosts: { 'claude-code': 200, 'openai-codex': 20 },
    });
    const s = await UserModel.getUserSettings(USER);
    expect(s.subscriptionCosts).toEqual({ 'claude-code': 200, 'openai-codex': 20 });
  });

  it('lower-cases provider keys so one seat cannot be stored twice', async () => {
    await UserModel.updateUserSettings(USER, { subscriptionCosts: { 'Claude-Code': 200 } });
    const s = await UserModel.getUserSettings(USER);
    expect(s.subscriptionCosts).toEqual({ 'claude-code': 200 });
  });

  it('leaves other settings untouched', async () => {
    await UserModel.updateUserSettings(USER, { selectedProvider: 'Anthropic', selectedModel: 'x' });
    await UserModel.updateUserSettings(USER, { subscriptionCosts: { 'claude-code': 150 } });
    const s = await UserModel.getUserSettings(USER);
    expect(s.selectedProvider).toBe('Anthropic');
    expect(s.selectedModel).toBe('x');
    expect(s.subscriptionCosts).toEqual({ 'claude-code': 150 });
  });

  it('is not touched by an update that does not mention it', async () => {
    await UserModel.updateUserSettings(USER, { customInstructions: 'hello' });
    const s = await UserModel.getUserSettings(USER);
    expect(s.subscriptionCosts).toEqual({ 'claude-code': 150 });
  });
});

describe('values that would make the arithmetic lie are refused', () => {
  it('drops zero and negative fees rather than storing them', async () => {
    // A stored 0 becomes the denominator of the leverage multiple. Infinity is
    // not a number worth showing a user.
    await UserModel.updateUserSettings(USER, {
      subscriptionCosts: { 'claude-code': 0, 'openai-codex': -50, 'gemini-cli': 20 },
    });
    const s = await UserModel.getUserSettings(USER);
    expect(s.subscriptionCosts).toEqual({ 'gemini-cli': 20 });
  });

  it('drops non-numeric fees', async () => {
    await UserModel.updateUserSettings(USER, {
      subscriptionCosts: { 'claude-code': 'free', 'openai-codex': null, 'gemini-cli': 20 },
    });
    expect((await UserModel.getUserSettings(USER)).subscriptionCosts).toEqual({ 'gemini-cli': 20 });
  });

  it('clearing every fee returns to the "not told" state', async () => {
    await UserModel.updateUserSettings(USER, { subscriptionCosts: {} });
    expect((await UserModel.getUserSettings(USER)).subscriptionCosts).toEqual({});
  });
});

describe('a corrupt column can never break settings', () => {
  it('tolerates malformed JSON', async () => {
    // Optional enrichment for one panel must not be able to make a user unable
    // to load their provider, model or instructions.
    await dbRun(`UPDATE users SET subscription_costs = ? WHERE id = ?`, ['{not json', USER]);
    const s = await UserModel.getUserSettings(USER);
    expect(s.subscriptionCosts).toEqual({});
    expect(s.selectedProvider).toBeTruthy();
  });

  it('tolerates a JSON value of the wrong shape', async () => {
    await dbRun(`UPDATE users SET subscription_costs = ? WHERE id = ?`, ['[1,2,3]', USER]);
    expect((await UserModel.getUserSettings(USER)).subscriptionCosts).toEqual({});
  });

  it('tolerates a legacy NULL', async () => {
    await dbRun(`UPDATE users SET subscription_costs = NULL WHERE id = ?`, [USER]);
    expect((await UserModel.getUserSettings(USER)).subscriptionCosts).toEqual({});
  });
});
