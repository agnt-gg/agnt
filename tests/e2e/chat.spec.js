/**
 * The chat input is reachable and interactive.
 *
 * Deliberately does not send: submitting would need the chat API mocked, and
 * that is covered far more thoroughly by the unit suites. What this proves is
 * the thing only a browser can — the screen renders far enough to type into.
 *
 * The input is locked until the account has an AI provider
 * (Chat.vue `:disableInputInitially="!hasConnectedAIProvider"`). The e2e
 * account has none, so the first version of this spec passed only when it
 * typed before the provider check answered, and failed whenever it did not.
 * Both states are now asserted on purpose, each from a known account.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function withConnectedProvider(page) {
  await page.route('**/api/users/settings', (route) => {
    if (route.request().method() !== 'GET') return route.fulfill(json({ success: true }));
    return route.fulfill(json({ selectedProvider: 'openai-codex', selectedModel: 'test-model', routingMode: 'static' }));
  });
  await page.route('**/api/auth/connected', (route) => route.fulfill(json(['OpenAI-Codex'])));
  await page.route('**/api/custom-providers', (route) => route.fulfill(json({ providers: [] })));
  await page.route('**/api/models/*/models', (route) => route.fulfill(json({ models: ['test-model'] })));
  await page.route('http://127.0.0.1:1234/**', (route) => route.fulfill(json({ data: [] })));
}

test.describe('Chat Feature', () => {
  test('can type in the chat input @ci', async ({ appPage }) => {
    await withConnectedProvider(appPage);
    await gotoApp(appPage, '/');
    await appPage.locator('[data-tour-id="sidebar.chat"]').click();
    await appPage.waitForURL('**/chat');

    const input = appPage.locator('.chat-input-textarea').first();
    await expect(input).toBeVisible({ timeout: 30000 });
    await expect(input).toBeEnabled({ timeout: 30000 });

    await input.fill('Hello AGNT Test');
    await expect(input).toHaveValue('Hello AGNT Test');
  });

  // Since d916cc445 a signed-in account always has AGNT Flash, so the
  // "connect a provider" lock is for signed-out visitors only. A selected
  // provider that is not connected must never lock a signed-in user out.
  test('a signed-in account with nothing connected can still chat (AGNT Flash), never the connect lock @ci', async ({ appPage }) => {
    // Every input to Chat.vue hasConnectedAIProvider, pinned: a selected
    // provider with nothing connected, no custom provider, no local server.
    // store/auth/appAuth.js fetchConnectedApps merges THREE lanes (local
    // backend, remote agnt.gg, CLI status probes), and pinning only the local
    // one passed on this machine and failed in CI, where another lane
    // reported the provider connected. All three are pinned empty here.
    await appPage.route('**/api/users/settings', (route) => {
      if (route.request().method() !== 'GET') return route.fulfill(json({ success: true }));
      return route.fulfill(json({ selectedProvider: 'openai', selectedModel: 'gpt-test', routingMode: 'static' }));
    });
    await appPage.route(/\/auth\/connected(\?|$)/, (route) => route.fulfill(json([])));
    await appPage.route(/\/api\/providers\/[^/]+\/auth\/status(\?|$)/, (route) => route.fulfill(json({ available: false, apiUsable: false })));
    await appPage.route('**/api/custom-providers', (route) => route.fulfill(json({ providers: [] })));
    await appPage.route('http://127.0.0.1:1234/**', (route) => route.abort());
    await gotoApp(appPage, '/chat');
    await expect.poll(() => appPage.evaluate(() => localStorage.getItem('selectedProvider')), { timeout: 30000 }).toMatch(/^openai$/i);
    const input = appPage.locator('.chat-input-textarea').first();
    await expect(input).toBeVisible({ timeout: 30000 });
    await expect(input).toBeEnabled();
    await expect(input).not.toHaveAttribute('placeholder', 'Connect a provider to start chatting...');
    await expect(appPage.locator('.setup-message')).toHaveCount(0);
  });
});
