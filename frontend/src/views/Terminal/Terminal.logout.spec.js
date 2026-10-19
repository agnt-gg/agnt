import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
const session=reactive({authenticated:true,onboarding:false});
const route=reactive({path:'/chat',query:{},meta:{terminalScreen:'ChatScreen'}});
const commit=vi.fn();
vi.mock('vue-router',()=>({useRoute:()=>route,useRouter:()=>({push:vi.fn()})}));
vi.mock('vuex',()=>({useStore:()=>({getters:{get 'userAuth/isAuthenticated'(){return session.authenticated},get 'userAuth/shouldShowOnboarding'(){return session.onboarding}},dispatch:vi.fn().mockResolvedValue(),commit})}));
vi.mock('@/utils/chunkRecovery.js',()=>({lazyComponent:(_loader,{name})=>({name,template:name==='SettingsScreen'?'<div data-testid="sign-in">Login</div>':'<div />'})}));
vi.mock('@/views/One/OneShell.vue',()=>({default:{template:'<aside data-testid="one-rail">Navigation<slot /></aside>'}}));
vi.mock('./CenterPanel/screens/Chat/Chat.vue',()=>({default:{template:'<div data-testid="private-chat">Private conversation</div>'}}));
import Terminal from './Terminal.vue';

const stubs={TerminalLayout:{template:'<div><slot /></div>'}};

describe('Root signed-in boundary',()=>{
 it('logout tears down ALL navigation and cached private screens, even before routing finishes',async()=>{
  session.authenticated=true;
  const w=mount(Terminal,{global:{stubs}});
  expect(w.find('[data-testid="one-rail"]').exists()).toBe(true);
  session.authenticated=false;await flushPromises();
  expect(w.findAll('aside')).toHaveLength(0);expect(w.find('[data-testid="private-chat"]').exists()).toBe(false);
  expect(w.find('[data-testid="sign-in"]').exists()).toBe(true);
  route.meta={terminalScreen:'AgentsScreen'};route.path='/agents';await flushPromises();
  expect(w.findAll('aside')).toHaveLength(0);expect(w.find('[data-testid="sign-in"]').exists()).toBe(true);
  w.unmount();route.path='/chat';route.meta={terminalScreen:'ChatScreen'};
 });
});

// AGNT One has no onboarding pages: a new account lands straight in the chat.
describe('First run',()=>{
 it('marks onboarding done instead of showing a modal',async()=>{
  session.authenticated=true;session.onboarding=true;commit.mockClear();
  const w=mount(Terminal,{global:{stubs}});
  expect(commit).toHaveBeenCalledWith('userAuth/COMPLETE_ONBOARDING');
  expect(w.html()).not.toMatch(/onboarding/i);
  expect(w.find('[data-testid="private-chat"]').exists()).toBe(true);
  w.unmount();session.onboarding=false;
 });

 it('leaves a finished account alone',()=>{
  session.authenticated=true;session.onboarding=false;commit.mockClear();
  const w=mount(Terminal,{global:{stubs}});
  expect(commit).not.toHaveBeenCalledWith('userAuth/COMPLETE_ONBOARDING');
  w.unmount();
 });
});
