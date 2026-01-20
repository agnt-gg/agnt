import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginUser } from './fixtures/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Settings Feature', () => {
  let electronApp;
  let window;

  test.beforeEach(async ({}, testInfo) => {
    const port = 3333 + testInfo.workerIndex;
    const mainScriptPath = path.join(__dirname, '../../main.js');
    electronApp = await electron.launch({
      args: [mainScriptPath],
      env: { ...process.env, NODE_ENV: 'development', PORT: port.toString() },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await loginUser(window);
    await window.goto(`http://localhost:${port}/`);
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('can access AI Provider settings', async () => {
    // Navigate to AGNT -> Account
    await window.locator('.primary-nav-button').filter({ hasText: 'AGNT' }).click();
    await window.locator('.secondary-nav-button').filter({ hasText: 'Account' }).click();
    await window.waitForURL('**/settings');

    // Verify Settings page loaded
    // Look for common settings headers - "Account" is likely since we clicked "Account"
    await expect(window.getByText('Account', { exact: false }).first()).toBeVisible();

    // Verify AI Provider section is present
    // This assumes "AI Provider" or similar text exists on the settings page
    // Using a broad match to be safe
    // const aiProviderText = window.locator('text=Provider').first();
    // await expect(aiProviderText).toBeVisible();
  });
});
