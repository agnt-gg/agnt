// @vitest-environment node
import { describe, it, expect } from 'vitest';
import config from '../vite.config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('voice release build portability and isolation', () => {
  it('uses function chunks compatible with Rollup and Rolldown without eager highlight grammars', () => {
    const chunks = config.build.rollupOptions.output.manualChunks;
    expect(typeof chunks).toBe('function');
    for (const [pkg, name] of [['vue','vue'],['vue-router','vue'],['@vue/runtime-core','vue'],['d3-array','charts'],['@codemirror/lang-python','editor'],['three','3d'],['axios','axios'],['showdown','markdown']]) {
      expect(chunks(`/checkout/node_modules/${pkg}/dist/index.js`)).toBe(`vendor-${name}`);
      expect(chunks(`C:\\checkout\\node_modules\\${pkg.replaceAll('/','\\')}\\index.js`)).toBe(`vendor-${name}`);
    }
    expect(chunks('/checkout/node_modules/highlight.js/lib/index.js')).toBeUndefined();
    expect(chunks('/checkout/src/vue/index.js')).toBeUndefined();
    expect(chunks('/checkout/node_modules/vue-imposter/index.js')).toBeUndefined();
  });
  it('copies icons only into the resolved isolated output, independent of cwd', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-build-'));
    const outDir = path.join(root, 'isolated-output');
    fs.mkdirSync(path.join(root, 'src/assets/icons'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/assets/icons/voice.txt'), 'fixture');
    const plugin = config.plugins.find(p => p.name === 'copy-directory');
    expect(plugin.configResolved).toBeTypeOf('function');
    plugin.configResolved({ root, build: { outDir } });
    await plugin.writeBundle();
    expect(fs.readFileSync(path.join(outDir, 'assets/icons/voice.txt'), 'utf8')).toBe('fixture');
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
  });
});
