/**
 * MessageItem — Share affordance on inline previews.
 *
 * Chat used to publish a lone HTML string to /api/previews. Anything rendered
 * from a real file on disk therefore either had no Share button at all (raw
 * `<iframe src="/api/local-file/...">`) or had one that published the code
 * block WITHOUT its sibling stylesheets, scripts and images — while the
 * Fullscreen button next to it opened the real file. These tests pin both
 * halves of the fix:
 *
 *  1. A preview backed by a workspace HTML file publishes through the
 *     creation-bundle pipeline (whole directory), exactly like Artifacts.
 *  2. Everything else — remote embeds, non-HTML files, files outside the
 *     workspace — must NOT offer Share, because the pipeline cannot take them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const getSettings = vi.fn();
vi.mock('@/services/fileSystemService.js', () => ({ getSettings: (...a) => getSettings(...a) }));

const prepareArtifactBundle = vi.fn();
const publishArtifactBundle = vi.fn();
vi.mock('@/services/artifactBundlePublisher.js', () => ({
  prepareArtifactBundle: (...a) => prepareArtifactBundle(...a),
  publishArtifactBundle: (...a) => publishArtifactBundle(...a),
}));

import MessageItem from './MessageItem.vue';
import { resetWorkspaceRootCache } from '@/utils/workspacePath.js';

const WORKSPACE = 'C:/Users/Studio/AppData/Roaming/AGNT/projects';
const ENTRY = `${WORKSPACE}/whitney/index.html`;
const localFileUrl = (path) => `http://localhost:3333/api/local-file/${path}`;

const store = createStore({
  state: {
    agents: { agents: [] },
    chat: { activeConversationId: null, conversations: {} },
    userAuth: { token: 'test-token' },
  },
});

function mountMessage({ content, toolCalls = [] }) {
  return mount(MessageItem, {
    props: { message: { id: 'm1', role: 'assistant', content, toolCalls }, status: null, imageCache: new Map() },
    // Attached for real: the Share button only reveals itself when it is
    // `isConnected`, and a detached wrapper would make every visibility
    // assertion below pass or fail for the wrong reason.
    attachTo: document.body,
    global: { plugins: [store], stubs: { ProviderSetup: true, GoalProgressWidget: true, Tooltip: true, Teleport: true } },
  });
}

/**
 * Poll rather than count ticks. The button bar is built in nextTick, the Share
 * button is revealed after an async workspace lookup, and the code-block path
 * additionally awaits a REAL dynamic import of highlight.js before it runs at
 * all — a fixed number of microtask hops cannot span that.
 */
async function waitFor(condition, { attempts = 60 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    await nextTick();
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

const settle = () => waitFor(() => false, { attempts: 12 });

const shareButton = (wrapper) => wrapper.element.querySelector('.iframe-inline-preview-wrapper .share-btn');
const codeShareButton = (wrapper) => wrapper.element.querySelector('.html-inline-preview-wrapper .share-btn');
const isVisible = (element) => Boolean(element) && element.style.display !== 'none';
const hasIframeChrome = (wrapper) => Boolean(wrapper.element.querySelector('.iframe-inline-preview-wrapper .preview-btn'));

beforeEach(() => {
  getSettings.mockReset().mockResolvedValue({ workspaceRoot: WORKSPACE });
  prepareArtifactBundle.mockReset().mockResolvedValue({
    schemaVersion: 1,
    rootPath: 'whitney',
    entryPath: 'index.html',
    files: [{ path: 'index.html', size: 10, sha256: 'a', modifiedMs: 1 }],
    excluded: [],
    totals: { files: 3, bytes: 2048 },
    manifestHash: 'h',
  });
  publishArtifactBundle.mockReset().mockResolvedValue({ id: 'c1', url: 'https://agnt.gg/creations/c1' });
  resetWorkspaceRootCache();
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'p1', url: 'u' }) });
});

describe('iframe preview of a workspace HTML file', () => {
  const mountPreview = () => mountMessage({ content: `<iframe src="${localFileUrl(ENTRY)}"></iframe>` });
  const openShare = async (w) => {
    expect(await waitFor(() => isVisible(shareButton(w)))).toBe(true);
    shareButton(w).click();
    await waitFor(() => document.querySelector('.share-bundle-summary'));
  };

  it('shows a Share button', async () => {
    const w = mountPreview();
    expect(await waitFor(() => isVisible(shareButton(w)))).toBe(true);
    w.unmount();
  });

  it('publishes the whole directory rather than a single document', async () => {
    const w = mountPreview();
    await openShare(w);

    // Workspace-RELATIVE entry: the backend's normalizeBundlePath rejects an
    // absolute path or a drive letter outright.
    expect(prepareArtifactBundle).toHaveBeenCalledWith('whitney/index.html', 'test-token');
    expect(global.fetch).not.toHaveBeenCalledWith('https://agnt.gg/api/previews', expect.anything());
    w.unmount();
  });

  it('names the creation after the folder, not "index"', async () => {
    const w = mountPreview();
    await openShare(w);
    expect(document.querySelector('#shareTitle').value).toBe('Whitney');
    w.unmount();
  });

  it('summarises what is about to be published before publishing it', async () => {
    const w = mountPreview();
    await openShare(w);
    expect(document.querySelector('.share-bundle-summary').textContent).toContain('3 files');
    w.unmount();
  });

  it('uploads the manifest when the share is confirmed', async () => {
    const w = mountPreview();
    await openShare(w);
    document.querySelector('.share-submit-btn').click();
    expect(await waitFor(() => publishArtifactBundle.mock.calls.length > 0)).toBe(true);
    expect(publishArtifactBundle.mock.calls[0][0]).toMatchObject({ title: 'Whitney', token: 'test-token' });
    w.unmount();
  });

  it('still renders Fullscreen alongside Share', async () => {
    const w = mountPreview();
    expect(await waitFor(() => hasIframeChrome(w))).toBe(true);
    w.unmount();
  });
});

