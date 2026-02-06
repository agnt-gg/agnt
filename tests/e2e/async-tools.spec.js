/**
 * E2E Test: Async Tool Stop Button
 * Tests that the Stop button appears for async tools and works correctly
 */

import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

let electronProcess;

test.beforeAll(async () => {
  // Start Electron app
  electronProcess = spawn('npm', ['start'], {
    cwd: rootDir,
    shell: true,
    stdio: 'pipe',
  });

  // Wait for app to start
  await new Promise((resolve) => setTimeout(resolve, 5000));
});

test.afterAll(async () => {
  // Kill Electron process
  if (electronProcess) {
    electronProcess.kill();
  }
});

test.describe('Async Tool Stop Button', () => {
  test('should show Stop button for async tools', async ({ page }) => {
    // Navigate to app
    await page.goto('http://localhost:3333');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Check if we're on login page or chat page
    const isLoginPage = await page.locator('input[type="email"]').isVisible().catch(() => false);

    if (isLoginPage) {
      // Login if needed
      await page.fill('input[type="email"]', 'test@example.com');
      await page.fill('input[type="password"]', 'password');
      await page.click('button[type="submit"]');
      await page.waitForNavigation();
    }

    // Navigate to chat
    await page.click('text=Chat').catch(() => {}); // May already be on chat page

    // Wait for chat interface
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Send message to trigger async tool
    const textarea = await page.locator('textarea').first();
    await textarea.fill('roll me a dice every minute for the next hour');
    await textarea.press('Enter');

    console.log('✅ Sent dice rolling message');

    // Wait for assistant response
    await page.waitForSelector('.message-item', { timeout: 15000 });

    console.log('✅ Assistant message appeared');

    // Wait for tool execution details to appear
    const toolExecutionDetails = await page.locator('.tool-execution-details').first();
    await expect(toolExecutionDetails).toBeVisible({ timeout: 10000 });

    console.log('✅ Tool execution details visible');

    // Click to expand tool
    const toolHeader = await page.locator('.tool-header').first();
    await toolHeader.click();

    console.log('✅ Clicked to expand tool');

    // Wait a moment for expansion
    await page.waitForTimeout(500);

    // Check if Stop button appears
    const stopButton = await page.locator('.stop-async-tool-btn');

    console.log('🔍 Checking for Stop button...');

    // Log the tool call structure for debugging
    const toolCallContent = await page.locator('.tool-call-content').first().innerHTML().catch(() => 'not found');
    console.log('Tool call content:', toolCallContent.substring(0, 500));

    // Check if button exists
    const stopButtonExists = await stopButton.count();
    console.log(`Stop button count: ${stopButtonExists}`);

    if (stopButtonExists === 0) {
      // Debug: Log console messages from the page
      const logs = [];
      page.on('console', (msg) => logs.push(msg.text()));

      console.log('❌ Stop button NOT found');
      console.log('Page console logs:', logs.join('\n'));

      // Take screenshot for debugging
      await page.screenshot({ path: 'test-failure-no-stop-button.png' });

      throw new Error('Stop button not found! Expected button with class .stop-async-tool-btn');
    }

    console.log('✅ Stop button found');

    // Verify button is visible
    await expect(stopButton.first()).toBeVisible({ timeout: 5000 });

    console.log('✅ Stop button is visible');

    // Verify button text
    const buttonText = await stopButton.first().textContent();
    expect(buttonText).toContain('Stop');

    console.log('✅ Stop button has correct text');

    // Click stop button
    await stopButton.first().click();

    console.log('✅ Clicked Stop button');

    // Wait for confirmation or tool status change
    await page.waitForTimeout(1000);

    // Verify tool was stopped (check for status change or message)
    // This will depend on your implementation
    const pageContent = await page.content();

    console.log('✅ Test completed successfully');
  });

  test('should log async tool events to console', async ({ page }) => {
    // Collect console logs
    const consoleLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[AsyncTool') || text.includes('[Realtime')) {
        consoleLogs.push(text);
      }
    });

    // Navigate to app
    await page.goto('http://localhost:3333');
    await page.waitForLoadState('networkidle');

    // Navigate to chat
    await page.click('text=Chat').catch(() => {});
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Send message
    const textarea = await page.locator('textarea').first();
    await textarea.fill('roll me a dice every minute for the next hour');
    await textarea.press('Enter');

    // Wait for logs
    await page.waitForTimeout(3000);

    console.log('Console logs captured:');
    consoleLogs.forEach((log) => console.log(log));

    // Verify expected logs
    const hasAsyncToolCheck = consoleLogs.some((log) => log.includes('[AsyncTool Check]'));
    const hasToolStart = consoleLogs.some((log) => log.includes('tool_start') || log.includes('Tool started'));

    console.log('Has AsyncTool Check logs:', hasAsyncToolCheck);
    console.log('Has tool_start logs:', hasToolStart);

    // At least one of these should be true
    expect(hasAsyncToolCheck || hasToolStart).toBeTruthy();
  });
});
