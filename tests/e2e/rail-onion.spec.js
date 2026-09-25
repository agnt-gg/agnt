/**
 * The young account, in the running app.
 *
 * Every other spec signs in with an earned rail (appFixture `earnedRail`),
 * because they are about the screens, not about how the rail grows. This one
 * is about exactly that, so it starts from nothing:
 *
 *   - a brand-new account sees Chat and no other destination row
 *   - a guided tour that points at a row the account has not earned yet puts
 *     that row on the rail, so the popup has something to point at
 *     (frontend/src/services/tourReveal.js)
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

test.use({ earnedRail: false });

const EARNABLE = ['dashboard', 'goals', 'traces', 'artifacts', 'agents', 'workflows', 'tools', 'store'];

test.describe('the rail grows with the account', () => {
  test('a new account sees Chat, and no earnable row @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/');
    await expect(appPage.locator('[data-tour-id="sidebar.chat"]')).toBeVisible();
    for (const id of EARNABLE) {
      await expect(appPage.locator(`[data-tour-id="sidebar.${id}"]`), `sidebar.${id} on a new account`).toHaveCount(0);
    }
  });

  test('a guided tour at a locked row puts it on the rail and highlights it @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/');
    const tools = appPage.locator('[data-tour-id="sidebar.tools"]');
    await expect(tools).toHaveCount(0);

    await appPage.waitForFunction(() => typeof window.__aiTour?.start === 'function');
    await appPage.evaluate(() => window.__aiTour.start({
      tourId: 'e2e-locked-row',
      steps: [{ title: 'Tools', content: 'Your tools live here.', targetSelector: '[data-tour-id="sidebar.tools"]', position: 'right' }],
    }));

    await expect(tools).toBeVisible();
    await expect(appPage.getByText('Your tools live here.')).toBeVisible({ timeout: 10000 });

    // It stays, like an earned row, across a reload.
    await appPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(appPage.locator('[data-tour-id="sidebar.tools"]')).toBeVisible({ timeout: 60000 });
  });
});
