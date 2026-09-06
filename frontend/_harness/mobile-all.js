// Verification-only entry. The real Vue screens/store run against an in-memory
// HTTP fixture. No auth bypass, fixture state or test globals enter the app build.
import { createApp, h, ref, provide, KeepAlive, nextTick, defineAsyncComponent, markRaw } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
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

const agents=[{id:'agent-1',name:'Research assistant',description:'Read primary sources and prepare attributed briefings.',systemPrompt:'Verify source dates before summarizing.',status:'ACTIVE',category:'300 - Data & Analytics',assignedTools:['web-search'],assignedSkills:['skill-1'],assignedWorkflows:[],creditLimit:1000,creditsUsed:12,successRate:95,lastActive:new Date(now).toISOString()}];
const tools=[{id:'tool-1',name:'Feedback summary',title:'Feedback summary',description:'Summarize incoming feedback.',category:'utilities',is_builtin:false,toolType:'AI',parameters:{feedback:{type:'string'}},outputs:{summary:{type:'string'}},fields:[{id:'field-1',name:'feedback',type:'text',value:''}],instructions:'Summarize feedback.'}];
const workflow={id:'workflow-1',name:'Morning briefing',description:'Prepare a verified morning briefing.',category:'Research',status:'stopped',updated_at:new Date(now).toISOString(),nodes:[{id:'n1',type:'trigger-timer',text:'Timer',x:40,y:40,category:'trigger',parameters:{fireOnStart:'Yes',scheduleType:'Interval',schedule:'Daily'}}],edges:[]};
const goals=[{id:'goal-1',title:'Weekly briefing',description:'Write an attributed weekly report.',status:'planning',priority:'high',progress:0,tasks:[{id:'task-1',title:'Verify sources',description:'Check source dates',status:'pending',progress:0}],created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()}];
const skills=[{id:'skill-1',name:'Source verification',description:'Verify source dates and attribution.',instructions:'Read the primary source and record its date.',category:'research',source:'user',created_at:new Date(now).toISOString()}];
const listings=[{id:'listing-1',asset_id:'agent-1',asset_type:'agent',name:'Research assistant',title:'Research assistant',description:'Primary-source research with explicit verification and approval.',category:'Research',price:0,rating:4.8,downloads:12,publisher_pseudonym:'Research team',version:'1.0.0',tags:['research'],requirements:'Web search'}];
const plugins=[{name:'browser-tools',displayName:'Browser tools',description:'Navigate and inspect web pages.',version:'1.0.0',author:'AGNT',trustTier:'verified',tools:[{type:'browser',schema:{title:'Browser'}}]}];
const widgets=[{id:'widget-1',name:'Activity feed',description:'Recent work',widget_type:'html',source_code:'<h2>Recent activity</h2><p>Briefing ready.</p>',icon:'fas fa-list',category:'custom',default_size:{cols:4,rows:3},min_size:{cols:2,rows:2}}];
const fixtureSchemas={triggers:[{type:'trigger-timer',title:'Timer Trigger',category:'trigger',icon:'clock',parameters:{fireOnStart:{type:'string',inputType:'select',options:['Yes','No'],default:'Yes'},scheduleType:{type:'string',inputType:'select',options:['Interval','Specific Time'],default:'Interval'},schedule:{type:'string',inputType:'select',options:['Daily','Hourly'],default:'Daily'}}}],actions:[{type:'web-search',title:'Web Search',category:'action',icon:'search',parameters:{query:{type:'string',default:''}},outputs:{result:{type:'string'}}}],utilities:[],widgets:[],controls:[],custom:[]};
function allScreenAnswer(p,method,body){
 if(p.endsWith('/executions/activity'))return [];
 if(p.includes('/ledger/summary'))return {calls:1,totalCost:0.02,estimatedCost:0.02,inputTokens:1200,outputTokens:140,cachedInputTokens:0};
 if(p.includes('/ledger/breakdown'))return {rows:[]};
 if(p.endsWith('/agents/agent-1')&&method==='PUT'){const patch=typeof body==='string'?JSON.parse(body):body;Object.assign(agents[0],patch);return {agent:agents[0],success:true};}
 if(p.includes('/agents/')||p.endsWith('/agents'))return p.endsWith('/agent-1')?agents[0]:{agents};
 if(p.includes('workflow-tools'))return fixtureSchemas;
 if(p.includes('/custom-tools')||p.includes('/orchestrator/tools'))return {tools};
 if(p.includes('/workflows'))return p.endsWith('/workflow-1')?workflow:{workflows:[workflow]};
 if(p.includes('/goals'))return p.endsWith('/goal-1')?{goal:goals[0]}:{goals};
 if(p.includes('/skills'))return {skills,scanLocations:['/projects/skills'],lastScan:new Date().toISOString()};
 if(p.includes('/memories')||p.includes('/memory'))return {memories:[{id:'mem-1',agent_id:'agent-1',memory_type:'preference',content:'Keep source links in the report.',created_at:new Date(now).toISOString()}]};
 if(p.includes('/experiments/datasets'))return {datasets:[{id:'dataset-1',name:'Research examples',source:'synthetic',item_count:20}]};
 if(p.includes('/experiments'))return {experiments:[{id:'experiment-1',name:'Source dates',type:'ab_test',status:'completed',hypothesis:'Explicit dates improve attribution'}]};
 if(p.includes('/insights'))return {insights:[{id:'insight-1',title:'Verify source dates',description:'Include source publication dates in reports.',target_type:'agent',target_id:'agent-1',category:'prompt_refinement',status:'pending',confidence:0.9,evidence:{runs:3},created_at:new Date(now).toISOString()}],stats:{}};
 if(p.includes('/widget-definitions'))return {widgets};
 if(p.includes('/workspaces'))return {workspaces:[]};
 if(p.includes('/filesystem/settings'))return {workspaceRoot:'/projects',defaultWorkspaceRoot:'/projects'};
 if(p.includes('/filesystem/tree'))return {items:[{name:'briefing.md',path:'briefing.md',type:'file',isDirectory:false}],root:'/projects'};
 if(p.includes('/filesystem/file'))return {path:'briefing.md',name:'briefing.md',content:'# Briefing\nPrimary sources verified.',extension:'.md',mimeType:'text/markdown',size:38};
 if(p.endsWith('/executions'))return [{id:'exec-1',workflowId:'workflow-1',workflowName:'Morning briefing',status:'completed',startTime:new Date(now-60000).toISOString(),endTime:new Date(now).toISOString(),nodeCount:2}];
 if(p.endsWith('/executions/agents/list'))return [];
 if(p.endsWith('/executions/exec-1'))return {id:'exec-1',workflowId:'workflow-1',workflowName:'Morning briefing',status:'completed',startTime:new Date(now-60000).toISOString(),endTime:new Date(now).toISOString(),nodeExecutions:[],logs:[]};
 if(p.includes('/executions')&&!p.includes('/conversation/'))return {executions:[],runs:[],pagination:{page:1,pageSize:20,total:0}};
 if(p.includes('/marketplace'))return {items:listings,workflows:listings,plugins,purchases:[],earnings:[],stats:{},sales:[]};
 if(p.includes('/plugins'))return {success:true,plugins};
 if(p.includes('/mcp'))return {success:true,servers:[],tools:[],resources:[],prompts:[]};
 if(p.includes('/security-policy'))return {policy:{mode:'balanced',outputScanning:'report',categoryOverrides:{},ruleOverrides:{}},rules:[],balancedRuleDefaults:{}};
 if(p.includes('/autonomy')||p.includes('/schedules')||p.includes('/contracts')||p.includes('/mutations'))return {schedules:[],contracts:[],mutations:[],escalations:[],policy:{enabled:false,allowedCategories:[]}};
 return null;
}

