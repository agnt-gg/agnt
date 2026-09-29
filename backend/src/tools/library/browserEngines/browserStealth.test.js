/**
 * CONTRACT: a headless browser AGNT launches presents like the same browser
 * running headed — or, when that cannot be known honestly, changes nothing.
 *
 * The failure this guards against is specific and measured (2026-09-27):
 * `HeadlessChrome` in the User-Agent, navigator.webdriver, an 800x600 screen
 * and a software WebGL renderer got the hidden browser blocked on Home
 * Depot, Lowe's, Zillow, Walmart and Etsy.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  detectChromiumVersion, headedUserAgent, headlessPresentationFlags, headlessLaunchProfile,
  HEADLESS_WINDOW, _resetVersionCacheForTests,
} from './browserStealth.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-stealth-'));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
beforeEach(() => _resetVersionCacheForTests());

/** A fake Windows install: the executable plus sibling version directories. */
function fakeInstall(name, versions) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const v of versions) fs.mkdirSync(path.join(dir, v), { recursive: true });
  fs.mkdirSync(path.join(dir, 'SetupMetrics'), { recursive: true });
  const exe = path.join(dir, 'chrome.exe');
  fs.writeFileSync(exe, '');
  return exe;
}

describe('detectChromiumVersion (Windows install layout)', () => {
  it('reads the newest version directory beside the executable', () => {
    // Mid-update, Chrome keeps the old and new versions side by side; numeric
    // (not lexical) order matters: 154.0.10000.1 is newer than 154.0.9999.9.
    const exe = fakeInstall('chrome-a', ['153.0.7000.10', '154.0.9999.9', '154.0.10000.1']);
    expect(detectChromiumVersion(exe, { platform: 'win32' })).toBe('154.0.10000.1');
  });

  it('returns null rather than guessing when there is no version directory', () => {
    const exe = fakeInstall('chrome-none', []);
    expect(detectChromiumVersion(exe, { platform: 'win32' })).toBeNull();
  });

  it('refuses a version that cannot be a Chromium major (node.exe, stray folders)', () => {
    const exe = fakeInstall('not-chrome', ['22.16.0.0']);
    expect(detectChromiumVersion(exe, { platform: 'win32' })).toBeNull();
  });

  it('never throws for a path that does not exist', () => {
    expect(detectChromiumVersion(path.join(tmpRoot, 'nope', 'chrome.exe'), { platform: 'win32' })).toBeNull();
    expect(detectChromiumVersion('', { platform: 'win32' })).toBeNull();
  });
});

describe('headedUserAgent', () => {
  it('is exactly what headed Chrome sends: reduced UA, major only, no "Headless"', () => {
    expect(headedUserAgent({ key: 'chrome', version: '154.0.8037.57', platform: 'win32' }))
      .toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36');
  });

  it('uses the frozen platform token per OS', () => {
    expect(headedUserAgent({ key: 'chrome', version: '154.0.1.2', platform: 'darwin' })).toContain('(Macintosh; Intel Mac OS X 10_15_7)');
    expect(headedUserAgent({ key: 'chrome', version: '154.0.1.2', platform: 'linux' })).toContain('(X11; Linux x86_64)');
  });

  it('keeps Edge\'s own token, so Edge does not claim to be Chrome', () => {
    expect(headedUserAgent({ key: 'edge', version: '154.0.3000.1', platform: 'win32' })).toMatch(/Chrome\/154\.0\.0\.0 Safari\/537\.36 Edg\/154\.0\.0\.0$/);
  });

  it('declines browsers whose install version is not the Chromium version', () => {
    // Vivaldi 7.x and Opera 12x name folders after themselves; a Chrome/7 UA
    // would be a worse tell than the headless one.
    expect(headedUserAgent({ key: 'vivaldi', version: '7.5.3735.64' })).toBeNull();
    expect(headedUserAgent({ key: 'opera', version: '120.0.5543.61' })).toBeNull();
    expect(headedUserAgent({ key: 'chrome', version: null })).toBeNull();
  });
});

describe('headlessPresentationFlags', () => {
  it('turns off navigator.webdriver and gives a real desktop viewport', () => {
    const flags = headlessPresentationFlags({ userAgent: 'UA' });
    expect(flags).toContain('--disable-blink-features=AutomationControlled');
    expect(flags).toContain(`--window-size=${HEADLESS_WINDOW.width},${HEADLESS_WINDOW.height}`);
    expect(flags).toContain(`--screen-info={${HEADLESS_WINDOW.width}x${HEADLESS_WINDOW.height}}`);
    expect(flags).toContain('--user-agent=UA');
  });

  it('never disables the GPU — the software renderer is itself a fingerprint', () => {
    expect(headlessPresentationFlags({ userAgent: 'UA' })).not.toContain('--disable-gpu');
  });

  it('omits the User-Agent override when there is no honest one to give', () => {
    expect(headlessPresentationFlags({}).some((f) => f.startsWith('--user-agent'))).toBe(false);
  });
});

describe('headlessLaunchProfile', () => {
  it('ties the detected version to the flags the launcher uses', () => {
    const exe = fakeInstall('chrome-profile', ['154.0.8037.57']);
    const profile = headlessLaunchProfile({ executable: exe, key: 'chrome', platform: 'win32' });
    expect(profile.version).toBe('154.0.8037.57');
    expect(profile.userAgent).toContain('Chrome/154.0.0.0');
    expect(profile.flags).toContain(`--user-agent=${profile.userAgent}`);
  });
});
