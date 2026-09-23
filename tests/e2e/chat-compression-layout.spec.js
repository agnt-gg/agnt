import { test, expect, gotoApp } from './fixtures/appFixture.js';

for (const width of [1920, 1780, 1280, 1024, 900, 768, 390, 320]) {
  test(`compression visible borders match full-width user and assistant cards at ${width}px @ci`, async ({ appPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.addInitScript(() => localStorage.setItem('tours_auto_start', 'false'));
    await gotoApp(page, '/chat');
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      const conversationId = 'compression-layout-fixture';
      // Natural wrapping makes genuinely full-width bordered bubbles. Measuring
      // .message-content alone hid the mismatch with the visible user card.
      const paragraph = 'Review the approved decisions and keep every original message available. Continue with the same plan after checking the summary. '.repeat(2);
      store.commit('chat/ENSURE_CONVERSATION', conversationId);
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId, messages: [
        { id: 'layout-original', role: 'user', content: 'Keep the approved decisions.', timestamp: 1 },
        { id: 'layout-summary', role: 'compaction', content: '## Goal\nKeep the approved decisions and retain the originals.', timestamp: 2,
          compaction: { foldedCount: 1, tokensBefore: 10000, tokensAfter: 1200, estimatedCost: 0.01, model: 'gpt-4o' } },
        { id: 'layout-user', role: 'user', content: paragraph, timestamp: 3 },
        { id: 'layout-assistant', role: 'assistant', content: paragraph, timestamp: 4, toolCalls: [] },
        { id: 'layout-short-user', role: 'user', content: 'Yes.', timestamp: 5 },
        { id: 'layout-short-assistant', role: 'assistant', content: 'Ready.', timestamp: 6, toolCalls: [] },
      ] });
      store.commit('chat/SET_ACTIVE_CONVERSATION', conversationId);
    });
    const card = page.locator('.compaction-card');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-message-id="layout-assistant"] .message-card')).toBeVisible();
    const assertAligned = async state => {
      const geometry = await page.evaluate(() => {
        const bounds = selector => {
          const { left, right, width } = document.querySelector(selector).getBoundingClientRect();
          return { left, right, width };
        };
        const bubble = id => bounds(`[data-message-id="${id}"] .message-card`);
        return {
          card: bounds('.compaction-card'), user: bubble('layout-user'), assistant: bubble('layout-assistant'),
          shortUser: bubble('layout-short-user'), shortAssistant: bubble('layout-short-assistant'),
          flow: bounds('.message-flow'),
          avatarVisible: getComputedStyle(document.querySelector('[data-message-id="layout-assistant"] .message-avatar')).display !== 'none',
        };
      });
      await testInfo.attach(`${width}-${state}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
      for (const role of ['user', 'assistant']) for (const edge of ['left', 'right', 'width']) {
        expect(geometry.card[edge], `${state}: fold ${edge} must equal the visible ${role} border`).toBe(geometry[role][edge]);
      }
      expect(geometry.card.right, 'existing right edge is preserved').toBe(geometry.flow.right);
      expect(geometry.shortUser.width, 'short user messages still shrink to their content').toBeLessThan(geometry.user.width);
      expect(geometry.shortUser.right).toBe(geometry.card.right);
      expect(geometry.shortAssistant.width, 'short assistant messages still shrink to their content').toBeLessThan(geometry.assistant.width);
      expect(geometry.shortAssistant.left).toBe(geometry.card.left);
      if (!geometry.avatarVisible) expect(geometry.card.left, 'no empty avatar gutter on mobile').toBe(geometry.flow.left);
    };
    await card.scrollIntoViewIfNeeded();
    await testInfo.attach(`${width}-visible-borders`, { body: await page.screenshot(), contentType: 'image/png' });
    await assertAligned('folded');
    await card.locator('.fold-toggle').click();
    await expect(page.getByText('Keep the approved decisions.', { exact: true })).toBeVisible();
    await assertAligned('expanded');
    await card.locator('button.summary-edit').click();
    await expect(card.locator('textarea')).toBeVisible();
    await assertAligned('editing');
    await card.locator('button.summary-edit').filter({ hasText: 'Cancel' }).click();
  });
}
