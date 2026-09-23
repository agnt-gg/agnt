import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import ShareButton from './ShareButton.vue';
import ShareSheet from './ShareSheet.vue';
import ReceiveShareDialog from './ReceiveShareDialog.vue';
import { closeShare, closeReceive } from '@/composables/useShare.js';

const wrappers = [];
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount());
  closeShare(); closeReceive();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

/** A fake backend: every call recorded, answers keyed by URL. */
function backend(answers = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const call = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    const key = Object.keys(answers).find(pattern => url.includes(pattern) && (!answers[pattern].method || answers[pattern].method === call.method));
    const answer = key ? answers[key] : { body: {} };
    return { ok: (answer.status || 200) < 400, status: answer.status || 200, json: async () => (typeof answer.body === 'function' ? answer.body(call) : answer.body) };
  }));
  return calls;
}
const global = { directives: { tooltip: {} } };
function mountShare(props) {
  const sheet = mount(ShareSheet, { attachTo: document.body, global });
  const button = mount(ShareButton, { attachTo: document.body, props, global });
  wrappers.push(sheet, button);
  return { sheet, button };
}
const sheetEl = () => document.querySelector('.share-sheet');
const tabLabels = () => [...document.querySelectorAll('.share-sheet .wm-tab')].map(t => t.textContent.trim());
const buttonNamed = text => [...document.querySelectorAll('.share-sheet button, .share-sheet a')].find(b => b.textContent.trim().startsWith(text));

describe('one share button, one sheet', () => {
  it('offers Team and Link for an item, plus Marketplace and File when the screen has them', async () => {
    backend({ '/teams': { body: [] }, '/share/links': { body: [] }, '/share/link?': { body: [] }, '/share/preview': { body: { items: [], dependencies: [], needs: [], removed: 0 } } });
    const publish = vi.fn(), exportItem = vi.fn();
    const { button } = mountShare({ kind: 'widget', id: 'cw_1', name: 'KPI board', publish, exportItem });
    expect(sheetEl()).toBeNull();
    await button.trigger('click');
    await flushPromises();
    expect(sheetEl().textContent).toContain('Share KPI board');
    expect(tabLabels()).toEqual(['Team', 'Link', 'Marketplace', 'File']);
    [...document.querySelectorAll('.share-sheet .wm-tab')].find(t => t.textContent.includes('File')).click();
    await flushPromises();
    buttonNamed('Export file').click();
    await flushPromises();
    expect(exportItem).toHaveBeenCalledTimes(1);
    expect(sheetEl()).toBeNull();
  });

  it('a conversation is shared by link only', async () => {
    backend({ '/share/conversation-link': { body: [] } });
    const { button } = mountShare({ kind: 'conversation', id: 'chat1', name: 'Launch plan' });
    await button.trigger('click');
    await flushPromises();
    expect(tabLabels()).toEqual([]);
    expect(sheetEl().textContent).toContain('Only the words are shared');
  });

  it('inside a team space the team is already here, so there is no Team tab', async () => {
    sessionStorage.setItem('agnt.teamScope', JSON.stringify({ teamId: 'acme', workspaceId: 'general' }));
    backend();
    const { button } = mountShare({ kind: 'agent', id: 'a1', name: 'Researcher' });
    await button.trigger('click');
    await flushPromises();
    expect(tabLabels()).toEqual([]);
    expect(sheetEl().textContent).toContain('Create link');
  });
});

