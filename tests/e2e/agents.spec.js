/**
 * The agents list renders what the API returned.
 *
 * Assertion unchanged from the Electron version. What changed is how the app
 * is launched (see fixtures/appFixture.js) and how the sidebar is addressed:
 * `.primary-nav-button` / `.secondary-nav-button` belong to a navigation
 * component that CanvasScreen replaced, so those selectors had been matching
 * nothing since long before anyone noticed.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';
import { mockAgents } from './fixtures/auth.js';

test.describe('Agents Feature', () => {
  test('can navigate to agents and see the list @ci', async ({ appPage }) => {
    // Registered BEFORE the app boots: the screen fetches on mount, and a mock
    // installed after that races a request already in flight.
    await mockAgents(appPage);
    await gotoApp(appPage, '/');

    await appPage.locator('[data-tour-id="sidebar.agents"]').click();
    await appPage.waitForURL('**/agents');

    await expect(appPage.getByText('Test Agent 1')).toBeVisible();
    await expect(appPage.getByText('Test Agent 2')).toBeVisible();
  });
});
