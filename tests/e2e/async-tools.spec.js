import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  test, expect, gotoApp, validateFixtureContract, fixtureState,
} from './fixtures/appFixture.js';

const executionId = 'synthetic-execution-1';
const assistantMessageId = 'synthetic-assistant-1';
const toolCallId = 'synthetic-tool-1';

function sse(eventName, data) {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function arrangeSyntheticAsyncTurn(page) {
  const observed = { chatRequests: 0, cancelRequests: 0, chatBody: null, cancelUrl: null };
  await page.route('**/api/orchestrator/chat', async (route) => {
    observed.chatRequests += 1;
    observed.chatBody = route.request().postData();
    const body = [
      sse('conversation_started', { conversationId: 'synthetic-conversation-1' }),
      sse('assistant_message', { id: assistantMessageId, role: 'assistant', content: '', agentName: 'Fixture Annie' }),
      sse('tool_start', {
        assistantMessageId,
        toolCall: { id: toolCallId, name: 'execute_javascript_code', args: { code: 'synthetic-only' } },
      }),
      sse('tool_end', {
        assistantMessageId,
        toolCall: {
          id: toolCallId,
          name: 'execute_javascript_code',
          result: JSON.stringify({ executionId, status: 'running' }),
        },
      }),
    ].join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route(`**/api/async-tools/cancel/${executionId}`, async (route) => {
    observed.cancelRequests += 1;
    observed.cancelUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  return observed;
}

async function openChat(page) {
  await gotoApp(page, '/');
  await page.locator('[data-tour-id="sidebar.chat"]').click();
  await page.waitForURL('**/chat');
  const input = page.locator('.chat-input-textarea').first();
  await expect(input).toBeVisible({ timeout: 30000 });
  await expect(input).toBeEnabled({ timeout: 30000 });
}

async function submitSyntheticTurn(page) {
  const input = page.locator('.chat-input-textarea').first();
  await input.fill('roll me a synthetic dice every minute');
  await input.press('Enter');
}

test.describe('Legacy browser fixture admission', () => {
  test('Given a missing build, When admission runs, Then it refuses before mkdir or child spawn', () => {
    const before = fixtureState();
    const absent = path.join(os.tmpdir(), `missing-dist-${process.pid}`, 'index.html');
    expect(fs.existsSync(absent)).toBe(false);
    expect(() => validateFixtureContract({ repo: '/candidate', port: 36400, distIndex: absent }))
      .toThrow(/FIXTURE_REFUSED_BEFORE_SIDE_EFFECTS: frontend\/dist\/index\.html is missing/);
    expect(fixtureState()).toEqual(before);
  });

  test('Given an invalid or forbidden port, When admission runs, Then it refuses before side effects', () => {
    const before = fixtureState();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-contract-'));
    const index = path.join(tmp, 'index.html');
    fs.writeFileSync(index, '<!doctype html>');
    try {
      expect(() => validateFixtureContract({ repo: '/candidate', port: 3333, distIndex: index }))
        .toThrow(/FIXTURE_REFUSED_BEFORE_SIDE_EFFECTS: fixture port 3333 is forbidden/);
      expect(() => validateFixtureContract({ repo: '/candidate', port: 70000, distIndex: index }))
        .toThrow(/FIXTURE_REFUSED_BEFORE_SIDE_EFFECTS: fixture port must be an unprivileged integer/);
      expect(fixtureState()).toEqual(before);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test.describe('Legacy async-tool browser purpose on isolated fixture', () => {
  test('Given a valid fixture, When a synthetic async turn runs, Then Stop mounts and cancels through the API', async ({ appPage, agntBackend }) => {
    const observed = await arrangeSyntheticAsyncTurn(appPage);
    await openChat(appPage);
    await submitSyntheticTurn(appPage);

    const tool = appPage.locator('.tool-execution-details').filter({ hasText: 'execute_javascript_code' }).first();
    await expect(tool).toBeVisible({ timeout: 30000 });
    const stop = tool.locator('.stop-async-tool-btn');
    await expect(stop).toBeVisible();
    await stop.click();

    await expect.poll(() => observed.cancelRequests).toBe(1);
    await expect(stop).toHaveCount(0);
    expect(observed.chatRequests).toBe(1);
    expect(observed.chatBody).toContain('synthetic dice');
    expect(observed.cancelUrl).toContain(`/api/async-tools/cancel/${executionId}`);
    expect(agntBackend.port).not.toBe(3333);
    expect(new URL(appPage.url()).port).toBe(String(agntBackend.port));
    const health = await appPage.request.get(`${agntBackend.baseUrl}/api/health`);
    expect(health.ok()).toBeTruthy();
  });

  test('Given a valid fixture, When tool_start crosses the real SSE transport, Then the intended tool card renders', async ({ appPage }) => {
    const observed = await arrangeSyntheticAsyncTurn(appPage);
    await openChat(appPage);
    await submitSyntheticTurn(appPage);

    await expect.poll(() => observed.chatRequests).toBe(1);
    const renderedTool = appPage.locator('.tool-execution-details').filter({ hasText: 'execute_javascript_code' }).first();
    await expect(renderedTool).toBeVisible({ timeout: 30000 });
    await expect(renderedTool).toContainText('execute_javascript_code');
  });
});
