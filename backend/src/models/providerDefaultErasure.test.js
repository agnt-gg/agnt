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
 * The erasure was invisible because `getUserSettings` USED TO mask a NULL
 * provider as 'Anthropic' and a NULL model as 'claude-3-5-sonnet-20240620' (it
 * now reports them as null; see the suite below). A wiped row was
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

/** Read the RAW columns, independent of how getUserSettings presents them. */
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

  it('a provider with no model is refused and the stored pair survives whole', async () => {
    // The write a client sent when it switched provider before that
    // provider's models loaded. Storing it left a default that could not run
    // (provider + NULL model), which read back as the retired Anthropic pair.
    // Keeping the previous complete pair is strictly better than half a new one.
    for (const selectedModel of [undefined, null, '', '   ']) {
      await UserModel.updateUserSettings(USER, { selectedProvider: 'Anthropic', selectedModel });
      const row = await rawRow();
      expect(row.default_provider, String(selectedModel)).toBe('Claude-Code');
      expect(row.default_model, String(selectedModel)).toBe('claude-opus-5');
    }
  });
});

describe('getUserSettings never invents a default', () => {
  const OTHER = 'user-erasure-blank';

  it('a row with no default reads back as null, not Anthropic', async () => {
    await dbRun('INSERT OR IGNORE INTO users (id, email, default_provider, default_model) VALUES (?, ?, NULL, NULL)', [OTHER, 'blank@test.local']);
    const settings = await UserModel.getUserSettings(OTHER);
    expect(settings.selectedProvider).toBeNull();
    expect(settings.selectedModel).toBeNull();
  });

  it('a fresh schema has no column default for the default AI', async () => {
    // The stamp is read from the schema, so this is what makes the legacy
    // path a no-op on new installs.
    const columns = await new Promise((resolve, reject) => db.all('PRAGMA table_info(users)', [], (e, rows) => (e ? reject(e) : resolve(rows))));
    const dflt = (name) => columns.find((c) => c.name === name)?.dflt_value ?? null;
    expect(dflt('default_provider')).toBeNull();
    expect(dflt('default_model')).toBeNull();
  });

  it('a deliberate choice of any provider with a current model is kept', async () => {
    await UserModel.updateUserSettings(OTHER, { selectedProvider: 'Some-Provider', selectedModel: 'some-model' });
    const settings = await UserModel.getUserSettings(OTHER);
    expect(settings.selectedProvider).toBe('Some-Provider');
    expect(settings.selectedModel).toBe('some-model');
  });

  it('an unknown user has no default', async () => {
    const settings = await UserModel.getUserSettings('no-such-user');
    expect(settings.selectedProvider).toBeNull();
    expect(settings.selectedModel).toBeNull();
  });

  it('a settings write that creates the user row stores no vendor default', async () => {
    const NEW_USER = 'user-erasure-created';
    await UserModel.updateUserSettings(NEW_USER, { customInstructions: 'hello' });
    const row = await dbGet('SELECT default_provider, default_model FROM users WHERE id = ?', [NEW_USER]);
    expect(row.default_provider).toBeNull();
    expect(row.default_model).toBeNull();
  });
});

describe('readStoredDefaultAi: the legacy schema stamp is not a choice', () => {
  // Values are arbitrary: the stamp is whatever the install's schema says, so
  // the code under test names no vendor and neither does this test.
  const STAMP = { provider: 'Legacy-Vendor', model: 'legacy-model-1' };

  it('a row equal to the column-default stamp reads as no default', async () => {
    const { readStoredDefaultAi } = await import('./UserModel.js');
    expect(readStoredDefaultAi(STAMP.provider, STAMP.model, STAMP)).toEqual({ provider: null, model: null });
  });

  it('the same provider with a different model is a real choice', async () => {
    const { readStoredDefaultAi } = await import('./UserModel.js');
    expect(readStoredDefaultAi(STAMP.provider, 'current-model', STAMP)).toEqual({ provider: STAMP.provider, model: 'current-model' });
  });

  it('with no stamp (new installs) every stored pair is returned as stored', async () => {
    const { readStoredDefaultAi } = await import('./UserModel.js');
    expect(readStoredDefaultAi(STAMP.provider, STAMP.model, { provider: null, model: null })).toEqual(STAMP);
  });
});

describe('every real change to the default is logged with its source', () => {
  const LOGGED = 'user-erasure-logged';
  const history = () => UserModel.getDefaultAiHistory(LOGGED, 200);

  beforeAll(async () => {
    await dbRun('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)', [LOGGED, 'logged@test.local']);
    await UserModel.updateUserSettings(LOGGED, { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5', changeSource: 'fixture' });
  });

  it('records from, to and the writer', async () => {
    await UserModel.updateUserSettings(LOGGED, { selectedProvider: 'OpenAI-Codex', selectedModel: 'gpt-6', changeSource: 'settings-picker' });
    const [latest] = await history();
    expect(latest).toMatchObject({
      previousProvider: 'Claude-Code',
      previousModel: 'claude-opus-5',
      provider: 'OpenAI-Codex',
      model: 'gpt-6',
      source: 'settings-picker',
    });
  });

  it('a write that changes nothing is not logged', async () => {
    const before = (await history()).length;
    await UserModel.updateUserSettings(LOGGED, { selectedProvider: 'OpenAI-Codex', selectedModel: 'gpt-6', changeSource: 'chat-turn-pin' });
    expect((await history()).length).toBe(before);
  });

  it('a model-only write keeps the provider in the log entry', async () => {
    await UserModel.updateUserSettings(LOGGED, { selectedModel: 'gpt-6-mini', changeSource: 'set-model' });
    const [latest] = await history();
    expect(latest).toMatchObject({ provider: 'OpenAI-Codex', model: 'gpt-6-mini', previousModel: 'gpt-6' });
  });

  it('a refused write is not logged', async () => {
    const before = (await history()).length;
    await UserModel.updateUserSettings(LOGGED, { selectedProvider: 'Anthropic', selectedModel: null, changeSource: 'set-provider' });
    expect((await history()).length).toBe(before);
  });

  it('an unrecognised source is stored as unknown, never raw', async () => {
    await UserModel.updateUserSettings(LOGGED, { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5', changeSource: "x'); DROP TABLE users; --" });
    const [latest] = await history();
    expect(latest.source).toBe('unknown');
  });

  it('keeps at most the newest 200 entries per user', async () => {
    for (let i = 0; i < 205; i += 1) {
      await UserModel.updateUserSettings(LOGGED, { selectedProvider: 'Claude-Code', selectedModel: `m-${i}`, changeSource: 'bulk' });
    }
    const rows = await history();
    expect(rows.length).toBe(200);
    expect(rows[0].model).toBe('m-204');
  }, 60000);
});
