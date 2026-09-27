import test from 'node:test';
import assert from 'node:assert/strict';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('console.log reaches stderr, not the worker stdout pipe', () => {
  let stderr = '';
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    stderr += chunk;
    return orig(chunk, ...args);
  };
  console.log('📁 AGNT root: /tmp/agnt-example');
  assert.match(stderr, /AGNT root:/);
});

test('ordinary assertion before console banner', async () => {
  await tick();
});

test('console.log writes the AGNT banner between runner frames', async () => {
  for (let i = 0; i < 40; i++) {
    console.log(`📁 AGNT root: /tmp/agnt-example ${i}`);
    await tick();
  }
});

test('ordinary assertion after console banner', async () => {
  await tick();
});
