import { test, expect } from './fixtures/appFixture.js';
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const CONV = 'steer-live-browser';

// A NEW steer arriving mid-run must render at its seam, live, in both modes.
// steer-replay.spec.js only re-applied steers already in the transcript.
for (const mode of ['focused', 'studio']) {
  test(`a live steer renders at the interruption seam in ${mode} @ci`, async ({ appPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.addInitScript(mode => { localStorage.setItem('uiMode', mode); localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); }, mode);
    await page.route('**/users/preferences**', route => route.fulfill(json({})));
    await page.route('**/users/settings', route => route.fulfill(json({ selectedProvider: 'OpenAI', selectedModel: 'gpt-4o' })));
    await page.goto('/chat');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
    await page.evaluate(async ({ mode, conversationId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      await store.dispatch('theme/setUiMode', mode);
      store.commit('chat/ENSURE_CONVERSATION', conversationId);
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId, messages: [{ id: 'u1', role: 'user', content: 'Please work on this.', timestamp: 1 }] });
      store.commit('chat/SET_ACTIVE_CONVERSATION', conversationId);
      store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId, message: { id: 'a1', role: 'assistant', content: 'Working on it.', toolCalls: [], timestamp: 2 } });
    }, { mode, conversationId: CONV });
    const ids = () => page.locator('.message-flow [data-message-id]').evaluateAll(elements => elements.map(el => el.dataset.messageId));
    await expect.poll(ids).toEqual(['u1', 'a1']);

    // Exactly what the backend emits at a tool-round seam: the steer, then
    // the continuation bubble below it.
    await page.evaluate(conversationId => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      store.commit('chat/SCOPED_APPLY_STEER', { conversationId, event: { assistantMessageId: 'a1', round: 3, content: 'Actually, do it this way.' } });
      store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId, message: { id: 'a1-s3', role: 'assistant', content: 'Switching approach.', toolCalls: [], steerContinuation: true, timestamp: 3 } });
    }, CONV);

    await expect.poll(ids).toEqual(['u1', 'a1', 'msg-steer-a1-3', 'a1-s3']);
    const steer = page.locator('[data-message-id="msg-steer-a1-3"]');
    await expect(steer).toBeVisible();
    await expect(steer).toContainText('Actually, do it this way.');
    await expect(steer).toContainText('Steered mid-run');
  });

  test(`a steer that missed every tool seam is still shown, after the reply it interrupted, in ${mode} @ci`, async ({ appPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.addInitScript(mode => { localStorage.setItem('uiMode', mode); localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); }, mode);
    await page.route('**/users/preferences**', route => route.fulfill(json({})));
    await page.route('**/users/settings', route => route.fulfill(json({ selectedProvider: 'OpenAI', selectedModel: 'gpt-4o' })));
    // The follow-up turn itself: an immediately finished stream.
    await page.route('**/orchestrator/chat**', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' }));
    await page.goto('/chat');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
    await page.evaluate(async ({ mode, conversationId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      await store.dispatch('theme/setUiMode', mode);
      store.commit('chat/ENSURE_CONVERSATION', conversationId);
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId, messages: [
        { id: 'u1', role: 'user', content: 'Tell me a long story.', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Once upon a time...', timestamp: 2 },
      ] });
      store.commit('chat/SET_ACTIVE_CONVERSATION', conversationId);
      store.commit('chat/SCOPED_SET_PENDING_STEER', { conversationId, content: 'Change the story a bit.' });
      store.dispatch('chat/drainPendingSteer', { conversationId });
    }, { mode, conversationId: CONV });
    const steer = page.locator('.message-flow .message-wrapper.user.steered');
    await expect(steer).toHaveCount(1);
    await expect(steer).toBeVisible();
    await expect(steer).toContainText('Change the story a bit.');
    await expect(steer).toContainText('Steered mid-run');
    const order = await page.locator('.message-flow [data-message-id]').evaluateAll(elements => elements.map(el => el.dataset.messageId));
    expect(order.slice(0, 3)).toEqual(['u1', 'a1', await steer.getAttribute('data-message-id')]);
  });
}
