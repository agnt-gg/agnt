#!/usr/bin/env node

/**
 * agnt plugin doctor — trust system (W5): check a plugin WITHOUT building.
 *
 * Thin wrapper over validate-core (the one-core rule — zero rules live here).
 *
 * Usage:
 *   node cli/doctor.js <plugin-dir | file.agnt>
 */

import fs from 'fs';
import path from 'path';
import {
  validateManifestAssets,
  dryRunInstall,
  verifyArchive,
  computeIntegrity,
  scanCapabilities,
  normalizePermissions,
  diffCapabilities,
} from '../lib/validate-core.js';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node cli/doctor.js <plugin-dir | file.agnt>');
  process.exit(1);
}
const abs = path.resolve(target);
if (!fs.existsSync(abs)) {
  console.error(`❌ Not found: ${abs}`);
  process.exit(1);
}

let failed = false;
const section = (t) => console.log(`\n🩺 ${t}`);

if (fs.statSync(abs).isDirectory()) {
  section(`Validating directory: ${abs}`);
  const report = await validateManifestAssets(abs);
  report.warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
  report.errors.forEach((e) => console.log(`  ❌ ${e}`));
  if (report.valid) console.log('  ✅ manifest + entryPoints + ecosystem assets OK');
  failed = failed || !report.valid;

  section('Capability scan (first-party source)');
  const scan = await scanCapabilities(abs);
  const declared = normalizePermissions(report.manifest?.permissions);
  const diff = diffCapabilities(report.manifest?.permissions, scan.capabilities);
  console.log(`  detected: ${Object.keys(scan.capabilities).join(', ') || '(none)'}`);
  console.log(`  declared: ${declared.join(', ') || '(none)'}`);
  if (diff.undeclared.length) {
    console.log(`  ⚠️  undeclared: ${diff.undeclared.join(', ')} (warn-only during the migration window)`);
    for (const cap of diff.undeclared) {
      const hit = scan.capabilities[cap][0];
      console.log(`       e.g. ${hit.file}:${hit.line}`);
    }
  } else {
    console.log('  ✅ all detected capabilities are declared');
  }
} else {
  section(`Verifying archive: ${abs}`);
  const arch = await verifyArchive(abs);
  if (!arch.valid) {
    console.log(`  ❌ ${arch.error}`);
    failed = true;
  } else {
    console.log(`  ✅ readable, ${arch.entries.length} entries, manifest present`);
  }

  section('Dry-run install');
  const dry = await dryRunInstall(abs);
  dry.warnings?.forEach((w) => console.log(`  ⚠️  ${w}`));
  dry.errors?.forEach((e) => console.log(`  ❌ ${e}`));
  if (dry.valid) console.log('  ✅ would install cleanly');
  failed = failed || !dry.valid;

  section('Integrity');
  console.log(`  🔐 ${await computeIntegrity(abs)}`);
}

console.log(failed ? '\n❌ Doctor found problems.' : '\n✅ Doctor: all clear.');
process.exit(failed ? 1 : 0);
