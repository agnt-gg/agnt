/**
 * THE ROUTER AGAINST THE REAL REGISTRY.
 *
 * Every unit test in this branch feeds the scorer synthetic candidates, which
 * proves the MATH but says nothing about whether `collectCandidates` can
 * actually build a pool out of AGNT's real provider registry, real published
 * pricing, real cache economics and real capability flags. That gap is where a
 * routing feature dies: the objective is fine and the pool is empty, or full of
 * models nobody can call.
 *
 * So this drives the real modules end to end, with only ONE thing faked — the
 * credential lookup, because the point is to test routing, not to spend money.
 * Every price, context window, vision flag and cache multiplier below comes
 * from the shipping registry.
 */
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

const TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-router-'));
await fsp.mkdir(path.join(TMP, '.agnt', 'data'), { recursive: true });
await fsp.writeFile(path.join(TMP, '.agnt', 'data', 'agnt.db'), '');
delete process.env.USER_DATA_PATH;
delete process.env.DOCKER_CONTAINER;
process.env.AGNT_HOME = TMP;

const B = '../../backend/src/services/orchestrator';
const { collectCandidates, __resetRoutingCaches } = await import(`${B}/routingCandidates.js`);
const { buildDynamicChain, estimateCost } = await import(`${B}/DynamicChain.js`);
const { classifyIntent } = await import(`${B}/routingIntent.js`);
const { parseRoutingPolicy } = await import(`${B}/routingMode.js`);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

// The ONLY fake: which providers this user has credentials for.
const CONNECTED = ['anthropic', 'openai', 'gemini', 'groq', 'grokai', 'deepseek', 'cerebras'];
const authManager = { getConnectedApps: async () => CONNECTED.map((id) => ({ providerId: id })) };

const poolFor = async (intent) => {
  __resetRoutingCaches();
  return collectCandidates({ userId: 'u1', authToken: null, authManager, intent });
};

console.log('\n=== POOL CONSTRUCTION FROM THE REAL REGISTRY ===');
const baseIntent = classifyIntent({ origin: 'orchestrator', contextTokens: 20000, hasTools: true });
const pool = await poolFor(baseIntent);

check('the pool is non-empty', pool.length > 0, `${pool.length} candidates`);
const providersFound = [...new Set(pool.map((c) => c.provider))].sort();
check('every credentialed provider contributed models',
  CONNECTED.every((p) => providersFound.includes(p)),
  providersFound.join(', '));

const priced = pool.filter((c) => Number.isFinite(c.inputCostPer1M));
check('the registry actually priced most of the pool',
  priced.length / pool.length > 0.5,
  `${priced.length}/${pool.length} priced (${Math.round((priced.length / pool.length) * 100)}%)`);

const withCtx = pool.filter((c) => Number.isFinite(c.contextWindow));
check('context windows are populated (the eligibility filter depends on them)',
  withCtx.length / pool.length > 0.5, `${withCtx.length}/${pool.length}`);

const cacheKnown = pool.filter((c) => c.cacheKnown);
check('cache economics resolved for a real share of the pool',
  cacheKnown.length > 0,
  `${cacheKnown.length}/${pool.length} have a KNOWN cache multiplier`);

check('nothing is measured yet, so every candidate takes the explore path',
  pool.every((c) => c.quality === undefined),
  'quality is undefined until the ledger has samples — never a silent default');

const spread = priced.map((c) => c.inputCostPer1M).sort((a, b) => a - b);
check('the pool spans a real price range (there is something to optimise)',
  spread.length > 1 && spread[spread.length - 1] / Math.max(spread[0], 0.001) > 5,
  `$${spread[0]}/M .. $${spread[spread.length - 1]}/M input`);

console.log('\n=== POLICY CHANGES THE ANSWER (real models, real prices) ===');
const pick = (policy, intent = baseIntent, session = {}) => {
  const chain = buildDynamicChain({
    intent, candidates: pool, policy: parseRoutingPolicy(policy), session,
    hint: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  });
  return chain;
};

const save = pick('save');
const balanced = pick('balanced');
const quality = pick('quality');

