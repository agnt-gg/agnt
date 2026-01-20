import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginUser, mockAgents } from './fixtures/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Agents Feature', () => {
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

    await mockAgents(window);
    await loginUser(window);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('can navigate to agents and see the list', async () => {
    // Navigate to Agents via secondary nav
    // Primary: Assets -> Agents
    await window.locator('.primary-nav-button').filter({ hasText: 'Assets' }).click();
    await window.locator('.secondary-nav-button').filter({ hasText: 'Agents' }).click();
    await window.waitForURL('**/agents');

    // Verify Agent List
    // We expect the mocked agents to be present
    await expect(window.getByText('Test Agent 1')).toBeVisible();
    await expect(window.getByText('Test Agent 2')).toBeVisible();
  });
});
