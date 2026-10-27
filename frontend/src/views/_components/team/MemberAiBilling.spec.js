import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://instance/api' } }));
import MemberAiBilling from './MemberAiBilling.vue';

let answer;
const calls = [];
beforeEach(() => {
  calls.length = 0;
  global.fetch = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (options.method === 'PUT') {
      const change = JSON.parse(options.body);
      answer = {
        ...answer,
        ...(change.billing ? { billing: change.billing } : {}),
        ...(change.sharedSubscriptions ? { subscriptions: answer.subscriptions.map((s) => ({ ...s, shared: change.sharedSubscriptions.includes(s.id) })) } : {}),
      };
    }
    return { ok: true, json: async () => answer };
  });
});
afterEach(() => { delete global.fetch; });

describe("members' AI", () => {
  it('shows nothing on a desktop', async () => {
    answer = { hosted: false, isOwner: false, billing: 'team', subscriptions: [] };
    const wrapper = mount(MemberAiBilling);
    await flushPromises();
    expect(wrapper.find('.member-ai').exists()).toBe(false);
  });

  it('lets the owner switch to each member paying', async () => {
    answer = { hosted: true, isOwner: true, billing: 'team', subscriptions: [] };
    const wrapper = mount(MemberAiBilling);
    await flushPromises();
    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].element.checked).toBe(true);
    await radios[1].trigger('change');
    await flushPromises();
    expect(calls.at(-1)).toMatchObject({ url: 'http://instance/api/instance/member-ai', method: 'PUT', body: JSON.stringify({ billing: 'member' }) });
    expect(wrapper.findAll('input[type="radio"]')[1].element.checked).toBe(true);
  });

  it('lets the owner share a subscription with the whole team', async () => {
    answer = { hosted: true, isOwner: true, billing: 'team', subscriptions: [{ id: 'claude-code', name: 'Claude Code', shared: false }, { id: 'openai-codex', name: 'OpenAI Codex', shared: true }] };
    const wrapper = mount(MemberAiBilling);
    await flushPromises();
    const boxes = wrapper.findAll('.subscription input[type="checkbox"]');
    expect(boxes.map((b) => b.element.checked)).toEqual([false, true]);
    boxes[0].element.checked = true;
    await boxes[0].trigger('change');
    await flushPromises();
    expect(JSON.parse(calls.at(-1).body)).toEqual({ sharedSubscriptions: ['openai-codex', 'claude-code'] });
    expect(wrapper.findAll('.subscription input[type="checkbox"]').map((b) => b.element.checked)).toEqual([true, true]);
  });

  it('tells a member whose keys and which shared subscriptions they are on, with no controls', async () => {
    answer = { hosted: true, isOwner: false, billing: 'team', subscriptions: [{ id: 'claude-code', name: 'Claude Code', shared: true }] };
    const wrapper = mount(MemberAiBilling);
    await flushPromises();
    expect(wrapper.findAll('input')).toHaveLength(0);
    expect(wrapper.find('.member-line').text()).toMatch(/team's AI keys/);
    expect(wrapper.find('.shared-line').text()).toMatch(/Shared with you by the owner: Claude Code/);
  });

  it('tells a member with nothing shared how to use their own Claude Code or Codex', async () => {
    answer = { hosted: true, isOwner: false, billing: 'member', subscriptions: [] };
    const wrapper = mount(MemberAiBilling);
    await flushPromises();
    expect(wrapper.find('.shared-line').text()).toMatch(/sign in with your own account/);
  });
});
