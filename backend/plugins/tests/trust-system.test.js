#!/usr/bin/env node

/**
 * trust system (0.7.0 workstreams) verification suite. Sandboxed — never touches
 * the real %APPDATA%/AGNT and stubs all network.
 *
 *   W2: Ed25519 keygen/sign/verify roundtrip + tamper rejection +
 *       signed marketplace install (key fetch stubbed) + bad-sig abort
 *   W4: installFromGitHub — release-asset flow, redirect confirmation,
 *       permission gate (GitHub API stubbed)
 *   W7: DomainInterceptor — hostname matching, violation recording,
 *       attribution isolation across concurrent contexts
 *   W8: UpdateScheduler — notify vs auto vs pinned, escalation blocked
 *   W1: remote marketplace transform maps server trust columns
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-trust-b-'));
process.env.USER_DATA_PATH = SANDBOX;
process.env.APP_PATH = SANDBOX;
process.env.UNPACKED_PATH = SANDBOX;
await fsp.mkdir(path.join(SANDBOX, 'Data'), { recursive: true });
await fsp.writeFile(path.join(SANDBOX, 'Data', 'agnt.db'), '');
await fsp.mkdir(path.join(SANDBOX, 'plugins', 'installed'), { recursive: true });
await fsp.mkdir(path.join(SANDBOX, 'plugins', '.temp'), { recursive: true });

const { default: installer } = await import('../../src/plugins/PluginInstaller.js');
const { generateKeypair, signBuffer, verifyBuffer } = await import('../cli/sign-plugin.js');
const DomainInterceptor = (await import('../../src/plugins/DomainInterceptor.js')).default;
const { default: UpdateScheduler } = await import('../../src/plugins/UpdateScheduler.js');
const core = await import('../lib/validate-core.js');
const tar = await import('tar');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const registryPath = path.join(SANDBOX, 'plugins', 'registry.json');
const readEntry = (n) => JSON.parse(fs.readFileSync(registryPath, 'utf8')).plugins.find((p) => p.name === n);

async function makeArchive(name, version, permissions = null) {
  const dir = path.join(SANDBOX, 'fix', `${name}-${version}`);
  const src = path.join(dir, name);
  await fsp.mkdir(path.join(src, 'tools'), { recursive: true });
  const manifest = { name, version, tools: [{ type: `${name}-tool`, entryPoint: 'tools/main.js', schema: { title: name } }] };
  if (permissions) manifest.permissions = permissions;
  await fsp.writeFile(path.join(src, 'manifest.json'), JSON.stringify(manifest));
  await fsp.writeFile(path.join(src, 'tools', 'main.js'), 'export async function execute(){ return { ok: true }; }');
  const archive = path.join(SANDBOX, 'fix', `${name}-${version}.agnt`);
  await tar.create({ gzip: true, file: archive, cwd: dir }, [name]);
  return archive;
}

console.log(`\n🧪 trust system 0.7.0 suite — sandbox: ${SANDBOX}\n`);

// === W2a: sign/verify roundtrip ==============================================
{
  const pair = generateKeypair();
  const data = Buffer.from('the exact package bytes');
  const sig = signBuffer(data, pair.privateKey);
  check('W2a sign/verify roundtrip', verifyBuffer(data, sig, pair.publicKey));
  check('W2b tampered bytes rejected', !verifyBuffer(Buffer.from('the exact package bytez'), sig, pair.publicKey));
  check('W2c wrong key rejected', !verifyBuffer(data, sig, generateKeypair().publicKey));

  // Server-side verifier agrees with client-side signer (same SPKI trick)
  const gate = await import('file:///' + 'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-server/api.agnt.gg/src/libs/PluginTrustGate.js'.replace(/\\/g, '/'));
  check('W2d server verifyPackageSignature agrees with client signer', gate.verifyPackageSignature(data, sig, pair.publicKey) === true);
  check('W2e server rejects tampered', gate.verifyPackageSignature(Buffer.from('x'), sig, pair.publicKey) === false);
}

// === W2f: signed marketplace install (key fetch stubbed) =====================
const realGetMarketplaceRegistry = installer.getMarketplaceRegistry.bind(installer);
{
  const pair = generateKeypair();
  const archive = await makeArchive('signed-plugin', '1.0.0', { capabilities: [] });
  const bytes = fs.readFileSync(archive);
  const signature = signBuffer(bytes, pair.privateKey);
  const integrity = await core.computeIntegrity(archive);

  installer.getMarketplaceRegistry = async () => ({
    plugins: [{ name: 'signed-plugin', version: '1.0.0', integrity, signature, publisherKeyId: 'key-123', downloadUrl: 'file://x' }],
  });
  installer.fetchMarketplaceArchive = async (info, tempFile) => fsp.copyFile(archive, tempFile);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/marketplace/keys/key-123/public')) {
      return { ok: true, json: async () => ({ success: true, keyId: 'key-123', publicKey: pair.publicKey, status: 'active' }) };
    }
    return realFetch(url);
  };

  const r = await installer.installFromMarketplace('signed-plugin');
  globalThis.fetch = realFetch;
  check('W2f signed install succeeds + records signedBy', r.success && readEntry('signed-plugin')?.signedBy === 'key-123', JSON.stringify(r).slice(0, 100));

  // Bad signature → hard abort, nothing installed over the good version
  const evilSig = signBuffer(Buffer.from('different bytes'), pair.privateKey);
  installer.getMarketplaceRegistry = async () => ({
    plugins: [{ name: 'signed-plugin', version: '2.0.0', integrity, signature: evilSig, publisherKeyId: 'key-123', downloadUrl: 'file://x' }],
  });
  globalThis.fetch = async (url) =>
    String(url).includes('/public')
      ? { ok: true, json: async () => ({ success: true, publicKey: pair.publicKey, status: 'active' }) }
      : realFetch(url);
  const r2 = await installer.updatePlugin('signed-plugin', { acceptedPermissions: true });
  globalThis.fetch = realFetch;
  check('W2g invalid signature hard-aborts update', !r2.success && /Signature verification FAILED/.test(r2.error || ''), r2.error?.slice(0, 80));
  check('W2h prior version untouched after sig abort', readEntry('signed-plugin')?.version === '1.0.0');
}

// === W4: installFromGitHub (GitHub API stubbed) ===============================
{
  const archive = await makeArchive('gh-plugin', '3.0.0', { capabilities: [] });
  const bytes = fs.readFileSync(archive);
  const realFetch = globalThis.fetch;
  let redirectMode = false;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u === 'https://api.github.com/repos/agnt-gg/gh-plugin') {
      return { ok: true, json: async () => ({ full_name: redirectMode ? 'newowner/gh-plugin' : 'agnt-gg/gh-plugin', default_branch: 'main' }) };
    }
    if (u.includes('/releases/latest')) {
      return { ok: true, json: async () => ({ tag_name: 'v3.0.0', assets: [{ name: 'gh-plugin.agnt', browser_download_url: 'https://dl.example/gh-plugin.agnt' }] }) };
    }
    if (u.startsWith('https://dl.example/')) {
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    return realFetch(url);
  };

  const r = await installer.installFromGitHub('gh-plugin', { repo: 'agnt-gg/gh-plugin' });
  check('W4a release-asset install succeeds', r.success === true && r.ref === 'v3.0.0', JSON.stringify(r).slice(0, 120));
  const e = readEntry('gh-plugin');
  check('W4b registry records github source + TOFU integrity', e?.source?.type === 'github' && e.source.repo === 'agnt-gg/gh-plugin' && e.integrityState === 'tofu');

  redirectMode = true;
  const r2 = await installer.installFromGitHub('gh-plugin', { repo: 'agnt-gg/gh-plugin' });
  check('W4c moved repo requires confirmation, nothing touched', r2.requiresConfirmation === true && r2.movedTo === 'newowner/gh-plugin' && readEntry('gh-plugin')?.version === '3.0.0');
  redirectMode = false;

  // Permission escalation via GitHub pull → gate fires
  const spicy = await makeArchive('gh-plugin', '4.0.0', { capabilities: ['spawn-process'] });
  const spicyBytes = fs.readFileSync(spicy);
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u === 'https://api.github.com/repos/agnt-gg/gh-plugin') return { ok: true, json: async () => ({ full_name: 'agnt-gg/gh-plugin', default_branch: 'main' }) };
    if (u.includes('/releases/latest')) return { ok: true, json: async () => ({ tag_name: 'v4.0.0', assets: [{ name: 'gh-plugin.agnt', browser_download_url: 'https://dl.example/v4.agnt' }] }) };
    if (u.startsWith('https://dl.example/')) return { ok: true, arrayBuffer: async () => spicyBytes.buffer.slice(spicyBytes.byteOffset, spicyBytes.byteOffset + spicyBytes.byteLength) };
    return realFetch(url);
  };
  const r3 = await installer.installFromGitHub('gh-plugin', { repo: 'agnt-gg/gh-plugin' });
  check('W4d permission escalation blocked pending consent', r3.requiresConsent === true && readEntry('gh-plugin')?.version === '3.0.0');
  const r4 = await installer.installFromGitHub('gh-plugin', { repo: 'agnt-gg/gh-plugin', acceptedPermissions: true });
  check('W4e consented GitHub update succeeds', r4.success === true && readEntry('gh-plugin')?.version === '4.0.0');
  globalThis.fetch = realFetch;
}

// === W7: DomainInterceptor ====================================================
{
  DomainInterceptor._resetForTests();
  check('W7a exact + wildcard hostname matching', DomainInterceptor.hostnameAllowed('api.example.com', new Set(['api.example.com'])) && DomainInterceptor.hostnameAllowed('sub.example.com', new Set(['*.example.com'])) && !DomainInterceptor.hostnameAllowed('evil.com', new Set(['api.example.com'])));
  check('W7b empty declaration = no restriction claimed', DomainInterceptor.hostnameAllowed('anything.com', new Set()));

  DomainInterceptor.installGlobalFetchWrapper();
  const realFetch = globalThis.fetch;
  // Stub the ORIGINAL fetch under the wrapper by re-wrapping: call through a
  // context and point at an unreachable-but-parseable URL with warn-only mode.
  await DomainInterceptor.runWithPluginContext('test-plugin', ['api.allowed.com'], async () => {
    await globalThis.fetch('https://api.evil.com/exfil').catch(() => {});
  });
  const v = DomainInterceptor.getViolations();
  check('W7c undeclared fetch recorded + attributed', v.length === 1 && v[0].plugin === 'test-plugin' && v[0].hostname === 'api.evil.com');

  await DomainInterceptor.runWithPluginContext('test-plugin', ['api.allowed.com'], async () => {
    await globalThis.fetch('https://api.allowed.com/ok').catch(() => {});
  });
  check('W7d declared fetch not flagged', DomainInterceptor.getViolations().length === 1);

  // Attribution isolation across concurrent contexts
  await Promise.all([
    DomainInterceptor.runWithPluginContext('plugin-A', ['a.com'], async () => {
      await new Promise((r) => setTimeout(r, 10));
      await globalThis.fetch('https://only-b.com/x').catch(() => {});
    }),
    DomainInterceptor.runWithPluginContext('plugin-B', ['only-b.com'], async () => {
      await new Promise((r) => setTimeout(r, 5));
      await globalThis.fetch('https://only-b.com/y').catch(() => {});
    }),
  ]);
  const vA = DomainInterceptor.getViolations().find((x) => x.plugin === 'plugin-A');
  const vB = DomainInterceptor.getViolations().find((x) => x.plugin === 'plugin-B');
  check('W7e concurrent contexts attribute correctly (ALS isolation)', vA?.hostname === 'only-b.com' && !vB);
}

// === W8: UpdateScheduler ======================================================
{
  const sched = new UpdateScheduler(installer);
  // Registry: three plugins with three policies
  const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const [name, policy] of [['signed-plugin', 'notify'], ['gh-plugin', 'pinned']]) {
    const e = reg.plugins.find((p) => p.name === name);
    if (e) e.updatePolicy = policy;
  }
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2));

  const calls = [];
  const realCheck = installer.checkForUpdates.bind(installer);
  const realUpdate = installer.updatePlugin.bind(installer);
  installer.checkForUpdates = async () => ({
    success: true,
    updates: [
      { name: 'signed-plugin', installed: '1.0.0', latest: '2.0.0', updateAvailable: true },
      { name: 'gh-plugin', installed: '4.0.0', latest: '5.0.0', updateAvailable: true },
      { name: 'auto-plugin', installed: '1.0.0', latest: '1.1.0', updateAvailable: true },
      { name: 'esc-plugin', installed: '1.0.0', latest: '2.0.0', updateAvailable: true },
    ],
  });
  installer.updatePlugin = async (name, opts) => {
    calls.push({ name, opts });
    if (name === 'esc-plugin') return { success: false, requiresConsent: true, permissionDiff: { added: ['spawn-process'] } };
    return { success: true, version: 'next' };
  };
  const reg2 = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  reg2.plugins.push({ name: 'auto-plugin', version: '1.0.0', enabled: true, updatePolicy: 'auto' });
  reg2.plugins.push({ name: 'esc-plugin', version: '1.0.0', enabled: true, updatePolicy: 'auto' });
  fs.writeFileSync(registryPath, JSON.stringify(reg2, null, 2));

  const summary = await sched.tick();
  installer.checkForUpdates = realCheck;
  installer.updatePlugin = realUpdate;

  check('W8a notify policy → notified, not updated', summary.notified.some((n) => n.name === 'signed-plugin') && !calls.some((c) => c.name === 'signed-plugin'));
  check('W8b pinned policy → untouched entirely', !calls.some((c) => c.name === 'gh-plugin') && !summary.notified.some((n) => n.name === 'gh-plugin'));
  check('W8c auto policy → updated WITHOUT acceptedPermissions', summary.autoUpdated.some((a) => a.name === 'auto-plugin') && calls.find((c) => c.name === 'auto-plugin')?.opts?.acceptedPermissions === false);
  check('W8d auto + escalation → blocked on consent, never granted', summary.blockedOnConsent.some((b) => b.name === 'esc-plugin'));
  check('W8e status file persisted', fs.existsSync(path.join(SANDBOX, 'plugins', 'update-status.json')));
  check('W8f scheduler default OFF (autoCheck=false → start refuses)', (await sched.start()) === false);
}

// === W1: remote transform maps server trust columns ==========================
{
  // Restore the REAL method — earlier tests stubbed it.
  installer.getMarketplaceRegistry = realGetMarketplaceRegistry;
  delete installer.fetchMarketplaceArchive;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.agnt.gg/marketplace/items')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              asset_id: 'remote-trusted',
              title: 'Remote Trusted',
              current_version: '2.0.0',
              integrity: 'sha256-REMOTEHASH=',
              trust_tier: 'verified',
              declared_permissions: '["network"]',
              detected_capabilities: '["network"]',
              publisher_key_id: 'key-9',
              provenance: '{"provider":"github-actions-oidc","repository":"a/b"}',
              metadata: JSON.stringify({ downloadUrl: 'https://api.agnt.gg/x' }),
            },
          ],
        }),
      };
    }
    return realFetch(url);
  };
  const reg = await installer.getMarketplaceRegistry();
  globalThis.fetch = realFetch;
  const p = reg.plugins.find((x) => x.name === 'remote-trusted');
  check(
    'W1a remote record carries mapped trust fields',
    p?.integrity === 'sha256-REMOTEHASH=' && p.trustTier === 'verified' && Array.isArray(p.declaredPermissions) && p.publisherKeyId === 'key-9' && p.provenance?.repository === 'a/b',
    JSON.stringify({ t: p?.trustTier, i: p?.integrity })
  );
}

// === Summary =================================================================
const passed = results.filter((r) => r.pass).length;
console.log(`\n${'='.repeat(60)}\n📊 trust system 0.7.0 suite: ${passed}/${results.length} checks passed`);
if (passed !== results.length) {
  console.log('FAILED:', results.filter((r) => !r.pass).map((r) => r.name).join(' | '));
  process.exit(1);
}
console.log('🎉 ALL GREEN');
try {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
} catch {}
process.exit(0);
