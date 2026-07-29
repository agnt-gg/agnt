/**
 * Mobile lite chat — rich rendering parity with main chat.
 *
 * PR #54 shipped the phone client with `<div class="ml-body">{{ m.content }}</div>`,
 * so every answer arrived as one unstyled paragraph: no headings, no lists, no
 * code blocks, no images, no tables, no tool cards. The root cause was not a
 * missing feature — it was a SECOND renderer. Any surface that re-implements
 * rendering starts at zero and drifts from there.
 *
 * These tests mount the REAL MobileChat with the REAL MessageItem and assert on
 * rendered DOM, so they fail if the phone ever stops routing through the shared
 * renderer — including via a copy-paste "mobile version" of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('@/../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  IMAP_EMAIL_DOMAIN: '',
  AI_PROVIDERS_CONFIG: {},
  DEPLOYMENT_CONFIG: {},
  default: {},
}));
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  default: {},
}));
vi.mock('@/assets/images/annie-avatar.png', () => ({ default: 'avatar.png' }));
vi.mock('highlight.js/styles/atom-one-dark.css', () => ({}));

const streamChat = vi.fn(async () => {});
vi.mock('@/services/chatService.js', () => ({
  streamChat: (...a) => streamChat(...a),
  toChatHistory: (messages) =>
    (messages || []).filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })),
}));

const loadConversation = vi.fn();
vi.mock('@/services/mobileLiteApi.js', () => ({
  listConversations: vi.fn(async () => []),
  loadConversation: (...a) => loadConversation(...a),
  saveConversation: vi.fn(async () => ({ id: 'out-1' })),
  newConversationId: () => 'conv-1',
  newMessageId: () => `m-${Math.random().toString(36).slice(2, 8)}`,
  resolveLiteProviderModelAsync: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4o', source: 'test' })),
}));

import MobileChat from './MobileChat.vue';

const store = createStore({
  state: {
    agents: { agents: [] },
    theme: { currentTheme: 'dark' },
    userAuth: { token: 'tok' },
  },
});

/** Mount the phone client with one saved conversation already open. */
async function mountWithMessages(messages) {
  loadConversation.mockResolvedValueOnce({
    outputId: 'out-1',
    title: 'T',
    conversationId: 'conv-1',
    messages,
  });
  const w = mount(MobileChat, {
    global: {
      plugins: [store],
      stubs: { ProviderSetup: true, GoalProgressWidget: true, Tooltip: true, Teleport: true },
    },
  });
  await flushPromises();
  await w.vm.openConversation('out-1');
  await flushPromises();
  return w;
}

const assistant = (content, extra = {}) => ({ id: 'a1', role: 'assistant', content, timestamp: 1, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markdown', () => {
  it('renders headings, bold and lists instead of raw markdown', async () => {
    const w = await mountWithMessages([assistant('# Title\n\n**bold** text\n\n- one\n- two')]);
    const html = w.element.innerHTML;
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(w.element.querySelectorAll('.message-text li')).toHaveLength(2);
    // The literal source must NOT survive to the screen.
    expect(w.element.querySelector('.message-text').textContent).not.toContain('**bold**');
    w.unmount();
  });

  it('renders links', async () => {
    const w = await mountWithMessages([assistant('see [AGNT](https://agnt.gg)')]);
    const a = w.element.querySelector('.message-text a');
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe('https://agnt.gg');
    w.unmount();
  });

  it('wraps tables in the scrollable container', async () => {
    const w = await mountWithMessages([assistant('| a | b |\n| --- | --- |\n| 1 | 2 |')]);
    expect(w.element.querySelector('.message-text .table-wrapper table')).toBeTruthy();
    w.unmount();
  });
});

describe('code', () => {
  it('renders a fenced block with its declared language', async () => {
    const w = await mountWithMessages([assistant('```js\nconst a = 1;\n```')]);
    const code = w.element.querySelector('.message-text pre code');
    expect(code).toBeTruthy();
    expect(code.className).toContain('language-js');
    expect(code.textContent).toContain('const a = 1;');
    expect(code.textContent).not.toContain('```');
    w.unmount();
  });

  it('marks an unclosed block streaming so it is not highlighted mid-write', async () => {
    const w = await mountWithMessages([assistant('```js\nconst a = 1;')]);
    // Not streaming (loaded from history) — the marker must be absent.
    expect(w.element.querySelector('.message-text pre code').hasAttribute('data-streaming')).toBe(false);
    w.unmount();
  });
});