function answer(url, method='GET', body) {
  const p=new URL(url,location.origin).pathname;
  requests.push({path:p,method,body: typeof body==='string' ? body : JSON.stringify(body)});
  const scoped=allScreenAnswer(p,method,body);if(scoped!==null)return scoped;
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
class FixtureEventSource extends EventTarget { constructor(){super();this.timer=setTimeout(()=>{this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'summary',data:{overall:'healthy',healthyConnections:1,totalConnections:1,providers:[{provider:'openai',status:'healthy'}]}})}));this.dispatchEvent(new Event('complete'));},10);}close(){clearTimeout(this.timer);} }
window.EventSource=FixtureEventSource;
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
store.state.userAuth.user={id:'fixture',email:'fixture@example.invalid'};store.state.userAuth.planType='pro';store.state.userAuth.subscription={status:'active',plan:'pro',features:{plugins:true,apiAccess:true,phoneAccess:true}};
store.state.appAuth.connectedApps=['openai'];
store.state.agents.agents=agents;store.state.agents.lastFetched=Date.now();store.state.tools.tools=tools;store.state.tools.workflowTools=fixtureSchemas;store.state.tools.workflowToolsLastFetched=Date.now();store.state.workflows.workflows=[workflow];store.state.goals.goals=goals;store.state.skills.skills=skills;store.state.widgetDefinitions.definitions=widgets;

