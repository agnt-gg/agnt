import { test, expect, gotoApp } from './fixtures/appFixture.js';

for (const width of [1920, 1280, 390]) {
  test(`compression card aligns with message bodies at ${width}px @ci`, async ({ appPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem('tutorial-ChatScreen-completed', 'true'));
    await gotoApp(page, '/chat');
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      const conversationId = 'compression-layout-fixture';
      store.commit('chat/ENSURE_CONVERSATION', conversationId);
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId, messages: [
        { id: 'layout-original', role: 'user', content: 'Keep the approved decisions.', timestamp: 1 },
        { id: 'layout-summary', role: 'compaction', content: '## Goal\nKeep the approved decisions and retain the originals.', timestamp: 2,
          compaction: { foldedCount: 1, tokensBefore: 10000, tokensAfter: 1200, estimatedCost: 0.01, model: 'gpt-4o' } },
        { id: 'layout-user', role: 'user', content: 'What happens next?', timestamp: 3 },
        { id: 'layout-assistant', role: 'assistant', content: 'Review the summary, then continue the conversation.', timestamp: 4, toolCalls: [] },
      ] });
      store.commit('chat/SET_ACTIVE_CONVERSATION', conversationId);
    });
    const card = page.locator('.compaction-card');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-message-id="layout-assistant"] .message-content')).toBeVisible();

    const assertAligned = async state => {
      const geometry = await page.evaluate(() => {
        const bounds = selector => {
          const { left, right, width } = document.querySelector(selector).getBoundingClientRect();
          return { left, right, width };
        };
        return {
          card: bounds('.compaction-card'),
          body: bounds('[data-message-id="layout-assistant"] .message-content'),
          flow: bounds('.message-flow'),
          avatarVisible: getComputedStyle(document.querySelector('[data-message-id="layout-assistant"] .message-avatar')).display !== 'none',
        };
      });
      await testInfo.attach(`${width}-${state}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
      expect(Math.abs(geometry.card.right - geometry.flow.right), `${state}: right edge stays at the conversation edge`).toBeLessThan(1);
      expect(Math.abs(geometry.card.left - geometry.body.left), `${state}: left edge follows the message body, not its avatar`).toBeLessThan(1);
      if (!geometry.avatarVisible) expect(Math.abs(geometry.card.left - geometry.flow.left), 'no empty avatar gutter on mobile').toBeLessThan(1);
    };

    await assertAligned('folded');
    await card.locator('.fold-toggle').click();
    await expect(page.getByText('Keep the approved decisions.', { exact: true })).toBeVisible();
    await assertAligned('expanded');
    await card.locator('button.summary-edit').click();
    await expect(card.locator('textarea')).toBeVisible();
    await assertAligned('editing');
    await card.locator('button.summary-edit').filter({ hasText: 'Cancel' }).click();
    await card.scrollIntoViewIfNeeded();
    await testInfo.attach(`${width}-aligned-card`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
