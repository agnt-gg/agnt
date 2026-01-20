import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginUser } from './fixtures/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Chat Feature', () => {
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
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('can type in the chat input', async ({}, testInfo) => {
    const port = 3333 + testInfo.workerIndex;
    // Navigate to Chat
    await window.goto(`http://localhost:${port}/chat`);
    await window.waitForURL('**/chat');

    // Verify that we are connected (welcome message instead of setup)
    // "Hi! I'm Annie..." implies connection
    // "Connect an AI Provider" implies no connection

    // If we see the setup message, the test will fail because input is hidden
    const setupMessage = window.locator('text=Connect an AI Provider');
    if (await setupMessage.isVisible()) {
      console.log('Setup message visible - provider not connected properly in test');
    }

    // Find the input field
    // Using the specific class from BaseScreen.vue
    const input = window.locator('.chat-input-textarea').first();
    await expect(input).toBeVisible({ timeout: 20000 });

    // Type a message
    const testMessage = 'Hello AGNT Test';
    await input.fill(testMessage);

    // Verify input value
    await expect(input).toHaveValue(testMessage);

    // We won't submit to avoid backend errors since we haven't mocked the chat API
    // But verifying we can type confirms the UI is interactive
  });
});
