/**
 * CONTRACT for the launch-environment decision.
 *
 * Two properties, and the whole point is that they are SEPARATE:
 *
 *   - headless follows the DISPLAY. A machine with no window server cannot show
 *     a browser, and launching one headed there fails 30 seconds later with a
 *     message that blames the browser.
 *   - --no-sandbox follows the CONTAINER. It disables the boundary that
 *     contains a renderer compromise, on a browser that visits pages an LLM
 *     chose, so it is only ever paid where seccomp genuinely blocks the
 *     sandbox.
 *
 * The two get pasted together as one incantation constantly. A test that only
 * checked "headless in Docker" would pass against code that always sends both.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import {
  isContainerRuntime,
  hasDisplay,
  shouldRunHeadless,
  requiredChromeFlags,
  describeRuntime,
} from './browserRuntime.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => {
  delete process.env.AGNT_BROWSER_HEADLESS;
  delete process.env.AGNT_CONTAINER;
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(ORIGINAL_PLATFORM);
  process.env = { ...ORIGINAL_ENV };
});

describe('a desktop is left exactly as it was', () => {
  it('adds no flags on Windows', () => {
    setPlatform('win32');
    expect(requiredChromeFlags()).toEqual([]);
    expect(shouldRunHeadless()).toBe(false);
  });

  it('adds no flags on macOS', () => {
    setPlatform('darwin');
    expect(requiredChromeFlags()).toEqual([]);
  });

  it('adds no flags on Linux WITH a display', () => {
    setPlatform('linux');
    process.env.DISPLAY = ':0';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('0::/init.scope');
    expect(requiredChromeFlags()).toEqual([]);
  });

  it('counts Wayland as a display too', () => {
    setPlatform('linux');
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    expect(hasDisplay()).toBe(true);
    expect(shouldRunHeadless()).toBe(false);
  });
});

describe('no display means headless, container or not', () => {
  // MEASURED, NOT ASSUMED: WSL Ubuntu on the dev machine reports no DISPLAY,
  // no WAYLAND_DISPLAY, and `0::/init.scope` — genuinely not a container. A
  // "detect Docker" check would have handed it a headed launch that cannot
  // work. So would a headless VPS, a CI runner, and SSH with no X forwarding.
  it('goes headless on a display-less machine that is NOT a container', () => {
    setPlatform('linux');
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('0::/init.scope');

    expect(isContainerRuntime()).toBe(false);
    expect(hasDisplay()).toBe(false);
    expect(shouldRunHeadless()).toBe(true);

    const flags = requiredChromeFlags();
    expect(flags).toContain('--headless=new');
    // THE POINT OF THIS TEST: the sandbox is NOT given away here. There is no
    // container, so the sandbox works, and disabling it would be a security
    // downgrade bought for nothing.
    expect(flags).not.toContain('--no-sandbox');
  });

  it('pays the container price only inside a container', () => {
    setPlatform('linux');
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/.dockerenv');

    expect(isContainerRuntime()).toBe(true);
    const flags = requiredChromeFlags();
    expect(flags).toContain('--no-sandbox');
    // 64MB of /dev/shm is not enough for Chromium's renderer heaps, and running
    // out reads as a renderer crash several layers from the cause.
    expect(flags).toContain('--disable-dev-shm-usage');
  });

  it('recognises podman and kubernetes, not just docker', () => {
    setPlatform('linux');
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/run/.containerenv');
    expect(isContainerRuntime()).toBe(true);

    vi.restoreAllMocks();
    setPlatform('linux');
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('0::/kubepods/besteffort/pod123');
    expect(isContainerRuntime()).toBe(true);
  });

  it('a container WITH a display still gets the sandbox flag but no headless', () => {
    // An X-forwarded container is unusual and entirely legal. The two decisions
    // being separate is exactly what makes this case come out right.
    setPlatform('linux');
    process.env.DISPLAY = ':99';
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/.dockerenv');

    const flags = requiredChromeFlags();
    expect(flags).not.toContain('--headless=new');
    expect(flags).toContain('--no-sandbox');
  });
});

describe('the environment can overrule the detection', () => {
  it('forces headless on a machine that has a display', () => {
    setPlatform('linux');
    process.env.DISPLAY = ':0';
    process.env.AGNT_BROWSER_HEADLESS = '1';
    expect(shouldRunHeadless()).toBe(true);
  });

  it('forces headed on a machine that has none', () => {
    // The Xvfb case: a display exists but not in a variable we can see.
    setPlatform('linux');
    process.env.AGNT_BROWSER_HEADLESS = 'false';
    expect(shouldRunHeadless()).toBe(false);
  });

  it('treats an empty value as unset rather than as false', () => {
    setPlatform('linux');
    process.env.AGNT_BROWSER_HEADLESS = '';
    expect(shouldRunHeadless()).toBe(true); // falls through to detection
  });
});

describe('the decision is legible in a log', () => {
  it('names why a browser became invisible', () => {
    setPlatform('linux');
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/.dockerenv');
    expect(describeRuntime()).toBe('headless, containerised, no DISPLAY');
  });

  it('says so plainly on a desktop', () => {
    setPlatform('win32');
    expect(describeRuntime()).toBe('visible');
  });
});