store.state.aiProvider.selectedProvider='openai';store.state.aiProvider.selectedModel='gpt-4o';store.state.aiProvider.providerModels={openai:['gpt-4o']};
store.commit('contentOutputs/SET_OUTPUTS',{outputs,totalCount:outputs.length});
store.commit('contentOutputs/SET_HAS_LOADED_ALL',true);store.commit('groups/SET_GROUPS',groups);
store.commit('SET_CRITICAL_DATA_READY');
store.state.widgetLayout.isLoaded=true;
store.state.widgetLayout.pages=[{id:'page-chat',name:'Chat',route:'ChatScreen'},{id:'page-dashboard',name:'Dashboard',route:'DashboardScreen'}];
store.state.widgetLayout.activePageId='page-chat';
for(const [id,t]of Object.entries(transcripts)){store.commit('chat/ENSURE_CONVERSATION',t.conversationId);store.commit('chat/SCOPED_SET_MESSAGES',{conversationId:t.conversationId,messages:t.messages});store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID',{conversationId:t.conversationId,id});}
store.commit('chat/SET_ACTIVE_CONVERSATION','conversation-one');
store.commit('chat/SCOPED_SET_SAVED_OUTPUT_TITLE',{conversationId:'conversation-one',title:'Morning briefing'});
store.state.chat.autosaveEnabled=false;
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/docs/:type/:page',name:'DocsPage',component:{render:()=>null}},{path:'/:pathMatch(.*)*',component:{render:()=>null}}]});const requestedScreen=new URLSearchParams(location.search).get('screen');await router.push('/chat?content-id=one'+(requestedScreen?'&screen='+requestedScreen:''));await router.isReady();
const {registerAllWidgets}=await import('../src/canvas/widgets/index.js');registerAllWidgets();document.body.classList.add('dark');
const screen=ref(new URLSearchParams(location.search).get('screen')||'ChatScreen'),mobile=ref(innerWidth<=800);const update=()=>mobile.value=innerWidth<=800;window.addEventListener('resize',update);installAppHeight();
const activeScreenRef=ref(null);
const actualScreens={DocsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Docs/Docs.vue'))),ChatScreen:markRaw(Chat),WorkspaceScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Workspace/Workspace.vue'))),DashboardScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Dashboard/Dashboard.vue'))),GoalsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Goals/Goals.vue'))),TracesScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Traces/Traces.vue'))),ArtifactsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Artifacts/Artifacts.vue'))),AgentsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Agents/Agents.vue'))),AgentForgeScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/AgentForge/AgentForge.vue'))),SkillsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Skills/Skills.vue'))),MemoryScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Memory/Memory.vue'))),WorkflowsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Workflows/Workflows.vue'))),WorkflowForgeScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/WorkflowForge/WorkflowForge.vue'))),ToolsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Tools/Tools.vue'))),ToolForgeScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/ToolForge/ToolForge.vue'))),WidgetManagerScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/WidgetManager/WidgetManager.vue'))),WidgetForgeScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/WidgetForge/WidgetForge.vue'))),ConnectorsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue'))),PluginsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Plugins/Plugins.vue'))),MarketplaceScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Marketplace/Marketplace.vue'))),SettingsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Settings/Settings.vue'))),AutonomyScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Autonomy/Autonomy.vue'))),ExperimentsScreen:markRaw(defineAsyncComponent(()=>import('../src/views/Terminal/CenterPanel/screens/Experiments/Experiments.vue')))};
const alternate={name:'AlternateTestScreen',setup(){const draft=ref('Other screen draft');return()=>h('div',{style:'padding:24px'},[h('h2','Other screen'),h('input',{value:draft.value,onInput:e=>draft.value=e.target.value})]);}};
const app=createApp({setup(){provide('isMobile',mobile);provide('playSound',()=>{});return()=>h('div',{class:'terminal-container',style:'height:var(--app-height);display:flex;flex-direction:column'},[h(CanvasScreen,{screenName:screen.value,onScreenChange:name=>screen.value=name},{default:()=>h(KeepAlive,null,{default:()=>h(actualScreens[screen.value]||alternate,{ref:activeScreenRef,key:screen.value,onScreenChange:name=>screen.value=name})})})]);}});
app.use(store).use(router).directive('tooltip',vTooltip).directive('viewport-clamp',vViewportClamp).mount('#app');
window.MOBILE_FIXTURE={getScreen:()=>activeScreenRef.value,actualScreens,agents,tools,workflow,goals,skills,store,router,requests,screen,mobile,outputs,groups,async switch(id){await router.push('/chat?content-id='+id);await nextTick();},stream(value){store.state.chat.isStreaming=value;},setScreen(name){screen.value=name;}};
