import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

// The node:test CI job installs root dependencies only. Skip explicitly there,
// but let malformed modules and parser failures fail once dependencies resolve.
const requireFrontend = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const missing = [];
for (const name of ['@vue/compiler-sfc', '@vue/compiler-dom', '@babel/parser']) {
  try { requireFrontend.resolve(name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    missing.push(name);
  }
}
if (missing.length) {
  test('RGB research inventory requires frontend dependencies', {
    skip: `Install frontend dependencies to run this research suite; missing: ${missing.join(', ')}`,
  }, () => {});
} else {
const { countParts, inScope, inventory, parseArgs, sourceParts, stripCssComments, stripJsComments } =
  await import('../../../scripts/research/theme-rgb-inventory.mjs');

const count = (source, extension) => countParts(sourceParts(source, `frontend/src/fixture.${extension}`));
const one = (references = 0, directRgba = 0, declarations = 0) => ({ references, directRgba, declarations });
const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/research/theme-rgb-inventory.mjs', import.meta.url));

test('CSS comments are removed without erasing quoted comment-like strings', () => {
  assert.deepEqual(count(`/* --hidden-rgb: 0; color: var(--hidden-rgb) */
    a { --color-background-rgb: 1,2,3; color: rgba(/* gap */var(--color-background-rgb), .2);
      content: "/* var(--quoted-rgb) */"; }`, 'css'), {
    '--color-background-rgb': one(1, 1, 1), '--quoted-rgb': one(1),
  });
  assert.equal(stripCssComments('va/* gap */r(--x-rgb)').includes('var('), false);
  assert.throws(() => stripCssComments('/* unfinished'), /Unterminated CSS comment/);
  assert.throws(() => stripCssComments('"unfinished'), /Unterminated CSS string/);
});

test('Babel strips actual JS comments, not URLs, strings, regexes, or template text', () => {
  const source = `// var(--line-rgb)
    /* var(--block-rgb) */
    const url = "https://example.test/var(--url-rgb)";
    const css = 'rgba(var(--green-rgb), .2)';
    const quoted = '/* var(--quoted-rgb) */';
    const regex = /https?:\\/\\//;
    const template = \`var(--template-rgb) \${/* var(--hidden-rgb) */ 1}\`;
  `;
  assert.deepEqual(count(source, 'js'), {
    '--url-rgb': one(1), '--green-rgb': one(1, 1), '--quoted-rgb': one(1), '--template-rgb': one(1),
  });
  assert.equal(stripJsComments(source).length, source.length);
  assert.deepEqual(count(`const color: string = 'var(--typed-rgb)'; // var(--hidden-rgb)`, 'ts'), {
    '--typed-rgb': one(1),
  });
  assert.deepEqual(count("const color = <string>'var(--asserted-rgb)';", 'ts'), { '--asserted-rgb': one(1) });
  assert.throws(() => count('const color = ;', 'js'));
});

test('Vue template, both script forms, and multiple styles count once; custom blocks do not', () => {
  assert.deepEqual(count(`<!-- var(--outside-rgb) -->
    <template><div style="color: rgba(var(--template-rgb), .1)">
      <!-- var(--hidden-rgb) --><span>{{ 'var(--expression-rgb)' }}</span>
    </div></template>
    <script>export default { data() { return { color: 'var(--script-rgb)' }; } } // var(--hidden-rgb)
    </script>
    <script setup lang="ts">const color: string = 'var(--setup-rgb)'; /* var(--hidden-rgb) */</script>
    <style scoped>/* var(--hidden-rgb) */ a { --style-rgb: 1,2,3; color: var(--style-rgb) }</style>
    <style>a { color: var(--second-rgb) }</style>
    <docs>var(--custom-rgb)</docs>`, 'vue'), {
    '--template-rgb': one(1, 1), '--expression-rgb': one(1), '--script-rgb': one(1),
    '--setup-rgb': one(1), '--style-rgb': one(1, 0, 1), '--second-rgb': one(1),
  });
  assert.throws(() => count('<template><div></template>', 'vue'));
  assert.throws(() => count('<script>const x = ;</script>', 'vue'));
});

test('Vue expressions distinguish JavaScript comments from literal string content', () => {
  assert.deepEqual(count(`<template><div :style="/* var(--hidden-rgb) */ {color: 'var(--binding-rgb)'}">
    {{ /* var(--hidden-rgb) */ 'var(--expression-rgb)' }}
    {{ 'https://example.test/var(--url-rgb)' }}
  </div></template>`, 'vue'), {
    '--binding-rgb': one(1), '--expression-rgb': one(1), '--url-rgb': one(1),
  });
});

test('suffix tokens, aliases and nested fallback references are independent source occurrences', () => {
  assert.deepEqual(count(`:root { --alias-rgb: var(--base-rgb, var(--fallback-rgb)); }
    a { color: rgba(var(--alias-rgb, var(--fallback-rgb)), .2);
      background: rgb(var(--base-rgb)); border: var(--not-rgb-extra); }
    b { color: var(--with_underscore-rgb); }`, 'css'), {
    '--alias-rgb': one(1, 1, 1), '--base-rgb': one(2), '--fallback-rgb': one(2),
    '--with_underscore-rgb': one(1),
  });
  assert.deepEqual(countParts(['rgba(', 'var(--separate-rgb)']), { '--separate-rgb': one(1) });
});

test('standalone HTML handles comments, inline values, style and raw-text script', () => {
  assert.deepEqual(count(`<!doctype html><html><head>
    <style>/* var(--hidden-rgb) */ :root { --html-rgb: 1,2,3; }</style>
    <script>const less = '<'; const color = 'rgba(var(--script-rgb), .5)'; // var(--hidden-rgb)
    </script></head><body style="color:var(--html-rgb)">
    <!-- var(--hidden-rgb) --><p>var(--text-rgb)</p></body></html>`, 'html'), {
    '--html-rgb': one(1, 0, 1), '--script-rgb': one(1, 1), '--text-rgb': one(1),
  });
  assert.throws(() => count('<script>const broken = ;</script>', 'html'));
});

test('scope is anchored and excludes tests, caches, plugins and unsupported extensions', () => {
  for (const ext of ['vue', 'css', 'js', 'ts', 'html']) assert.ok(inScope(`frontend/src/a.${ext}`));
  for (const path of ['frontend/src/a.spec.js', 'frontend/src/a.test.vue', 'frontend/dist/a.css',
    'backend/src/a.js', 'frontend/src/a.json', 'frontend/src/plugins/a.vue',
    'frontend/src/.cache/a.css', 'frontend/src/node_modules/a.js', 'frontend/src/cache/a.ts']) {
    assert.equal(inScope(path), false, path);
  }
});

test('argument and ref failures are nonzero JSON errors, never partial inventory', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--ref', 'HEAD']), 'HEAD');
  for (const args of [['--ref'], ['--unknown'], ['--ref', '--all'], ['HEAD'], ['--ref', 'HEAD', 'extra']]) {
    assert.throws(() => parseArgs(args));
  }
  for (const args of [['--unknown'], ['--ref', 'refs/does-not-exist/theme-rgb-inventory-test']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(typeof JSON.parse(result.stderr).error, 'string');
    assert.ok(!result.stderr.includes(root));
  }
});

test('known committed baseline reproduces counts and per-token sums deterministically', (t) => {
  const ref = '535e136c2217a1e694c71634389baca71daf1a49';
  try { execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' }); }
  catch { t.skip('baseline commit unavailable in this clone'); return; }
  const result = inventory(ref);
  assert.deepEqual(result.git, { mode: 'snapshot', commit: ref });
  assert.deepEqual(result.totals, {
    references: { occurrences: 1657, files: 184 }, directRgba: { occurrences: 1641, files: 181 },
    declarations: { occurrences: 73, files: 10 },
  });
  for (const [kind, total] of Object.entries(result.totals)) {
    assert.equal(Object.values(result.tokens).reduce((sum, token) => sum + token[kind].occurrences, 0), total.occurrences);
  }
  assert.deepEqual(inventory(ref), result);
  assert.ok(!JSON.stringify(result).includes(root));
});
}
