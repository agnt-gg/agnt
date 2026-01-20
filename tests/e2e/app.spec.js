import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Application Launch', () => {
  let electronApp;

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('app launches and displays main window', async ({}, testInfo) => {
    // Path to the main.js file
    // tests/e2e -> tests -> desktop -> main.js
    const mainScriptPath = path.join(__dirname, '../../main.js');

    console.log('Launching app from:', mainScriptPath);

    const port = 3333 + testInfo.workerIndex;
    console.log(`Launching app on port: ${port}`);

    // Launch the app
    electronApp = await electron.launch({
      args: [mainScriptPath],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: port.toString(),
      },
    });

    // Get the first window that opens
    const window = await electronApp.firstWindow();

    // Wait for the window to load
    // The app loads localhost:3333, so we wait for that to be ready
    await window.waitForLoadState('domcontentloaded');

    // Check title
    const title = await window.title();
    console.log('Window title:', title);
    // The HTML title is AGNT.gg, which overrides the Electron window title
    expect(title).toBe('AGNT.gg');

    // Capture a screenshot
    await window.screenshot({ path: 'test-results/initial-launch.png' });

    // Basic verification that the app mounted
    const appElement = window.locator('#app');
    await expect(appElement).toBeVisible();
  });
});
