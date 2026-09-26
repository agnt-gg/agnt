import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const categories = ['actions', 'triggers', 'controls', 'utilities', 'widgets', 'custom', 'mcp'];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-registry-discovery-'));
  await fs.mkdir(path.join(root, 'tools'), { recursive: true });
  await fs.mkdir(path.join(root, 'plugins'));
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  // Exercise the exact production loader, not a reimplementation or source rewrite.
  await fs.copyFile(new URL('../../backend/src/tools/ToolRegistry.js', import.meta.url), path.join(root, 'tools/ToolRegistry.js'));
  // Only dependencies are inert: no backend initialization, DB, credentials or plugins.
  await fs.writeFile(path.join(root, 'tools/SchemaValidator.js'), 'export default class { validate() { return { valid: true }; } }');
  await fs.writeFile(path.join(root, 'plugins/PluginManager.js'), 'export default { getAllPluginSchemas() { return []; } };');
  for (const category of categories) {
    await fs.mkdir(path.join(root, 'tools/library', category), { recursive: true });
  }
  const { default: ToolRegistry } = await import(pathToFileURL(path.join(root, 'tools/ToolRegistry.js')).href);
  const registry = new ToolRegistry();
  registry.toolLibraryJson = {};
  return { root, registry };
}

for (const suffix of ['test', 'spec']) {
  test(`Given colocated .${suffix}.js modules When production schema discovery runs Then none executes even before a caught import error`, async () => {
    const { root, registry } = await fixture();
    for (const category of categories) {
      // The write happens BEFORE the throw: catching import errors is not exclusion.
      await fs.writeFile(path.join(root, 'tools/library', category, `side-effect.${suffix}.js`),
        `import fs from 'node:fs'; fs.writeFileSync(new URL('./executed.marker', import.meta.url), 'executed'); throw new Error('synthetic import side effect');`);
      await fs.writeFile(path.join(root, 'tools/library', category, 'ordinary.js'),
        `export default new class { static schema = { type: 'ordinary', category: ${JSON.stringify(category)} }; };`);
    }
    await registry.loadToolSchemas();
    assert.equal(registry.schemas.get('ordinary')?.source, 'file', 'ordinary tool must still import');
    for (const category of categories) {
      await assert.rejects(fs.access(path.join(root, 'tools/library', category, 'executed.marker')), { code: 'ENOENT' }, `${category}: .${suffix}.js must never execute`);
    }
    assert.equal(registry.schemas.has(`side-effect.${suffix}`), false);
  });
}

test('Given ordinary filenames containing test or spec When production schema discovery runs Then their exact schemas and metadata remain available', async () => {
  const { root, registry } = await fixture();
  const names = ['ordinary', 'test', 'contest', 'latest-tool', 'tool.test-helper', 'spec', 'inspect', 'tool.spec-helper'];
  for (const category of categories) {
    for (const name of names) {
      const type = `${category}-${name}`;
      const schema = { type, category, title: `Ordinary ${type}`, inputs: {} };
      await fs.writeFile(path.join(root, 'tools/library', category, `${type}.js`),
        `export default new class { static schema = ${JSON.stringify(schema)}; };`);
    }
  }
  await registry.loadToolSchemas();
  assert.equal(registry.schemas.size, categories.length * names.length);
  for (const category of categories) {
    for (const name of names) {
      const type = `${category}-${name}`;
      assert.deepEqual(registry.schemas.get(type), {
        schema: { type, category, title: `Ordinary ${type}`, inputs: {} },
        source: 'file', toolType: type, category, validated: true,
      });
    }
  }
});
