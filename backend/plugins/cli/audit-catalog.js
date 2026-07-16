#!/usr/bin/env node

/**
 * audit-catalog — official bundled-plugin release gate.
 *
 * Validates the exact marketplace-default/*.agnt bytes users install and proves
 * they agree with canonical source under dev/ and marketplace.json metadata.
 * Official defaults are green by construction: any structural error, integrity
 * drift, missing structured permissions block, undeclared capability, missing
 * canonical source, source/artifact mismatch, or version mismatch is red.
 *
 * Usage: node cli/audit-catalog.js
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeIntegrity,
  diffCapabilities,
  normalizePermissions,
  scanCapabilities,
  validateManifestAssets,
} from '../lib/validate-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.join(__dirname, '..');
const ARTIFACT_DIR = path.join(PLUGINS_DIR, 'marketplace-default');
const DEV_DIR = path.join(PLUGINS_DIR, 'dev');
const MARKETPLACE = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, 'marketplace.json'), 'utf8'));

function hasStructuredPermissions(manifest) {
  return Boolean(
    manifest?.permissions &&
      !Array.isArray(manifest.permissions) &&
      Array.isArray(manifest.permissions.capabilities) &&
      Array.isArray(manifest.permissions.domains)
  );
}

function sameArray(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

async function inspectDirectory(dir) {
  const validation = await validateManifestAssets(dir);
  const manifest = validation.manifest || {};
  const scan = await scanCapabilities(dir);
  const declared = normalizePermissions(manifest.permissions);
  const detected = Object.keys(scan.capabilities).sort();
  const diff = diffCapabilities(manifest.permissions, scan.capabilities);
  return { validation, manifest, scan, declared, detected, diff };
}

const sourcesByName = new Map();
for (const entry of fs.readdirSync(DEV_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(DEV_DIR, entry.name, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (sourcesByName.has(manifest.name)) {
    throw new Error(`Duplicate canonical source manifest name: ${manifest.name}`);
  }
  sourcesByName.set(manifest.name, path.join(DEV_DIR, entry.name));
}

const recordsByName = new Map(MARKETPLACE.plugins.map((record) => [record.name, record]));
const artifactFiles = fs.readdirSync(ARTIFACT_DIR).filter((file) => file.endsWith('.agnt')).sort();
const artifactNames = new Set(artifactFiles.map((file) => file.slice(0, -'.agnt'.length)));
const tally = { green: 0, red: 0 };
const rows = [];

for (const file of artifactFiles) {
  const artifactName = file.slice(0, -'.agnt'.length);
  const artifact = path.join(ARTIFACT_DIR, file);
  const record = recordsByName.get(artifactName);
  const problems = [];
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-official-audit-'));

  try {
    const tar = await import('tar');
    await tar.extract({ file: artifact, cwd: tmpDir, strip: 1 });
    const shipped = await inspectDirectory(tmpDir);
    const manifestName = shipped.manifest.name;
    const sourceDir = sourcesByName.get(manifestName);

    if (!record) problems.push('marketplace.json record missing');
    if (artifactName !== manifestName) problems.push(`artifact/manifest name mismatch: ${artifactName} != ${manifestName}`);
    if (!shipped.validation.valid) problems.push(...shipped.validation.errors);
    if (!hasStructuredPermissions(shipped.manifest)) problems.push('shipped manifest lacks structured permissions.capabilities/domains arrays');
    if (shipped.scan.scanFailed) problems.push(`shipped capability scan failed: ${shipped.scan.error || 'unknown error'}`);
    if (shipped.diff.undeclared.length) problems.push(`shipped undeclared capabilities: ${shipped.diff.undeclared.join(', ')}`);

    if (!sourceDir) {
      problems.push(`canonical source missing for manifest name: ${manifestName}`);
    } else {
      const source = await inspectDirectory(sourceDir);
      if (!source.validation.valid) problems.push(...source.validation.errors.map((error) => `source: ${error}`));
      if (!hasStructuredPermissions(source.manifest)) problems.push('source manifest lacks structured permissions.capabilities/domains arrays');
      if (source.scan.scanFailed) problems.push(`source capability scan failed: ${source.scan.error || 'unknown error'}`);
      if (source.diff.undeclared.length) problems.push(`source undeclared capabilities: ${source.diff.undeclared.join(', ')}`);
      if (source.manifest.version !== shipped.manifest.version) {
        problems.push(`source/artifact version mismatch: ${source.manifest.version} != ${shipped.manifest.version}`);
      }
      if (!sameArray(source.declared, shipped.declared)) {
        problems.push(`source/artifact permissions mismatch: ${JSON.stringify(source.declared)} != ${JSON.stringify(shipped.declared)}`);
      }
      if (!sameArray(source.detected, shipped.detected)) {
        problems.push(`source/artifact detected capabilities mismatch: ${JSON.stringify(source.detected)} != ${JSON.stringify(shipped.detected)}`);
      }
    }

    const integrity = await computeIntegrity(artifact);
    if (record) {
      if (record.version !== shipped.manifest.version) {
        problems.push(`marketplace/artifact version mismatch: ${record.version} != ${shipped.manifest.version}`);
      }
      if (record.integrity !== integrity) problems.push('marketplace integrity does not match shipped bytes');
      if (record.size !== fs.statSync(artifact).size) problems.push('marketplace size does not match shipped bytes');
      if (record.trustTier !== 'official') problems.push(`official record has trustTier=${record.trustTier}`);
      if (!sameArray(record.declaredPermissions, shipped.declared)) problems.push('marketplace declaredPermissions do not match artifact');
      if (!sameArray(record.detectedCapabilities, shipped.detected)) problems.push('marketplace detectedCapabilities do not match artifact');
    }
  } catch (error) {
    problems.push(`artifact inspection failed: ${error.message}`);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  const status = problems.length ? 'red' : 'green';
  tally[status]++;
  rows.push({ artifactName, status, problems });
}

for (const record of MARKETPLACE.plugins) {
  if (record.downloadUrl?.startsWith('file://') && !artifactNames.has(record.name)) {
    tally.red++;
    rows.push({ artifactName: record.name, status: 'red', problems: ['marketplace record points to missing artifact'] });
  }
}

for (const row of rows) {
  console.log(`${row.status === 'green' ? '🟢' : '🔴'} ${row.artifactName.padEnd(34)} ${row.problems.join(' | ')}`);
}
console.log(`\n📊 Official catalog audit: 🟢${tally.green} 🔴${tally.red}`);
if (tally.red) process.exit(1);
console.log('✅ All official artifacts are structurally valid, fully disclosed, reproducible, and metadata-aligned.');
