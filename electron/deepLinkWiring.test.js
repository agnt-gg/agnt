/**
 * Source-level contract for `agnt://`.
 *
 * deepLink.test.js proves the parser is correct. That is worth nothing if the
 * parser is never called, if the single-instance lock is dropped in a
 * refactor, or if the macOS listener drifts below `ready` — none of which any
 * unit test of the parser can see, and none of which fail loudly. They fail by
 * a link quietly doing nothing on one platform.
 *
 * Same approach and the same reason as mainWiring.test.js: an invariant nobody
 * can verify is an invariant that silently rots.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCREENS, ACTION_NAMES } from './deepLink.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Strip comments so a rule can never be satisfied by prose describing it.
 * This file documents its own design at length; without this, half the
 * assertions below would pass on the comments alone.
 *
 * THE EXCLUSION CLASS IS NOT DECORATIVE. `[^:]` keeps `http://` intact — the
 * well-known half. The quote characters are the half that bit: the source
 * being scanned contains `path.startsWith('//')`, and a stripper that only
 * guards against `:` treats the `//` INSIDE that string literal as a comment
 * and deletes the rest of the line. The assertion then fails against code that
 * is perfectly correct, which is the kind of false failure that gets a suite
 * loosened until it proves nothing. Pinned by the self-test below.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

describe('the stripper this file depends on', () => {
  it('removes real comments', () => {
    expect(strip('const a = 1; // gone\nconst b = 2;')).not.toMatch(/gone/);
    expect(strip('/* gone */ const a = 1;')).not.toMatch(/gone/);
  });

  it('leaves a // that lives inside a string or a URL', () => {
    expect(strip("if (p.startsWith('//')) return;")).toMatch(/startsWith\('\/\/'\)/);
    expect(strip('const u = "https://agnt.gg";')).toMatch(/https:\/\/agnt\.gg/);
  });
});

const main = strip(read('main.js'));
const preload = strip(read('preload.js'));
const router = strip(read('frontend/src/router/index.js'));
const bridge = strip(read('frontend/src/deepLinkRouting.js'));
const marketplace = strip(read('frontend/src/views/Terminal/CenterPanel/screens/Marketplace/Marketplace.vue'));
const nsis = read('build/installer.nsh'); // ';' comments — stripping JS comments would be wrong
const pkg = JSON.parse(read('package.json'));

