#!/usr/bin/env node

/**
 * sync-validate-core — trust system W0: re-vendor the canonical validation core
 * into the api.agnt.gg server repo.
 *
 * The one-core rule (trust system) crosses a repo boundary: the server's
 * publish gate must run the EXACT same rules as the client build/install
 * path. This script copies the canonical file and stamps a SYNC-HASH header.
 * It REFUSES to overwrite a server copy whose content doesn't match its own
 * recorded hash (i.e. someone edited the vendored file directly) unless
 * --force is passed.
 *
 * Usage:
 *   node cli/sync-validate-core.js [--check] [--force] [serverRepoPath]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL = path.join(__dirname, '../lib/validate-core.js');
const DEFAULT_SERVER_REPO = path.resolve(__dirname, '../../../../agnt-server/api.agnt.gg');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const force = args.includes('--force');
const repoArg = args.find((a) => !a.startsWith('--'));
const serverRepo = repoArg ? path.resolve(repoArg) : DEFAULT_SERVER_REPO;
const TARGET = path.join(serverRepo, 'src', 'libs', 'plugin-validate-core.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const canonical = fs.readFileSync(CANONICAL, 'utf8');
const canonicalHash = sha(canonical);

const header = `/**
 * VENDORED FILE — DO NOT EDIT HERE.
 * Canonical source: agnt-pro/backend/plugins/lib/validate-core.js
 * Re-vendor with:   node agnt-pro/backend/plugins/cli/sync-validate-core.js
 * SYNC-HASH: ${canonicalHash}
 * (hash of the canonical file content at vendor time — the sync script
 *  refuses to overwrite if this file was edited independently)
 */
`;

function parseVendored(content) {
  const m = /SYNC-HASH: ([a-f0-9]{64})/.exec(content);
  if (!m) return null;
  const headerEnd = content.indexOf('*/\n') + 3;
  return { recordedHash: m[1], body: content.slice(headerEnd) };
}

if (!fs.existsSync(TARGET)) {
  if (checkOnly) {
    console.error(`❌ Vendored copy missing: ${TARGET}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, header + canonical);
  console.log(`✅ Vendored fresh copy → ${TARGET}`);
  process.exit(0);
}

const existing = fs.readFileSync(TARGET, 'utf8');
const parsed = parseVendored(existing);

if (parsed && sha(parsed.body) !== parsed.recordedHash && !force) {
  console.error('❌ DRIFT: the vendored server copy was edited directly (body no longer matches its SYNC-HASH).');
  console.error('   Reconcile the edit into the canonical file first, or re-run with --force to overwrite.');
  process.exit(1);
}

if (parsed && parsed.recordedHash === canonicalHash && sha(parsed.body) === canonicalHash) {
  console.log('✓ Vendored copy is in sync.');
  process.exit(0);
}

if (checkOnly) {
  console.error('❌ Vendored copy is STALE (canonical changed). Run without --check to re-vendor.');
  process.exit(1);
}

fs.writeFileSync(TARGET, header + canonical);
console.log(`✅ Re-vendored → ${TARGET} (SYNC-HASH ${canonicalHash.slice(0, 16)}…)`);
