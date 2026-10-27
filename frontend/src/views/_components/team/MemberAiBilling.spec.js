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
    if (options.method === 'PUT') answer = { ...answer, billing: JSON.parse(options.body).billing };
    return { ok: true, json: async () => answer };
  });
});
afterEach(() => { delete global.fetch; });

describe("who pays for members' AI", () => {
  it('shows nothing on a desktop', async () => {
    answer = { hosted: false, isOwner: false, billing: 'team' };
    const wrapper = mount(MemberAiBilling);
    await flushPromises();
    expect(wrapper.find('.member-ai').exists()).toBe(false);
  });

  it('lets the owner switch to each member paying', async () => {
    answer = { hosted: true, isOwner: true, billing: 'team' };
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

  it("tells a member whose keys they are on, with no controls", async () => {
    answer = { hosted: true, isOwner: false, billing: 'team' };
    const wrapper = mount(MemberAiBilling);
    await flushPromises();
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(0);
    expect(wrapper.find('.member-line').text()).toMatch(/team's AI keys/);
  });
});
