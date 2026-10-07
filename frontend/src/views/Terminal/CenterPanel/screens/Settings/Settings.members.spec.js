import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount, mount, flushPromises } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import { createStore } from 'vuex';
import Settings from './Settings.vue';
import MembersSettings from './components/MembersSettings.vue';
import SettingsPanel from '@/views/Terminal/LeftPanel/types/SettingsPanel/SettingsPanel.vue';
import FocusedSettings from '@/views/Focused/FocusedSettings.vue';
import TeamWorkspace from '@/views/_components/one/TeamWorkspace.vue';
import { settingsDirectory } from '@/mobile/sectionDirectories.js';
import { focusedLocation, routeFor } from '@/views/Focused/focusedRoutes.js';
import { screenRoute } from '@/views/Terminal/screenRoute.js';

const route = reactive({ query: {} });
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
const mounted = [];
function store(authenticated = true) {
  const s = createStore({ state: { userAuth: { token: 'fixture', planType: 'personal' }, aiProvider: {} }, getters: { 'userAuth/isAuthenticated': () => authenticated, 'userAuth/planType': () => 'personal' } });
  vi.spyOn(s, 'dispatch').mockResolvedValue(); return s;
}
function studio(authenticated = true, mobile = false) {
  const w = shallowMount(Settings, { global: { plugins: [store(authenticated)], provide: { isMobile: ref(mobile) }, stubs: { BaseScreen: { template: '<div><slot /></div>' } } } });
  mounted.push(w); return w;
}
beforeEach(() => { route.query = {}; localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('Settings → Account → Members', () => {
  it('lives between Profile and Billing in the shared desktop/mobile directory', async () => {
    const account = settingsDirectory.find(g => g.label === 'Account');
    expect(account.items.slice(0, 3).map(i => i.id)).toEqual(['profile', 'members', 'billing']);
    const panel = mount(SettingsPanel); mounted.push(panel);
    await panel.get('[data-section="account"] [data-nav="members"]').trigger('click');
    expect(panel.emitted('panel-action')).toEqual([['settings-nav', 'members']]);
  });
  it('renders the members section on a cold Studio link and follows history navigation', async () => {
    route.query = { section: 'members' }; const w = studio();
    expect(w.findComponent(MembersSettings).exists()).toBe(true);
    route.query = { section: 'profile' }; await flushPromises();
    expect(w.findComponent(MembersSettings).exists()).toBe(false);
    route.query = { section: 'members' }; await flushPromises();
    expect(w.findComponent(MembersSettings).exists()).toBe(true);
  });
  it('desktop and mobile navigation set the canonical section URL', async () => {
    const w = studio(true, true);
    w.vm.mobileSelectSection(settingsDirectory.find(g => g.label === 'Account').items.find(i => i.id === 'members'));
    await flushPromises();
    expect(w.findComponent(MembersSettings).exists()).toBe(true);
    expect(w.vm.mobileDirectoryOpen).toBe(false);
    expect(w.emitted('screen-change').at(-1)).toEqual(['SettingsScreen', { section: 'members' }]);
    w.findComponent(MembersSettings).vm.$emit('open-billing'); await flushPromises();
    expect(w.emitted('screen-change').at(-1)).toEqual(['SettingsScreen', { section: 'billing' }]);
  });
  it('does not mount any membership UI for signed-out users', () => {
    route.query = { section: 'members' }; const w = studio(false);
    expect(w.findComponent(MembersSettings).exists()).toBe(false);
    expect(w.findComponent({ name: 'LoginSection' }).exists()).toBe(true);
  });
  it('Focused has its own Account entry and uses the exact same members implementation', async () => {
    const nav = { go: vi.fn(), studio: vi.fn(), toast: vi.fn() };
    const w = shallowMount(FocusedSettings, { global: { plugins: [store()], provide: { focusedNav: nav } } }); mounted.push(w);
    await w.findAll('button').find(b => b.text().includes('Manage members')).trigger('click');
    expect(nav.go).toHaveBeenCalledWith({ page: 'settings', section: 'members' });
    await w.setProps({ section: 'members' });
    expect(w.findComponent(MembersSettings).exists()).toBe(true);
    expect(w.find('.focused-page-head').exists()).toBe(false);
    await w.find('.focused-page-back').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'settings' });
  });
  it('the section deep link round-trips through the Focused router', () => {
    const loc = { page: 'settings', section: 'members' };
    const [screen, options] = routeFor(loc);
    const target = screenRoute(screen, options);
    expect(target).toMatchObject({ path: '/settings', query: { section: 'members' } });
    expect(focusedLocation(screen, target.query)).toEqual(loc);
    expect(focusedLocation('SettingsScreen', {})).toEqual({ page: 'settings' });
  });
  it('reuses TeamWorkspace, starts in the active team, and forwards membership and billing events', async () => {
    sessionStorage.setItem('agnt.teamScope', JSON.stringify({ teamId: 'research', workspaceId: null }));
    const listener = vi.fn(); window.addEventListener('agnt:team-membership-changed', listener);
    const w = shallowMount(MembersSettings); mounted.push(w);
    const team = w.findComponent(TeamWorkspace);
    expect(team.props()).toMatchObject({ selectedTeamId: 'research', initialTab: 'Members', hideScopeSelector: true });
    team.vm.$emit('update:selectedTeamId', 'engineering'); await flushPromises();
    expect(team.props('selectedTeamId')).toBe('engineering');
    team.vm.$emit('teams-loaded', []); expect(listener).toHaveBeenCalledOnce();
    team.vm.$emit('open-billing'); expect(w.emitted('open-billing')).toHaveLength(1);
    team.vm.$emit('close'); expect(w.emitted('close')).toHaveLength(1);
    window.removeEventListener('agnt:team-membership-changed', listener);
  });
});
