/**
 * Regression guard: the thumbnail-capture browser launch args.
 *
 * ROOT CAUSE PINNED (2026-08-04): `--window-position=-32000,-32000` +
 * `--window-size=1,1` in headless 'shell' mode stall compositor frame
 * production for every page AFTER the first on the persistent capture
 * browser. Page.captureScreenshot then waits forever for a frame, hits
 * protocolTimeout (60s), and the retry/fallback path produced grey/blank
 * thumbnails — misattributed by users to widget CSS (opacity fades widened
 * the race window on page 1 too). Empirically: with the args, page 2+ hung
 * 100% of 4/4 sequential captures; without them, 16/16 cases (opacity,
 * transitions, animations, backdrop-filter, WebGL, rAF canvas) captured
 * correctly in 20-70ms each across two rounds on one shared browser.
 *
 * This test reads the source rather than launching Chrome so it runs in CI
 * in milliseconds and fails the moment someone re-adds a window-geometry
 * flag "for safety".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'WidgetDefinitionService.js'), 'utf8');

describe('WidgetDefinitionService thumbnail browser launch args', () => {
  it('never passes window-geometry flags to the headless shell browser', () => {
    // Window geometry args are meaningless in headless 'shell' mode and a
    // 1x1/off-screen window kills frame production for page 2+ (grey thumbnails).
    // Match the QUOTED arg form only, so the warning comment in the source
    // (which names the flags in prose) doesn't trip the guard.
    expect(source).not.toMatch(/['"`]--window-position/);
    expect(source).not.toMatch(/['"`]--window-size/);
  });

  it('still uses headless shell mode (the window-flash fix the geometry args were guarding)', () => {
    // headless: 'shell' is the actual fix for the Chrome 132+/Windows visible
    // window regression. If this changes to 'new'/true, re-verify no window
    // flashes on Windows — but do NOT bring the geometry args back.
    expect(source).toMatch(/headless:\s*'shell'/);
  });

  it('keeps the swiftshader WebGL stack for Three.js/canvas widgets', () => {
    expect(source).toMatch(/--use-angle=swiftshader/);
    expect(source).toMatch(/--enable-webgl/);
  });
});
