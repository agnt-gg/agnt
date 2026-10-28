/**
 * MessageItem — one navigation per preview iframe.
 *
 * An iframe loads when it enters the document with a src, and loads again
 * whenever it is moved or its src changes. Chat previews used to do all
 * three: the markup carried a live src, the action wrapper then adopted the
 * frame by moving it, and diagnostics then re-pointed it at a channel URL.
 * Measured in Edge, every one of those requests reached the server, which
 * prepares the whole document for each (~450 ms at 4.8 MB).
 *
 * These tests count navigations per frame synchronously, at every DOM call:
 * entering the document with a src, being moved while connected (a reload),
 * or a src change while connected. (A MutationObserver cannot do this: its
 * records arrive later, when an inserted ancestor's CURRENT contents no
 * longer say what it contained at insertion.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick } from 'vue';

vi.mock('@/../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  IMAP_EMAIL_DOMAIN: '',
  AI_PROVIDERS_CONFIG: {},
  DEPLOYMENT_CONFIG: {},
  default: {},
}));
vi.mock('@/assets/images/annie-avatar.png', () => ({ default: 'avatar.png' }));
vi.mock('highlight.js/styles/atom-one-dark.css', () => ({}));
vi.mock('@/services/fileSystemService.js', () => ({ getSettings: async () => ({ workspaceRoot: 'C:/Users/Studio/AppData/Roaming/AGNT/projects' }) }));
vi.mock('@/services/artifactBundlePublisher.js', () => ({ prepareArtifactBundle: vi.fn(), publishArtifactBundle: vi.fn() }));

import MessageItem from './MessageItem.vue';
import { resetWorkspaceRootCache } from '@/utils/workspacePath.js';

const ENTRY = 'C:/Users/Studio/AppData/Roaming/AGNT/projects/whitney/index.html';
const artifactFence = '```artifact\n' + JSON.stringify({ path: ENTRY, title: 'Whitney' }) + '\n```';

const store = createStore({
  state: {
    agents: { agents: [] },
    chat: { activeConversationId: null, conversations: {} },
    userAuth: { token: 'test-token' },
  },
});

const iframesIn = (node) => (node?.nodeType !== 1 ? [] : node.tagName === 'IFRAME' ? [node] : [...node.querySelectorAll('iframe')]);

const navigationCount = new Map();
const lastSeen = new Map();
const restorers = [];
const mounted = [];

function countNavigation(frame) {
  navigationCount.set(frame, (navigationCount.get(frame) || 0) + 1);
}

/** After any DOM call: a frame that became connected with a src, or changed src while connected, navigated. */
function sample() {
  for (const frame of document.querySelectorAll('iframe')) if (!lastSeen.has(frame)) lastSeen.set(frame, { connected: false, src: null });
  for (const [frame, before] of lastSeen) {
    const now = { connected: frame.isConnected, src: frame.getAttribute('src') };
    if (now.connected && now.src && (!before.connected || before.src !== now.src)) countNavigation(frame);
    lastSeen.set(frame, now);
  }
}

/** `inserted` picks the arguments a call inserts: insertBefore's anchor and replaceChild's old child are not moved. */
function wrap(target, name, { inserted = () => [] } = {}) {
  const original = target[name];
  target[name] = function (...args) {
    // Moving a connected iframe (or an ancestor) detaches and re-attaches it in
    // one call: invisible to before/after sampling, and a reload in Chromium.
    const moving = inserted(args).flatMap((node) => (node?.isConnected ? iframesIn(node) : [])).filter((f) => f.getAttribute('src'));
    const result = original.apply(this, args);
    for (const frame of moving) {
      if (frame.isConnected) {
        countNavigation(frame);
        lastSeen.set(frame, { connected: true, src: frame.getAttribute('src') });
      }
    }
    sample();
    return result;
  };
  restorers.push(() => { target[name] = original; });
}

function wrapSetter(target, property) {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, { ...descriptor, set(value) { descriptor.set.call(this, value); sample(); } });
  restorers.push(() => Object.defineProperty(target, property, descriptor));
}

