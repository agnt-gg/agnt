/**
 * Sidebar navigation across the main sections.
 *
 * Four real route transitions, each asserting BOTH the URL and the active
 * state — the same shape as the Electron original, against the sidebar that
 * actually ships. The original addressed `.primary-nav-button` /
 * `.secondary-nav-button`, which belong to a navigation component CanvasScreen
 * replaced; those selectors had been matching nothing for months and, with
 * nothing running the spec, nothing said so.
 *
 * Addressed by `data-tour-id` rather than by CSS class: the guided-tour system
 * targets these same ids, so they cannot be renamed without breaking a
 * user-visible feature. A hook something else depends on is a hook that stays
 * true.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

test.describe('Navigation', () => {
  test('can navigate to major application views using sidebar @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/');

    const go = async (sectionId, expectedUrlPart) => {
      const button = appPage.locator(`[data-tour-id="sidebar.${sectionId}"]`);
      await button.click();
      await appPage.waitForURL(`**/${expectedUrlPart}`);
      await expect(button).toHaveClass(/active/);
    };

    await go('chat', 'chat');
    await go('tools', 'tools');
    await go('agents', 'agents');
    await go('settings', 'settings');
  });
});
