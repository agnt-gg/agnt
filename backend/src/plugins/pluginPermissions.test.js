import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import tar from 'tar';

import PluginInstaller from './PluginInstaller.js';
import { grantedPermissionsForEntry, newlyRequestedPermissions } from './pluginPermissions.js';
import { effectivePermissions } from '../../plugins/lib/validate-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Declaring capabilities is OPTIONAL — omitting it must not buy an exemption.
 *
 * WHY THIS EXISTS
 * ---------------
 * `grantedPermissions` was set to the author's manifest declaration alone, and
 * the update consent gate diffed against that. Measured on the live catalog
 * 2026-07-29: 17 of 18 published plugins declared nothing, so `granted` was
 * `[]`, `added` was always `[]`, and the gate — the only real security control
 * on an update — could never fire for 94% of the catalog.
 *
 * ice-crawler runs spawn-process, env-access, network and filesystem and
 * declares none of them; its next version could have added anything and the
 * swap would have happened silently. Meanwhile buzz-cli-plugin, the one author
 * who declared properly, was the only plugin the gate applied to. The
 * incentive was exactly inverted.
 *
 * The fix is to derive: effective = declared ∪ detected. These tests pin both
 * halves — that the derivation happens, and that the gate still fires on
 * genuine escalation afterwards.
 */
describe('effectivePermissions — declaration is optional, omission is not an exemption', () => {
  it('derives the full set from the scan when the author declared nothing', () => {
    // ice-crawler's real shape.
    const detected = { 'spawn-process': [], 'env-access': [], network: [], filesystem: [] };
    expect(effectivePermissions(undefined, detected)).toEqual(['env-access', 'filesystem', 'network', 'spawn-process']);
  });

  it('keeps declared entries the scan cannot see', () => {
    // node_modules is in SCAN_SKIP_DIRS, so a capability reached through a
    // bundled dependency is invisible to the scan. The declaration is the only
    // evidence we have for it, which is why this is a union and not scan-only.
    const effective = effectivePermissions({ capabilities: ['filesystem'] }, { network: [] });
    expect(effective).toEqual(['filesystem', 'network']);
  });

  it('preserves intent-only domain entries, which are unscannable', () => {
    const effective = effectivePermissions({ capabilities: ['network'], domains: ['api.example.com'] }, { network: [] });
    expect(effective).toEqual(['domain:api.example.com', 'network']);
  });

  it('is a no-op when the author already declared everything detected', () => {
    // buzz-cli-plugin: the one honest author must not be penalised or changed.
    const declared = ['env-access', 'filesystem', 'network', 'spawn-process'];
    const detected = { 'spawn-process': [], filesystem: [], 'env-access': [] };
    expect(effectivePermissions(declared, detected)).toEqual(declared);
  });

  it('accepts both manifest permission shapes', () => {
    const asArray = effectivePermissions(['network'], {});
    const asObject = effectivePermissions({ capabilities: ['network'] }, {});
    expect(asArray).toEqual(['network']);
    expect(asObject).toEqual(['network']);
  });

  it('returns an empty set for a package that genuinely needs nothing', () => {
    // Must not manufacture permissions — a clean plugin stays clean.
    expect(effectivePermissions(null, {})).toEqual([]);
  });

  it('is deterministic and deduplicated', () => {
    const once = effectivePermissions(['network', 'network'], { network: [], filesystem: [] });
    expect(once).toEqual(['filesystem', 'network']);
    expect(effectivePermissions(['filesystem', 'network'], { network: [] })).toEqual(once);
  });
});