describe('single instance', () => {
  it('requests the lock and leaves if it does not get it', () => {
    // Without this, every click on a link on Windows/Linux forks a second
    // backend that cannot bind 3333 and a second window fighting the first.
    expect(main).toMatch(/requestSingleInstanceLock\(\)/);
    expect(main).toMatch(/if\s*\(!gotTheLock\)\s*\{[\s\S]*?app\.exit\(0\)/);
  });

  it('exits rather than quits, because quit still fires ready', () => {
    // MEASURED in a standalone Electron harness, identified by pid: the
    // instance that lost the lock and called app.quit() went on to fire the
    // ready event milliseconds later. In this app ready forks the backend, so
    // app.quit() here means every link click briefly starts a second one.
    // app.exit(0) skips the quit sequence and ready never arrives.
    const losingBranch = main.slice(main.indexOf('if (!gotTheLock)'), main.indexOf('function handleDeepLink'));
    expect(losingBranch).toMatch(/app\.exit\(0\)/);
    expect(losingBranch).not.toMatch(/app\.quit\(\)/);
  });

  it('guards the ready handler too, in case the exit is ever softened', () => {
    const readyBody = main.slice(main.indexOf("app.on('ready'"));
    expect(readyBody.slice(0, 400)).toMatch(/if\s*\(!gotTheLock\)\s*return;/);
  });

  it('takes the lock before the backend is forked or a window is made', () => {
    // app.quit() only prevents those if it runs before 'ready'.
    const lockAt = main.indexOf('requestSingleInstanceLock');
    const readyAt = main.indexOf("app.on('ready'");
    expect(lockAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(readyAt);
  });
});

describe('the three ways a link arrives', () => {
  it('Windows/Linux, app already running: second-instance argv', () => {
    expect(main).toMatch(/app\.on\('second-instance'[\s\S]{0,200}deepLinkFromArgv\(argv\)/);
  });

  it('Windows/Linux, cold start: our own argv', () => {
    expect(main).toMatch(/deepLinkFromArgv\(process\.argv\)/);
  });

  it('macOS: open-url, with the default prevented', () => {
    expect(main).toMatch(/app\.on\('open-url'[\s\S]{0,160}event\.preventDefault\(\)/);
  });

  it('registers open-url BEFORE ready, because macOS can fire it first', () => {
    // THE TRAP THIS PINS: on a cold launch macOS delivers open-url before the
    // app is ready. A listener registered inside whenReady/ready misses the
    // very click that launched the app — silently, and only on a real signed
    // build, which is the worst combination for finding it late.
    const openUrlAt = main.indexOf("app.on('open-url'");
    const readyAt = main.indexOf("app.on('ready'");
    const whenReadyAt = main.indexOf('app.whenReady()');
    expect(openUrlAt).toBeGreaterThan(-1);
    expect(openUrlAt).toBeLessThan(readyAt);
    expect(openUrlAt).toBeLessThan(whenReadyAt);
  });
});

describe('delivery', () => {
  it('parses before doing anything with the URL', () => {
    expect(main).toMatch(/parseDeepLink\(raw\)/);
    // A refusal must return, not fall through into navigation.
    expect(main).toMatch(/if\s*\(!intent\.ok\)\s*\{[\s\S]{0,300}?return;/);
  });

  it('waits for a loading window rather than firing into the void', () => {
    // A window that exists but has not finished loading has no listener yet;
    // an immediate send is simply lost.
    expect(main).toMatch(/isLoading\(\)[\s\S]{0,120}did-finish-load/);
  });

  it('lands a cold start on the linked page instead of navigating after paint', () => {
    expect(main).toMatch(/takePendingIntent\(\)/);
    expect(main).toMatch(/intentToUrl\(origin,\s*intent\)/);
  });

  it('consumes the pending intent exactly once', () => {
    // Re-delivering on a later reload would drop the user back onto a page
    // they deep-linked to twenty minutes ago.
    expect(main).toMatch(/function takePendingIntent\(\)\s*\{[\s\S]*?pendingIntent\s*=\s*null;[\s\S]*?\}/);
  });

  it('claims the scheme on every launch', () => {
    expect(main).toMatch(/setAsDefaultProtocolClient\(SCHEME\)/);
    // Unpackaged, the registration must name the electron binary AND the app
    // directory or the OS launches a bare Electron with nothing to run.
    expect(main).toMatch(/setAsDefaultProtocolClient\(SCHEME,\s*process\.execPath,\s*\[/);
  });
});

describe('the renderer bridge', () => {
  it('is receive-only', () => {
    expect(preload).toMatch(/onDeepLink:/);
    expect(preload).toMatch(/ipcRenderer\.on\('deep-link'/);
    // No path for the renderer to originate or request a link.
    expect(preload).not.toMatch(/(send|invoke)\('deep-link'/);
  });

  it('returns an unsubscribe, like every other listener on this bridge', () => {
    expect(preload).toMatch(/removeListener\('deep-link'/);
  });

  it('refuses a protocol-relative path in the renderer too', () => {
    // `//evil.example` is a URL, not a route. Main already validates; this is
    // the layer that survives a future caller who does not.
    expect(bridge).toMatch(/startsWith\('\/\/'\)/);
  });
});

describe('every allowlisted screen is a real route', () => {
  const declared = new Set([...router.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));

  it('found the route table', () => {
    expect(declared.size).toBeGreaterThan(10);
    expect(declared.has('/marketplace')).toBe(true);
  });

  it.each(Object.entries(SCREENS))('%s → %s exists', (_name, routePath) => {
    // A route rename would otherwise leave a link that opens the app on a 404.
    expect(declared.has(routePath)).toBe(true);
  });

  it('excludes the phone shell and the oauth endpoint', () => {
    const values = Object.values(SCREENS);
    expect(values.some((p) => p === '/m' || p.startsWith('/m/'))).toBe(false);
    expect(values).not.toContain('/oauth-callback');
  });
});

describe('the marketplace screen honours a link', () => {
  it('reads ?item= on a cold arrival, after the listings load', () => {
    expect(marketplace).toMatch(/urlParams\.get\('item'\)/);
    expect(marketplace).toMatch(/openByAssetId\(deepLinkAssetId\)/);
  });

  it('watches the route for a warm arrival', () => {
    // The component does not remount when only the query changes, so without
    // this a link clicked while the app sits on /marketplace does nothing.
    expect(marketplace).toMatch(/route\.query\.item/);
  });

  it('matches on asset_id, not the listing id', () => {
    // Listing UUIDs change on delete-and-republish; asset ids never do, and
    // the links are compiled into static pages.
    expect(marketplace).toMatch(/asset_id === assetId/);
  });

  it('says so when nothing matches', () => {
    // Usually means "not published yet". Silence reads as a broken link.
    expect(marketplace).toMatch(/No listing found for/);
  });
});

describe('packaging', () => {
  it('declares the scheme for macOS and Linux', () => {
    // electron-builder turns this into CFBundleURLTypes and the desktop-file
    // MimeType respectively.
    expect(pkg.build.protocols).toEqual([{ name: 'AGNT', schemes: ['agnt'], role: 'Viewer' }]);
  });

  it('registers the scheme on Windows in the NSIS script', () => {
    // electron-builder does NOT honour build.protocols on Windows — there is
    // no reference to it anywhere in its nsis target — so this is the only
    // thing that associates the scheme at install time.
    expect(nsis).toMatch(/WriteRegStr HKCU "Software\\Classes\\agnt"/);
    expect(nsis).toMatch(/"URL Protocol"/);
    expect(nsis).toMatch(/shell\\open\\command/);
  });

  it('quotes %1, so a URL containing a space is not split across argv', () => {
    expect(nsis).toMatch(/'"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" "%1"'/);
  });

  it('removes the handler on uninstall, but only if it still points at us', () => {
    expect(nsis).toMatch(/!macro customUnInstall/);
    expect(nsis).toMatch(/DeleteRegKey HKCU "Software\\Classes\\agnt"/);
    expect(nsis).toMatch(/ReadRegStr \$R0 HKCU/);
  });

  it('ships deepLink.js and not its tests', () => {
    const files = pkg.build.files;
    expect(files).toContain('electron/**/*');
    expect(files).toContain('!electron/**/*.test.js');
  });
});

describe('the security posture, asserted rather than assumed', () => {
  it('has no verb that writes or executes anything', () => {
    // `install` belongs behind an in-app confirmation card; `run` has no
    // business being reachable from a URL at all. Adding either here is a
    // security decision, and this is the assertion that forces the discussion.
    expect(ACTION_NAMES).toEqual(['marketplace', 'open']);
  });

  it('never surfaces a refusal to the user', () => {
    // A dialog on a bad link teaches a hostile page it can make our app pop up
    // an alert on demand.
    expect(main).toMatch(/console\.warn\(`\[deep-link\] refused/);
    expect(main).not.toMatch(/dialog\.showMessageBox[\s\S]{0,120}deep-link/);
  });
});
