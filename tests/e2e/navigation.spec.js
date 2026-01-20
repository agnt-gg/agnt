import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginUser } from './fixtures/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Navigation', () => {
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

    // Login and reload to apply auth state
    await loginUser(window);
    // Use goto instead of reload to handle connection issues better
    await window.goto(`http://localhost:${port}/`);
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('can navigate to major application views using sidebar', async () => {
    // Helper to click primary category
    const clickPrimary = async (label) => {
      await window.locator('.primary-nav-button').filter({ hasText: label }).click();
    };

    // Helper to click secondary item and verify
    const clickSecondary = async (label, expectedUrlPart) => {
      const button = window.locator('.secondary-nav-button').filter({ hasText: label });
      await button.click();
      await expect(button).toHaveClass(/active/);
      await window.waitForURL(`**/${expectedUrlPart}`);
    };

    // 1. Verify Home -> Chat (Default)
    // Click Home explicitly to ensure state
    await clickPrimary('Home');
    await expect(window.locator('.primary-nav-button').filter({ hasText: 'Home' })).toHaveClass(/active/);
    // Click Chat just to be sure
    await clickSecondary('Chat', 'chat');

    // 2. Studio -> Tool
    console.log('Navigating to Studio -> Tool...');
    await clickPrimary('Studio');
    await clickSecondary('Tool', 'tool-forge');

    // 3. Assets -> Agents
    console.log('Navigating to Assets -> Agents...');
    await clickPrimary('Assets');
    await clickSecondary('Agents', 'agents');

    // 4. AGNT -> Account (Settings)
    console.log('Navigating to AGNT -> Account...');
    await clickPrimary('AGNT');
    await clickSecondary('Account', 'settings');
  });
});
