import { test, expect, gotoApp } from './fixtures/appFixture.js';

test('Given image controls, When switching and sending, Then real composer sends each selected policy @ci',async({appPage})=>{
 const sent=[];
 await appPage.route('**/api/orchestrator/chat',async route=>{
  const raw=route.request().postData();sent.push(JSON.parse(raw));
  await route.fulfill({status:200,contentType:'text/event-stream',body:'event: done\ndata: {}\n\n'});
 });
 await gotoApp(appPage,'/chat');
 await appPage.evaluate(()=>{
  const s=document.querySelector('#app').__vue_app__.config.globalProperties.$store;
  s.state.aiProvider.selectedProvider='openai-codex';s.state.aiProvider.selectedModel='gpt-6-astra';
  s.state.chat.conversations['selector-test']={conversationId:'selector-test',messages:[],isStreaming:false,agentId:null};
  s.state.chat.activeConversationId='selector-test';s.state.chat.messages=[];
  s.state.chat.aiByConv={'selector-test':{provider:'openai-codex',model:'gpt-6-astra'}};
  s.state.appAuth.connectedApps=[...(s.state.appAuth.connectedApps||[]).filter(a=>a.provider_id!=='openai-codex'),{provider:'openai-codex',provider_id:'openai-codex',name:'openai-codex',connected:true}];
 });
 await appPage.locator('.chat-provider-button').first().click();
 await expect(appPage.locator('[data-test="images-enabled"]').first()).toBeVisible();
 await appPage.locator('[data-test="images-enabled"]').first().check();
 for(const policy of ['latest','latest-fast']){
  await appPage.locator('[data-test="image-policy-'+policy+'"]').first().click();
  await expect(appPage.locator('[data-test="image-policy-'+policy+'"]').first()).toHaveAttribute('aria-pressed','true');
  // Invoke actual store action through the composer scope, with no external LLM.
  await appPage.evaluate(async()=>{
   const s=document.querySelector('#app').__vue_app__.config.globalProperties.$store;
   await s.dispatch('chat/startStreamingConversation',{userInput:'fixture comparison',provider:'openai-codex',model:'gpt-6-astra'});
  });
  expect(sent.at(-1).codexImages).toEqual({provider:'openai-codex',enabled:true,policy});
 }
 expect(sent).toHaveLength(2);
});
