import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import CanvasScreen from './CanvasScreen.vue';
import WorkspaceSwitcher from './WorkspaceSwitcher.vue';
import TeamWorkspace from '@/views/_components/one/TeamWorkspace.vue';
import { NAVIGATION_CHANGED_EVENT, updateNavigationItem } from '@/services/navigationPreferences.js';
import { ONION_STORAGE_KEY } from '@/services/navigationOnion.js';
const mounted=[];
// The account under test has already earned these rows (see navigationOnion.js);
// what is asserted below is how the rail renders and routes them.
const EARNED=['goals','artifacts','library','teams'];
const teams=[{id:'engineering',name:'Engineering',role:'owner',tenantUrl:'https://engineering.agnt.gg'},{id:'research',name:'Research',role:'member',tenantUrl:'https://research.agnt.gg'}];
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});localStorage.clear();localStorage.setItem(ONION_STORAGE_KEY,JSON.stringify({version:1,unlocked:EARNED,seeded:EARNED,fresh:[]}));vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>teams})));});
afterEach(()=>{mounted.splice(0).forEach(w=>w.unmount());vi.unstubAllGlobals();document.body.innerHTML='';delete window.electron;sessionStorage.clear();});
function spaceHost(){const host={list:vi.fn(async()=>({spaces:[],activeId:'primary'})),switch:vi.fn(async()=>({ok:true})),syncTeams:vi.fn(async()=>({ok:true})),onChanged:vi.fn(()=>()=>{})};window.electron={spaces:host};return host;}
function setup(planType='free'){const pages=[{id:'chat',name:'Chat',route:'ChatScreen'},{id:'goal',name:'Goals',route:'GoalsScreen'},{id:'custom',name:'Scratch',route:'custom:scratch'}];const store=createStore({modules:{
 userAuth:{namespaced:true,state:()=>({token:'user-1',plan:planType}),getters:{isAuthenticated:()=>true,planType:s=>s.plan}},
 aiProvider:{namespaced:true,state:()=>({selectedProvider:'openai',selectedModel:'gpt-4o'})},
 widgetLayout:{namespaced:true,state:()=>({pages}),getters:{allPages:s=>s.pages,activePageId:()=> 'custom',activePage:()=>pages[2],isLoaded:()=>true,pageForRoute:s=>route=>s.pages.find(p=>p.route===route)},actions:{setActivePage:vi.fn(),createPageFromDefault:vi.fn(),fetchLayouts:vi.fn()}},
 shell:{namespaced:true,state:()=>({jump:false}),getters:{jumpOpen:s=>s.jump,inspect:()=>null,updateAvailable:()=>false},mutations:{open(s){s.jump=true}},actions:{openJump({commit}){commit('open')},toggleJump({commit}){commit('open')}}}},
 getters:{'contentOutputs/unreadOutputIdSet':()=>new Set(['unread']),'chat/streamingOutputIds':()=>new Set()},
});const wrapper=mount(CanvasScreen,{attachTo:document.body,props:{screenName:'ChatScreen'},slots:{default:'<input id="personal-draft" value="keep my draft" />'},global:{plugins:[store],directives:{tooltip:{}},stubs:{Tooltip:{template:'<div class="tooltip-container"><slot /></div>'},WidgetCanvas:true,WidgetCatalog:true,ChatProviderSelector:true,SimpleModal:true,PanelBackdrop:true,JumpPalette:true,TeamWorkspace:{name:'TeamWorkspace',props:['selectedTeamId','initialTab','hideScopeSelector'],emits:['close','update:selectedTeamId','teams-loaded'],template:'<section class="team-fixture">{{selectedTeamId}} {{initialTab}}</section>'}}}});mounted.push(wrapper);return{wrapper,store};}
describe('reference sidebar ordering and context',()=>{
 // The rail renders the Settings → Navigation registry verbatim. Search is the
 // only hardcoded row above it, because it opens the palette instead of going
 // anywhere. Nothing is filtered out: the rail used to drop chat, goals and
 // artifacts — the exact three that ship visible — so its configurable half
 // rendered nothing and Settings described a sidebar nobody had.
 // The rail lists DESTINATIONS only. Search is an action, it lives on the
 // jump bar above the canvas, and a row for it here was a second door to the
 // same palette taking up the most valuable slot in the nav.
 it('renders the settings registry verbatim, with the space picker in the top bar and no Search row',async()=>{const{wrapper}=setup();await flushPromises();const rail=wrapper.find('.cv-sidebar');expect(rail.find('.workspace-switcher').exists()).toBe(false);const right=wrapper.find('.cv-right');const controls=[...right.element.children].map(e=>e.classList.contains('workspace-switcher')?'space':e.querySelector?.('.cv-global-model')?'model':null).filter(Boolean);expect(controls).toEqual(['model','space']);expect(wrapper.findAll('[data-primary]')).toHaveLength(0);expect(rail.find('.cv-primary-nav').exists()).toBe(false);expect(wrapper.findAll('.cv-sb-pages .cv-sb-page').map(b=>b.attributes('aria-label'))).toEqual(['Chat','Goals','Files','Scratch']);expect(wrapper.findAll('.cv-sb-pages .cv-sb-cap-text').map(c=>c.text())).toEqual(['WORK','PLAN','PERSONAL']);expect(wrapper.find('[data-tour-id="sidebar.library"]').exists()).toBe(false);expect(wrapper.findComponent(WorkspaceSwitcher).props('modelValue')).toBe('');expect(wrapper.find('.cv-right .workspace-toolbar-btn').text()).toContain('Personal');expect(wrapper.findAll('.cv-sb-pages [data-tour-id="sidebar.chat"]')).toHaveLength(1);expect(wrapper.findAll('.cv-sb-pages [data-tour-id="sidebar.goals"]')).toHaveLength(1);});
 it('follows Settings when a row is hidden, regrouped or reordered',async()=>{const{wrapper}=setup();await flushPromises();updateNavigationItem('section:goals',{visible:false});updateNavigationItem('page:custom',{group:'Focus'});updateNavigationItem('section:store',{visible:true});window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED_EVENT));await flushPromises();expect(wrapper.findAll('.cv-sb-pages .cv-sb-page').map(b=>b.attributes('aria-label'))).toEqual(['Chat','Market','Files','Scratch']);expect(wrapper.findAll('.cv-sb-pages .cv-sb-cap-text').map(c=>c.text())).toEqual(['WORK','PLAN','FOCUS']);});
 // Library is no longer a Studio row (BUILD lists every kind of thing you made), so the
 // membership management now routes through Settings instead of a virtual row.
 it('workspace management navigates to Settings without covering the personal screen',async()=>{const{wrapper}=setup();await flushPromises();const draft=wrapper.find('#personal-draft').element;wrapper.findComponent(WorkspaceSwitcher).vm.$emit('select','__manage');await flushPromises();expect(wrapper.emitted('screen-change').at(-1)).toEqual(['SettingsScreen',{section:'members'}]);expect(wrapper.find('.team-fixture').exists()).toBe(false);expect(wrapper.find('#personal-draft').element).toBe(draft);expect(wrapper.find('[data-tour-id="sidebar.teams"]').exists()).toBe(false);await wrapper.find('.cv-sb-pages [data-tour-id="sidebar.goals"]').trigger('click');expect(wrapper.emitted('screen-change').at(-1)[0]).toBe('GoalsScreen');});
 it('still opens the palette from the jump bar above the canvas',async()=>{const{wrapper,store}=setup();await flushPromises();await wrapper.find('[data-tour-id="toolbar.jump"]').trigger('click');expect(store.getters['shell/jumpOpen']).toBe(true)});

 // An offer, not a destination: it sits below Settings, is the same button as
 // every other row, and opens billing rather than a screen of its own.
 it('offers Upgrade under Settings on a free plan, and opens billing',async()=>{const{wrapper}=setup('free');await flushPromises();
  const upgrade=wrapper.find('[data-tour-id="sidebar.upgrade"]');
  expect(upgrade.exists()).toBe(true);
  expect(upgrade.text()).toContain('Upgrade');
  expect(upgrade.classes()).toContain('cv-sb-page');
  const foot=wrapper.find('.cv-sb-bottom').findAll('button');
  // The foot reads Settings, then Profile (the account menu), then the offer.
  expect(foot.map(b=>b.attributes('data-tour-id')).slice(-3)).toEqual(['sidebar.settings','sidebar.profile','sidebar.upgrade']);
  await upgrade.trigger('click');
  expect(wrapper.emitted('screen-change').at(-1)).toEqual(['SettingsScreen',{section:'billing'}]);
 });

 // Focused's account menu, in Studio: the profile, the switch to Focused, and
 // sign-out, one click from the rail.
 it('the Profile button under Settings opens the account menu: Profile, Switch to Focused, Log out',async()=>{const{wrapper,store}=setup('pro');await flushPromises();
  const dispatch=vi.spyOn(store,'dispatch').mockResolvedValue();
  const profile=wrapper.find('[data-tour-id="sidebar.profile"]');
  expect(profile.classes()).toContain('cv-sb-page');
  expect(document.body.querySelector('.cv-profile-menu')).toBeNull();
  await profile.trigger('click');
  expect(profile.attributes('aria-expanded')).toBe('true');
  const menu=()=>document.body.querySelector('.cv-profile-menu');
  expect([...menu().querySelectorAll('[role="menuitem"]')].map(b=>b.textContent.replace(/Ctrl Shift S/,'').trim())).toEqual(['Profile','Switch to Focused','Log out']);
  menu().querySelector('[data-testid="switch-to-focused"]').click();await flushPromises();
  expect(dispatch).toHaveBeenCalledWith('theme/setUiMode','focused');
  expect(menu()).toBeNull(); // choosing closes it
  await profile.trigger('click');
  menu().querySelector('[data-testid="open-profile"]').click();await flushPromises();
  expect(wrapper.emitted('screen-change').at(-1)).toEqual(['SettingsScreen',{section:'profile'}]);
  await profile.trigger('click');
  document.body.querySelector('.cv-profile-scrim').click();await flushPromises();
  expect(menu()).toBeNull(); // a click outside closes it
  await profile.trigger('click');
  menu().querySelector('[data-testid="studio-logout"]').click();await flushPromises();
  expect(dispatch).toHaveBeenCalledWith('userAuth/logout');
  expect(wrapper.emitted('screen-change').at(-1)).toEqual(['SettingsScreen',{section:'general'}]);
 });

 // Selling Pro to someone who already pays for it reads as a billing bug.
 it.each(['pro','enterprise','founder'])('hides Upgrade on the %s plan',async(plan)=>{const{wrapper}=setup(plan);await flushPromises();
  expect(wrapper.find('[data-tour-id="sidebar.upgrade"]').exists()).toBe(false);
 });
 // Choosing a team switches the WHOLE app to that team's own space. The personal
 // page underneath is never relabelled as shared: it keeps saying Personal and
 // keeps its draft, because it still is personal.
 it('switches the whole app to a team through the space host, never relabelling the personal page',async()=>{const host=spaceHost();const{wrapper}=setup();await flushPromises();expect(host.syncTeams).toHaveBeenCalledWith([{id:'engineering',name:'Engineering',tenantUrl:'https://engineering.agnt.gg'},{id:'research',name:'Research',tenantUrl:'https://research.agnt.gg'}],{replace:true});const picker=wrapper.findComponent(WorkspaceSwitcher);picker.vm.$emit('select','engineering');await flushPromises();expect(host.switch).toHaveBeenCalledWith('team:engineering',{projectId:null});expect(picker.props('modelValue')).toBe('');expect(wrapper.find('.cv-right .workspace-toolbar-btn').text()).toBe('Personal');expect(wrapper.findComponent({name:'TeamWorkspace'}).exists()).toBe(false);expect(wrapper.find('#personal-draft').element.value).toBe('keep my draft');host.switch.mockClear();picker.vm.$emit('select','');await flushPromises();expect(host.switch).not.toHaveBeenCalled();});
 it('legacy team-open events route to Settings Members',async()=>{const{wrapper}=setup();await flushPromises();window.dispatchEvent(new CustomEvent('agnt:open-team-workspace'));expect(wrapper.emitted('screen-change').at(-1)).toEqual(['SettingsScreen',{section:'members'}]);expect(wrapper.findComponent({name:'TeamWorkspace'}).exists()).toBe(false);});
 it('a page opened in a team says so, and keeps saying so after the query string is gone',async()=>{sessionStorage.setItem('agnt.teamScope',JSON.stringify({teamId:'research',workspaceId:null}));const{wrapper}=setup();await flushPromises();expect(wrapper.findComponent(WorkspaceSwitcher).props('modelValue')).toBe('research');expect(wrapper.find('.cv-right .workspace-toolbar-btn').text()).toContain('Research');const host=spaceHost();wrapper.findComponent(WorkspaceSwitcher).vm.$emit('select','');await flushPromises();expect(host.switch).toHaveBeenCalledWith('primary');});
 it('refreshes the space picker when Settings reports membership changes',async()=>{const{wrapper}=setup();await flushPromises();global.fetch.mockResolvedValue({ok:true,json:async()=>[...teams,{id:'design',name:'Design',role:'owner'}]});window.dispatchEvent(new CustomEvent('agnt:team-membership-changed'));await flushPromises();expect(wrapper.findComponent(WorkspaceSwitcher).props('teams').map(t=>t.name)).toContain('Design');});
 it('clears cached workspace membership on identity change',async()=>{const{wrapper,store}=setup();await flushPromises();global.fetch.mockResolvedValue({ok:true,json:async()=>[]});store.state.userAuth.token='user-2';await flushPromises();expect(wrapper.findComponent(WorkspaceSwitcher).props('teams')).toEqual([]);expect(wrapper.find('.team-fixture').exists()).toBe(false)});
 it('keeps custom pages on the rail and sends Manage to Settings instead of an overlay',async()=>{const{wrapper}=setup();await flushPromises();const scratch=wrapper.findAll('.cv-sb-pages button').find(b=>b.text().includes('Scratch'));await scratch.trigger('click');expect(wrapper.find('widget-canvas-stub').exists()).toBe(true);wrapper.findComponent(WorkspaceSwitcher).vm.$emit('select','__manage');await flushPromises();expect(wrapper.emitted('screen-change').at(-1)).toEqual(['SettingsScreen',{section:'members'}]);expect(wrapper.find('.team-fixture').exists()).toBe(false);});
 // Measured 2026-09-26: signing in at bravo.t1.agnt.gg (the bravo team's own instance) landed in
 // "Personal" on the team's server, and a second "bravo" entry was the same place again.
 it('a page served by a team\'s own instance IS that team, and offers no personal mode there',async()=>{const own={id:'own-team',name:'Own',role:'owner',tenantUrl:window.location.origin};const urls=[];global.fetch.mockImplementation(async url=>{urls.push(String(url));return{ok:true,json:async()=>(String(url).endsWith('/workspaces/default')?{id:'general'}:[own,...teams])};});const{wrapper}=setup();await flushPromises();const switcher=wrapper.findComponent(WorkspaceSwitcher);expect(switcher.props('modelValue')).toBe('own-team');expect(wrapper.find('.cv-right .workspace-toolbar-btn').text()).toContain('Own');expect(JSON.parse(localStorage.getItem('agnt.instanceTeam'))).toMatchObject({origin:window.location.origin,teamId:'own-team'});expect(urls.filter(u=>u.endsWith('/teams/own-team/workspaces/default'))).toHaveLength(1);switcher.vm.$emit('select','');await flushPromises();expect(switcher.props('error')).toMatch(/shared workspace/);expect(wrapper.find('.cv-right .workspace-toolbar-btn').classes()).toContain('has-error');expect(wrapper.find('.cv-right .workspace-toolbar-btn').attributes('aria-label')).toMatch(/shared workspace/);expect(switcher.props('modelValue')).toBe('own-team');localStorage.removeItem('agnt.instanceTeam');});
 it('stops calling a page its team once the team list no longer includes it',async()=>{localStorage.setItem('agnt.instanceTeam',JSON.stringify({origin:window.location.origin,teamId:'gone',name:'Gone'}));const{wrapper}=setup();await flushPromises();expect(localStorage.getItem('agnt.instanceTeam')).toBeNull();expect(wrapper.findComponent(WorkspaceSwitcher).props('teams').map(t=>t.id)).not.toContain('gone');});
 it('shows team-load failure without claiming a team is selected',async()=>{global.fetch.mockResolvedValue({ok:false,status:503});const{wrapper}=setup();await flushPromises();expect(wrapper.findComponent(WorkspaceSwitcher).props('error')).toContain('Cannot load');expect(wrapper.find('.cv-right .workspace-toolbar-btn').attributes('aria-label')).toContain('Cannot load');expect(wrapper.findComponent(WorkspaceSwitcher).props('modelValue')).toBe('')});
});
describe('controlled team panel selection',()=>{
 it('loads shell selection and emits changes from team selection',async()=>{global.fetch.mockImplementation(async url=>({ok:true,json:async()=>url.endsWith('/teams')?teams:[]}));const store=createStore({state:{userAuth:{token:'t'}},getters:{'agents/allAgents':()=>[],'workflows/allWorkflows':()=>[],'skills/allSkills':()=>[]}});const wrapper=mount(TeamWorkspace,{props:{selectedTeamId:'engineering',initialTab:'Members',hideScopeSelector:true},global:{plugins:[store],directives:{tooltip:{}}}});mounted.push(wrapper);await flushPromises();expect(wrapper.find('header [role="combobox"]').exists()).toBe(false);expect(wrapper.find('nav .active').text()).toBe('Members');expect(wrapper.emitted('teams-loaded')[0][0]).toEqual(teams);expect(global.fetch.mock.calls.some(([url])=>url.includes('/engineering/members'))).toBe(true);await wrapper.setProps({selectedTeamId:'research',initialTab:'Assets'});await flushPromises();expect(global.fetch.mock.calls.some(([url])=>url.includes('/research/assets'))).toBe(false);expect(wrapper.find('nav .active').text()).toBe('Library');await wrapper.setProps({initialTab:'Members'});await flushPromises();expect(global.fetch.mock.calls.some(([url])=>url.includes('/research/members'))).toBe(true);});
});
