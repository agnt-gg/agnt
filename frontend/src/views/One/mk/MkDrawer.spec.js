import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MkDrawer from './MkDrawer.vue';

vi.mock('@/composables/useSpaces.js', () => ({ openTeam: vi.fn(), openPersonal: vi.fn() }));

const mountDrawer = (props) => mount(MkDrawer, { props, global: { directives: { tooltip: {} } } });
const team = (role) => ({ id: 't', name: 'bravo', role, tenantUrl: 'https://bravo.t1.agnt.gg' });

// The approved mockup always has + beside "Teamspaces". The server decides who may create
// one; a client-side role check once hid the button for anyone whose role was not literally 'owner'.
describe('drawer: Teamspaces +', () => {
  it.each(['owner', 'admin', 'member', undefined])('shows + beside Teamspaces for role %s and asks for a new teamspace', async (role) => {
    const wrapper = mountDrawer({ team: team(role), teams: [team(role)], spaces: [] });
    const plus = wrapper.find('[data-testid="new-teamspace"]');
    expect(plus.exists()).toBe(true);
    expect(plus.element.closest('.d-head').textContent).toContain('Teamspaces');
    await plus.trigger('click');
    expect(wrapper.emitted('new-space')).toHaveLength(1);
    expect(wrapper.text()).toContain('No teamspaces yet. Add one with +.');
  });

  it('personal workspace has no Teamspaces group, so no +', () => {
    const wrapper = mountDrawer({ team: null, teams: [], spaces: [] });
    expect(wrapper.find('[data-testid="new-teamspace"]').exists()).toBe(false);
  });
});
