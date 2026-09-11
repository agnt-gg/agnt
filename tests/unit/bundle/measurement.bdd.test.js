import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

// Import within each scenario so RED names every missing behavior, not one loader crash.
const api = () => import('../../../scripts/bundle/measurement.mjs');
const scenario = (given, when, then, run) => test(`Given ${given}; When ${when}; Then ${then}`, run);
const node = (file, imports = [], dynamicImports = [], extra = {}) => ({ file, imports, dynamicImports, ...extra });
const graph = () => ({
  app: node('app.js', ['a', 'b'], ['lazy', 'lazy'], { isEntry: true, css: ['app.css'], assets: ['image.png'] }),
  a: node('a.js', ['shared']), b: node('b.js', ['shared']), shared: node('shared.js', ['a']),
  lazy: node('lazy.js', ['shared', 'helper'], ['nested'], { css: ['lazy.css'] }),
  helper: node('helper.js'), nested: node('nested.js'),
  other: node('other.js', ['shared'], [], { isEntry: true }),
});
const initial = ['a.js', 'app.css', 'app.js', 'b.js', 'image.png', 'shared.js'];
scenario('a diamond with a static cycle', 'classifying app', 'static closure terminates and deduplicates', async () => {
  assert.deepEqual((await api()).classify(graph(), 'app').initial, initial);
});
scenario('duplicate dynamic edges and nested imports', 'classifying app', 'lazy closure excludes nested boundary and initial files', async () => {
  const r = (await api()).classify(graph(), 'app');
  assert.deepEqual(r.lazy.lazy, ['helper.js', 'lazy.css', 'lazy.js']);
  assert.deepEqual(r.lazy.nested, ['nested.js']);
});
scenario('two entries', 'classifying the other entry', 'app-only dependencies are not charged', async () => {
  assert.deepEqual((await api()).classify(graph(), 'other').initial, ['a.js', 'other.js', 'shared.js']);
});
scenario('a target both statically and dynamically imported', 'classifying app', 'its incremental lazy bytes are empty', async () => {
  const g = graph(); g.app.dynamicImports.push('shared');
  assert.deepEqual((await api()).classify(g, 'app').lazy.shared, []);
});
scenario('a lazy chunk imports the entry', 'classifying app', 'back edges do not make lazy code initial', async () => {
  const g = graph(); g.lazy.imports.push('app');
  assert.deepEqual((await api()).classify(g, 'app').initial, initial);
});
scenario('a shared helper in two lazy boundaries', 'classifying app', 'overlap is reported without making groups additive', async () => {
  const g = graph(); g.app.dynamicImports.push('second'); g.second = node('second.js', ['helper']);
  assert.deepEqual((await api()).classify(g, 'app').sharedLazy, ['helper.js']);
});
scenario('a missing static import', 'classifying', 'incomplete graphs fail closed', async () => {
  const m = await api(); const g = graph(); g.a.imports.push('missing');
  assert.throws(() => m.classify(g, 'app'), /missing.*import/i);
});
scenario('a missing dynamic import', 'classifying', 'incomplete boundaries fail closed', async () => {
  const m = await api(); const g = graph(); g.app.dynamicImports.push('missing');
  assert.throws(() => m.classify(g, 'app'), /missing.*import/i);
});
scenario('an unknown entry', 'classifying', 'no empty success report is returned', async () => {
  const m = await api(); assert.throws(() => m.classify(graph(), 'absent'), /entry/i);
});
scenario('two manifest keys alias one emitted URL', 'classifying', 'the URL is counted once', async () => {
  const g = graph(); g.alias = node('shared.js', ['a']); g.app.imports.push('alias');
  assert.deepEqual((await api()).classify(g, 'app').initial, initial);
});
scenario('repeated file references and UTF8 content', 'accounting', 'raw uses bytes and gzip is per unique file', async () => {
  const files = { 'x.js': Buffer.from('é'.repeat(100)), 'y.js': Buffer.from('x'.repeat(100)) };
  const r = (await api()).account(['x.js', 'y.js', 'x.js'], files);
  assert.equal(r.rawBytes, 300);
  assert.equal(r.gzipBytes, Object.values(files).reduce((n, b) => n + gzipSync(b, { level: 9 }).length, 0));
  assert.equal(r.fileCount, 2);
});
scenario('identical content at distinct URLs', 'accounting', 'both resources are charged', async () => {
  assert.equal((await api()).account(['x', 'y'], { x: Buffer.from('same'), y: Buffer.from('same') }).rawBytes, 8);
});
scenario('stale assets in the supplied disk inventory', 'accounting only current references', 'retained bytes are excluded', async () => {
  assert.equal((await api()).account(['x'], { x: Buffer.from('new'), stale: Buffer.alloc(999) }).rawBytes, 3);
});
scenario('a referenced file absent on disk', 'accounting', 'missing bytes fail closed', async () => {
  const m = await api(); assert.throws(() => m.account(['missing'], {}), /missing.*file/i);
});
scenario('an unsafe relative path', 'accounting', 'path escape is rejected', async () => {
  const m = await api(); assert.throws(() => m.account(['../secret'], { '../secret': Buffer.from('x') }), /path/i);
});
scenario('two sequential feature uses with shared code', 'subtracting already loaded URLs', 'second use charges only new files', async () => {
  assert.deepEqual((await api()).incremental(['helper.js', 'second.js'], ['app.js', 'helper.js']), ['second.js']);
});
const metadata = () => ({ schemaVersion: 1, graphSemantics: 'entry-static-v1', assetPolicy: 'explicit-associated-v1', gzip: 'per-file-level9', node: process.version, zlib: process.versions.zlib, vite: '5.4.21', mode: 'production', configHash: 'config', lockHash: 'lock', scenario: 'app-initial', browserCache: 'not-applicable', buildCache: 'fresh-process' });
const report = (value = 1000) => ({ metadata: metadata(), sourceRevision: 'base', metrics: { rawBytes: value, gzipBytes: value } });
const budget = { rawBytes: { absolute: 10, relative: 0.05 }, gzipBytes: { absolute: 10, relative: 0.05 } };
for (const [value, pass] of [[999, true], [1060, true], [1061, false]]) {
  scenario(`baseline 1000 and allowance 10 plus 5 percent`, `measuring ${value}`, `budget pass is ${pass}`, async () => {
    assert.equal((await api()).enforce(report(value), report(), budget).pass, pass);
  });
}
scenario('zero baseline', 'testing absolute allowance and one byte over', 'no division by zero or implicit unlimited budget', async () => {
  const m = await api(); assert.equal(m.enforce(report(10), report(0), budget).pass, true);
  assert.equal(m.enforce(report(11), report(0), budget).pass, false);
});
scenario('no baseline', 'enforcing', 'baseline creation is never automatic', async () => {
  const m = await api(); assert.throws(() => m.enforce(report(), null, budget), /baseline/i);
});
for (const key of Object.keys(metadata())) {
  scenario(`incompatible ${key}`, 'comparing reports', 'metadata mismatch fails closed', async () => {
    const m = await api(); const candidate = report(); candidate.metadata[key] = 'different';
    assert.throws(() => m.enforce(candidate, report(), budget), /metadata|incompatible/i);
  });
}
scenario('a different candidate revision', 'comparing compatible reports', 'revision provenance does not prohibit regression comparison', async () => {
  const r = report(); r.sourceRevision = 'candidate'; assert.equal((await api()).enforce(r, report(), budget).pass, true);
});
scenario('missing required metadata', 'enforcing', 'unknown comparability is not a pass', async () => {
  const m = await api(); const r = report(); delete r.metadata.lockHash;
  assert.throws(() => m.enforce(r, report(), budget), /metadata|incompatible/i);
});
scenario('a missing budgeted metric', 'enforcing', 'undefined values cannot bypass budgets', async () => {
  const m = await api(); const r = report(); delete r.metrics.gzipBytes;
  assert.throws(() => m.enforce(r, report(), budget), /metric/i);
});
scenario('NaN measurements and negative allowance', 'enforcing', 'invalid numeric inputs are rejected', async () => {
  const m = await api(); assert.throws(() => m.enforce(report(NaN), report(), budget), /metric|finite/i);
  assert.throws(() => m.enforce(report(), report(), { rawBytes: { absolute: -1, relative: 0 } }), /budget|allowance/i);
});
