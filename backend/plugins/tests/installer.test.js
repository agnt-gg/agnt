#!/usr/bin/env node

/**
 * trust system verification gauntlet.
 *
 * Runs the full install/update/registry stack against a SANDBOXED user-data
 * dir (never touches the real %APPDATA%/AGNT). No network: the marketplace
 * lookup is monkey-patched. Exercises every invariant the PRD names:
 *
 *   - shared-core validation (NeuralForge-class checks)
 *   - SRI integrity verify + mismatch abort
 *   - staged install + atomic swap (failed install leaves live untouched)
 *   - registry merge semantics (G1), atomic writes + .bak (G3)
 *   - permission-diff gate (an update can never gain powers silently)
 *   - non-semver version handling ('local'/'latest'/'unknown')
 *   - boot sweep of staging/.retired leftovers; dot-dir registry filters
 *
 * Usage: node tests/installer.test.js
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

// --- Sandbox BEFORE importing the installer (its constructor reads env) ---
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-trust-'));
process.env.USER_DATA_PATH = SANDBOX;
process.env.APP_PATH = SANDBOX; // keeps bundledPluginsDir/marketplacePath out of the real repo
process.env.UNPACKED_PATH = SANDBOX;

const { default: installer } = await import('../../src/plugins/PluginInstaller.js');
const core = await import('../lib/validate-core.js');
const tar = await import('tar');

// No network, ever: marketplace is a local fixture we control per-test.
let marketplaceFixture = { plugins: [] };
installer.getMarketplaceRegistry = async () => marketplaceFixture;

const PLUGIN = 'gauntlet-plugin';
const FIXTURES = path.join(SANDBOX, 'fixtures');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- Fixture builder -------------------------------------------------------
async function makeArchive({ version, permissions, withSpawn = false, breakIt = false, missingAsset = false }) {
  const suffix = `${withSpawn ? '-spawn' : ''}${breakIt ? '-broken' : ''}${missingAsset ? '-noasset' : ''}`;
  const dir = path.join(FIXTURES, `${PLUGIN}-${version}${suffix}`);
  const src = path.join(dir, PLUGIN);
  await fsp.mkdir(path.join(src, 'tools'), { recursive: true });

  const manifest = {
    name: PLUGIN,
    version,
    description: 'trust system gauntlet fixture',
    tools: [{ type: 'gauntlet-tool', entryPoint: 'tools/gauntlet-tool.js', schema: { title: 'Gauntlet' } }],
  };
  // The sukuna shape: manifest declares a workflow whose JSON is NOT bundled.
  if (missingAsset) {
    manifest.workflows = [{ slug: 'sukuna-style-demo', definition: './workflows/demo.json' }];
  }
  if (permissions) manifest.permissions = permissions;
  await fsp.writeFile(path.join(src, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const code = [
    withSpawn ? "import { execSync } from 'child_process';" : '',
    'export async function execute(params) {',
    "  const res = await fetch('https://api.example.com/data');",
    withSpawn ? "  execSync('echo hi');" : '',
    `  return { ok: true, version: '${version}' };`,
    '}',
  ].join('\n');
  if (!breakIt) {
    await fsp.writeFile(path.join(src, 'tools', 'gauntlet-tool.js'), code);
  } // breakIt: declared entryPoint intentionally missing (the NeuralForge case)

  const archive = path.join(FIXTURES, `${PLUGIN}-${version}${suffix}.agnt`);
  await tar.create({ gzip: true, file: archive, cwd: dir }, [PLUGIN]);
  return archive;
}

const livePath = path.join(SANDBOX, 'plugins', 'installed', PLUGIN);
const registryPath = path.join(SANDBOX, 'plugins', 'registry.json');
const readRegistry = () => JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const readEntry = () => readRegistry().plugins.find((p) => p.name === PLUGIN);

await fsp.mkdir(path.join(SANDBOX, 'plugins', 'installed'), { recursive: true });
await fsp.mkdir(path.join(SANDBOX, 'plugins', '.temp'), { recursive: true });

console.log(`\n🧪 trust system gauntlet — sandbox: ${SANDBOX}\n`);

// === T1: shared-core validation ============================================
{
  const good = await makeArchive({ version: '1.0.0', permissions: { capabilities: ['network'] } });
  const goodReport = await core.dryRunInstall(good);
  check('T1a validate-core passes a good package', goodReport.valid);

  const broken = await makeArchive({ version: '1.0.0', breakIt: true });
  const brokenReport = await core.dryRunInstall(broken);
  check(
    'T1b validate-core fails the NeuralForge case (missing entryPoint file) with exact reason',
    !brokenReport.valid && brokenReport.errors.some((e) => e.includes('missing file: tools/gauntlet-tool.js'))
  );

  const archReport = await core.verifyArchive(good);
  check('T1c verifyArchive reads a good archive + finds manifest', archReport.valid && archReport.entries.length > 0);
}

// === T2: version comparison matrix =========================================
{
  const m = [
    ['1.0.0', '1.1.0', true, -1], ['2.0.0', '1.9.9', true, 1], ['1.0.0', '1.0.0', true, 0],
    ['3.0.1-local.annie', '3.0.1', true, -1], // prerelease < release
    ['local', '2.0.0', false, null], ['latest', '2.0.0', false, null],
    ['unknown', '2.0.0', false, null], ['1.0.0', 'not-a-version', false, null],
  ];
  const ok = m.every(([a, b, comparable, cmp]) => {
    const r = core.compareVersions(a, b);
    return r.comparable === comparable && (cmp === null || r.cmp === cmp);
  });
  check('T2 compareVersions: semver matrix + local/latest/unknown → "unknown version"', ok);
}

// === T3: staged install from file (TOFU) ===================================
{
  const v1 = await makeArchive({ version: '1.0.0', permissions: { capabilities: ['network'] } });
  const r = await installer.installFromFile(v1, PLUGIN);
  const entry = readEntry();
  check('T3a installFromFile succeeds via staged path', r.success);
  check('T3b registry has REAL manifest version (not "local")', entry?.version === '1.0.0', `got ${entry?.version}`);
  check('T3c registry has TOFU integrity (SRI format)', entry?.integrityState === 'tofu' && /^sha256-/.test(entry?.integrity || ''));
  check('T3d trustTier = community (declared covers detected)', entry?.trustTier === 'community', `got ${entry?.trustTier}`);
  check('T3e grantedPermissions recorded', Array.isArray(entry?.grantedPermissions) && entry.grantedPermissions.includes('network'));
  check('T3f plugin dir live + loadable', fs.existsSync(path.join(livePath, 'manifest.json')) && (await installer.validatePlugin(PLUGIN)));
  check('T3g no staging leftovers', !fs.readdirSync(path.join(SANDBOX, 'plugins', '.temp')).some((n) => n.startsWith('staging-')));
}

// === T3h-j: BACKWARD-COMPAT — a pre-trust-era package that declares an =======
// ecosystem asset (workflow) whose file isn't bundled (the "sukuna" break).
// Install must TOLERATE it (warn + skip), but build/publish must REJECT it.
{
  const sukuna = await makeArchive({ version: '1.5.0', permissions: { capabilities: ['network'] }, missingAsset: true });

  // Install tolerates it (old installer only hard-checked tool entryPoints).
  const r = await installer.installFromFile(sukuna, PLUGIN);
  const entry = readEntry();
  check('T3h sukuna-style pkg (missing declared workflow) INSTALLS', r.success === true, r.error || '');
  check('T3i badge capped at unverified when an asset is missing', entry?.trustTier === 'unverified', `got ${entry?.trustTier}`);

  // The SAME package fails the strict build/publish gate (default error mode).
  const strict = await core.validateManifestAssets(path.join(FIXTURES, `${PLUGIN}-1.5.0-noasset`, PLUGIN));
  const tolerant = await core.validateManifestAssets(path.join(FIXTURES, `${PLUGIN}-1.5.0-noasset`, PLUGIN), { assetFileMode: 'warn' });
  check(
    'T3j build/publish REJECTS it (strict), install ACCEPTS it (warn)',
    strict.valid === false &&
      strict.errors.some((e) => e.includes('sukuna-style-demo') && e.includes('missing file')) &&
      tolerant.valid === true &&
      tolerant.assetWarnings.some((w) => w.includes('sukuna-style-demo'))
  );

  // restore v1 as the installed baseline so later tests see a known state
  await installer.installFromFile(path.join(FIXTURES, `${PLUGIN}-1.0.0.agnt`), PLUGIN);
}

// === T4: corrupt archive NEVER destroys the live install (recut M-A6) ======
{
  const corrupt = path.join(FIXTURES, 'corrupt.agnt');
  await fsp.writeFile(corrupt, Buffer.from('this is not a gzip archive at all'));
  const r = await installer.installFromFile(corrupt, PLUGIN);
  check('T4a corrupt archive install fails cleanly', !r.success);
  check('T4b live v1 still installed + valid after failed install', fs.existsSync(path.join(livePath, 'manifest.json')) && (await installer.validatePlugin(PLUGIN)));
  check('T4c registry entry untouched (still 1.0.0)', readEntry()?.version === '1.0.0');
}

// === T5: registry merge semantics (G1) + disabled preservation =============
{
  // Inject a custom field + disable the plugin, then reinstall the same file.
  const reg = readRegistry();
  const e = reg.plugins.find((p) => p.name === PLUGIN);
  e.customFutureField = 'must-survive';
  e.enabled = false;
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2));

  const v1 = path.join(FIXTURES, `${PLUGIN}-1.0.0.agnt`);
  await installer.installFromFile(v1, PLUGIN);
  const after = readEntry();
  check('T5a unknown field survives reinstall (merge, not replace)', after?.customFutureField === 'must-survive');
  check('T5b disabled state survives reinstall (old re-enable bug fixed)', after?.enabled === false);
  check('T5c installedAt preserved, updatedAt stamped', !!after?.installedAt && !!after?.updatedAt);
  // restore enabled for later tests
  const reg2 = readRegistry();
  reg2.plugins.find((p) => p.name === PLUGIN).enabled = true;
  fs.writeFileSync(registryPath, JSON.stringify(reg2, null, 2));
}

// === T6: atomic registry writes (G3) ========================================
{
  check('T6a .bak generation exists', fs.existsSync(registryPath + '.bak'));
  check('T6b no orphaned .tmp', !fs.existsSync(registryPath + '.tmp'));
  const bak = JSON.parse(fs.readFileSync(registryPath + '.bak', 'utf8'));
  check('T6c .bak is valid parseable JSON registry', Array.isArray(bak.plugins));
}

// === T7: update with permission-diff gate ===================================
{
  const v2 = await makeArchive({ version: '2.0.0', permissions: { capabilities: ['network', 'spawn-process'] }, withSpawn: true });
  const v2Integrity = await core.computeIntegrity(v2);
  marketplaceFixture = { plugins: [{ name: PLUGIN, version: '2.0.0', integrity: v2Integrity, downloadUrl: 'file://fixture' }] };
  installer.fetchMarketplaceArchive = async (info, tempFile) => fsp.copyFile(v2, tempFile);

  // 7a: checkForUpdates sees it
  const cfu = await installer.checkForUpdates();
  const u = cfu.updates.find((x) => x.name === PLUGIN);
  check('T7a checkForUpdates flags 1.0.0 → 2.0.0', cfu.success && u?.updateAvailable === true && u.status === 'update-available');

  // 7b: update WITHOUT consent → blocked, nothing changed
  const blocked = await installer.updatePlugin(PLUGIN, { acceptedPermissions: false });
  check('T7b update requesting new permission is BLOCKED pending consent', blocked.success === false && blocked.requiresConsent === true);
  check('T7c gate reports the exact added permission', blocked.permissionDiff?.added?.join() === 'spawn-process');
  check('T7d live still v1 after blocked update', readEntry()?.version === '1.0.0' && (await installer.validatePlugin(PLUGIN)));

  // 7e: update WITH consent → swapped
  const accepted = await installer.updatePlugin(PLUGIN, { acceptedPermissions: true });
  const entry = readEntry();
  check('T7e consented update succeeds', accepted.success === true);
  check('T7f registry now 2.0.0, integrity VERIFIED', entry?.version === '2.0.0' && entry?.integrityState === 'verified');
  check('T7g grantedPermissions now includes spawn-process', entry?.grantedPermissions?.includes('spawn-process'));
  check('T7h trustTier still community (v2 declares everything it uses)', entry?.trustTier === 'community', `got ${entry?.trustTier}`);
  check('T7i v2 actually live on disk', JSON.parse(fs.readFileSync(path.join(livePath, 'manifest.json'), 'utf8')).version === '2.0.0');
  check('T7j customFutureField STILL survives (merge through update)', entry?.customFutureField === 'must-survive');
}

// === T8: integrity mismatch aborts BEFORE touching live =====================
{
  const v3 = await makeArchive({ version: '3.0.0', permissions: { capabilities: ['network', 'spawn-process'] }, withSpawn: true });
  marketplaceFixture = { plugins: [{ name: PLUGIN, version: '3.0.0', integrity: 'sha256-DEADBEEFdeadbeefDEADBEEFdeadbeefDEADBEEFxxx=', downloadUrl: 'file://fixture' }] };
  installer.fetchMarketplaceArchive = async (info, tempFile) => fsp.copyFile(v3, tempFile);

  const r = await installer.updatePlugin(PLUGIN, { acceptedPermissions: true });
  check('T8a tampered artifact aborts with integrity error', !r.success && /Integrity check failed/.test(r.error || ''));
  check('T8b live v2 untouched after integrity abort', readEntry()?.version === '2.0.0' && (await installer.validatePlugin(PLUGIN)));
}

// === T9: unknown installed version is surfaced, never auto-compared =========
{
  const reg = readRegistry();
  reg.plugins.find((p) => p.name === PLUGIN).version = 'local';
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2));
  marketplaceFixture = { plugins: [{ name: PLUGIN, version: '9.9.9', downloadUrl: 'file://fixture' }] };

  const cfu = await installer.checkForUpdates();
  const u = cfu.updates.find((x) => x.name === PLUGIN);
  check('T9 version "local" → status unknown-version, updateAvailable=false', u?.status === 'unknown-version' && u.updateAvailable === false);
  const reg2 = readRegistry();
  reg2.plugins.find((p) => p.name === PLUGIN).version = '2.0.0';
  fs.writeFileSync(registryPath, JSON.stringify(reg2, null, 2));
}

// === T10: boot sweep + dot-dir filters ======================================
{
  const staleStaging = path.join(SANDBOX, 'plugins', '.temp', 'staging-dead-123');
  const staleRetired = path.join(SANDBOX, 'plugins', 'installed', '.retired-dead-123');
  await fsp.mkdir(staleStaging, { recursive: true });
  await fsp.mkdir(staleRetired, { recursive: true });
  await fsp.writeFile(path.join(staleRetired, 'manifest.json'), JSON.stringify({ name: 'dead', version: '0.0.1', tools: [] }));

  await installer.sweepStaleInstallArtifacts();
  check('T10a stale staging dir swept', !fs.existsSync(staleStaging));
  check('T10b stale .retired dir swept', !fs.existsSync(staleRetired));

  // rebuildRegistry must skip dot-dirs even if sweep missed them
  await fsp.mkdir(staleRetired, { recursive: true });
  await fsp.writeFile(path.join(staleRetired, 'manifest.json'), JSON.stringify({ name: 'dead', version: '0.0.1' }));
  const rebuilt = await installer.rebuildRegistry();
  check('T10c rebuildRegistry ignores .retired-* dirs', !rebuilt.plugins.some((p) => p.name.startsWith('.retired-')));
  await fsp.rm(staleRetired, { recursive: true, force: true });
}

// === T11: registry corruption → rebuild (TOFU re-baseline path) =============
{
  fs.writeFileSync(registryPath, '{ this is not valid json');
  await installer.updateRegistry(PLUGIN, '2.0.0', 'installed', {});
  const reg = readRegistry();
  check('T11 corrupted registry rebuilt from disk, plugin re-registered', reg.plugins.some((p) => p.name === PLUGIN));
}

// === T12: uninstall still clean ==============================================
{
  const r = await installer.uninstallPlugin(PLUGIN);
  check('T12a uninstall succeeds', r.success);
  check('T12b registry entry removed + userUninstalled recorded', !readEntry() && readRegistry().userUninstalled?.includes(PLUGIN));
  check('T12c plugin dir removed', !fs.existsSync(livePath));
}

// === Summary =================================================================
const passed = results.filter((r) => r.pass).length;
console.log(`\n${'='.repeat(60)}\n📊 ${passed}/${results.length} checks passed`);
if (passed !== results.length) {
  console.log('FAILED:', results.filter((r) => !r.pass).map((r) => r.name).join(' | '));
  process.exit(1);
}
console.log('🎉 trust system gauntlet: ALL GREEN');
// best-effort sandbox cleanup
try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch {}