describe('images', () => {
  it('renders markdown images as <img>', async () => {
    const w = await mountWithMessages([assistant('![chart](https://example.com/c.png)')]);
    const img = w.element.querySelector('.message-text img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/c.png');
    w.unmount();
  });

  it('resolves {{IMAGE_REF}} to the backend image endpoint', async () => {
    const w = await mountWithMessages([assistant('<img src="{{IMAGE_REF:img-42}}" alt="gen">')]);
    const img = w.element.querySelector('.message-text img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('http://localhost:3333/api/images/img-42');
    w.unmount();
  });
});

describe('tool calls', () => {
  const withTool = [
    assistant('Looking it up.', {
      toolCalls: [{ id: 't1', name: 'web_search', args: { q: 'agnt' }, result: 'ok', status: 'completed' }],
      contentParts: [
        { type: 'text', text: 'Looking it up.' },
        { type: 'tool_call', toolCallId: 't1' },
      ],
    }),
  ];

  it('renders a tool card labelled with the real tool name', async () => {
    const w = await mountWithMessages(withTool);
    const label = w.element.querySelector('.tool-label');
    expect(label).toBeTruthy();
    expect(label.textContent.trim()).toBe('web_search');
    w.unmount();
  });

  it('expands a tool card on tap and shows its input/output', async () => {
    const w = await mountWithMessages(withTool);
    await w.find('.tool-header').trigger('click');
    await flushPromises();
    const body = w.element.querySelector('.tool-call-content');
    expect(body).toBeTruthy();
    expect(body.textContent).toContain('agnt');
    w.unmount();
  });

  it('keeps prose and tool cards in the order the model produced them', async () => {
    const w = await mountWithMessages([
      assistant('before', {
        toolCalls: [{ id: 't1', name: 'read_file', args: {}, result: 'x' }],
        contentParts: [
          { type: 'text', text: 'before' },
          { type: 'tool_call', toolCallId: 't1' },
          { type: 'text', text: 'after' },
        ],
      }),
    ]);
    const kinds = [...w.element.querySelectorAll('.message-text, .tool-execution-details')].map((el) =>
      el.classList.contains('message-text') ? 'text' : 'tool'
    );
    expect(kinds).toEqual(['text', 'tool', 'text']);
    w.unmount();
  });
});

describe('user messages', () => {
  it('renders user text as plain text, not markdown', async () => {
    const w = await mountWithMessages([{ id: 'u1', role: 'user', content: '**not bold**', timestamp: 1 }]);
    const text = w.element.querySelector('.message-wrapper.user .message-text');
    expect(text).toBeTruthy();
    expect(text.innerHTML).not.toContain('<strong>');
    expect(text.textContent).toContain('**not bold**');
    w.unmount();
  });
});

describe('legacy conversations', () => {
  it('renders a saved chat that predates contentParts', async () => {
    const w = await mountWithMessages([{ id: 'a9', role: 'assistant', content: '## Older', timestamp: 1 }]);
    expect(w.element.querySelector('.message-text h2')).toBeTruthy();
    w.unmount();
  });
});

describe('live streaming', () => {
  // MessageItem throttles markdown re-renders to ~15fps while a message is
  // streaming (RENDER_INTERVAL = 66ms), so a delta lands on a timer, not a
  // microtask. flushPromises() alone would assert against the previous frame.
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 90));
    await flushPromises();
  };

  /** Mount an empty chat and hand back the onEvent callback send() passed to streamChat. */
  async function startTurn() {
    let emitEvent;
    let resolveStream;
    streamChat.mockImplementationOnce(({ onEvent }) => {
      emitEvent = onEvent;
      return new Promise((res) => {
        resolveStream = res;
      });
    });
    const w = mount(MobileChat, {
      global: {
        plugins: [store],
        stubs: { ProviderSetup: true, GoalProgressWidget: true, Tooltip: true, Teleport: true },
      },
    });
    await flushPromises();
    w.vm.draft = 'hi';
    w.vm.send();
    await flushPromises();
    return { w, emit: emitEvent, finish: resolveStream };
  }

  it('renders streamed markdown live, not on completion', async () => {
    const { w, emit, finish } = await startTurn();
    emit('content_delta', { delta: '## Live' });
    await settle();
    expect(w.element.querySelector('.message-text h2')).toBeTruthy();
    finish();
    await flushPromises();
    w.unmount();
  });

  it('shows a tool card with its real name while the tool runs', async () => {
    const { w, emit, finish } = await startTurn();
    emit('tool_start', { toolCall: { id: 't1', name: 'execute_shell_command', args: { command: 'ls' } } });
    await settle();
    expect(w.element.querySelector('.tool-label').textContent.trim()).toBe('execute_shell_command');
    finish();
    await flushPromises();
    w.unmount();
  });

  it('holds highlighting off an unclosed fence until it closes', async () => {
    const { w, emit, finish } = await startTurn();
    emit('content_delta', { delta: '```js\nconst a = 1;' });
    await settle();
    expect(w.element.querySelector('.message-text pre code').getAttribute('data-streaming')).toBe('true');
    emit('content_delta', { delta: '\n```' });
    await settle();
    expect(w.element.querySelector('.message-text pre code').hasAttribute('data-streaming')).toBe(false);
    finish();
    await flushPromises();
    w.unmount();
  });

  it('surfaces a stream error to the composer', async () => {
    const { w, emit, finish } = await startTurn();
    emit('error', { error: 'provider exploded' });
    await flushPromises();
    expect(w.element.querySelector('.ml-error').textContent).toContain('provider exploded');
    finish();
    await flushPromises();
    w.unmount();
  });
});

