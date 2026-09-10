/** Real built app/composer; synthetic receipt and media response. No provider generation. */
import { test, expect, gotoApp } from './fixtures/appFixture.js';
import { png } from '../../backend/src/services/ai/codexImageTestFixture.js';

test('Given a prior native image, When selected, Then attach to draft without sending @ci', async ({ appPage }) => {
  let imageGets = 0, sends = 0;
  await appPage.route('**/api/images/img-gen-reference-fixture', route => {
    imageGets++;
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
  await appPage.route('**/api/orchestrator/chat', route => { sends++; return route.abort(); });
  await gotoApp(appPage, '/chat');
  await expect(appPage.locator('.chat-input-textarea').first()).toBeVisible();
  // Seed the real Vuex conversation slot, not a component stub or model response.
  await appPage.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    const id = 'reference-picker-conversation';
    const messages = [{id:'reference-fixture-message',role:'assistant',content:'Synthetic saved design.',toolCalls:[{
      id:'reference-fixture-call',name:'generate_image',result:JSON.stringify({success:true,savedImageIds:['img-gen-reference-fixture'],generatedImages:[],imageMetadata:{returnedModel:null}}),
    }]}];
    store.state.chat.conversations[id] = { conversationId:id,messages,isStreaming:false,agentId:null };
    store.state.chat.activeConversationId = id;
    store.state.chat.messages = messages;
    store.state.chat.isStreaming = false;
    store.state.chat.currentAgentId = null;
  });
  const open = appPage.getByRole('button', {name:'Use a previous image'});
  await expect(open).toBeVisible();
  await open.click();
  expect(imageGets).toBe(0); // No unbounded thumbnail request on open.
  await appPage.locator('[data-test="reference-img-gen-reference-fixture"]').click();
  await expect(appPage.locator('.file-chip').filter({hasText:'reference-img-gen-reference-fixture.png'})).toBeVisible();
  expect(imageGets).toBe(1);
  expect(sends).toBe(0);
  await appPage.locator('.chat-input-textarea').first().fill('Change the header colour; preserve the layout.');
  expect(sends).toBe(0);
  await appPage.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    store.state.chat.conversations['other-reference-conversation'] = {conversationId:'other-reference-conversation',messages:[],isStreaming:false,agentId:null};
    store.state.chat.activeConversationId = 'other-reference-conversation';
    store.state.chat.messages = [];
  });
  await expect(appPage.locator('.file-chip').filter({hasText:'reference-img-gen-reference-fixture.png'})).toHaveCount(0);
  expect(sends).toBe(0);
});
