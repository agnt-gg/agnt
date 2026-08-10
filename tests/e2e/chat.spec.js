/**
 * The chat input is reachable and interactive.
 *
 * Deliberately does not send: submitting would need the chat API mocked, and
 * that is covered far more thoroughly by the unit suites. What this proves is
 * the thing only a browser can — the screen renders far enough to type into.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

test.describe('Chat Feature', () => {
  test('can type in the chat input @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/');
    await appPage.locator('[data-tour-id="sidebar.chat"]').click();
    await appPage.waitForURL('**/chat');

    const input = appPage.locator('.chat-input-textarea').first();
    await expect(input).toBeVisible({ timeout: 30000 });

    await input.fill('Hello AGNT Test');
    await expect(input).toHaveValue('Hello AGNT Test');
  });
});