describe('share by link', () => {
  it('previews what goes in, creates the link, copies it, and can turn it off', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const calls = backend({
      '/teams': { body: [] },
      '/share/links?': { body: [] },
      '/share/link?': { body: [] },
      '/share/preview': { body: { items: [{ kind: 'agent', id: 'a1', name: 'Researcher', dependency: false }, { kind: 'tool', id: 't1', name: 'Summarize', dependency: true }], dependencies: [], needs: [{ provider: 'openai', reason: 'model' }], removed: 1 } },
      '/share/link/': { method: 'DELETE', body: { revoked: 'Ab3xYz9kLmNo' } },
      '/share/link': { method: 'POST', body: { id: 'Ab3xYz9kLmNo', url: 'https://agnt.gg/s/Ab3xYz9kLmNo', removed: 1 } },
    });
    const { button } = mountShare({ kind: 'agent', id: 'a1', name: 'Researcher' });
    await button.trigger('click');
    await flushPromises();
    [...document.querySelectorAll('.share-sheet .wm-tab')].find(t => t.textContent.includes('Link')).click();
    await flushPromises();
    const text = sheetEl().textContent;
    expect(text).toContain('Summarize');
    expect(text).toContain('OpenAI models');
    expect(text).toMatch(/1 value that looked like a credential/);

    buttonNamed('Create link').click();
    await flushPromises();
    expect(calls.find(c => c.url.endsWith('/share/link') && c.method === 'POST').body).toEqual({ items: ['agent:a1'], includeDependencies: true });
    expect(document.querySelector('.share-sheet input[aria-label="Share link"]').value).toBe('https://agnt.gg/s/Ab3xYz9kLmNo');
    expect(writeText).toHaveBeenCalledWith('https://agnt.gg/s/Ab3xYz9kLmNo');

    buttonNamed('Turn off link').click();
    await flushPromises();
    expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/share/link/Ab3xYz9kLmNo'))).toBe(true);
    expect(document.querySelector('.share-sheet input[aria-label="Share link"]')).toBeNull();
  });

  it('shows the live link an item already has, and says when it is out of date', async () => {
    backend({ '/teams': { body: [] }, '/share/links?': { body: [] }, '/share/link?': { body: [{ id: 'old000000001', url: 'https://agnt.gg/s/old000000001', stale: true }] }, '/share/preview': { body: { items: [], dependencies: [], needs: [], removed: 0 } } });
    const { button } = mountShare({ kind: 'goal', id: 'g1', name: 'Ship v2' });
    await button.trigger('click');
    await flushPromises();
    [...document.querySelectorAll('.share-sheet .wm-tab')].find(t => t.textContent.includes('Link')).click();
    await flushPromises();
    expect(document.querySelector('.share-sheet input[aria-label="Share link"]').value).toBe('https://agnt.gg/s/old000000001');
    expect(sheetEl().textContent).toContain('Changed since this link was made');
    expect(buttonNamed('Make a new link')).toBeTruthy();
  });

  it('a conversation link is made from the conversation, not a bundle', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
    const calls = backend({ '/share/conversation-link?': { body: [] }, '/share/conversation-link': { method: 'POST', body: { id: 'chat00000001', url: 'https://agnt.gg/s/chat00000001', messages: 4, removed: 0 } } });
    const { button } = mountShare({ kind: 'conversation', id: 'chat1', name: 'Launch plan' });
    await button.trigger('click');
    await flushPromises();
    buttonNamed('Create link').click();
    await flushPromises();
    expect(calls.find(c => c.method === 'POST').body).toEqual({ outputId: 'chat1' });
    expect(calls.some(c => c.url.includes('/share/preview'))).toBe(false);
  });
});

describe('receiving a link', () => {
  async function mountReceive(path) {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { template: '<div />' } }] });
    router.push(path);
    await router.isReady();
    const w = mount(ReceiveShareDialog, { attachTo: document.body, global: { ...global, plugins: [router] } });
    wrappers.push(w);
    await flushPromises();
    return router;
  }

  it('opens from agnt://shared (via ?shared=), shows exactly what arrives, and installs only on confirm', async () => {
    const calls = backend({
      '/share/receive/preview': { body: { id: 'gift00000001', title: 'Research kit', author: 'Alice', items: [{ kind: 'tool', name: 'Summarize', stripped: 0 }, { kind: 'agent', name: 'Researcher', stripped: 1 }], needs: [{ provider: 'openai', reason: 'model' }], removed: 1 } },
      '/share/receive': { method: 'POST', body: { id: 'gift00000001', installed: [{ kind: 'tool', id: 't9' }, { kind: 'agent', id: 'a9' }] } },
    });
    const router = await mountReceive('/chat?shared=gift00000001');
    const text = sheetEl().textContent;
    expect(text).toContain('Research kit');
    expect(text).toContain('Alice shared this');
    expect(text).toContain('Researcher');
    expect(text).toContain('OpenAI models');
    expect(calls.filter(c => c.method === 'POST' && c.url.endsWith('/share/receive'))).toHaveLength(0);

    buttonNamed('Add to Personal').click();
    await flushPromises();
    expect(calls.find(c => c.url.endsWith('/share/receive')).body).toEqual({ link: 'gift00000001' });
    expect(sheetEl().textContent).toContain('Added 2 items to Personal');
    buttonNamed('Open Agents').click();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/agents');
    expect(router.currentRoute.value.query.shared).toBeUndefined();
  });

  it('says plainly when a link is gone, or is a conversation to read rather than add', async () => {
    backend({ '/share/receive/preview': { status: 404, body: { error: 'This share link no longer exists' } } });
    await mountReceive('/chat?shared=gone00000001');
    expect(sheetEl().textContent).toContain('This link is no longer available');
    expect(buttonNamed('Add to')).toBeUndefined();
  });
});