describe('grantedPermissionsForEntry — no consent-prompt wave on legacy installs', () => {
  it('unions a pre-derivation entry with what was disclosed at install', () => {
    // The install-consent modal listed the detected capabilities with
    // file:line evidence and the user proceeded, so this is what they actually
    // agreed to. Reading grantedPermissions alone would re-prompt for all of
    // it on the next update.
    const legacy = { name: 'ice-crawler', grantedPermissions: [], detectedCapabilities: ['spawn-process', 'network'] };
    expect(grantedPermissionsForEntry(legacy)).toEqual(['network', 'spawn-process']);
  });

  it('is a no-op once the entry was written by the derived path', () => {
    const modern = { grantedPermissions: ['filesystem', 'network'], detectedCapabilities: ['filesystem', 'network'] };
    expect(grantedPermissionsForEntry(modern)).toEqual(['filesystem', 'network']);
  });

  it('keeps a declared permission the scan no longer detects', () => {
    // Never silently revoke: a grant the user gave is not ours to drop.
    const entry = { grantedPermissions: ['domain:api.example.com'], detectedCapabilities: ['network'] };
    expect(grantedPermissionsForEntry(entry)).toEqual(['domain:api.example.com', 'network']);
  });

  it('tolerates a missing entry and malformed fields', () => {
    // rebuildRegistry reconstructs entries from disk and has historically lost
    // trust fields; this must degrade to "nothing granted", never throw.
    expect(grantedPermissionsForEntry(null)).toEqual([]);
    expect(grantedPermissionsForEntry({})).toEqual([]);
    expect(grantedPermissionsForEntry({ grantedPermissions: 'network' })).toEqual([]);
    expect(grantedPermissionsForEntry({ detectedCapabilities: { network: [] } })).toEqual(['network']);
  });
});

describe('newlyRequestedPermissions — the gate still fires on real escalation', () => {
  it('fires when an update adds a capability the user never accepted', () => {
    const granted = grantedPermissionsForEntry({ grantedPermissions: [], detectedCapabilities: ['network'] });
    const requested = effectivePermissions(undefined, { network: [], 'spawn-process': [] });
    expect(newlyRequestedPermissions(requested, granted)).toEqual(['spawn-process']);
  });

  it('stays silent when the update requests nothing new', () => {
    const granted = grantedPermissionsForEntry({ grantedPermissions: [], detectedCapabilities: ['network', 'filesystem'] });
    const requested = effectivePermissions(undefined, { network: [], filesystem: [] });
    expect(newlyRequestedPermissions(requested, granted)).toEqual([]);
  });

  it('THE BUG: an undeclared escalation used to be invisible, and now is not', () => {
    // Before: granted = declared = [], requested = declared = [] -> added = []
    // and a plugin could silently start spawning processes on update.
    const legacyGate = [].filter((p) => ![].includes(p));
    expect(legacyGate).toEqual([]);

    const granted = grantedPermissionsForEntry({ grantedPermissions: [], detectedCapabilities: ['network'] });
    const requested = effectivePermissions(undefined, { network: [], 'spawn-process': [], 'dynamic-eval': [] });
    expect(newlyRequestedPermissions(requested, granted)).toEqual(['dynamic-eval', 'spawn-process']);
  });

  it('does not re-prompt for a capability that merely became declared', () => {
    // An author adding an honest permissions block for what the scan already
    // found must not cost their users a consent prompt.
    const granted = grantedPermissionsForEntry({ grantedPermissions: [], detectedCapabilities: ['network'] });
    const requested = effectivePermissions(['network'], { network: [] });
    expect(newlyRequestedPermissions(requested, granted)).toEqual([]);
  });
});

/**
 * End-to-end through the real stagedInstall with a real .agnt package. The
 * pure functions above prove the rule; this proves the installer actually
 * applies it, which is the half a unit test cannot see.
 */
