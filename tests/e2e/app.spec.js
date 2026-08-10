/**
 * The app boots and mounts.
 *
 * Thin, but not nothing: it is the canary for "the bundle is broken" or "the
 * session gate rejected us", both of which fail every other spec in confusing
 * ways. Keeping it first means those produce one obvious failure instead of six.
 *
 * NOTE ON #app: the original asserted it was VISIBLE. In the canvas layout the
 * root div carries no box of its own, so Playwright correctly reports it
 * hidden while the app is plainly on screen. Visibility of something the user
 * can actually see is asserted by gotoApp (the sidebar); what belongs here is
 * that Vue mounted into the root at all.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

test.describe('Application Launch', () => {
  test('app loads and mounts the shell @ci', async ({ appPage }, testInfo) => {
    await gotoApp(appPage, '/');

    // The HTML title, which the Electron window title used to override.
    expect(await appPage.title()).toBe('AGNT.gg');

    // Mounted: Vue sets data-v-app on the root it takes over.
    const root = appPage.locator('#app');
    await expect(root).toBeAttached();
    await expect(root).toHaveAttribute('data-v-app', '');

    await appPage.screenshot({ path: testInfo.outputPath('initial-launch.png') });
  });
});
