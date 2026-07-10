#!/usr/bin/env node

/**
 * trust system END-TO-END test: boots the REAL express router (PluginRoutes.js)
 * with the REAL PluginInstaller against the REAL bundled marketplace
 * artifacts, and exercises the full HTTP surface a user's clicks hit:
 *
 *   GET  /api/plugins/marketplace      (trust fields served?)
 *   GET  /api/plugins/inspect/:name    (pre-install disclosure)
 *   POST /api/plugins/install          (real .agnt from marketplace-default)
 *   GET  /api/plugins/installed        (badge fields present?)
 *   GET  /api/plugins/updates
 *   POST /api/plugins/update/:name     (permission gate over HTTP)
 *   POST /api/plugins/install-file     (multipart upload path)
 *   DELETE /api/plugins/:name
 *
 * Plus the Windows locked-file swap test that was specced but never written.
 *
 * Sandboxed USER_DATA_PATH — the real %APPDATA%/AGNT is never touched.
 * APP_PATH points at the real repo so marketplace.json + .agnt artifacts are
 * the genuine shipped ones.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-e2e-'));
process.env.USER_DATA_PATH = SANDBOX;
process.env.APP_PATH = REPO;      // real repo → real marketplace.json + artifacts
process.env.UNPACKED_PATH = REPO;

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// Boot the REAL router. PluginRoutes imports PluginManager, orchestrator
// tools, WorkflowProcessBridge etc. — if any of that fails to import in a
// bare Node process, that's a finding, not something to hide.
// ---------------------------------------------------------------------------
await fsp.mkdir(path.join(SANDBOX, 'plugins', 'installed'), { recursive: true });
await fsp.mkdir(path.join(SANDBOX, 'plugins', '.temp'), { recursive: true });

// CRITICAL: pre-seed an EMPTY agnt.db so the legacy data-dir migration shim in
// src/models/database/index.js does NOT copy the user's real (100+ GB) db
// into the sandbox. The shim only migrates when the target file is absent.
await fsp.mkdir(path.join(SANDBOX, 'Data'), { recursive: true });
await fsp.writeFile(path.join(SANDBOX, 'Data', 'agnt.db'), '');

let app, server, BASE;
try {
  const express = (await import('express')).default;
  const { default: pluginRoutes } = await import('../../src/routes/PluginRoutes.js');
  app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/plugins', pluginRoutes);
  server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  BASE = `http://127.0.0.1:${server.address().port}/api/plugins`;
  check('E0 REAL PluginRoutes router mounts and serves', true, BASE);
} catch (err) {
  check('E0 REAL PluginRoutes router mounts and serves', false, err.message);
  console.log('\nCannot continue without the router.');
  process.exit(1);
}

const { default: installer } = await import('../../src/plugins/PluginInstaller.js');

async function api(method, route, body, isForm = false) {
  const opts = { method, headers: {} };
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body; // FormData
  }
  const res = await fetch(BASE + route, opts);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// === E1: marketplace listing serves trust fields =============================
{
  const { status, json } = await api('GET', '/marketplace');
  const plugins = json?.plugins || [];
  const withTrust = plugins.filter((p) => p.trustTier);
  const withIntegrity = plugins.filter((p) => p.integrity);
  check('E1a GET /marketplace 200 + plugins', status === 200 && plugins.length >= 39, `${plugins.length} plugins`);
  check('E1b trust fields served on marketplace records', withTrust.length >= 39, `${withTrust.length} with trustTier`);
  check('E1c integrity hashes served', withIntegrity.length >= 39, `${withIntegrity.length} with integrity`);
}

// === E2: pre-install inspection over HTTP ====================================
{
  const { status, json } = await api('GET', '/inspect/calculator-plugin');
  check('E2a GET /inspect/calculator-plugin 200 + success', status === 200 && json?.success);
  check('E2b integrity verified against shipped artifact', json?.integrityState === 'verified');
  check('E2c dynamic-eval detected with file:line', !!json?.detected?.['dynamic-eval']?.example?.file);
  check('E2d nothing installed by inspection', !fs.existsSync(path.join(SANDBOX, 'plugins', 'installed', 'calculator-plugin')));
}

// === E3: REAL install through the REAL route (genuine .agnt, no deps) ========
{
  const { status, json } = await api('POST', '/install', { name: 'calculator-plugin' });
  check('E3a POST /install calculator-plugin succeeds', status === 200 && json?.success, JSON.stringify(json)?.slice(0, 120));
  check('E3b response carries trustTier', !!json?.trustTier, json?.trustTier);
  const live = path.join(SANDBOX, 'plugins', 'installed', 'calculator-plugin');
  check('E3c plugin physically on disk', fs.existsSync(path.join(live, 'manifest.json')));
  const reg = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'plugins', 'registry.json'), 'utf8'));
  const entry = reg.plugins.find((p) => p.name === 'calculator-plugin');
  check('E3d registry: integrity verified + tier + detected caps', entry?.integrityState === 'verified' && !!entry?.trustTier && Array.isArray(entry?.detectedCapabilities));
}

// === E4: install a plugin WITH dependencies (real npm install in staging) ====
{
  const { status, json } = await api('POST', '/install', { name: 'chucknorris-joke-plugin' });
  const live = path.join(SANDBOX, 'plugins', 'installed', 'chucknorris-joke-plugin');
  const manifest = fs.existsSync(path.join(live, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(live, 'manifest.json'), 'utf8')) : null;
  check('E4a POST /install chucknorris (dep path) succeeds', status === 200 && json?.success, json?.error?.slice(0, 100) || '');
  check('E4b installed + manifest readable', !!manifest, manifest?.version);
}

// === E5: GET /installed serves badge fields to the UI ========================
{
  const { status, json } = await api('GET', '/installed');
  const calc = (json?.plugins || []).find((p) => p.name === 'calculator-plugin');
  check('E5a GET /installed 200', status === 200 && json?.success);
  check('E5b UI receives trustTier + integrityState + detectedCapabilities', !!calc?.trustTier && !!calc?.integrityState && Array.isArray(calc?.detectedCapabilities), JSON.stringify({ t: calc?.trustTier, i: calc?.integrityState }));
}

// === E6: updates endpoint over HTTP ==========================================
{
  const { status, json } = await api('GET', '/updates');
  check('E6a GET /updates 200 + shape', status === 200 && json?.success && Array.isArray(json.updates), `${json?.updates?.length} entries, ${json?.updateCount} available`);
  const calc = json.updates.find((u) => u.name === 'calculator-plugin');
  check('E6b freshly installed plugin is up-to-date', calc?.status === 'up-to-date');
}

// === E7: update flow + permission gate over HTTP =============================
{
  // Downgrade registry version so an update is "available", and pretend fewer
  // permissions were granted so the gate must fire.
  const regPath = path.join(SANDBOX, 'plugins', 'registry.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const entry = reg.plugins.find((p) => p.name === 'calculator-plugin');
  entry.version = '0.0.1';
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));

  // calculator's manifest now DECLARES its capabilities (fleet migration,
  // 2026-07-07) and install granted them — same declared vs granted → no
  // diff → the gate must NOT fire and the update proceeds:
  const r1 = await api('POST', '/update/calculator-plugin', {});
  check('E7a update with no permission diff proceeds over HTTP', r1.status === 200 && r1.json?.success, r1.json?.error?.slice(0, 100) || '');
  const reg2 = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const e2 = reg2.plugins.find((p) => p.name === 'calculator-plugin');
  check('E7b registry version restored to marketplace version', e2?.version !== '0.0.1', e2?.version);

  // Now force a REAL permission diff: mark granted=[], and fake the
  // marketplace-side manifest by using a fixture plugin that declares perms.
  // Use installer directly is already covered in the gauntlet; over HTTP we
  // verify the requiresConsent shape with a synthetic marketplace override:
  const realGet = installer.getMarketplaceRegistry.bind(installer);
  const tar = await import('tar');
  const fixDir = path.join(SANDBOX, 'fix', 'permy');
  await fsp.mkdir(path.join(fixDir, 'permy-plugin', 'tools'), { recursive: true });
  await fsp.writeFile(path.join(fixDir, 'permy-plugin', 'manifest.json'), JSON.stringify({
    name: 'calculator-plugin', version: '99.0.0',
    permissions: { capabilities: ['spawn-process'] },
    tools: [{ type: 'x', entryPoint: 'tools/x.js', schema: { title: 'x' } }],
  }));
  await fsp.writeFile(path.join(fixDir, 'permy-plugin', 'tools', 'x.js'), 'export async function execute(){return {}}');
  const permyArchive = path.join(SANDBOX, 'fix', 'permy.agnt');
  await tar.create({ gzip: true, file: permyArchive, cwd: fixDir }, ['permy-plugin']);
  installer.getMarketplaceRegistry = async () => ({ plugins: [{ name: 'calculator-plugin', version: '99.0.0', downloadUrl: 'file://x' }] });
  installer.fetchMarketplaceArchive = async (info, tempFile) => fsp.copyFile(permyArchive, tempFile);

  const r2 = await api('POST', '/update/calculator-plugin', {});
  check('E7c permission-escalating update BLOCKED over HTTP', r2.json?.success === false && r2.json?.requiresConsent === true, JSON.stringify(r2.json?.permissionDiff?.added));
  const r3 = await api('POST', '/update/calculator-plugin', { acceptedPermissions: true });
  check('E7d consented retry succeeds over HTTP', r3.json?.success === true, r3.json?.version);
  installer.getMarketplaceRegistry = realGet;
  delete installer.fetchMarketplaceArchive;
}

// === E8: install-file over HTTP (multipart upload path) ======================
{
  const artifact = path.join(REPO, 'backend', 'plugins', 'marketplace-default', 'dice-roller-plugin.agnt');
  // Real route contract: JSON body { name, fileData: base64 } — not multipart.
  const { status, json } = await api('POST', '/install-file', {
    name: 'dice-roller-plugin',
    fileData: fs.readFileSync(artifact).toString('base64'),
  });
  check('E8a POST /install-file (base64 JSON) succeeds', status === 200 && json?.success, json?.error?.slice(0, 120) || '');
  const reg = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'plugins', 'registry.json'), 'utf8'));
  const entry = reg.plugins.find((p) => p.name === 'dice-roller-plugin');
  check('E8b file install: TOFU integrity + real manifest version', entry?.integrityState === 'tofu' && entry?.version !== 'local', `${entry?.version} / ${entry?.integrityState}`);
}

// === E9: THE WINDOWS LOCKED-FILE SWAP TEST (specced, never written — now real)
{
  const live = path.join(SANDBOX, 'plugins', 'installed', 'dice-roller-plugin');
  const lockTarget = path.join(live, 'manifest.json');
  // Hold a real open handle the way the running server does via import()
  const fd = fs.openSync(lockTarget, 'r');
  let r;
  try {
    const artifact = path.join(REPO, 'backend', 'plugins', 'marketplace-default', 'dice-roller-plugin.agnt');
    r = await installer.stagedInstall(artifact, 'dice-roller-plugin', { integrityState: 'tofu', integrity: 'sha256-test' });
  } finally {
    fs.closeSync(fd);
  }
  check('E9a swap under open file handle completes (atomic or degraded)', r?.success === true, `degraded=${r?.degraded}`);
  check('E9b plugin still valid after locked swap', fs.existsSync(lockTarget) && (await installer.validatePlugin('dice-roller-plugin')));
  const leftovers = fs.readdirSync(path.join(SANDBOX, 'plugins', 'installed')).filter((n) => n.startsWith('.retired-'));
  // .retired may legitimately linger under lock — the boot sweep owns it:
  await installer.sweepStaleInstallArtifacts();
  const after = fs.readdirSync(path.join(SANDBOX, 'plugins', 'installed')).filter((n) => n.startsWith('.retired-'));
  check('E9c retired dirs swept (or none left)', after.length === 0, `before sweep: ${leftovers.length}`);
}

// === E10: uninstall over HTTP ================================================
{
  const { status, json } = await api('DELETE', '/calculator-plugin');
  check('E10a DELETE /:name succeeds', status === 200 && json?.success);
  check('E10b gone from disk', !fs.existsSync(path.join(SANDBOX, 'plugins', 'installed', 'calculator-plugin')));
}

// === Summary =================================================================
server.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\n${'='.repeat(60)}\n📊 E2E: ${passed}/${results.length} checks passed`);
if (passed !== results.length) {
  console.log('FAILED:', results.filter((r) => !r.pass).map((r) => r.name).join(' | '));
  process.exit(1);
}
console.log('🎉 trust system E2E over real HTTP routes: ALL GREEN');
try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch {}
process.exit(0);
