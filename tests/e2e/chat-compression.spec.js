import { test, expect, gotoApp } from './fixtures/appFixture.js';

// Real built chat screen/store; only provider response and persistence transport
// are deterministic fixtures. Never sends user text to an external provider.
test('chat compression keeps originals, edits the summary, reloads and undoes @ci', async ({appPage:page}) => {
  let saved=null, calls=0;
  await page.route('**/api/orchestrator/compress', async route => {
    calls++;
    const body=route.request().postDataJSON();
    expect(body.messages[0].content).toBe('Original request 0');
    await route.fulfill({json:{success:true,summary:'## Goal\nKnown summary',provider:'openai',model:'gpt-4o',estimatedCost:0.01,tokenUsage:{inputTokens:1000,outputTokens:30,totalTokens:1030}}});
  });
  await page.route('**/api/content-outputs/save', async route => {
    saved=route.request().postDataJSON();
    await route.fulfill({json:{success:true,id:'compression-fixture-output',output:{id:'compression-fixture-output'}}});
  });
  await page.addInitScript(()=>{
    localStorage.setItem('agnt_last_context_status',JSON.stringify({'compression-fixture':{currentTokens:10000,tokenLimit:128000,messagesCount:8,breakdown:{messagesTokens:8000},cachedAt:Date.now()}}));
    localStorage.setItem('tutorial-ChatScreen-completed','true');
  });
  const seed=async messages=>page.evaluate(messages=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    store.state.aiProvider.selectedProvider='OpenAI';store.state.aiProvider.selectedModel='gpt-4o';
    store.commit('chat/ENSURE_CONVERSATION','compression-fixture');
    store.commit('chat/SCOPED_SET_MESSAGES',{conversationId:'compression-fixture',messages});
    store.state.chat.conversations['compression-fixture'].conversationId='compression-fixture';
    store.state.chat.conversations['compression-fixture'].savedOutputId='compression-fixture-output';
    store.commit('chat/SET_CONV_AI',{conversationId:'compression-fixture',ai:{provider:'OpenAI',model:'gpt-4o'}});
    store.commit('chat/SET_ACTIVE_CONVERSATION','compression-fixture');
  },messages);
  const originals=Array.from({length:8},(_,i)=>({id:'original-'+i,role:i%2?'assistant':'user',content:i%2?'Original answer '+i:'Original request '+i,timestamp:i+1,toolCalls:[]}));
  await gotoApp(page,'/chat');await seed(originals);
  await page.locator('.tiles-strip').click();
  const compress=page.locator('.compress-row button').filter({hasText:'Compress'});
  await compress.first().click();
  await page.locator('.compress-row button.primary').click();
  const card=page.locator('.compaction-card');
  await expect(card).toContainText('Known summary');
  await expect(page.getByText('Original request 0',{exact:true})).not.toBeVisible();
  await card.locator('.fold-toggle').click();
  await expect(page.getByText('Original request 0',{exact:true})).toBeVisible();
  await card.locator('button.summary-edit').filter({hasText:'Edit'}).click();
  await card.locator('textarea').fill('Edited summary');
  await card.locator('button.summary-edit.save').click();
  await expect(card).toContainText('Edited summary');
  await expect.poll(()=>saved?.content && JSON.parse(saved.content).messages.find(m=>m.role==='compaction')?.content).toBe('Edited summary');
  const stored=JSON.parse(saved.content).messages;
  expect(stored.filter(m=>m.role!=='compaction').map(m=>m.content)).toEqual(originals.map(m=>m.content));
  await page.reload();await page.locator('[data-tour-id="sidebar.chat"]').waitFor();await seed(stored);
  await expect(page.locator('.compaction-card')).toContainText('Edited summary');
  await page.locator('.compaction-card .fold-undo').click();
  await expect(page.locator('.compaction-card')).toHaveCount(0);
  await expect(page.getByText('Original request 0',{exact:true})).toBeVisible();
  await expect.poll(()=>saved?.content && JSON.parse(saved.content).messages.length).toBe(8);
  expect(calls).toBe(1);
});
