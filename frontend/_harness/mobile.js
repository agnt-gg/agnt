// Verification-only entry. The real Vue screens/store run against an in-memory
// HTTP fixture. No auth bypass, fixture state or test globals enter the app build.
import { createApp, h, ref, provide, KeepAlive, nextTick } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import axios from 'axios';
import '../src/styles/main.css';
import { installAppHeight } from '../src/utils/appHeight.js';

const requests = [];
const now = Date.now();
const transcripts = {
  one: { conversationId: 'conversation-one', title: 'Morning briefing', messages: [
    { id: 'u-one', role: 'user', content: 'Check the morning briefing and show me what changed.', timestamp: now-60000 },
    { id: 'a-one', role: 'assistant', content: 'The briefing is ready. I checked the primary sources and saved the results. Nothing has been published.', timestamp: now-58000, reasoning: 'I compared the release notes and checked their dates.' },
  ] },
  two: { conversationId: 'conversation-two', title: 'Design review', messages: [
    { id:'u-two', role:'user', content:'Keep the conversation and inspector together.', timestamp:now-30000 },
    { id:'a-two', role:'assistant', content:'The selected conversation retains its own draft, history and context.', timestamp:now-29000 },
  ] },
};
const outputs = Object.entries(transcripts).map(([id,t])=>({id,title:t.title,content_type:'conversation',conversation_id:t.conversationId,channel_key:'orchestrator:default',created_at:new Date(now-60000).toISOString(),updated_at:new Date(now-20000).toISOString(),read_at:null,group_id:id==='one'?'research':null,content:JSON.stringify(t)}));
const groups=[{id:'research',name:'Research',parent_id:null,sort_order:0},{id:'notes',name:'Source notes',parent_id:'research',sort_order:0}];
function answer(url, method='GET', body) {
  const p=new URL(url,location.origin).pathname;
  requests.push({path:p,method});
  if(p.includes('/executions/conversation/'))return {executionsCount:1,latest:{tokenUsage:{inputTokens:1200,outputTokens:140},estimatedCost:0.02},cumulative:{inputTokens:1200,outputTokens:140,totalTokens:1340,estimatedCost:0.02}};
  if(p.endsWith('/content-outputs/save'))return {id:'one',output:outputs[0]};
  if(/\/content-outputs\/(one|two)\//.test(p)){const row=outputs.find(o=>p.includes('/'+o.id+'/'));if(p.endsWith('/read'))row.read_at=new Date().toISOString();if(p.endsWith('/unread'))row.read_at=null;if(p.endsWith('/archive'))row.archived_at=new Date().toISOString();if(p.endsWith('/unarchive'))row.archived_at=null;return {success:true,output:row};}
  if(p.endsWith('/content-outputs/one')||p.endsWith('/content-outputs/two'))return outputs.find(o=>p.endsWith('/'+o.id));
  if(p.includes('/content-outputs'))return {outputs,totalCount:outputs.length};
  if(p.endsWith('/groups'))return {groups};
  if(p.includes('/connected-apps')||p.endsWith('/auth/connected'))return {connectedApps:['openai']};
  if(p.includes('/providers'))return {providers:[],models:['gpt-4o']};
  if(p.includes('/models'))return {models:['gpt-4o']};
  if(p.includes('/version'))return {version:'mobile-child-fixture'};
  if(p.includes('/local')||p.includes('/health'))return {running:false,available:false};
  return {success:true,outputs:[],groups:[],executions:[],runs:[],agents:[],workflows:[],tools:[],data:[]};
}
const originalFetch=window.fetch.bind(window);
window.fetch=async(url,opts={})=>{
 const href=typeof url==='string'?url:url.url;
 if(!href.includes('/api/')&&!/^https?:/.test(href))return originalFetch(url,opts);
 if((href.includes('/chat')||href.includes('/orchestrator/'))&&opts.method==='POST'&&!href.includes('cancel')){
   requests.push({path:new URL(href,location.origin).pathname,method:'POST',body:opts.body});
   const encoder=new TextEncoder();let timer;
   const body=new ReadableStream({start(controller){let n=0;timer=setInterval(()=>{const message=n===0?'event: assistant_message\ndata: {"id":"reply-fixture","role":"assistant","content":"","timestamp":'+Date.now()+'}\n\n':n<8?'event: content_delta\ndata: {"assistantMessageId":"reply-fixture","delta":"Verified response segment. "}\n\n':'event: done\ndata: {}\n\n';try{controller.enqueue(encoder.encode(message));}catch{clearInterval(timer);}if(++n>8){clearInterval(timer);controller.close();}},100);opts.signal?.addEventListener('abort',()=>{clearInterval(timer);try{controller.error(new DOMException('Aborted','AbortError'));}catch{}});},cancel(){clearInterval(timer);}});
   return new Response(body,{status:200,headers:{'Content-Type':'text/event-stream'}});
 }
 return new Response(JSON.stringify(answer(href,opts.method,opts.body)),{status:200,headers:{'Content-Type':'application/json'}});
};
axios.defaults.adapter=async config=>({data:answer(config.url,config.method?.toUpperCase(),config.data),status:200,statusText:'OK',headers:{},config});
localStorage.setItem('token','fixture-not-a-real-credential');
localStorage.setItem('hasCompletedOnboarding','true');
localStorage.setItem('tours_enabled','false');
localStorage.setItem('agnt:savedChats:view','all');
localStorage.setItem('onboarding-completed','true');
localStorage.setItem('selectedProvider','openai');localStorage.setItem('selectedModel','gpt-4o');
localStorage.setItem('showLeftPanel','true');localStorage.setItem('showRightPanel','true');
const [{default:store},{default:CanvasScreen},{default:Chat},{vTooltip},{vViewportClamp}]=await Promise.all([
 import('../src/store/state.js'),import('../src/canvas/CanvasScreen.vue'),import('../src/views/Terminal/CenterPanel/screens/Chat/Chat.vue'),import('../src/directives/tooltip.js'),import('../src/directives/viewportClamp.js')
]);
store.state.userAuth.token='fixture-not-a-real-credential';store.state.userAuth.sessionState='valid';store.state.userAuth.hasCompletedOnboarding=true;
store.state.userAuth.user={id:'fixture',email:'fixture@example.invalid'};
store.state.appAuth.connectedApps=['openai'];
store.state.aiProvider.selectedProvider='openai';store.state.aiProvider.selectedModel='gpt-4o';store.state.aiProvider.providerModels={openai:['gpt-4o']};
store.commit('contentOutputs/SET_OUTPUTS',{outputs,totalCount:outputs.length});
store.commit('contentOutputs/SET_HAS_LOADED_ALL',true);store.commit('groups/SET_GROUPS',groups);
store.state.widgetLayout.isLoaded=true;
store.state.widgetLayout.pages=[{id:'page-chat',name:'Chat',route:'ChatScreen'},{id:'page-dashboard',name:'Dashboard',route:'DashboardScreen'}];
store.state.widgetLayout.activePageId='page-chat';
for(const [id,t]of Object.entries(transcripts)){store.commit('chat/ENSURE_CONVERSATION',t.conversationId);store.commit('chat/SCOPED_SET_MESSAGES',{conversationId:t.conversationId,messages:t.messages});store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID',{conversationId:t.conversationId,id});}
store.commit('chat/SET_ACTIVE_CONVERSATION','conversation-one');
store.state.chat.autosaveEnabled=false;
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]});await router.push('/chat?content-id=one');await router.isReady();
const screen=ref('ChatScreen'),mobile=ref(innerWidth<=800);const update=()=>mobile.value=innerWidth<=800;window.addEventListener('resize',update);installAppHeight();
const alternate={name:'AlternateTestScreen',setup(){const draft=ref('Other screen draft');return()=>h('div',{style:'padding:24px'},[h('h2','Other screen'),h('input',{value:draft.value,onInput:e=>draft.value=e.target.value})]);}};
const app=createApp({setup(){provide('isMobile',mobile);provide('playSound',()=>{});return()=>h('div',{class:'terminal-container',style:'height:var(--app-height);display:flex;flex-direction:column'},[h(CanvasScreen,{screenName:screen.value,onScreenChange:name=>screen.value=name},{default:()=>h(KeepAlive,null,{default:()=>screen.value==='ChatScreen'?h(Chat,{onScreenChange:name=>screen.value=name}):h(alternate)})})]);}});
app.use(store).use(router).directive('tooltip',vTooltip).directive('viewport-clamp',vViewportClamp).mount('#app');
window.MOBILE_FIXTURE={store,router,requests,screen,mobile,outputs,groups,async switch(id){await router.push('/chat?content-id='+id);await nextTick();},stream(value){store.state.chat.isStreaming=value;},setScreen(name){screen.value=name;}};