beforeEach(() => {
  resetWorkspaceRootCache();
  navigationCount.clear();
  lastSeen.clear();
  for (const name of ['insertBefore', 'appendChild', 'replaceChild']) wrap(Node.prototype, name, { inserted: (args) => [args[0]] });
  wrap(Node.prototype, 'removeChild');
  for (const name of ['replaceWith', 'prepend', 'append', 'before', 'after']) wrap(Element.prototype, name, { inserted: (args) => args });
  for (const name of ['setAttribute', 'removeAttribute']) wrap(Element.prototype, name);
  wrapSetter(Element.prototype, 'innerHTML');
  wrapSetter(HTMLIFrameElement.prototype, 'src');
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  restorers.splice(0).reverse().forEach((restore) => restore());
});

function mountMessage({ content, toolCalls = [], status = null }) {
  const w = mount(MessageItem, {
    props: { message: { id: 'm1', role: 'assistant', content, toolCalls }, status, imageCache: new Map() },
    attachTo: document.body,
    global: { plugins: [store], stubs: { ProviderSetup: true, GoalProgressWidget: true, Tooltip: true, Teleport: true } },
  });
  mounted.push(w);
  return w;
}

async function waitFor(condition, { attempts = 80 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    await nextTick();
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

const navigations = (frame) => navigationCount.get(frame) || 0;

const previewFrame = (w) => w.element.querySelector('.iframe-inline-preview-wrapper > iframe');
const hasActions = (w) => !!w.element.querySelector('.iframe-inline-preview-wrapper > .html-code-actions');

describe('chat preview iframes navigate once', () => {
  it('an artifact fence loads once, in its wrapper, with its diagnostics channel', async () => {
    const w = mountMessage({ content: artifactFence });
    expect(await waitFor(() => hasActions(w) && previewFrame(w)?.hasAttribute('src'))).toBe(true);
    const frame = previewFrame(w);
    expect(frame.getAttribute('src')).toContain('/api/local-preview/');
    expect(frame.getAttribute('src')).toContain('__agnt_preview=');
    expect(navigations(frame)).toBe(1);
  });

  it('a raw local iframe written by the model loads once', async () => {
    const w = mountMessage({ content: `<iframe src="http://localhost:3333/api/local-file/${ENTRY}"></iframe>` });
    expect(await waitFor(() => hasActions(w) && previewFrame(w)?.hasAttribute('src'))).toBe(true);
    expect(previewFrame(w).getAttribute('src')).toContain('/api/local-preview/');
    expect(navigations(previewFrame(w))).toBe(1);
  });

  it('a fence that closes mid-stream loads at once, and completion adds actions without reloading it', async () => {
    const w = mountMessage({ content: artifactFence + '\n\nStill writing', status: { state: 'streaming' } });
    expect(await waitFor(() => previewFrame(w)?.hasAttribute('src'))).toBe(true);
    expect(hasActions(w)).toBe(false);
    const frame = previewFrame(w);

    await w.setProps({ status: null });
    expect(await waitFor(() => hasActions(w))).toBe(true);
    expect(previewFrame(w)).toBe(frame);
    expect(navigations(frame)).toBe(1);
  });

  it('an html block paired with its file loads once', async () => {
    const html = '<!DOCTYPE html>\n<html><body><h1>Whitney</h1></body></html>';
    const w = mountMessage({
      content: '```html\n' + html + '\n```',
      toolCalls: [{ name: 'read_file', args: { path: ENTRY }, result: { absolutePath: ENTRY, content: html } }],
    });
    expect(await waitFor(() => w.element.querySelector('iframe.html-inline-iframe')?.hasAttribute('src'))).toBe(true);
    const frame = w.element.querySelector('iframe.html-inline-iframe');
    expect(frame.getAttribute('src')).toContain('/api/local-preview/');
    expect(navigations(frame)).toBe(1);
  });

  it('never trusts a data-preview-src written by the author', async () => {
    const w = mountMessage({ content: '<iframe data-preview-src="javascript:alert(1)"></iframe><div data-preview-src="x">text</div>' });
    await waitFor(() => false, { attempts: 15 });
    expect(w.element.querySelector('[data-preview-src]')).toBeNull();
    for (const frame of w.element.querySelectorAll('iframe')) expect(frame.getAttribute('src') || '').not.toMatch(/javascript:/i);
  });
});
