#!/usr/bin/env node

/**
 * draft-permissions — trust system (W5): the launch migration assessment.
 *
 * Scans every dev plugin and emits a ready-to-paste `permissions` block per
 * plugin (permissions-drafts/<name>.json) plus a summary. This is the
 * concrete artifact that ends the 90-day capability-declaration window:
 * authors paste the block into manifest.json, rebuild, and earn 🟢.
 *
 * Usage: node cli/draft-permissions.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanCapabilities, normalizePermissions, diffCapabilities } from '../lib/validate-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_DIR = path.join(__dirname, '../dev');
const OUT_DIR = path.join(__dirname, '../permissions-drafts');

fs.mkdirSync(OUT_DIR, { recursive: true });

const dirs = fs
  .readdirSync(DEV_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map((d) => d.name);

const summary = [];
for (const name of dirs) {
  const dir = path.join(DEV_DIR, name);
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    summary.push(`⏭️  ${name}: no manifest`);
    continue;
  }
  const scan = await scanCapabilities(dir);
  const detected = Object.keys(scan.capabilities).sort();
  const declared = normalizePermissions(manifest.permissions);
  const diff = diffCapabilities(manifest.permissions, scan.capabilities);

  const draft = {
    _instructions: 'Paste the "permissions" key into manifest.json, review the capability list (remove any false positives), then rebuild with build-plugin.js.',
    _evidence: Object.fromEntries(Object.entries(scan.capabilities).map(([cap, hits]) => [cap, hits.slice(0, 3).map((h) => `${h.file}:${h.line}`)])),
    permissions: { capabilities: detected, domains: [] },
  };
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(draft, null, 2));

  const state = declared.length === 0 && detected.length > 0 ? 'UNDECLARED' : diff.undeclared.length > 0 ? 'PARTIAL' : 'OK';
  summary.push(`${state === 'OK' ? '🟢' : state === 'PARTIAL' ? '🟡' : '🔴'} ${name.padEnd(32)} detected: ${detected.join(', ') || '(none)'}`);
}

fs.writeFileSync(
  path.join(OUT_DIR, '_SUMMARY.md'),
  `# Permissions Migration Assessment — ${new Date().toISOString().slice(0, 10)}\n\n` +
    `Drafted blocks for ${dirs.length} plugins. Authors: paste your block, prune false positives, rebuild.\n\n` +
    summary.join('\n') +
    '\n'
);
console.log(summary.join('\n'));
console.log(`\n✅ Drafts written to ${OUT_DIR} (${dirs.length} plugins + _SUMMARY.md)`);
