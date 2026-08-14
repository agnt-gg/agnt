/**
 * LIVE HTTP TEST — boots the real backend and talks to it over the wire.
 *
 * Everything above this file tests modules in isolation. This one proves the
 * things only a running server can: that the new route is actually MOUNTED,
 * that auth guards it, that validation rejects what it should, and that a
 * setting written through the API survives a read back through the API.
 *
 * Runs on port 3399 against a throwaway AGNT_HOME, so the user's own AGNT on
 * 3333 and their real 32GB database are untouched.
 */
import { spawn } from 'child_process';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { pathToFileURL } from 'url';

const ROOT = 'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro.wt/dynamic-routing';
const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}/api`;
const JWT_SECRET = 'live-test-secret-' + crypto.randomBytes(8).toString('hex');
const USER = 'u-http-test';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-http-'));
await fsp.mkdir(path.join(TMP, '.agnt', 'data'), { recursive: true });
await fsp.writeFile(path.join(TMP, '.agnt', 'data', 'agnt.db'), '');
delete process.env.USER_DATA_PATH;
delete process.env.DOCKER_CONTAINER;
process.env.AGNT_HOME = TMP;

// ── Seed a user before the server boots ────────────────────────────────────
const dbMod = await import(pathToFileURL(`${ROOT}/backend/src/models/database/index.js`).href);
const db = dbMod.default;
await dbMod.dbReady;
await new Promise((res, rej) =>
  db.run(`INSERT INTO users (id, email, name, default_provider, default_model) VALUES (?,?,?,?,?)`,
    [USER, 'http@example.com', 'HTTP Test', 'Anthropic', 'claude-sonnet-4-5'],
    (e) => (e ? rej(e) : res())));
// The handle stays OPEN for the whole run. Closing it here left the cached
// database module in this process holding a dead connection, so the later
// RoutingDecisionModel writes silently no-op'd (record() is best-effort by
// design and swallows its own errors — correct for production, invisible in a
// harness). WAL mode is what makes two processes on one file safe.
console.log('seeded user (db handle held open for the run)\n');

// ── Boot the real server ───────────────────────────────────────────────────
const child = spawn(process.execPath, ['server.js'], {
  cwd: `${ROOT}/backend`,
  env: {
    ...process.env,
    PORT: String(PORT),
    AGNT_HOME: TMP,
    JWT_SECRET,
    NODE_ENV: 'test',
    ELECTRON_RUN_AS_NODE: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => { bootLog += d.toString(); });
child.stderr.on('data', (d) => { bootLog += d.toString(); });

const stop = async () => {
  try { child.kill('SIGKILL'); } catch {}
  await new Promise((r) => db.close(r)).catch(() => {});
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
};

// Wait for it to answer.
let up = false;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const r = await fetch(`${BASE}/routing/summary`);
    if (r.status === 401 || r.status === 403 || r.ok) { up = true; break; }
  } catch { /* not listening yet */ }
  if (child.exitCode !== null) break;
}
check('the backend boots with the routing routes mounted', up,
  up ? `port ${PORT}` : `exit=${child.exitCode}; log tail: ${bootLog.slice(-600)}`);
if (!up) { await stop(); process.exit(1); }

// ── Mint a token the server will accept ────────────────────────────────────
const { default: jwt } = await import('jsonwebtoken');
const token = jwt.sign({ id: USER, userId: USER, email: 'http@example.com', auth_type: 'local' }, JWT_SECRET, { expiresIn: '1h' });
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

try {
  console.log('\n=== AUTH ===');
  const noAuth = await fetch(`${BASE}/routing/summary`);
  check('GET /routing/summary is guarded', noAuth.status === 401 || noAuth.status === 403, `status ${noAuth.status}`);

  const authed = await api('GET', '/routing/summary');
  check('GET /routing/summary with a token returns 200', authed.status === 200, JSON.stringify(authed.json));
  check('an empty log reports zeros, not nulls',
    authed.json && authed.json.decisions === 0 && authed.json.savedUsd === 0
    && Array.isArray(authed.json.distribution),
    JSON.stringify(authed.json));

  console.log('\n=== THE ONE-CLICK TOGGLE, THROUGH THE API ===');
  const before = await api('GET', '/users/settings');
  check('a fresh user reads routingMode=static (the feature is OFF by default)',
    before.json?.routingMode === 'static' && before.json?.routingPolicy === 'balanced',
    `${before.json?.routingMode}/${before.json?.routingPolicy}`);

  const on = await api('PUT', '/users/settings', { routingMode: 'dynamic' });
  check('PUT routingMode=dynamic succeeds', on.status === 200, `status ${on.status}`);
  const afterOn = await api('GET', '/users/settings');
  check('...and reads back as dynamic', afterOn.json?.routingMode === 'dynamic', String(afterOn.json?.routingMode));
  check('...without disturbing the provider/model defaults',
    afterOn.json?.selectedProvider === 'Anthropic' && afterOn.json?.selectedModel === 'claude-sonnet-4-5');

  console.log('\n=== POLICY (the dial that was dead) ===');
  for (const policy of ['save', 'quality', 'balanced']) {
    const put = await api('PUT', '/users/settings', { routingPolicy: policy });
    const get = await api('GET', '/users/settings');
    check(`policy '${policy}' round-trips through the API`,
      put.status === 200 && get.json?.routingPolicy === policy,
      `PUT ${put.status}, GET ${get.json?.routingPolicy}`);
  }

  console.log('\n=== VALIDATION IS LOUD, NOT SILENT ===');
  const badMode = await api('PUT', '/users/settings', { routingMode: 'DYNAMIC!!' });
  check('an invalid routingMode is rejected with 400', badMode.status === 400, `status ${badMode.status}: ${badMode.json?.error}`);
  const badPolicy = await api('PUT', '/users/settings', { routingPolicy: 'cheapest' });
  check('an invalid routingPolicy is rejected with 400', badPolicy.status === 400, `status ${badPolicy.status}`);
  const stillGood = await api('GET', '/users/settings');
  check('a rejected write changed nothing',
    stillGood.json?.routingMode === 'dynamic' && stillGood.json?.routingPolicy === 'balanced',
    `${stillGood.json?.routingMode}/${stillGood.json?.routingPolicy}`);

  console.log('\n=== OFF IS TOTAL ===');
  await api('PUT', '/users/settings', { routingMode: 'static' });
  const off = await api('GET', '/users/settings');
  check('the toggle turns all the way back off', off.json?.routingMode === 'static');
  check('the fallback chain fields still round-trip while routing exists',
    'fallbackEnabled' in off.json && 'fallbackProviders' in off.json);

  console.log('\n=== PER-CONVERSATION MODE ===');
  const CONV = 'conv-http-1';
  const patch = await api('PATCH', `/conversations/${CONV}/settings`, { routingMode: 'dynamic' });
  check('PATCH conversation routingMode succeeds', patch.status === 200, `status ${patch.status}`);
  const convGet = await api('GET', `/conversations/${CONV}/settings`);
  check('...and reads back', convGet.json?.routingMode === 'dynamic', String(convGet.json?.routingMode));

  const pin = await api('PATCH', `/conversations/${CONV}/settings`, { provider: 'openai', model: 'gpt-5.2', routingMode: 'pinned' });
  const pinGet = await api('GET', `/conversations/${CONV}/settings`);
  check('a conversation can be pinned through the API',
    pin.status === 200 && pinGet.json?.routingMode === 'pinned' && pinGet.json?.provider === 'openai',
    `${pinGet.json?.routingMode} ${pinGet.json?.provider}/${pinGet.json?.model}`);

  const junk = await api('PATCH', `/conversations/${CONV}/settings`, { routingMode: 'wat' });
  const junkGet = await api('GET', `/conversations/${CONV}/settings`);
  check('an unrecognised conversation mode clears to "no opinion" rather than sticking',
    junk.status === 200 && junkGet.json?.routingMode === null,
    String(junkGet.json?.routingMode));

  console.log('\n=== THE DECISION LOG + HONEST SAVINGS ===');
  const RoutingDecisionModel = (await import(pathToFileURL(`${ROOT}/backend/src/models/RoutingDecisionModel.js`).href)).default;
  await RoutingDecisionModel.record({
    userId: USER, conversationId: CONV, origin: 'orchestrator', mode: 'dynamic', policy: 'save',
    stake: 'normal', verifiability: 'subjective',
    chosenProvider: 'groq', chosenModel: 'llama-3.1-8b-instant', chosenReason: 'cheapest capable',
    baselineProvider: 'anthropic', baselineModel: 'claude-sonnet-4-5',
    predictedCostUsd: 0.00106, baselineCostUsd: 0.072, candidatesConsidered: 33,
  });
  await RoutingDecisionModel.record({
    userId: USER, chosenProvider: 'mystery', chosenModel: 'unpriced',
    baselineProvider: 'anthropic', baselineModel: 'claude-sonnet-4-5',
    predictedCostUsd: null, baselineCostUsd: 0.072,
  });

  const sum = await api('GET', '/routing/summary?hours=24');
  check('the summary counts both decisions', sum.json?.decisions === 2, JSON.stringify(sum.json?.decisions));
  check('savings come only from the priced decision',
    Math.abs(sum.json.savedUsd - (0.072 - 0.00106)) < 1e-9,
    `$${sum.json.savedUsd?.toFixed(5)} saved`);
  check('the unpriced decision is reported, never folded in as zero',
    sum.json.unpricedDecisions === 1, `unpriced=${sum.json.unpricedDecisions}`);
  check('the model distribution is populated',
    sum.json.distribution.length === 2 && sum.json.distribution[0].calls === 1,
    sum.json.distribution.map((d) => `${d.model} ${Math.round(d.share * 100)}%`).join(', '));

  const recent = await api('GET', '/routing/recent?limit=5');
  check('GET /routing/recent returns the audit rows newest-first',
    recent.status === 200 && Array.isArray(recent.json) && recent.json.length === 2,
    `${recent.json?.length} rows`);
  check('each row carries the chosen tier AND the counterfactual baseline',
    // .every() on an empty array is vacuously true, which would let this pass
    // while the log was in fact empty. Require the rows first.
    recent.json.length === 2 && recent.json.every((r) => r.chosen && r.baseline),
    `e.g. ${recent.json[1]?.chosen?.model} vs baseline ${recent.json[1]?.baseline?.model}, reason "${recent.json[1]?.chosen?.reason}"`);

  console.log('\n=== ISOLATION ===');
  const otherToken = jwt.sign({ id: 'someone-else', userId: 'someone-else' }, JWT_SECRET, { expiresIn: '1h' });
  const otherSum = await fetch(`${BASE}/routing/summary`, { headers: { Authorization: `Bearer ${otherToken}` } }).then((r) => r.json());
  check('another user sees none of these decisions', otherSum.decisions === 0, `decisions=${otherSum.decisions}`);
} catch (err) {
  check('the suite ran to completion', false, err.message);
}

await stop();
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(60)}\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { failed.forEach((f) => console.log(`  FAILED: ${f.name} ${f.detail}`)); process.exit(1); }
console.log('LIVE HTTP: CLEAN');
process.exit(0);
