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
    // Without this, electron-builder emits NO latest.yml — and with no feed the
    // installers are just files nobody is ever told about.
    const publish = [].concat(pkg.build?.publish ?? []);
    expect(publish.length, 'build.publish is missing — no update feed is generated').toBeGreaterThan(0);
    expect(publish[0].provider).toBe('github');
    expect(publish[0].owner).toBe('agnt-gg');
    expect(publish[0].repo).toBe('agnt');
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

  it('publishes the release instead of drafting it', () => {
    // electron-updater reads the latest PUBLISHED release. A draft is
    // invisible to it, so clients keep reporting themselves up to date.
    expect(workflow).toMatch(/draft:\s*false/);
    expect(workflow).not.toMatch(/draft:\s*true/);
  });

  it('releases every tag it builds', () => {
    // The build job triggers on `v*.*.*` AND `*.*.*`, so gating the release job
    // on `refs/tags/v` meant a bare `0.6.8` tag built three platforms and
    // published nothing.
    expect(workflow).toMatch(/startsWith\(github\.ref, 'refs\/tags\/'\)/);
    expect(workflow).not.toMatch(/startsWith\(github\.ref, 'refs\/tags\/v'\)/);
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

  it('asks the backend for the executing-goal count instead', () => {
    expect(main).toMatch(/\/api\/goals\/health/);
  });

  it('ANTI-VACUITY: the interlock still exists', () => {
    // If countExecutingGoals were deleted outright, the two rules above would
    // pass while the protection was gone.
    expect(main).toMatch(/countExecutingGoals/);
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