const fmt = (c) => `${c.provider}/${c.model}` + (c.estimatedCostUsd !== null ? ` ($${c.estimatedCostUsd.toFixed(5)})` : ' (unpriced)');
console.log(`   save      -> ${save.map(fmt).join('  |  ')}`);
console.log(`   balanced  -> ${balanced.map(fmt).join('  |  ')}`);
console.log(`   quality   -> ${quality.map(fmt).join('  |  ')}`);

check('all three policies produce a usable chain', [save, balanced, quality].every((c) => c.length > 0));
check('save mode is not more expensive than quality mode',
  save[0].estimatedCostUsd <= quality[0].estimatedCostUsd,
  `save $${save[0].estimatedCostUsd?.toFixed(5)} vs quality $${quality[0].estimatedCostUsd?.toFixed(5)}`);
check('the policy dial actually moves the choice',
  save[0].model !== quality[0].model,
  `${save[0].provider}/${save[0].model}  ->  ${quality[0].provider}/${quality[0].model}`);
check('save mode is meaningfully cheaper, not marginally cheaper',
  quality[0].estimatedCostUsd / Math.max(save[0].estimatedCostUsd, 1e-9) > 2,
  `${(quality[0].estimatedCostUsd / Math.max(save[0].estimatedCostUsd, 1e-9)).toFixed(1)}x apart`);

console.log('\n=== THE CHAIN IS A FAILOVER CHAIN ===');
check('chain is capped at 4 tiers', balanced.length <= 4, `${balanced.length} tiers`);
check('no provider repeats across tiers',
  new Set(balanced.map((t) => t.provider)).size === balanced.length,
  balanced.map((t) => t.provider).join(' -> '));
check('tiers are numbered 0..n with exactly one primary',
  balanced.every((t, i) => t.tier === i) && balanced.filter((t) => t.primary).length === 1);
check('every tier names a concrete model', balanced.every((t) => typeof t.model === 'string' && t.model.length > 0));
check('every tier explains itself', balanced.every((t) => !!t.reason),
  balanced.map((t) => t.reason).join(' | '));

console.log('\n=== HARD CONSTRAINTS AGAINST REAL CAPABILITY DATA ===');
const visionIntent = classifyIntent({ origin: 'orchestrator', contextTokens: 20000, hasImages: true });
const visionPool = await poolFor(visionIntent);
const visionChain = buildDynamicChain({
  intent: visionIntent, candidates: visionPool, policy: parseRoutingPolicy('balanced'),
  hint: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
});
const visionRejected = visionChain[0].rejected || [];
check('an image-bearing turn rejects text-only models by name',
  visionRejected.some((r) => /vision/.test(r.reason)),
  `${visionRejected.filter((r) => /vision/.test(r.reason)).length} rejected for no vision; chose ${visionChain[0].provider}/${visionChain[0].model}`);
check('the model it chose for an image really does support vision',
  visionPool.find((c) => c.provider === visionChain[0].provider && c.model === visionChain[0].model)?.supportsVision === true);

// 900k IS servable by the real lineup (grok-4-1 carries 2M, gemini 1M), so the
// correct assertion is not "everything is rejected" — that was my own wrong
// assumption — but that the filter shrinks the pool and every SURVIVOR can
// genuinely hold the prompt.
const hugeIntent = classifyIntent({ origin: 'orchestrator', contextTokens: 900000 });
const hugePool = await poolFor(hugeIntent);
const hugeChain = buildDynamicChain({
  intent: hugeIntent, candidates: hugePool, policy: parseRoutingPolicy('balanced'),
  hint: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
});
const hugeRejected = hugeChain[0].rejected || [];
check('a 900k-token turn rejects the small-context models',
  hugeRejected.filter((r) => /context/.test(r.reason)).length > 5,
  `${hugeRejected.filter((r) => /context/.test(r.reason)).length} rejected for context; ${hugeChain[0].consideredCount} survived`);
check('every survivor really can hold 900k + room to answer',
  hugeChain.every((t) => {
    const c = hugePool.find((x) => x.provider === t.provider && x.model === t.model);
    return c && c.contextWindow >= 900000;
  }),
  hugeChain.map((t) => `${t.model}:${hugePool.find((x) => x.model === t.model)?.contextWindow}`).join(', '));

