// Reported 2026-10-09 on a Mac, in Focused: the red window button sat alone in
// the top-right corner and yellow and green at the far left. A bare "close" class
// met the global button.close rule (absolute, top 0, right 0) and the group had
// order: -1. jsdom has no layout, so the positions are pinned here, in a real
// browser posing as the macOS desktop app, for Focused and Studio alike.
import { test, expect, gotoApp } from './fixtures/appFixture.js';

test.beforeEach(async ({ appPage }) => {
  await appPage.setViewportSize({ width: 1440, height: 900 });
  await appPage.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel', configurable: true });
    // Stand-in for preload.js's bridge: window buttons render only in the app.
    const call = () => Promise.resolve(null);
    const surface = () => new Proxy({}, { get: (_, key) => (key === 'then' ? undefined : String(key).startsWith('on') ? () => () => {} : call) });
    const nested = new Set(['browserBridge', 'connection', 'spaces', 'autoUpdate']);
    window.electron = new Proxy({}, {
      get: (_, key) => (key === 'then' ? undefined : nested.has(key) ? surface() : String(key).startsWith('on') ? () => () => {} : call),
    });
  });
});

const setMode = (page, mode) => page.evaluate((value) => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('theme/setUiMode', value), mode);

/** Red, yellow, green: left to right, one row, together, in the top-right corner. */
async function expectTopRightTrafficLights(page, buttons) {
  const boxes = [];
  for (const button of buttons) {
    await expect(button).toBeVisible();
    boxes.push(await button.boundingBox());
  }
  const [red, yellow, green] = boxes;
  expect(red.x).toBeLessThan(yellow.x);
  expect(yellow.x).toBeLessThan(green.x);
  for (const box of boxes) {
    expect(box.x).toBeGreaterThan(1440 - 120); // the right edge, not the sidebar side
    expect(Math.abs(box.y - red.y)).toBeLessThanOrEqual(2); // one row
  }
  expect(green.x - red.x).toBeLessThan(60); // together, not spread across the bar
}

test('macOS Focused: the window buttons sit together in the top-right corner @ci', async ({ appPage: page }) => {
  await gotoApp(page, '/chat');
  await setMode(page, 'focused');
  const bar = page.locator('[data-testid="focused-window-controls"]');
  await expect(bar).toHaveClass(/mac/);
  await expectTopRightTrafficLights(page, ['Close window', 'Minimize window', 'Maximize window'].map((name) => bar.getByRole('button', { name })));
});

test('macOS Studio: the window buttons sit together in the top-right corner @ci', async ({ appPage: page }) => {
  await gotoApp(page, '/chat');
  await setMode(page, 'studio');
  await expectTopRightTrafficLights(page, ['.cv-mac-close', '.cv-mac-minimize', '.cv-mac-maximize'].map((cls) => page.locator(`.cv-mac-controls ${cls}`)));
});
