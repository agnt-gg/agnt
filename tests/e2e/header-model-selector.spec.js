/** Real app/header/picker; synthetic settings and model responses, no provider calls. */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

const savedModel = 'saved-test-model';
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mockModelSettings(page, models) {
  await page.route('**/api/users/settings', (route) => {
    if (route.request().method() !== 'GET') return route.fulfill(json({ success: true }));
    return route.fulfill(json({ selectedProvider: 'openai-codex', selectedModel: savedModel, routingMode: 'static' }));
  });
  await page.route('**/api/custom-providers', (route) => route.fulfill(json({ providers: [] })));
  await page.route('**/api/models/*/models', (route) => route.fulfill(json({ models })));
  await page.route('**/api/models/*/metadata', (route) => route.fulfill(json({ success: true, metadata: {} })));
  await page.route('**/api/auth/connected', (route) => route.fulfill(json(['OpenAI-Codex'])));
  // The real picker checks local-model availability on mount. No LM Studio
  // instance is needed, and no request should reach an installed provider.
  await page.route('http://127.0.0.1:1234/**', (route) => route.fulfill(json({ data: [] })));
}

test.describe('Top-right default model selector', () => {
  test('loads a lowercase saved provider without losing its model @ci', async ({ appPage }) => {
    await mockModelSettings(appPage, ['recommended-test-model', savedModel]);
    await gotoApp(appPage, '/settings');
    const selector = appPage.getByRole('button', { name: 'Change default AI model' });
    await expect(selector).toBeVisible();
    await expect(selector).toContainText('openai-codex/' + savedModel);
    await expect.poll(() => appPage.evaluate(() => localStorage.getItem('selectedProvider'))).toBe('OpenAI-Codex');
    await expect.poll(() => appPage.evaluate(() => localStorage.getItem('selectedModel'))).toBe(savedModel);
    await appPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(selector).toBeVisible();
    await expect(selector).toContainText('openai-codex/' + savedModel);
  });

  test('keeps a keyboard-operated recovery control with an empty catalog @ci', async ({ appPage }) => {
    await mockModelSettings(appPage, []);
    await gotoApp(appPage, '/settings');
    // Wait for the actual settings action to settle, not just first paint.
    await expect.poll(() => appPage.evaluate(() => localStorage.getItem('selectedProvider'))).toBe('OpenAI-Codex');
    await expect.poll(() => appPage.evaluate(() => localStorage.getItem('selectedModel'))).toBeNull();
    const selector = appPage.getByRole('button', { name: 'Change default AI model' });
    const picker = appPage.locator('.cv-toolbar-selector');
    await expect(appPage.locator('#cvClock')).toBeVisible();
    await expect(selector).toBeVisible();
    await expect(selector).toHaveText('Select model');
    await expect(selector).toHaveAttribute('aria-expanded', 'false');

    await selector.focus();
    await expect(selector).toBeFocused();
    await appPage.keyboard.press('Enter');
    await expect(picker).toBeVisible();
    await expect(selector).toHaveAttribute('aria-expanded', 'true');
    // Await the real picker's mounted hook, which registers Escape after
    // its local-server check and nextTick selection synchronization.
    await expect(picker.locator('.selector-label-row')).toBeVisible();
    await appPage.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(selector).toHaveAttribute('aria-expanded', 'false');

    await selector.focus();
    await appPage.keyboard.press('Space');
    await expect(picker).toBeVisible();
    await expect(selector).toHaveAttribute('aria-expanded', 'true');
    await appPage.locator('#cvClock').click();
    await expect(picker).toHaveCount(0);
    await expect(selector).toBeVisible();
    await expect(selector).toHaveAttribute('aria-expanded', 'false');
  });
});
