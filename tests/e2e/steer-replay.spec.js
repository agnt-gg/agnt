import { test, expect } from './fixtures/appFixture.js';
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const CONV = 'steer-replay-browser';
const messages = [
  { id: 'u1', role: 'user', content: 'Please work on this.', timestamp: 1 },
  { id: 'a1', role: 'assistant', content: 'Before the first steer.', timestamp: 2 },
  { id: 'msg-steer-100', role: 'user', content: 'First interruption.', timestamp: 100 },
  { id: 'a2', role: 'assistant', content: 'After the first steer.', timestamp: 101 },
  { id: 'msg-steer-200', role: 'user', content: 'Second interruption.', timestamp: 200 },
  { id: 'a3', role: 'assistant', content: 'After the second steer.', timestamp: 201 },
  { id: 'msg-steer-900', role: 'user', content: 'First interruption.', timestamp: 900 },
  { id: 'msg-steer-950', role: 'user', content: 'Second interruption.', timestamp: 950 },
];
for (const mode of ['focused', 'studio']) {
  test(`steer reload keeps originals in place without tail copies in ${mode} @ci`, async ({ appPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.addInitScript(mode => { localStorage.setItem('uiMode', mode); localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); }, mode);
    await page.route('**/users/preferences**', route => route.fulfill(json({})));
    await page.route('**/users/settings', route => route.fulfill(json({ selectedProvider: 'OpenAI', selectedModel: 'gpt-4o' })));
    await page.goto('/chat');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
    await page.evaluate(async ({ mode, messages, conversationId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      await store.dispatch('theme/setUiMode', mode);
      store.commit('chat/ENSURE_CONVERSATION', conversationId);
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId, messages });
      store.commit('chat/SET_ACTIVE_CONVERSATION', conversationId);
    }, { mode, messages, conversationId: CONV });
    const ids = () => page.locator('.message-flow [data-message-id]').evaluateAll(elements => elements.map(el => el.dataset.messageId));
    await expect.poll(ids).toEqual(['u1', 'a1', 'msg-steer-100', 'a2', 'msg-steer-200', 'a3']);
    for (const id of ['msg-steer-900', 'msg-steer-950']) await expect(page.locator(`[data-message-id="${id}"]`)).toHaveCount(0);
    // Apply the exact production mutation used by steering_applied, repeatedly
    // and after a JSON snapshot reload. Not a DOM-only deduplication.
    await page.evaluate(conversationId => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      const events = [
        { assistantMessageId: 'a1', round: 1, content: 'First interruption.' },
        { assistantMessageId: 'a2', round: 2, content: 'Second interruption.' },
      ];
      for (const event of events) store.commit('chat/SCOPED_APPLY_STEER', { conversationId, event });
      const snapshot = JSON.parse(JSON.stringify(store.state.chat.conversations[conversationId].messages));
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId, messages: snapshot });
      for (const event of events) store.commit('chat/SCOPED_APPLY_STEER', { conversationId, event });
    }, CONV);
    await expect.poll(ids).toEqual(['u1', 'a1', 'msg-steer-100', 'a2', 'msg-steer-200', 'a3']);
    await page.evaluate(conversationId => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      const snapshot = JSON.parse(JSON.stringify(store.state.chat.conversations[conversationId].messages));
      store.commit('chat/SCOPED_TRUNCATE_FROM_REPLAYED_IDS', { conversationId, ids: ['a1', 'a2', 'a3'], preserveSteers: true });
      // An old capped backend replays every assistant segment but NONE of
      // the human steer events. The saved seam still has to survive.
      for (const message of snapshot.filter(message => message.role === 'assistant')) store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId, message });
    }, CONV);
    await expect.poll(ids).toEqual(['u1', 'a1', 'msg-steer-100', 'a2', 'msg-steer-200', 'a3']);
    await page.evaluate(async mode => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      await store.dispatch('theme/setUiMode', mode === 'focused' ? 'studio' : 'focused');
      await store.dispatch('theme/setUiMode', mode);
    }, mode);
    await expect.poll(ids).toEqual(['u1', 'a1', 'msg-steer-100', 'a2', 'msg-steer-200', 'a3']);
  });
}