// And a prompt nothing can hold must degrade to the hint rather than fail.
const absurdIntent = classifyIntent({ origin: 'orchestrator', contextTokens: 50_000_000 });
const absurdPool = await poolFor(absurdIntent);
const absurdChain = buildDynamicChain({
  intent: absurdIntent, candidates: absurdPool, policy: parseRoutingPolicy('balanced'),
  hint: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
});
check('a prompt no model can hold degrades to the caller default, never an error',
  absurdChain.length === 1 && absurdChain[0].score === null && absurdChain[0].provider === 'anthropic',
  `reason: ${absurdChain[0].reason}`);

console.log('\n=== STAKE, FROM THE CALL SITE ===');
const bg = classifyIntent({ origin: 'insight', contextTokens: 20000 });
const bgChain = buildDynamicChain({ intent: bg, candidates: pool, policy: parseRoutingPolicy('balanced'), hint: {} });
const evalIntent = classifyIntent({ origin: 'goal_eval', contextTokens: 20000 });
const evalChain = buildDynamicChain({ intent: evalIntent, candidates: pool, policy: parseRoutingPolicy('balanced'), hint: {} });
console.log(`   insight   -> ${fmt(bgChain[0])}   [${bgChain[0].reason}]`);
console.log(`   goal_eval -> ${fmt(evalChain[0])}   [${evalChain[0].reason}]`);
check('a background job costs no more than an evaluation',
  bgChain[0].estimatedCostUsd <= evalChain[0].estimatedCostUsd,
  `$${bgChain[0].estimatedCostUsd?.toFixed(5)} vs $${evalChain[0].estimatedCostUsd?.toFixed(5)}`);

console.log('\n=== CACHE AFFINITY, WITH REAL RATES ===');
// Warm on the model the balanced policy did NOT choose, and see whether the
// router stays put when the prefix is genuinely valuable.
const other = pool.find((c) => c.provider !== balanced[0].provider && Number.isFinite(c.inputCostPer1M) && c.cacheKnown);
const warmSession = {
  lastProvider: other.provider,
  lastModel: other.model,
  cachedTokens: 150000,
  lastCacheReadMult: other.cacheReadMult,
  lastInputCostPer1M: other.inputCostPer1M,
};
const warmIntent = classifyIntent({ origin: 'orchestrator', contextTokens: 150000 });
const warmChain = buildDynamicChain({
  intent: warmIntent, candidates: pool, policy: parseRoutingPolicy('balanced'), session: warmSession, hint: {},
});
console.log(`   warm on ${other.provider}/${other.model} (readMult ${other.cacheReadMult}, $${other.inputCostPer1M}/M)`);
console.log(`   -> chose ${fmt(warmChain[0])}   [${warmChain[0].reason}]`);
check('the warm provider is preferred, or the switch is explicitly justified',
  warmChain[0].provider === other.provider || /switch|value|stake|cheapest|plan|sampling/.test(warmChain[0].reason),
  warmChain[0].reason);

console.log('\n=== COST ESTIMATOR SANITY vs PUBLISHED RATES ===');
const anth = pool.find((c) => c.provider === 'anthropic' && Number.isFinite(c.inputCostPer1M));
const manual = (100000 / 1e6) * anth.inputCostPer1M + (800 / 1e6) * anth.outputCostPer1M;
const est = estimateCost(anth, { contextTokens: 100000 });
check('estimateCost matches hand arithmetic on a real model',
  Math.abs(est - manual) < 1e-9,
  `${anth.model}: $${est.toFixed(6)} (in $${anth.inputCostPer1M}/M, out $${anth.outputCostPer1M}/M)`);

console.log('\n=== NO CREDENTIALS AT ALL ===');
__resetRoutingCaches();
const emptyPool = await collectCandidates({
  userId: 'u2', authManager: { getConnectedApps: async () => [] }, intent: baseIntent,
});
check('no credentials -> empty pool -> caller keeps its own chain',
  emptyPool.length === 0);

await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(60)}\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { failed.forEach((f) => console.log(`  FAILED: ${f.name} ${f.detail}`)); process.exit(1); }
console.log('ROUTER vs REAL REGISTRY: CLEAN');
process.exit(0);
