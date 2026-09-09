#!/usr/bin/env node
// Explicit discovery plus TAP validation: missing prerequisites may be useful
// local skips, but never a passing research CI gate.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function discoverResearchTests(names) {
  const mandatory = ['theme-rgb-gate.test.js', 'theme-rgb-inventory.test.js', 'theme-rgb-palette.test.js'];
  const missing = mandatory.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Missing mandatory research suites: ${missing.join(', ')}`);
  return names.filter((file) => /^theme-rgb-.*\.test\.js$/.test(file)).sort()
    .map((file) => `tests/unit/research/${file}`);
}

export function assertCompleteRun(result, minimumTests = 1) {
  if (result.error || result.status !== 0) throw new Error('Research test process failed');
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...result.stdout.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous TAP total: ${key}`);
    counts[key] = Number(matches[0][1]);
  }
  if (counts.tests < minimumTests || counts.pass !== counts.tests ||
      counts.fail || counts.cancelled || counts.skipped || counts.todo) {
    throw new Error(`Incomplete research coverage: ${JSON.stringify(counts)}`);
  }
  return counts;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const files = discoverResearchTests(readdirSync(resolve(root, 'tests/unit/research')));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
      cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    const counts = assertCompleteRun(result, files.length);
    console.log(`RGB research gate: ${files.length} files, ${counts.pass} passed, zero skips`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
