/**
 * UPGRADE PATH TEST — the riskiest thing in this branch.
 *
 * Unit tests build a database with the NEW schema, so they can never catch the
 * failure that actually ships: an EXISTING database being migrated in place.
 * That is a different code path (ALTER TABLE on a populated table, not CREATE
 * TABLE), and it is the one every current install will take exactly once.
 *
 * Method:
 *   1. Boot the BASE-COMMIT database module (main repo, no routing columns)
 *      against a throwaway AGNT_HOME → a genuine pre-routing database.
 *   2. Write realistic pre-existing rows into it.
 *   3. Boot the NEW database module (worktree) against that SAME file.
 *   4. Assert the columns/table appeared, every pre-existing row survived
 *      untouched, and the feature reads as OFF.
 *
 * Nothing here touches the user's real database — AGNT_HOME is redirected to a
 * temp directory before any import.
 */
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const MAIN = 'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/backend/src/models/database/index.js';
const WT = 'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro.wt/dynamic-routing/backend/src/models/database/index.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const run = (db, sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const get = (db, sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
const all = (db, sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const cols = async (db, table) =>
  (await all(db, `PRAGMA table_info(${table})`)).map((c) => c.name);

const TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-upgrade-'));
const dataDir = path.join(TMP, '.agnt', 'data');
await fsp.mkdir(dataDir, { recursive: true });
await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

delete process.env.USER_DATA_PATH;
delete process.env.DOCKER_CONTAINER;
process.env.AGNT_HOME = TMP;

console.log(`\n=== STEP 1: build a PRE-ROUTING database with the base commit ===`);
const oldMod = await import(pathToFileURL(MAIN).href);
const oldDb = oldMod.default;
await oldMod.dbReady;

const beforeUsers = await cols(oldDb, 'users');
check('base schema genuinely has NO routing columns (control)',
  !beforeUsers.includes('routing_mode') && !beforeUsers.includes('routing_policy'),
  `users has ${beforeUsers.length} columns`);

const tablesBefore = (await all(oldDb, `SELECT name FROM sqlite_master WHERE type='table'`)).map((t) => t.name);
check('base schema has no routing_decisions table (control)',
  !tablesBefore.includes('routing_decisions'));

console.log(`\n=== STEP 2: write realistic pre-existing rows ===`);
await run(oldDb, `INSERT INTO users (id, email, name, default_provider, default_model, fallback_providers, fallback_enabled, custom_instructions, max_tool_rounds)
                  VALUES (?,?,?,?,?,?,?,?,?)`,
  ['u-legacy', 'legacy@example.com', 'Legacy User', 'Anthropic', 'claude-sonnet-4-5',
   JSON.stringify([{ provider: 'openai', model: 'gpt-5.2' }, { provider: 'groq', model: 'llama-x' }]), 1,
   'Be terse.', 42]);
await run(oldDb, `INSERT INTO agents (id, name, description, status, icon, category, tools, workflows, provider, model, created_by, fallback_providers, fallback_enabled)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ['a-legacy', 'Legacy Agent', 'desc', 'active', 'x', 'cat', '[]', '[]', 'openai', 'gpt-5.2', 'u-legacy',
   JSON.stringify([{ provider: 'gemini', model: 'flash' }]), 1]);
await run(oldDb, `INSERT INTO conversation_settings (conversation_id, user_id, active_skill_id, provider, model)
                  VALUES (?,?,?,?,?)`,
  ['c-legacy', 'u-legacy', 'skill-7', 'anthropic', 'claude-haiku-4-5']);
const legacyUserBefore = await get(oldDb, `SELECT * FROM users WHERE id = 'u-legacy'`);
await new Promise((r) => oldDb.close(r));
console.log('   wrote user + agent + conversation_settings, closed base db');

console.log(`\n=== STEP 3: boot the NEW code against that same file ===`);
const newMod = await import(pathToFileURL(WT).href);
const newDb = newMod.default;
await newMod.dbReady;
// Migrations are fire-and-forget db.run calls; let the queue drain.
await new Promise((r) => setTimeout(r, 1500));

console.log(`\n=== STEP 4: assertions ===`);
const afterUsers = await cols(newDb, 'users');
check('users.routing_mode was added', afterUsers.includes('routing_mode'));
check('users.routing_policy was added', afterUsers.includes('routing_policy'));
check('agents.routing_mode was added', (await cols(newDb, 'agents')).includes('routing_mode'));
check('conversation_settings.routing_mode was added',
  (await cols(newDb, 'conversation_settings')).includes('routing_mode'));

const tablesAfter = (await all(newDb, `SELECT name FROM sqlite_master WHERE type='table'`)).map((t) => t.name);
check('routing_decisions table was created', tablesAfter.includes('routing_decisions'));
const idx = await all(newDb, `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='routing_decisions'`);
check('routing_decisions index was created', idx.some((i) => i.name === 'idx_routing_decisions_user_ts'),
  idx.map((i) => i.name).join(', '));

// No column was dropped or renamed by the migration.
const lost = beforeUsers.filter((c) => !afterUsers.includes(c));
check('no pre-existing users column was lost', lost.length === 0, lost.join(', ') || 'none');

const legacyUserAfter = await get(newDb, `SELECT * FROM users WHERE id = 'u-legacy'`);
const preserved = Object.keys(legacyUserBefore).every(
  (k) => String(legacyUserBefore[k]) === String(legacyUserAfter[k])
);
check('every pre-existing user field survived the migration', preserved);

check('legacy fallback chain is intact — it is the rollback',
  legacyUserAfter.fallback_providers === JSON.stringify([{ provider: 'openai', model: 'gpt-5.2' }, { provider: 'groq', model: 'llama-x' }])
  && legacyUserAfter.fallback_enabled === 1);

// THE HEADLINE: an upgraded row must be OFF.
//
// It reads 'static', not NULL: `ALTER TABLE ... ADD COLUMN x TEXT DEFAULT
// 'static'` makes SQLite report the DEFAULT for every pre-existing row, so the
// backfill is implicit. That is stronger than NULL, not weaker — an upgraded
// account is explicitly OFF and matches a freshly-created one exactly, so the
// two boot paths cannot diverge. (My first version of this assertion expected
// NULL and was simply wrong about SQLite.)
//
// The guarantee being asserted is the one that matters: NOT dynamic.
check('an UPGRADED row is OFF, and can never read as dynamic',
  legacyUserAfter.routing_mode !== 'dynamic' && legacyUserAfter.routing_mode === 'static',
  `got ${JSON.stringify(legacyUserAfter.routing_mode)}`);

// agents.routing_mode has NO default, so it stays NULL = "no opinion" and the
// agent inherits the account. Two different columns, two different intents.
check('the two column intents are distinct: account defaults OFF, agent defers',
  legacyUserAfter.routing_mode === 'static' && legacyUserAfter.routing_policy === null);

const legacyAgent = await get(newDb, `SELECT * FROM agents WHERE id = 'a-legacy'`);
check('agent survived and has no routing opinion',
  legacyAgent.provider === 'openai' && legacyAgent.routing_mode === null);

const legacyConv = await get(newDb, `SELECT * FROM conversation_settings WHERE conversation_id = 'c-legacy'`);
check('conversation kept its skill + AI pin, routing NULL',
  legacyConv.active_skill_id === 'skill-7' && legacyConv.provider === 'anthropic' && legacyConv.routing_mode === null);

// The model layer must translate NULL → the documented default.
process.env.AGNT_HOME = TMP;
const UserModel = (await import(pathToFileURL(
  'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro.wt/dynamic-routing/backend/src/models/UserModel.js'
).href)).default;
const settings = await UserModel.getUserSettings('u-legacy');
check('getUserSettings translates the upgraded NULL to static/balanced',
  settings.routingMode === 'static' && settings.routingPolicy === 'balanced',
  `${settings.routingMode}/${settings.routingPolicy}`);
check('...without disturbing the legacy provider/model/instructions',
  settings.selectedProvider === 'Anthropic' && settings.selectedModel === 'claude-sonnet-4-5'
  && settings.customInstructions === 'Be terse.' && settings.maxToolRounds === 42);

// Idempotency: booting again must not error or duplicate.
console.log(`\n=== STEP 5: second boot (migrations must be idempotent) ===`);
const secondBoot = await import(pathToFileURL(WT).href + '?v=2').then(async (m) => {
  await m.dbReady; return true;
}).catch((e) => e.message);
check('a second boot of the migrated database succeeds', secondBoot === true,
  secondBoot === true ? '' : String(secondBoot));

await new Promise((r) => newDb.close(r));
await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(60)}\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILURES:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
  process.exit(1);
}
console.log('UPGRADE PATH: CLEAN');
process.exit(0);
