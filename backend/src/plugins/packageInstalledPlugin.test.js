import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';
import { isExcludedEntry, listPackageEntries, packageInstalledPlugin } from './packageInstalledPlugin.js';

/** Entry names inside a .agnt archive (tar 6 calls back `onentry`). */
async function archiveEntries(file) {
  const names = [];
  await tar.list({ file, onentry: (entry) => names.push(entry.path.replace(/\/$/, '')) });
  // An empty list would make every "does not contain" assertion pass vacuously.
  expect(names.length).toBeGreaterThan(0);
  return names.sort();
}

describe('packageInstalledPlugin', () => {
  let root;
  let pluginPath;
  let outFile;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-pkg-'));
    pluginPath = path.join(root, 'demo');
    const write = (rel, content = 'x') => {
      fs.mkdirSync(path.dirname(path.join(pluginPath, rel)), { recursive: true });
      fs.writeFileSync(path.join(pluginPath, rel), content);
    };
    write('manifest.json', '{"name":"demo"}');
    write('package.json', '{}');
    write('package-lock.json', '{}');
    write('.env', 'SECRET=1');
    write('tools/send.js', 'export default {}');
    write('lib/relay.js', 'export const x = 1');
    write('lib/.cache/junk', 'junk');
    write('figma-plugin/manifest.json', '{}');
    write('node_modules/ws/package.json', '{}');
    outFile = path.join(root, 'builds', 'demo.agnt');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('packs subfolders, not just top-level files (tools in tools/ used to be dropped)', async () => {
    await packageInstalledPlugin(pluginPath, 'demo', outFile);
    const entries = await archiveEntries(outFile);
    for (const expected of ['demo/tools/send.js', 'demo/lib/relay.js', 'demo/figma-plugin/manifest.json', 'demo/node_modules/ws/package.json', 'demo/manifest.json']) {
      expect(entries).toContain(expected);
    }
  });

  it('never packs dotfiles (any depth) or the lockfile', async () => {
    await packageInstalledPlugin(pluginPath, 'demo', outFile);
    const entries = await archiveEntries(outFile);
    expect(entries.some((e) => e.includes('.env') || e.includes('.cache') || e.endsWith('package-lock.json'))).toBe(false);
  });

  it('rebuilds every time instead of serving a stale archive', async () => {
    await packageInstalledPlugin(pluginPath, 'demo', outFile);
    fs.writeFileSync(path.join(pluginPath, 'tools', 'added-later.js'), 'export default {}');
    await packageInstalledPlugin(pluginPath, 'demo', outFile);
    expect(await archiveEntries(outFile)).toContain('demo/tools/added-later.js');
  });

  it('lists entries deterministically and excludes by name', async () => {
    expect(await listPackageEntries(pluginPath)).toEqual(['figma-plugin', 'lib', 'manifest.json', 'node_modules', 'package.json', 'tools']);
    expect(isExcludedEntry('.git')).toBe(true);
    expect(isExcludedEntry('package-lock.json')).toBe(true);
    expect(isExcludedEntry('tools')).toBe(false);
  });
});
