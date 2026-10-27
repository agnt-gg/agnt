import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

// Reported on the 2026-10-27 call: adding seats meant leaving the app for
// agnt.gg/account; the app's Billing page had no way to do it.
const tenantRequest = vi.fn();
vi.mock('@/utils/teamClient.js', () => ({ tenantRequest: (...a) => tenantRequest(...a) }));
const { default: TeamSeats } = await import('./TeamSeats.vue');
const { seatActionLabel } = await import('./teamSeats.js');

const GENII = { slug: 'genii', isOwner: true, plan: 'business', status: 'running' };
const detail = (used, total) => ({ slug: 'genii', seats: { used, total } });

describe('TeamSeats', () => {
  beforeEach(() => {
    tenantRequest.mockReset();
    global.fetch = vi.fn();
    localStorage.setItem('token', 'owner-token');
  });

  it('shows the owned Business instance\'s seats and buys more with the subscription endpoint', async () => {
    tenantRequest.mockImplementation(async (path) => (path === '' ? { tenants: [GENII] } : detail(6, 6)));
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Seats updated: 7.' }), { status: 200 }));
    const wrapper = mount(TeamSeats);
    await flushPromises();
    expect(wrapper.text()).toContain('6 of 6 seats in use');
    const [fewer, more] = wrapper.findAll('.seat-stepper button');
    expect(fewer.attributes('disabled')).toBeDefined(); // never below the six people already in
    await more.trigger('click');
    const save = wrapper.find('.seat-stepper .primary');
    expect(save.text()).toBe('Add 1 seat');
    await save.trigger('click');
    await flushPromises();
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/users\/subscription\/seats$/);
    expect(JSON.parse(init.body)).toEqual({ seats: 7 });
    expect(init.headers.Authorization).toBe('Bearer owner-token');
    expect(wrapper.text()).toContain('Seats updated: 7.');
  });

  it('an operator\'s instance (no Stripe subscription) is sized through the instance route', async () => {
    tenantRequest.mockImplementation(async (path) => (path === '' ? { tenants: [GENII] } : detail(2, 3)));
    global.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'No active subscription found', reason: 'no_subscription' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'ok' }), { status: 200 }));
    const wrapper = mount(TeamSeats);
    await flushPromises();
    await wrapper.findAll('.seat-stepper button')[1].trigger('click');
    await wrapper.find('.seat-stepper .primary').trigger('click');
    await flushPromises();
    expect(global.fetch.mock.calls[1][0]).toMatch(/\/tenants\/genii\/seats$/);
  });

  it('a refusal is shown in the server\'s words', async () => {
    tenantRequest.mockImplementation(async (path) => (path === '' ? { tenants: [GENII] } : detail(3, 3)));
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Team seats are part of Business Cloud. Upgrade first, then add seats.', reason: 'not_business' }), { status: 400 }));
    const wrapper = mount(TeamSeats);
    await flushPromises();
    await wrapper.findAll('.seat-stepper button')[1].trigger('click');
    await wrapper.find('.seat-stepper .primary').trigger('click');
    await flushPromises();
    expect(wrapper.find('.seat-note.error').text()).toContain('Upgrade first');
  });

  it('renders nothing for someone who owns no Business instance', async () => {
    tenantRequest.mockResolvedValue({ tenants: [{ ...GENII, isOwner: false }] });
    const wrapper = mount(TeamSeats);
    await flushPromises();
    expect(wrapper.find('.team-seats').exists()).toBe(false);
  });

  it('labels the change it will make', () => {
    expect(seatActionLabel(0)).toBe('Update seats');
    expect(seatActionLabel(2)).toBe('Add 2 seats');
    expect(seatActionLabel(-1)).toBe('Remove 1 seat');
  });
});