describe('stagedInstall derives permissions from a real package', () => {
  let workDir;
  let archivePath;
  const PLUGIN = 'perm-derivation-probe';

  beforeAll(async () => {
    // initializePlugins() creates these at boot; this suite calls stagedInstall
    // directly against an isolated USER_DATA_PATH, so the swap target's parent
    // has to exist or atomicSwap fails with ENOENT.
    await fs.mkdir(PluginInstaller.pluginsDir, { recursive: true });
    await fs.mkdir(PluginInstaller.tempDir, { recursive: true });

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-probe-'));
    const pkgDir = path.join(workDir, PLUGIN);
    await fs.mkdir(pkgDir, { recursive: true });

    // Declares NO permissions block at all — the shape 17 of 18 published
    // plugins actually have.
    await fs.writeFile(
      path.join(pkgDir, 'manifest.json'),
      JSON.stringify(
        {
          name: PLUGIN,
          version: '1.0.0',
          description: 'Fixture that uses capabilities without declaring them.',
          tools: [{ type: 'perm_probe', entryPoint: 'index.js', description: 'probe', schema: { type: 'object', properties: {} } }],
        },
        null,
        2
      )
    );
    // Real capability usage the scanner must detect.
    await fs.writeFile(
      path.join(pkgDir, 'index.js'),
      [
        "import { execFile } from 'child_process';",
        "import fs from 'fs/promises';",
        'export async function execute() {',
        "  await fetch('https://example.test/ping');",
        "  await fs.writeFile('/tmp/x', String(process.env.HOME));",
        "  execFile('echo', ['hi']);",
        '  return { ok: true };',
        '}',
      ].join('\n')
    );

    archivePath = path.join(workDir, `${PLUGIN}.agnt`);
    await tar.create({ gzip: true, file: archivePath, cwd: workDir }, [PLUGIN]);
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(PluginInstaller.pluginsDir, PLUGIN), { recursive: true, force: true }).catch(() => {});
  });

  it('grants the scanned capabilities even though the manifest declares none', async () => {
    let payload = null;
    const staged = await PluginInstaller.stagedInstall(archivePath, PLUGIN, {
      integrityState: 'tofu',
      integrity: 'sha256-fixture',
      beforeSwap: async (received) => {
        payload = received;
      },
    });

    // Anti-vacuity: if the scanner found nothing, every assertion below would
    // pass against an empty set and prove nothing.
    expect(staged.registryFields.detectedCapabilities.length).toBeGreaterThanOrEqual(3);

    expect(payload).not.toBeNull();
    expect(payload.declaredPermissions).toEqual([]); // the author really declared nothing
    expect(payload.effectivePermissions).toEqual(expect.arrayContaining(['network', 'filesystem', 'spawn-process', 'env-access']));
    expect(payload.undeclared.length).toBeGreaterThan(0); // still reported, just not penalised

    // The registry records the derived set, so the next update has something
    // real to diff against.
    expect(staged.registryFields.grantedPermissions).toEqual(payload.effectivePermissions);
    expect(staged.registryFields.grantedPermissions).not.toEqual([]);

    // And the badge no longer punishes the missing block.
    expect(staged.registryFields.trustTier).toBe('community');
  });
});

/**
 * WIRING. The original defect was that a correct rule was applied to the wrong
 * input — the same class as a policy nothing calls. Unit-testing the helpers
 * cannot see which value the gate reads, so assert it in the source.
 */
describe('wiring: the consent gate reads the derived set, not the raw declaration', () => {
  let source;

  beforeAll(async () => {
    source = await fs.readFile(path.join(__dirname, 'PluginInstaller.js'), 'utf8');
  });

  it('imports the derivation and the registry helper', () => {
    expect(source).toMatch(/effectivePermissions/);
    expect(source).toMatch(/from '\.\/pluginPermissions\.js'/);
  });

  it('stagedInstall grants the effective set, never the bare declaration', () => {
    expect(source).toMatch(/grantedPermissions: effective,/);
    expect(source).not.toMatch(/grantedPermissions: declared,/);
  });

  it('every beforeSwap gate destructures effectivePermissions', () => {
    const gates = [...source.matchAll(/beforeSwap: async \(\{([^}]*)\}\)/g)].map((m) => m[1]);
    // Anti-vacuity: there are two gates (updatePlugin and installFromGitHub).
    expect(gates.length).toBe(2);
    for (const gate of gates) expect(gate).toMatch(/effectivePermissions/);
  });

  it('no gate still diffs against the raw declaration', () => {
    expect(source).not.toMatch(/declaredPermissions\.filter\(\(p\) => !granted\.includes\(p\)\)/);
  });

  it('both gates read granted through the legacy-aware helper', () => {
    const uses = [...source.matchAll(/grantedPermissionsForEntry\(/g)];
    expect(uses.length).toBe(2);
    // The raw read would silently reintroduce the prompt wave.
    expect(source).not.toMatch(/\?\.grantedPermissions \|\| \[\]/);
  });
});
