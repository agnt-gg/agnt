import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompleteRun, discoverResearchTests } from '../../../scripts/research/run-theme-rgb-tests.mjs';

const result = (overrides = {}) => ({ status: 0, stdout: Object.entries({
  tests: 9, pass: 9, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...overrides,
}).map(([key, value]) => `# ${key} ${value}`).join('\n') + '\n' });

test('research discovery rejects missing mandatory suites and includes future matching suites', () => {
  const names = ['theme-rgb-gate.test.js', 'theme-rgb-inventory.test.js', 'theme-rgb-palette.test.js'];
  assert.throws(() => discoverResearchTests([]), /Missing mandatory/);
  for (const missing of names) {
    assert.throws(() => discoverResearchTests(names.filter((name) => name !== missing)), /Missing mandatory/);
  }
  assert.equal(discoverResearchTests([...names, 'theme-rgb-next.test.js', 'unrelated.test.js']).length, 4);
});

test('research gate accepts a complete passing TAP summary', () => {
  assert.equal(assertCompleteRun(result()).pass, 9);
});
test('research gate rejects empty or undiscovered tests', () => {
  assert.throws(() => assertCompleteRun(result({ tests: 0, pass: 0 })), /Incomplete/);
  assert.throws(() => assertCompleteRun({ status: 0, stdout: '' }), /Missing/);
});
test('research gate rejects skipped prerequisites or baseline checks', () => {
  assert.throws(() => assertCompleteRun(result({ skipped: 1, pass: 8 })), /Incomplete/);
});
test('research gate rejects failures, cancellations and todos even at exit zero', () => {
  for (const key of ['fail', 'cancelled', 'todo']) {
    assert.throws(() => assertCompleteRun(result({ [key]: 1, pass: 8 })), /Incomplete/);
  }
});
test('research gate rejects process failure and incomplete or duplicate totals', () => {
  assert.throws(() => assertCompleteRun({ ...result(), status: 1 }), /process failed/);
  assert.throws(() => assertCompleteRun({ ...result(), error: new Error('timeout') }), /process failed/);
  assert.throws(() => assertCompleteRun({ ...result(), stdout: result().stdout.replace('# skipped 0\n', '') }), /Missing/);
  assert.throws(() => assertCompleteRun({ ...result(), stdout: result().stdout + '# tests 9\n' }), /ambiguous/);
  assert.throws(() => assertCompleteRun(result(), 10), /Incomplete/);
});
