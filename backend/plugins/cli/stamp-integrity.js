#!/usr/bin/env node

/**
 * AGNT Marketplace Integrity Stamper — trust system Layer 2
 *
 * Hashes every .agnt artifact in ./marketplace-default and stamps the SRI
 * integrity string (sha256-<base64>) into the matching record in
 * ./marketplace.json. The hash is computed from THE ACTUAL SHIPPED ARTIFACT
 * (marketplace-default/*.agnt) — the exact bytes installFromMarketplace
 * downloads via its file:// path — never from plugin-builds/ output, which
 * may be newer than what ships.
 *
 * Run this AFTER copying rebuilt artifacts into marketplace-default/,
 * otherwise the stamped hash will not match the shipped bytes and installs
 * will (correctly) abort.
 *
 * Usage:
 *   node cli/stamp-integrity.js            # stamp all records
 *   node cli/stamp-integrity.js --check    # verify only, exit 1 on any mismatch
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeIntegrity,
  scanCapabilities,
  normalizePermissions,
  diffCapabilities,
  computeTrustTier,
} from '../lib/validate-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_JSON = path.join(__dirname, '../marketplace.json');
const ARTIFACT_DIR = path.join(__dirname, '../marketplace-default');

async function main() {
  const checkOnly = process.argv.includes('--check');
  const marketplace = JSON.parse(fs.readFileSync(MARKETPLACE_JSON, 'utf-8'));
  const plugins = marketplace.plugins || [];

  let stamped = 0;
  let unchanged = 0;
  let missingArtifact = 0;
  let mismatched = 0;

  for (const record of plugins) {
    // Only local file:// records can be stamped from disk. Remote records
    // inherit hashes from the marketplace API in 0.7.0 (trust system M-A1 scope).
    if (!record.downloadUrl || !record.downloadUrl.startsWith('file://')) {
      console.log(`⏭️  ${record.name}: non-local downloadUrl, skipped`);
      continue;
    }
    const rel = record.downloadUrl.replace('file://', '');
    // downloadUrl paths are relative to backend/plugins (one level above cli/)
    const artifactPath = path.join(__dirname, '..', rel);
    if (!fs.existsSync(artifactPath)) {
      console.error(`❌ ${record.name}: artifact not found: ${rel}`);
      missingArtifact++;
      continue;
    }
    const integrity = await computeIntegrity(artifactPath);
    const size = fs.statSync(artifactPath).size;

    // trust system: pre-compute trust metadata so marketplace cards can show the
    // badge BEFORE install (extract to temp → scan first-party source → tier).
    let trust = null;
    try {
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-stamp-'));
      try {
        const tar = await import('tar');
        await tar.extract({ file: artifactPath, cwd: tmpDir, strip: 1 });
        let manifest = {};
        try {
          manifest = JSON.parse(await fsp.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'));
        } catch (error) {
          throw new Error(`manifest.json could not be parsed: ${error.message}`);
        }
        const scan = await scanCapabilities(tmpDir);
        const declared = normalizePermissions(manifest.permissions);
        const diff = diffCapabilities(manifest.permissions, scan.capabilities);
        const hasStructuredPermissions =
          manifest.permissions &&
          !Array.isArray(manifest.permissions) &&
          Array.isArray(manifest.permissions.capabilities) &&
          Array.isArray(manifest.permissions.domains);
        if (!hasStructuredPermissions) {
          throw new Error('official artifact lacks structured permissions.capabilities/domains arrays');
        }
        if (scan.scanFailed) throw new Error(`official artifact capability scan failed: ${scan.error || 'unknown error'}`);
        if (diff.undeclared.length) {
          throw new Error(`official artifact has undeclared capabilities: ${diff.undeclared.join(', ')}`);
        }
        const computedTier = computeTrustTier({
          integrityState: 'verified',
          permissionsDeclared: declared.length > 0,
          undeclaredCount: diff.undeclared.length,
          scanFailed: scan.scanFailed,
        });
        trust = {
          version: manifest.version,
          // The bundled marketplace-default catalog is AGNT FIRST-PARTY —
          // these are 'official'. The community/unverified ladder applies to
          // third-party publishes (server-side, keyed on publisher identity).
          // Official artifacts have already passed the fail-closed scan above.
          trustTier: computedTier === 'unverified' ? computedTier : 'official',
          declaredPermissions: declared,
          detectedCapabilities: Object.keys(scan.capabilities),
        };
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch (err) {
      console.error(`❌ ${record.name}: trust scan failed (${err.message})`);
      mismatched++;
      continue;
    }

    if (checkOnly) {
      if (record.integrity !== integrity) {
        console.error(`❌ ${record.name}: integrity MISMATCH\n     recorded: ${record.integrity || '(none)'}\n     actual:   ${integrity}`);
        mismatched++;
      } else {
        unchanged++;
      }
      continue;
    }

    const trustChanged =
      trust &&
      (record.version !== trust.version ||
        record.trustTier !== trust.trustTier ||
        JSON.stringify(record.declaredPermissions || []) !== JSON.stringify(trust.declaredPermissions) ||
        JSON.stringify(record.detectedCapabilities || []) !== JSON.stringify(trust.detectedCapabilities));
    if (record.integrity === integrity && record.size === size && !trustChanged) {
      unchanged++;
      continue;
    }
    record.integrity = integrity;
    record.size = size;    if (trust) {
      record.version = trust.version;
      record.trustTier = trust.trustTier;
      record.declaredPermissions = trust.declaredPermissions;
      record.detectedCapabilities = trust.detectedCapabilities;
    }
    stamped++;
    console.log(`✅ ${record.name}: ${integrity} · ${trust ? trust.trustTier : 'no-scan'}`);
  }

  if (!checkOnly && stamped > 0) {
    fs.writeFileSync(MARKETPLACE_JSON, JSON.stringify(marketplace, null, 2) + '\n');
  }

  console.log(
    `\n📊 ${checkOnly ? 'Check' : 'Stamp'} complete: ${stamped} stamped, ${unchanged} unchanged/ok, ${missingArtifact} missing artifacts, ${mismatched} mismatched`
  );
  if (missingArtifact > 0 || mismatched > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ stamp-integrity failed:', err);
  process.exit(1);
});
