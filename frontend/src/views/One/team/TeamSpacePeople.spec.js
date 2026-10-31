import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TeamSpacePeople from './TeamSpacePeople.vue';
import { teamApi } from './useTeam.js';

vi.mock('./useTeam.js', () => ({ teamApi: { setSpaceMember: vi.fn() } }));

const people = [
  { id: 'me', name: 'Nathan Wilbanks', role: 'owner', isMe: true },
  { id: 'jess', name: 'Jess Park', role: 'member', isMe: false },
  { id: 'marco', name: 'Marco Diaz', role: 'member', isMe: false },
];
const mountPeople = (props) => mount(TeamSpacePeople, {
  props: { space: { id: 'hr', name: 'HR' }, teamName: 'Bravo', people, memberIds: ['me', 'jess'], canManage: true, ...props },
  global: { directives: { tooltip: {} }, stubs: { Teleport: true } },
});

// The approved mockup's "People in <space>": a tick for who is in; toggling adds or removes them.
describe('People in a teamspace', () => {
  beforeEach(() => teamApi.setSpaceMember.mockReset());

  it('ticks who is in, and you cannot take yourself out', () => {
    const wrapper = mountPeople();
    expect(wrapper.text()).toContain('People in HR');
    expect(wrapper.get('[data-testid="space-person-jess"]').classes()).toContain('on');
    expect(wrapper.get('[data-testid="space-person-marco"]').classes()).not.toContain('on');
    expect(wrapper.get('[data-testid="space-person-me"]').attributes('disabled')).toBeDefined();
  });

  it('adds someone who is out and removes someone who is in, reporting the new list', async () => {
    teamApi.setSpaceMember.mockResolvedValueOnce({ access: 'invited', memberIds: ['me', 'jess', 'marco'] });
    const wrapper = mountPeople();
    await wrapper.get('[data-testid="space-person-marco"]').trigger('click');
    await flushPromises();
    expect(teamApi.setSpaceMember).toHaveBeenCalledWith('hr', 'marco', true);
    expect(wrapper.emitted('changed')[0][0].memberIds).toEqual(['me', 'jess', 'marco']);
    teamApi.setSpaceMember.mockResolvedValueOnce({ access: 'invited', memberIds: ['me'] });
    await wrapper.get('[data-testid="space-person-jess"]').trigger('click');
    await flushPromises();
    expect(teamApi.setSpaceMember).toHaveBeenLastCalledWith('hr', 'jess', false);
  });

  it('shows the server\u2019s reason when a change is refused', async () => {
    teamApi.setSpaceMember.mockRejectedValueOnce(new Error('Only owners and admins manage access'));
    const wrapper = mountPeople();
    await wrapper.get('[data-testid="space-person-marco"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('error')[0]).toEqual(['Only owners and admins manage access']);
  });

  it('is read-only for members and for the default teamspace', () => {
    expect(mountPeople({ canManage: false }).get('[data-testid="space-person-marco"]').attributes('disabled')).toBeDefined();
    const general = mountPeople({ isDefault: true, memberIds: ['me', 'jess', 'marco'] });
    expect(general.text()).toContain('Everyone on Bravo is in HR.');
    expect(general.get('[data-testid="space-person-marco"]').attributes('disabled')).toBeDefined();
  });
});
