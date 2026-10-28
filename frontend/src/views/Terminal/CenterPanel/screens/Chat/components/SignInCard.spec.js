/**
 * The sign-in card is the person's half of browser action="signin": it must
 * say WHERE to sign in (the real host), bring the live browser forward when the
 * sign-in is in the chat, and carry the answers back with the sign-in's id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const requests = vi.hoisted(() => []);
const server = vi.hoisted(() => ({ signIn: null, answerStatus: 200 }));

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://api' } }));
vi.mock('@/utils/apiFetch.js', () => ({
  apiFetch: vi.fn(async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    const isAnswer = /\/signin\/(done|cancel|window)$/.test(url);
    const status = isAnswer ? server.answerStatus : 200;
    return { ok: status < 400, status, json: async () => ({ success: status < 400, signIn: server.signIn }) };
  }),
}));

const { default: SignInCard } = await import('./SignInCard.vue');
const { liveFocusRequest, _resetLiveRegistry } = await import('./browserLiveRegistry.js');
const { signInTarget, signInOutcome } = await import('./signInCards.js');

const waiting = (overrides = {}) => ({
  id: 'sid-1', status: 'waiting', mode: 'here', url: 'https://portal.example.com/login', host: 'portal.example.com',
  provider: 'portal.example.com', canUseWindow: true, startedAt: 1, deadline: 2, error: null, ...overrides,
});
const call = (extra = {}) => ({ name: 'browser', args: { action: 'signin' }, ...extra });

let wrapper;
const mountCard = async (toolCall = call(), conversationId = 'c1') => {
  wrapper = mount(SignInCard, { props: { toolCall, conversationId }, global: { directives: { tooltip: {} } } });
  await flushPromises();
};

beforeEach(() => {
  requests.length = 0;
  server.signIn = waiting();
  server.answerStatus = 200;
});
afterEach(() => { wrapper?.unmount(); wrapper = null; _resetLiveRegistry(); });

describe('signInTarget / signInOutcome', () => {
  it('only a browser call with action=signin is a sign-in card', () => {
    expect(signInTarget(call())).toEqual({ url: null, mode: 'auto' });
    expect(signInTarget(call({ args: JSON.stringify({ action: 'signin', url: 'https://x.io', mode: 'window' }) }))).toEqual({ url: 'https://x.io', mode: 'window' });
    expect(signInTarget(call({ args: { action: 'navigate' } }))).toBeNull();
    expect(signInTarget({ name: 'web_scrape', args: { action: 'signin' } })).toBeNull();
    expect(signInTarget(call({ args: '{"action":"sig' }))).toBeNull(); // still streaming
  });

  it('reads the finished call, whatever shape the result arrives in', () => {
    expect(signInOutcome(call())).toBeNull();
    expect(signInOutcome(call({ result: JSON.stringify({ success: true, signedIn: true, url: 'https://a/' }) }))).toMatchObject({ signedIn: true, error: null });
    expect(signInOutcome(call({ result: { success: false, signedIn: false, error: 'The user cancelled the sign-in.' } }))).toMatchObject({ signedIn: false, error: 'The user cancelled the sign-in.' });
    expect(signInOutcome(call({ error: 'boom' }))).toMatchObject({ signedIn: false, error: 'boom' });
  });
});

describe('while the agent waits', () => {
  it('asks the backend about THIS conversation and shows the real host', async () => {
    await mountCard();
    expect(requests[0]).toMatchObject({ url: 'http://api/browser-agent/signin?conversationId=c1', method: 'GET' });
    expect(wrapper.find('.signin-title').text()).toBe('Sign in to portal.example.com');
    expect(wrapper.find('.signin-host').text()).toBe('portal.example.com');
    expect(wrapper.text()).toContain('live browser');
  });

  it('brings the live browser forward once per sign-in, not on every poll', async () => {
    await mountCard();
    expect(liveFocusRequest('c1')).toMatchObject({ seq: 1, open: true });
    wrapper.vm.$forceUpdate(); await flushPromises();
    expect(liveFocusRequest('c1').seq).toBe(1);
    await wrapper.find('.signin-button.is-primary').trigger('click'); // "Sign in here" asks again, on purpose
    expect(liveFocusRequest('c1').seq).toBe(2);
  });

  it('a window sign-in says so, offers Done, and does not pull the live browser forward', async () => {
    server.signIn = waiting({ mode: 'window', status: 'window', url: 'https://accounts.google.com/v3/signin/identifier', provider: 'Google' });
    await mountCard();
    expect(wrapper.find('.signin-title').text()).toBe('Sign in to Google');
    expect(wrapper.text()).toContain('A browser window is open at accounts.google.com');
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(["I'm signed in", 'Cancel']);
    expect(liveFocusRequest('c1')).toBeNull();
  });

  it('answers carry the sign-in id and the conversation', async () => {
    await mountCard();
    const byText = (text) => wrapper.findAll('button').find((b) => b.text() === text);
    await byText('Use a browser window').trigger('click'); await flushPromises();
    await byText("I'm signed in").trigger('click'); await flushPromises();
    const answers = requests.filter((r) => r.method === 'POST');
    expect(answers.map((r) => r.url)).toEqual(['http://api/browser-agent/signin/window', 'http://api/browser-agent/signin/done']);
    expect(answers.every((r) => r.body.id === 'sid-1' && r.body.conversationId === 'c1')).toBe(true);
  });

  it('an answer to a sign-in that already ended says so', async () => {
    server.answerStatus = 409;
    await mountCard();
    await wrapper.findAll('button').find((b) => b.text() === 'Cancel').trigger('click'); await flushPromises();
    expect(wrapper.find('.signin-problem').text()).toBe('That sign-in has already ended.');
  });

  it('no window offer on a surface that cannot use one', async () => {
    server.signIn = waiting({ canUseWindow: false });
    await mountCard();
    expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('Use a browser window');
  });
});

describe('when it is over', () => {
  it('signed in: says it is saved, stops asking, and sends the live browser back', async () => {
    await mountCard();
    const polls = requests.length;
    await wrapper.setProps({ toolCall: call({ result: { success: true, signedIn: true, url: 'https://portal.example.com/home' } }) });
    await flushPromises();
    expect(wrapper.find('.signin-title').text()).toBe('Signed in');
    expect(wrapper.text()).toContain('Every conversation and workflow uses this login');
    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(liveFocusRequest('c1')).toMatchObject({ open: false });
    await new Promise((r) => { setTimeout(r, 1700); });
    expect(requests.length).toBe(polls);
  });

  it('not signed in: shows why, from the tool result', async () => {
    await mountCard(call({ result: { success: false, signedIn: false, error: 'The user cancelled the sign-in.' } }));
    expect(wrapper.find('.signin-title').text()).toBe('Not signed in');
    expect(wrapper.text()).toContain('The user cancelled the sign-in.');
    expect(requests).toHaveLength(0); // a finished call never polls
  });
});
