import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, defineComponent } from 'vue';
const session=reactive({authenticated:true,mode:'focused'});
const route=reactive({path:'/chat',query:{},meta:{terminalScreen:'ChatScreen'}});
vi.mock('vue-router',()=>({useRoute:()=>route,useRouter:()=>({push:vi.fn()})}));
vi.mock('vuex',()=>({useStore:()=>({getters:{get 'userAuth/isAuthenticated'(){return session.authenticated},get 'theme/uiMode'(){return session.mode},'userAuth/shouldShowOnboarding':false},dispatch:vi.fn().mockResolvedValue(),commit:vi.fn()})}));
vi.mock('@/composables/useUiModeDefault.js',()=>({useUiModeDefault:()=>({showTryFocused:false,dismissTryFocused:vi.fn()})}));
vi.mock('@/utils/chunkRecovery.js',()=>({lazyComponent:(_loader,{name})=>({name,template:name==='SettingsScreen'?'<div data-testid="sign-in">Login</div>':'<div />'})}));
vi.mock('@/views/Focused/FocusedShell.vue',()=>({default:{template:'<aside data-testid="focused-sidebar">Navigation<slot /></aside>'}}));
vi.mock('@/canvas/CanvasScreen.vue',()=>({default:{template:'<aside data-testid="studio-sidebar">Navigation<slot /></aside>'}}));
vi.mock('./CenterPanel/screens/Chat/Chat.vue',()=>({default:{template:'<div data-testid="private-chat">Private conversation</div>'}}));
import Terminal from './Terminal.vue';

describe('Root signed-in boundary',()=>{
 it.each(['focused','studio'])('logout tears down ALL %s navigation and cached private screens, even before routing finishes',async mode=>{
  session.mode=mode;session.authenticated=true;
  const w=mount(Terminal,{global:{stubs:{TerminalLayout:{template:'<div><slot /></div>'},OnboardingModal:true,TryFocusedNote:true}}});
  expect(w.find(`[data-testid="${mode}-sidebar"]`).exists()).toBe(true);
  session.authenticated=false;await flushPromises();
  expect(w.findAll('aside')).toHaveLength(0);expect(w.find('[data-testid="private-chat"]').exists()).toBe(false);
  expect(w.find('[data-testid="sign-in"]').exists()).toBe(true);
  route.meta={terminalScreen:'AgentsScreen'};route.path='/agents';await flushPromises();
  expect(w.findAll('aside')).toHaveLength(0);expect(w.find('[data-testid="sign-in"]').exists()).toBe(true);
  w.unmount();route.path='/chat';route.meta={terminalScreen:'ChatScreen'};
 });
});
