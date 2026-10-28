/**
 * Settings › Browser: the agent's logins, and a way to add one. Signing out
 * must be a deliberate two-step act, and "Open sign-in window" must hand the
 * page the window's state until it closes — then show the fresh list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const requests = vi.hoisted(() => []);
const server = vi.hoisted(() => ({ sites: [], signIn: null, last: null, startStatus: 200, forgetBody: null }));

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://api' } }));
vi.mock('@/utils/apiFetch.js', () => ({
  apiFetch: vi.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method: options.method || 'GET', body });
    const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
    if (url.endsWith('/browser-agent/sites')) return reply(200, { success: true, signingIn: Boolean(server.signIn), sites: server.sites });
    if (url.includes('/browser-agent/signin?scope=settings')) return reply(200, { success: true, signIn: server.signIn, last: server.last });
    if (url.endsWith('/signin/start')) {
      if (server.startStatus !== 200) return reply(server.startStatus, { success: false, error: 'A sign-in window is already open.' });
      server.signIn = { id: 'sid-9', status: 'window', mode: 'window', host: new URL(body.url).host };
      return reply(200, { success: true, signIn: server.signIn });
    }
    if (url.endsWith('/sites/forget')) {
      server.sites = server.sites.filter((s) => s.site !== body.site);
      return reply(200, server.forgetBody || { success: true, removed: 2, remaining: 0, sites: server.sites });
    }
    return reply(200, { success: true });
  }),
}));

const { default: BrowserSitesSection } = await import('./BrowserSitesSection.vue');

let wrapper;
const mountSection = async () => {
  wrapper = mount(BrowserSitesSection, { global: { directives: { tooltip: {} } } });
  await flushPromises();
};
const button = (text) => wrapper.findAll('button').find((b) => b.text() === text);

beforeEach(() => {
  requests.length = 0;
  server.sites = [
    { site: 'google.com', cookies: 12, session: false, expires: '2027-04-01T00:00:00.000Z' },
    { site: 'partnerstack.com', cookies: 3, session: true, expires: null },
  ];
  server.signIn = null;
  server.last = null;
  server.startStatus = 200;
  server.forgetBody = null;
});
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.useRealTimers(); });

describe('the list', () => {
  it('shows each site the agent holds cookies for', async () => {
    await mountSection();
    expect(wrapper.findAll('.browser-sites-name').map((n) => n.text())).toEqual(['google.com', 'partnerstack.com']);
    expect(wrapper.text()).toContain('12 cookies');
    expect(wrapper.text()).toContain('3 cookies · this session');
  });

  it('signing out takes two clicks, and names the site on the second', async () => {
    await mountSection();
    await wrapper.findAll('.browser-sites-row')[0].findAll('button').find((b) => b.text() === 'Sign out').trigger('click');
    expect(requests.some((r) => r.url.endsWith('/sites/forget'))).toBe(false);
    await button('Sign out of google.com').trigger('click');
    await flushPromises();
    expect(requests.find((r) => r.url.endsWith('/sites/forget')).body).toEqual({ site: 'google.com' });
    expect(wrapper.findAll('.browser-sites-name').map((n) => n.text())).toEqual(['partnerstack.com']);
  });

  it('a sign-out that left cookies behind says so', async () => {
    server.forgetBody = { success: false, removed: 1, remaining: 1, sites: server.sites };
    await mountSection();
    await wrapper.findAll('button').find((b) => b.text() === 'Sign out').trigger('click');
    await button('Sign out of google.com').trigger('click');
    await flushPromises();
    expect(wrapper.find('.browser-sites-problem').text()).toContain("google.com's cookies could not be removed");
  });
});

describe('"Open sign-in window"', () => {
  it('opens the window at the address (https assumed), shows its state, then the fresh list when it closes', async () => {
    vi.useFakeTimers();
    await mountSection();
    await wrapper.find('.browser-sites-input').setValue('accounts.google.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(requests.find((r) => r.url.endsWith('/signin/start')).body).toEqual({ url: 'https://accounts.google.com' });
    expect(wrapper.find('.browser-sites-window').text()).toContain('A browser window is open at accounts.google.com');

    // Done goes to the settings sign-in, by id.
    await button("I'm signed in").trigger('click');
    await flushPromises();
    expect(requests.find((r) => r.url.endsWith('/signin/done')).body).toEqual({ scope: 'settings', id: 'sid-9' });

    // The window closes; the next check sees it gone and reloads the list.
    server.signIn = null;
    server.last = { outcome: 'finished', host: 'accounts.google.com' };
    server.sites = [...server.sites, { site: 'example.com', cookies: 1, session: true, expires: null }];
    const listReads = requests.filter((r) => r.url.endsWith('/browser-agent/sites')).length;
    await vi.advanceTimersByTimeAsync(1600);
    await flushPromises();
    expect(wrapper.find('.browser-sites-window').exists()).toBe(false);
    expect(wrapper.find('.browser-sites-note').text()).toContain('accounts.google.com is in the list below');
    expect(requests.filter((r) => r.url.endsWith('/browser-agent/sites')).length).toBe(listReads + 1);
    expect(wrapper.findAll('.browser-sites-name').map((n) => n.text())).toContain('example.com');
  });

  it('a refusal from the server is shown, and nothing is left looking open', async () => {
    server.startStatus = 400;
    await mountSection();
    await wrapper.find('.browser-sites-input').setValue('https://example.com/login');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.browser-sites-problem').text()).toBe('A sign-in window is already open.');
    expect(wrapper.find('.browser-sites-window').exists()).toBe(false);
  });

  it('picks up a window that was already open when the page loaded', async () => {
    server.signIn = { id: 'sid-1', status: 'window', mode: 'window', host: 'github.com' };
    await mountSection();
    expect(wrapper.find('.browser-sites-window').text()).toContain('github.com');
    expect(requests.some((r) => r.url.endsWith('/browser-agent/sites'))).toBe(false);
  });
});