describe('previews the bundle pipeline cannot accept', () => {
  it.each([
    ['a remote embed', 'https://www.youtube.com/embed/abc123'],
    ['a non-HTML local file', localFileUrl(`${WORKSPACE}/whitney/clip.mp4`)],
  ])('offers no Share button for %s', async (_label, src) => {
    const w = mountMessage({ content: `<iframe src="${src}"></iframe>` });
    // Wait for the chrome to exist first, so absence of Share is a real
    // decision and not just a snapshot taken before the bar was built.
    expect(await waitFor(() => hasIframeChrome(w))).toBe(true);
    await settle();
    expect(shareButton(w)).toBeNull();
    w.unmount();
  });

  it('never reveals Share for an HTML file outside the workspace', async () => {
    // Plugin output under %APPDATA% renders fine but cannot be relativized, so
    // the button must stay hidden rather than fail on click.
    const outside = 'C:/Users/Studio/AppData/Roaming/AGNT/plugin-data/render/out.html';
    const w = mountMessage({ content: `<iframe src="${localFileUrl(outside)}"></iframe>` });
    expect(await waitFor(() => hasIframeChrome(w))).toBe(true);
    await settle();
    expect(isVisible(shareButton(w))).toBe(false);
    w.unmount();
  });

  it('keeps Share hidden when the workspace root cannot be read', async () => {
    getSettings.mockRejectedValue(new Error('offline'));
    const w = mountMessage({ content: `<iframe src="${localFileUrl(ENTRY)}"></iframe>` });
    expect(await waitFor(() => hasIframeChrome(w))).toBe(true);
    await settle();
    expect(isVisible(shareButton(w))).toBe(false);
    w.unmount();
  });
});

describe('html code block paired with a file on disk', () => {
  const HTML = '<!DOCTYPE html>\n<html><body><h1>Whitney</h1></body></html>';
  const READ_CALL = {
    name: 'read_file',
    args: { path: ENTRY },
    result: { absolutePath: ENTRY, content: HTML },
  };
  const codeBlockMessage = (toolCalls) => ({ content: '```html\n' + HTML + '\n```', toolCalls });

  const clickCodeShare = async (w) => {
    expect(await waitFor(() => codeShareButton(w))).toBe(true);
    codeShareButton(w).click();
  };

  it('publishes the directory, not the code string', async () => {
    // The regression this guards: Fullscreen opened the real FILE while Share
    // posted the code block, so the published creation silently lost every
    // sibling asset the user had just seen rendered.
    const w = mountMessage(codeBlockMessage([READ_CALL]));
    await clickCodeShare(w);
    expect(await waitFor(() => prepareArtifactBundle.mock.calls.length > 0)).toBe(true);
    expect(prepareArtifactBundle).toHaveBeenCalledWith('whitney/index.html', 'test-token');
    w.unmount();
  });

  it('offers the code-only publish when the file is outside the workspace', async () => {
    getSettings.mockResolvedValue({ workspaceRoot: 'D:/somewhere-else' });
    const w = mountMessage(codeBlockMessage([READ_CALL]));
    await clickCodeShare(w);

    // Offered, never taken silently — a creation missing its assets must be a
    // choice the user makes, not a substitution we make for them.
    const findFallback = () =>
      [...document.querySelectorAll('.share-error-actions button')].find((b) => b.textContent.includes('Publish the code only'));
    expect(await waitFor(findFallback)).toBe(true);
    expect(prepareArtifactBundle).not.toHaveBeenCalled();

    findFallback().click();
    expect(await waitFor(() => document.querySelector('.share-submit-btn'))).toBe(true);
    document.querySelector('.share-submit-btn').click();
    expect(await waitFor(() => global.fetch.mock.calls.some((c) => c[0] === 'https://agnt.gg/api/previews'))).toBe(true);
    w.unmount();
  });

  it('publishes as a single document when no file backs the block', async () => {
    const w = mountMessage(codeBlockMessage([]));
    await clickCodeShare(w);
    expect(await waitFor(() => document.querySelector('.share-submit-btn'))).toBe(true);
    document.querySelector('.share-submit-btn').click();

    expect(await waitFor(() => global.fetch.mock.calls.some((c) => c[0] === 'https://agnt.gg/api/previews'))).toBe(true);
    expect(prepareArtifactBundle).not.toHaveBeenCalled();
    w.unmount();
  });
});
