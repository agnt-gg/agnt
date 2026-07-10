#!/usr/bin/env node

/**
 * audit-catalog — trust system (W5): local regression canary.
 *
 * Runs every bundled marketplace artifact through the shared validation core
 * and cross-checks marketplace.json's recorded integrity + trust tier.
 * Run after any change to validate-core/build-plugin/PluginInstaller.
 * CI-friendly: exit 1 on any red.
 *
 * Usage: node cli/audit-catalog.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  dryRunInstall,
  computeIntegrity,
} from '../lib/validate-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, '../marketplace-default');
const MARKETPLACE = JSON.parse(fs.readFileSync(path.join(__dirname, '../marketplace.json'), 'utf8'));

const tally = { green: 0, yellow: 0, red: 0 };
const rows = [];

for (const record of MARKETPLACE.plugins) {
  if (!record.downloadUrl?.startsWith('file://')) continue;
  // downloadUrl paths are relative to backend/plugins (one level above cli/)
  const artifact = path.join(__dirname, '..', record.downloadUrl.replace('file://', ''));
  let status = 'green';
  const problems = [];

  if (!fs.existsSync(artifact)) {
    status = 'red';
    problems.push('artifact missing');
  } else {
    const integrity = await computeIntegrity(artifact);
    if (record.integrity && record.integrity !== integrity) {
      status = 'red';
      problems.push(`integrity drift: recorded ${record.integrity.slice(0, 20)}… actual ${integrity.slice(0, 20)}…`);
    }
    const dry = await dryRunInstall(artifact);
    if (!dry.valid) {
      status = 'red';
      problems.push(...dry.errors);
    }
    if (status === 'green' && record.trustTier === 'unverified') status = 'yellow';
  }

  tally[status]++;
  rows.push(`${status === 'green' ? '🟢' : status === 'yellow' ? '🟡' : '🔴'} ${record.name.padEnd(32)} ${problems.join('; ') || ''}`);
}

console.log(rows.join('\n'));
console.log(`\n📊 Catalog audit: 🟢${tally.green} 🟡${tally.yellow} 🔴${tally.red}`);
if (tally.red > 0) {
  console.error('❌ Red items found — fix before shipping.');
  process.exit(1);
}
console.log('✅ No red items.');