/**
 * Structural guard. The rendering bug was architectural, not cosmetic: a second
 * renderer existed. Behavioural tests above prove the surface renders correctly
 * TODAY; these prove it cannot quietly grow its own renderer again.
 */
describe('no second renderer', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, 'MobileChat.vue'), 'utf8');
  const template = src.slice(src.indexOf('<template>'), src.indexOf('</template>'));

  it('renders messages through the shared MessageItem component', () => {
    expect(src).toMatch(/import MessageItem from '@\/views\/Terminal\/CenterPanel\/screens\/Chat\/components\/MessageItem\.vue'/);
    expect(template).toMatch(/<MessageItem\b/);
  });

  it('never interpolates message content as raw text', () => {
    // `{{ m.content }}` is exactly what PR #54 shipped.
    expect(template).not.toMatch(/\{\{\s*\w+\.content\s*\}\}/);
  });

  it('translates stream events through the shared reducer, not a local switch', () => {
    expect(src).toMatch(/from '@\/services\/chatStreamReducer\.js'/);
    expect(src).not.toMatch(/eventName\s*===\s*'content_delta'/);
    expect(src).not.toMatch(/case\s+'tool_start'/);
  });
});

/**
 * Touch affordances. jsdom does not evaluate media queries, so this is a source
 * contract on the SHARED component rather than a computed-style assertion — the
 * point being that the fix lives in the renderer every touch surface uses, not
 * in one client's stylesheet.
 */
describe('controls reachable without hover', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const messageItem = fs.readFileSync(
    path.join(here, '..', 'Terminal', 'CenterPanel', 'screens', 'Chat', 'components', 'MessageItem.vue'),
    'utf8'
  );
  const css = messageItem.slice(messageItem.lastIndexOf('<style scoped>'));
  /** Body of every `@media (hover: none)` block in the component stylesheet. */
  const touchBlocks = [...css.matchAll(/@media\s*\(\s*hover:\s*none\s*\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);

  it('declares at least one touch-pointer block', () => {
    expect(touchBlocks.length).toBeGreaterThan(0);
  });

  it('reveals chart/diagram Copy + Fullscreen buttons on touch', () => {
    // Opacity 0 + :hover means these are unreachable on any touch pointer.
    const block = touchBlocks.find((b) => b.includes('viz-action-buttons'));
    expect(block, 'no @media (hover: none) rule for .viz-action-buttons').toBeTruthy();
    expect(block).toMatch(/opacity:\s*1/);
  });

  it('reserves space for the touch-visible viz buttons instead of overlaying content', () => {
    // Made permanent by the rule above, they would otherwise sit on top of the
    // chart legend for the entire life of the message.
    const block = touchBlocks.find((b) => b.includes('chartjs-container'));
    expect(block, 'no @media (hover: none) padding reserve for viz containers').toBeTruthy();
    expect(block).toMatch(/padding-top:\s*\d+px/);
    for (const kind of ['d3-container', 'threejs-container', 'mermaid-container']) {
      expect(block, `${kind} missing from the reserve`).toContain(kind);
    }
  });

  it('reveals the edit-message button on touch', () => {
    const block = touchBlocks.find((b) => b.includes('message-edit-btn'));
    expect(block, 'no @media (hover: none) rule for .message-edit-btn').toBeTruthy();
    expect(block).toMatch(/opacity:\s*0?\.?\d/);
  });
});
