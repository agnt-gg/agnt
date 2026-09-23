import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, gotoApp } from './fixtures/appFixture.js';

// Exercise the shipped chat renderer, boot-time cookie setup and real routes.
// Never add headers/cookies in this test: that masked the missing cookie path.
test('saved chat artifacts authenticate parent, nested HTML and CSS with browser cookies @ci', async ({ appPage: page, browser, agntBackend }, testInfo) => {
  const directory = testInfo.outputPath('fixture');
  fs.mkdirSync(directory, { recursive: true });
  const child = path.join(directory, 'child.html');
  const stylesheet = path.join(directory, 'styles.css');
  const parent = path.join(directory, 'parent.html');
  fs.writeFileSync(child, '<!doctype html><html><body><h1>Nested preview verified</h1></body></html>');
  fs.writeFileSync(stylesheet, 'body{background:rgb(16,16,31);color:rgb(25,239,131)}');
  const original = `<!doctype html><html><head><link rel="stylesheet" href="${pathToFileURL(stylesheet)}"></head><body><h1>Local preview fixture</h1><iframe title="Child" src="${pathToFileURL(child)}"></iframe></body></html>`;
  fs.writeFileSync(parent, original);
  const requests = [];
  page.on('response', response => {
    if (response.url().includes('/api/local-preview/')) requests.push(response);
  });
  await page.addInitScript(() => localStorage.setItem('tours_auto_start', 'false'));
  await gotoApp(page, '/chat');
  const seed = async () => page.evaluate(filePath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    const conversationId = 'artifact-auth-fixture';
    store.commit('chat/ENSURE_CONVERSATION', conversationId);
    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId, messages: [{
      id: 'artifact-auth-message', role: 'assistant', timestamp: 1, toolCalls: [],
      content: '```artifact\n' + JSON.stringify({ path: filePath, title: 'Cookie-only artifact preview' }) + '\n```',
    }] });
    store.commit('chat/SET_ACTIVE_CONVERSATION', conversationId);
  }, parent.replaceAll('\\', '/'));
  const verifyPreview = async () => {
    const frame = page.frameLocator('iframe[title="Cookie-only artifact preview"]');
    await expect(frame.getByRole('heading', { name: 'Local preview fixture' })).toBeVisible({ timeout: 8000 });
    await expect(frame.frameLocator('iframe[title="Child"]').getByRole('heading', { name: 'Nested preview verified' })).toBeVisible();
    await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(16, 16, 31)');
    await expect(frame.locator('body')).toHaveCSS('color', 'rgb(25, 239, 131)');
  };
  await seed();
  await verifyPreview();
  await page.reload();
  await expect(page.locator('[data-tour-id="sidebar.chat"]')).toBeVisible();
  await seed();
  await verifyPreview();
  expect(fs.readFileSync(parent, 'utf8')).toBe(original);
  const paths = new Set();
  for (const response of requests) {
    const headers = await response.request().allHeaders();
    expect(headers.authorization, 'browser subresources must not depend on injected headers').toBeUndefined();
    expect(headers.cookie, 'media credential must be sent by the browser').toContain('agnt_media_token=');
    expect(response.status()).toBe(200);
    paths.add(new URL(response.url()).pathname);
  }
  expect([...paths].some(p => p.endsWith('/parent.html'))).toBe(true);
  expect([...paths].some(p => p.endsWith('/child.html'))).toBe(true);
  expect([...paths].some(p => p.endsWith('/styles.css'))).toBe(true);
  const anonymous = await browser.newContext();
  try {
    for (const pathname of paths) {
      const response = await anonymous.request.get(agntBackend.baseUrl + pathname);
      expect(response.status(), 'preview files remain private without a session').toBe(401);
    }
  } finally { await anonymous.close(); }
  await testInfo.attach('cookie-only-artifact', { body: await page.screenshot(), contentType: 'image/png' });
});
