/**
 * The auto-update pipeline, as configuration.
 *
 * Every rule here is a place where the code is perfect and nothing updates
 * anyway, because a release artefact was missing or a flag was wrong. None of
 * these can be caught by running the app — they only show up as "nobody ever
 * gets the update", weeks later, silently.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(
  path.join(REPO_ROOT, '.github', 'workflows', 'electron-build.yml'),
  'utf8',
);

describe('the app can find an update at all', () => {
  it('declares a publish target', () => {
    // Without this, electron-builder emits NO latest.yml, and with no feed the
    // installers are just files nobody is ever told about. Since 0.6.7 the
    // target is agnt.gg's generic feed: it decides the version, GitHub holds
    // the files (electron/autoUpdate.js, agnt-server update-feed.js).
    const publish = [].concat(pkg.build?.publish ?? []);
    expect(publish.length, 'build.publish is missing: no update feed is generated').toBeGreaterThan(0);
    expect(publish[0]).toEqual({ provider: 'generic', url: 'https://agnt.gg/updates/stable/' });
  });

  it('pins downloads to this repository’s GitHub releases', () => {
    expect(pkg.agntUpdate?.assetBase).toBe('https://github.com/agnt-gg/agnt/releases/download/');
    expect(pkg.agntUpdate?.feedBase).toBe('https://agnt.gg/updates/');
  });

  it('ships electron-updater as a runtime dependency', () => {
    // A devDependency would be pruned out of the packaged app, and the import
    // in main.js would fail at launch on a user's machine and nowhere else.
    expect(pkg.dependencies?.['electron-updater']).toBeTruthy();
    expect(pkg.devDependencies?.['electron-updater']).toBeUndefined();
  });
});

describe('the release actually carries the feed', () => {
  it('uploads latest*.yml', () => {
    // This IS the feed. Omitting it was the single most likely way to ship a
    // release that every client ignores.
    expect(workflow).toMatch(/dist\/latest\*\.yml/);
  });

  it('uploads .blockmap so updates are deltas, not re-downloads', () => {
    // ~20-50 MB instead of ~300 MB. Without the blockmap every update is a
    // full installer download on someone's metered connection.
    expect(workflow).toMatch(/dist\/\*\.blockmap/);
  });

  it('drafts, verifies the draft, and only then publishes', () => {
    // v0.6.2-0.6.5 were published with zero assets. The release is uploaded
    // as a draft, checked against the validated manifest, then published.
    const create = workflow.indexOf('gh release create');
    const verify = workflow.indexOf('scripts/release/verify-release.mjs');
    const publish = workflow.indexOf('gh release edit "$TAG" --draft=false');
    expect(workflow).toMatch(/FLAGS=\(--draft /);
    expect(workflow).toMatch(/gh release create "\$TAG" release\/\* "\$\{FLAGS\[@\]\}"/);
    expect(create).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(create);
    expect(publish).toBeGreaterThan(verify);
    expect(workflow).toMatch(/scripts\/release\/release-manifest\.mjs/);
  });

  it('releases every tag it builds, and builds only tags it can release', () => {
    // A bare `0.6.8` tag used to build and publish nothing. Now only v-tags
    // trigger a build, because clients look under releases/download/v<version>/,
    // and the release job is gated on the same prefix.
    expect(workflow).toMatch(/tags:\s*\n(\s*#.*\n)*\s*- 'v\*\.\*\.\*'/);
    expect(workflow).not.toMatch(/- '\*\.\*\.\*'/);
    expect(workflow).toMatch(/if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  });

  it('builds each Mac architecture on its own runner and checks what it ships', () => {
    // v0.6.6's Intel zip held arm64 native modules from a single arm64 runner.
    expect(workflow).toMatch(/os: macos-15\s*\n\s*platform: mac\s*\n\s*arch: arm64/);
    expect(workflow).toMatch(/os: macos-15-intel\s*\n\s*platform: mac\s*\n\s*arch: x64/);
    expect(workflow).toMatch(/scripts\/release\/verify-artifacts\.mjs --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\}/);
    expect(workflow).toMatch(/scripts\/release\/merge-mac-feed\.mjs/);
  });

  it('does not build until the tests pass', () => {
    expect(workflow).toMatch(/build:\s*\n\s*name:[^\n]*\n\s*needs: test/);
  });
});

describe('Windows updates are possible without a code-signing certificate', () => {
  const win = pkg.build?.win ?? {};
  const nsis = pkg.build?.nsis ?? {};

  it('does not verify a signature that does not exist', () => {
    // The check compares the new installer's publisher against the running
    // app's. With neither signed there is nothing to compare, and leaving it on
    // fails EVERY Windows update. What still protects the payload is the sha512
    // in latest.yml plus HTTPS — see electron/autoUpdate.js.
    //
    // When a Windows certificate exists, delete this line rather than flipping
    // it: the default is the safe one.
    expect(win.verifyUpdateCodeSignature).toBe(false);
  });

  it('declares it where electron-builder accepts it', () => {
    // It belongs to `win`, not `nsis`. Put on the wrong block, electron-builder
    // 24 refuses the whole configuration with "unknown property" — which at
    // least fails loudly, before any packaging work.
    expect(nsis.verifyUpdateCodeSignature).toBeUndefined();
  });

  it('generates a differential package', () => {
    expect(nsis.differentialPackage).toBe(true);
  });
});

describe('main must not load a native module to decide about updating', () => {
  const main = fs.readFileSync(path.join(REPO_ROOT, 'main.js'), 'utf8');

  it('does not require sqlite3 in the main process', () => {
    // Requiring sqlite3 in Electron's main process ABORTS it — a native abort,
    // not an exception, so the try/catch around the goal check cannot contain
    // it. The first version of the update interlock did exactly this, which
    // meant pressing "Restart to update" would have killed AGNT instead of
    // updating it. Verified on Electron 33.4.11 against both the dev and the
    // packaged build of the module.
    expect(
      /(?:await import|require)\(\s*['"]sqlite3['"]\s*\)/.test(main),
      'main.js loads sqlite3 — this aborts the process; ask the backend over HTTP instead',
    ).toBe(false);
  });

  it('asks the backend what is running instead', () => {
    expect(main).toMatch(/\/api\/system\/busy/);
  });

  it('ANTI-VACUITY: the interlock still exists and is wired', () => {
    // If getBusyReport were deleted outright, the two rules above would pass
    // while the protection was gone.
    expect(main).toMatch(/async function getBusyReport\(/);
    expect(main).toMatch(/getBusyReport,\s*\n\s*handoffBackend,/);
  });
});

describe('the changelog does not claim what does not exist', () => {
  it('no longer advertises auto-update as a shipped v0.3.3 feature', () => {
    // releases.json listed "Auto-Update System" under v0.3.3 while the app
    // could only ever open a browser at the downloads page. It was false for
    // five versions. What shipped then was the NOTIFIER.
    const releases = fs.readFileSync(path.join(REPO_ROOT, 'releases.json'), 'utf8');
    expect(releases).not.toMatch(/Auto-Update System/i);
  });

  it('ANTI-VACUITY: releases.json is real and still describes that version', () => {
    const releases = fs.readFileSync(path.join(REPO_ROOT, 'releases.json'), 'utf8');
    expect(releases).toMatch(/Update Notifications/);
  });
});
