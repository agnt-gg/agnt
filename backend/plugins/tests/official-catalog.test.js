#!/usr/bin/env node

/**
 * Official bundled-plugin regression gate.
 *
 * Proves the release audit passes and the build gate rejects an official source
 * that omits the required structured capability disclosure.
 */

import assert from 'assert/strict';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginsDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginsDir, '..', '..');

function runNode(script, args = []) {
  return execFileSync(process.execPath, [path.join(pluginsDir, script), ...args], {
    cwd: pluginsDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

test('official catalog is fully disclosed and source/artifact/metadata aligned', () => {
  const output = runNode('cli/audit-catalog.js');
  assert.match(output, /Official catalog audit: .*39 .*0/);
  assert.match(output, /All official artifacts are structurally valid, fully disclosed, reproducible, and metadata-aligned/);
});

test('official build fails closed when structured permissions are absent', () => {
  const manifestPath = path.join(pluginsDir, 'dev', 'dice-roller-plugin', 'manifest.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(original);
  delete manifest.permissions;

  try {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = spawnSync(process.execPath, [path.join(pluginsDir, 'cli/build-plugin.js'), 'dice-roller-plugin'], {
      cwd: pluginsDir,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Official plugin disclosure gate/);
  } finally {
    fs.writeFileSync(manifestPath, original);
  }

  const restored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(restored.permissions);
  assert.deepEqual(restored.permissions.capabilities, []);
  assert.deepEqual(restored.permissions.domains, []);
});

test('integrity stamper verifies all 39 shipped artifacts', () => {
  const output = runNode('cli/stamp-integrity.js', ['--check']);
  assert.match(output, /39 unchanged\/ok/);
  assert.match(output, /0 mismatched/);
});
