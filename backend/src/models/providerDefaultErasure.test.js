/**
 * THE ACCOUNT DEFAULT CANNOT BE ERASED BY A MODEL WRITE.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 * `updateUserSettings` branched on `selectedProvider !== undefined`. null is
 * not undefined, so a payload of { selectedProvider: null, selectedModel: 'x' }
 * took the provider branch and wrote NULL into default_provider AND
 * default_model.
 *
 * Two clients send exactly that payload: `setModel` and `ensureValidModel`
 * both put `state.selectedProvider` on the wire verbatim, and that value is
 * null during the boot race and after any path that clears the selection.
 *
 * The erasure was invisible because `getUserSettings` masks a NULL provider as
 * 'Anthropic' and a NULL model as 'claude-3-5-sonnet-20240620'. A wiped row is
 * therefore indistinguishable from a deliberate switch to Anthropic — which is
 * precisely how it was reported ("it keeps changing my default to Anthropic"),
 * and precisely the pair a live settings watcher recorded on the flip.
 *
 * It survived for months because the orchestrator used to write the resolved
 * pair back on essentially every turn, repairing a wiped row within one
 * message. When that write-back was correctly narrowed to pinned requests, the
 * repair disappeared and the erasure became permanent — a saved default that
 * "stopped saving".
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let UserModel;
let TMP;
const savedEnv = {};

const USER = 'user-erasure-1';

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (e) { e ? reject(e) : resolve(this); }));
const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r))));

/** Read the RAW columns. getUserSettings masks NULL, so it cannot prove this. */
const rawRow = () =>
  dbGet('SELECT default_provider, default_model FROM users WHERE id = ?', [USER]);

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-erasure-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  UserModel = (await import('./UserModel.js')).default;

  await dbRun('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)', [USER, 'erasure@test.local']);
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  // Every test starts from a deliberately chosen, non-Anthropic default.
  await UserModel.updateUserSettings(USER, {
    selectedProvider: 'Claude-Code',
    selectedModel: 'claude-opus-5',
  });
});

describe('updateUserSettings — a model write cannot erase the provider', () => {
  it('the fixture itself is honest: the chosen pair really is in the columns', async () => {
    const row = await rawRow();
    expect(row.default_provider).toBe('Claude-Code');
    expect(row.default_model).toBe('claude-opus-5');
  });

  it('selectedProvider: null writes the MODEL and leaves the provider intact', async () => {
    await UserModel.updateUserSettings(USER, {
      selectedProvider: null,
      selectedModel: 'claude-opus-6',
    });

    const row = await rawRow();
    expect(row.default_provider).toBe('Claude-Code');
    // The model half of the write must still land — the guard falls through to
    // the model-only branch rather than dropping the write on the floor.
    expect(row.default_model).toBe('claude-opus-6');
  });

  it('selectedProvider: undefined is unchanged behaviour (model-only write)', async () => {
    await UserModel.updateUserSettings(USER, { selectedModel: 'claude-opus-7' });

    const row = await rawRow();
    expect(row.default_provider).toBe('Claude-Code');
    expect(row.default_model).toBe('claude-opus-7');
  });

  it('an empty / whitespace provider is treated as absent, not as an erasure', async () => {
    await UserModel.updateUserSettings(USER, { selectedProvider: '', selectedModel: 'm1' });
    expect((await rawRow()).default_provider).toBe('Claude-Code');

    await UserModel.updateUserSettings(USER, { selectedProvider: '   ', selectedModel: 'm2' });
    expect((await rawRow()).default_provider).toBe('Claude-Code');
  });

  it('the user-visible symptom is gone: a null-provider write never reads back as Anthropic', async () => {
    await UserModel.updateUserSettings(USER, {
      selectedProvider: null,
      selectedModel: 'claude-opus-6',
    });

    const settings = await UserModel.getUserSettings(USER);
    // This is the assertion that maps 1:1 onto the bug report. Before the
    // guard, the row was NULL and getUserSettings substituted this exact pair.
    expect(settings.selectedProvider).not.toBe('Anthropic');
    expect(settings.selectedModel).not.toBe('claude-3-5-sonnet-20240620');
    expect(settings.selectedProvider).toBe('Claude-Code');
  });

  it('a REAL provider change still rewrites both columns (guard is not a freeze)', async () => {
    await UserModel.updateUserSettings(USER, {
      selectedProvider: 'OpenAI',
      selectedModel: 'gpt-5.6',
    });

    const row = await rawRow();
    expect(row.default_provider).toBe('OpenAI');
    expect(row.default_model).toBe('gpt-5.6');
  });

  it('a real provider change with no model still clears the stale model', async () => {
    // The original invariant this branch protected: a model from the PREVIOUS
    // provider must not linger once the provider moves.
    await UserModel.updateUserSettings(USER, { selectedProvider: 'OpenAI' });

    const row = await rawRow();
    expect(row.default_provider).toBe('OpenAI');
    expect(row.default_model).toBeNull();
  });
});
