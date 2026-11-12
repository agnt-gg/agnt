import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { createStore } from 'vuex';
import MkAgents from './MkAgents.vue';
import { teamApi } from '@/views/One/team/useTeam.js';

vi.mock('@/views/One/team/useTeam.js', () => ({ teamApi: { native: vi.fn(), lead: vi.fn(), setLead: vi.fn() } }));

// CustomSelect as a native <select>, so a choice is one setValue.
const CustomSelect = {
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
};
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const SALES = { id: 'sales', name: 'Sales' };
const AGENTS = [{ id: 'lead', name: 'Sales Lead', kind: 'agent', status: 'published' }, { id: 'qb', name: 'Quote Builder', kind: 'agent', status: 'published' }, { id: 'ow', name: 'Outreach Writer', kind: 'agent', status: 'published' }, { id: 'idle', name: 'Idle One', kind: 'agent', status: 'draft' }];
const BOARD = [
  { id: 'c1', title: 'Quote for Contoso', status: 'todo', agentState: 'blocked', stopReason: 'prices disagree', assignee: { kind: 'agent', id: 'qb' } },
  { id: 'c2', title: 'Northwind proposal', status: 'doing', agentState: 'running', escalatedFrom: 'qb', assignee: { kind: 'agent', id: 'lead' } },
  { id: 'c3', title: 'Follow-ups', status: 'todo', agentState: 'queued', stopReason: 'Review is full', assignee: { kind: 'agent', id: 'ow' } },
  { id: 'c4', title: 'Done one', status: 'done', approvedAt: hoursAgo(5), sendBackCount: 0, runCost: 0.3, runCostUnknown: 0 },
  { id: 'c5', title: 'Done two', status: 'done', approvedAt: hoursAgo(8), sendBackCount: 1, runCost: 0.5, runCostUnknown: 0 },
  { id: 'c6', title: 'Done three', status: 'done', approvedAt: hoursAgo(9), sendBackCount: 0, runCost: 9, runCostUnknown: 1 },
];

function mountPage({ role = 'owner', lead = { leadAgentId: 'lead', leadRules: 'Settle price gaps under 15%.' } } = {}) {
  teamApi.native.mockResolvedValue(AGENTS);
  teamApi.lead.mockResolvedValue(lead);
  const ctx = {
    team: computed(() => ({ id: 'acme', name: 'Acme' })), spaces: computed(() => [SALES]), role: computed(() => role),
    boards: computed(() => ({ sales: BOARD })), limits: computed(() => ({ sales: { doing: 1, review: null } })),
    loadBoards: vi.fn(async () => {}), go: vi.fn(), toast: vi.fn(), ask: vi.fn(), create: vi.fn(), version: ref(0),
  };
  const store = createStore({ modules: { agents: { namespaced: true, getters: { allAgents: () => [] }, actions: { fetchAgents: () => {} } } } });
  const wrapper = mount(MkAgents, { global: { plugins: [store], provide: { teamCtx: ctx }, stubs: { CustomSelect, MkIcon: true }, directives: { tooltip: {} } } });
  return { wrapper, ctx };
}
const card = (w, id) => w.get(`[data-agent="${id}"]`);

describe('agents as teams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a team shows its work against its limit, first-time acceptance, what stopped, and cost per accepted card over priced cards', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    const kpis = wrapper.get('[data-testid="team-kpis-sales"]').findAll('.tag').map((t) => t.text());
    expect(kpis).toEqual(['1 of 1 in progress · at limit', '67% accepted first time · 7 days', '1 stopped', '$0.40 per accepted card']);
  });

  it('the team lead carries a tag and its rules; each agent says what it is doing', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    expect(card(wrapper, 'lead').text()).toContain('Team lead');
    expect(card(wrapper, 'lead').text()).toContain('Rules: Settle price gaps under 15%.');
    expect(card(wrapper, 'lead').get('[data-testid="agent-state"]').text()).toBe('Deciding on “Northwind proposal”');
    expect(card(wrapper, 'qb').get('[data-testid="agent-state"]').text()).toBe('Stopped: prices disagree');
    expect(card(wrapper, 'ow').get('[data-testid="agent-state"]').text()).toBe('Waiting: Review is full');
    expect(card(wrapper, 'idle').get('[data-testid="agent-state"]').text()).toBe('Idle: no card assigned');
    expect(card(wrapper, 'qb').text()).not.toContain('Team lead');
  });

  it('choosing the team lead and its rules', async () => {
    teamApi.setLead.mockResolvedValue({ leadAgentId: 'qb', leadRules: 'Never move money.' });
    const { wrapper, ctx } = mountPage();
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === 'Team lead').trigger('click');
    const form = wrapper.get('[data-testid="lead-form-sales"]');
    await form.get('select').setValue('qb');
    await form.get('textarea').setValue('Never move money.');
    await form.trigger('submit');
    await flushPromises();
    expect(teamApi.setLead).toHaveBeenCalledWith('sales', 'qb', 'Never move money.');
    expect(ctx.toast).toHaveBeenCalledWith('Team lead saved. It answers this team’s stops first.');
    expect(card(wrapper, 'qb').text()).toContain('Team lead');

    const member = mountPage({ role: 'member' });
    await flushPromises();
    expect(member.wrapper.findAll('button').some((b) => b.text() === 'Team lead')).toBe(false);
  });
});
