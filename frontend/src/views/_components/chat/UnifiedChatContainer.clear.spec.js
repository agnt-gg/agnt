/**
 * Clear-chat action — behaviour + host-wiring guards.
 *
 * WHY THIS FILE EXISTS
 * The workspace chat widget shipped with no clear button. The action was not
 * missing from that widget; it was never part of UnifiedChatContainer at all.
 * Six hosts each hand-rolled an identical button in their own header chrome,
 * so the seventh host — whose chrome is the generic WidgetFrame, which knows
 * nothing about chats — silently got zero. (The component even declared an
 * `emits: ['cleared']` that nothing ever fired.)
 *
 * The behavioural tests pin the action to the component. The structural tests
 * at the bottom pin the wiring, because the original defect was a wiring
 * failure that no unit test of the button itself could ever have caught.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import UnifiedChatContainer from './UnifiedChatContainer.vue';
import WorkspaceChatWidget from '@/views/Terminal/CenterPanel/screens/Workspace/WorkspaceChatWidget.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../..');

vi.mock('@/services/chatChannelConfig.js', () => ({
  getChannelConfig: () => null,
}));

// Must return real refs: ChatInputBar's voiceListening/voiceSupported props are
// Booleans, and a plain object is truthy — which silently renders the
// "Stop recording" branch instead of the overflow menu.
vi.mock('@/composables/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: ref(false),
    isSupported: ref(false),
    transcript: ref(''),
    toggleListening: vi.fn(),
  }),
}));

const noopDirective = { mounted() {}, unmounted() {} };

function makeStore(spies) {
  return createStore({
    modules: {
      chatUnified: {
        namespaced: true,
        state: () => ({}),
        getters: {
          getFormattedMessages: () => () => [],
          isStreaming: () => () => false,
          isLoadingSuggestions: () => () => false,
          getSuggestions: () => () => [],
          pendingSteer: () => () => null,
          getImageCache: () => () => new Map(),
          getDataCache: () => () => new Map(),
          getMessageStatus: () => () => null,
          getRunningToolsForMessage: () => () => [],
        },
        actions: {
          initializeChannel: spies.initializeChannel,
          clearConversation: spies.clearConversation,
          setSuggestions: spies.setSuggestions,
        },
      },
      aiProvider: {
        namespaced: true,
        state: () => ({ selectedProvider: null, selectedModel: null }),
        actions: { setProvider: vi.fn(), setModel: vi.fn() },
      },
    },
  });
}

function mountChat(props = {}, spies) {
  return mount(UnifiedChatContainer, {
    props: {
      channelKey: 'workspace:ws_1',
      chatType: 'orchestrator',
      welcomeMessage: 'Your workspace.',
      initialSuggestions: [{ id: 's1', text: 'Open a widget' }],
      ...props,
    },
    global: {
      plugins: [makeStore(spies)],
      directives: { tooltip: noopDirective, 'click-outside': noopDirective },
      stubs: {
        // Teleported content is unreachable via wrapper.find(); the stub keeps
        // SimpleModal's markup in-tree so we can drive the confirm.
        teleport: true,
        MessageItem: true,
        ProcessingState: true,
        QuickActions: true,
        ChatScrollControls: true,
        ChatProviderSelector: true,
        ChatToolSelector: true,
      },
    },
  });
}

describe('UnifiedChatContainer — clear chat action', () => {
  let spies;

  beforeEach(() => {
    spies = {
      initializeChannel: vi.fn(),
      clearConversation: vi.fn(),
      setSuggestions: vi.fn(),
    };
  });

  const openOverflow = async (wrapper) => {
    const btn = wrapper.find('.chat-overflow-btn');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
  };

  const findClearItem = (wrapper) =>
    wrapper.findAll('.chat-overflow-item').find((b) => b.text().includes('Clear chat'));

  it('offers Clear chat in the compact composer overflow (the workspace case)', async () => {
    const wrapper = mountChat({ compactInput: true }, spies);
    await openOverflow(wrapper);
    expect(findClearItem(wrapper)).toBeTruthy();
  });

  it('offers a Clear chat button in the wide composer', () => {
    const wrapper = mountChat({ compactInput: false }, spies);
    expect(wrapper.find('.chat-clear-btn').exists()).toBe(true);
  });

  it('is present by default — a new host inherits the action without opting in', async () => {
    const wrapper = mountChat({ compactInput: true }, spies);
    await openOverflow(wrapper);
    expect(findClearItem(wrapper)).toBeTruthy();
  });

  it('can be opted out by hosts that render their own header button', async () => {
    const wrapper = mountChat({ compactInput: true, showClearAction: false }, spies);
    await openOverflow(wrapper);
    expect(findClearItem(wrapper)).toBeUndefined();
    expect(wrapper.find('.chat-clear-item').exists()).toBe(false);
  });

  it('opting out of the wide composer hides the icon button too', () => {
    const wrapper = mountChat({ compactInput: false, showClearAction: false }, spies);
    expect(wrapper.find('.chat-clear-btn').exists()).toBe(false);
  });

  it('does NOT clear when the confirm is dismissed', async () => {
    const wrapper = mountChat({ compactInput: false }, spies);
    wrapper.vm.confirmModalRef.showModal = vi.fn().mockResolvedValue(false);
    await wrapper.vm.onClearChat();
    expect(spies.clearConversation).not.toHaveBeenCalled();
    expect(wrapper.emitted('cleared')).toBeFalsy();
  });

  it('clears the channel and restores the welcome message on confirm', async () => {
    const wrapper = mountChat({ compactInput: false }, spies);
    wrapper.vm.confirmModalRef.showModal = vi.fn().mockResolvedValue(true);
    await wrapper.vm.onClearChat();

    expect(spies.clearConversation).toHaveBeenCalledTimes(1);
    const payload = spies.clearConversation.mock.calls[0][1];
    expect(payload.channelKey).toBe('workspace:ws_1');
    expect(payload.welcomeMessage.content).toBe('Your workspace.');
    expect(payload.welcomeMessage.role).toBe('assistant');
  });

  it('resets suggestions to the host-supplied initial set', async () => {
    const wrapper = mountChat({ compactInput: false }, spies);
    wrapper.vm.confirmModalRef.showModal = vi.fn().mockResolvedValue(true);
    await wrapper.vm.onClearChat();

    expect(spies.setSuggestions).toHaveBeenCalledTimes(1);
    const payload = spies.setSuggestions.mock.calls[0][1];
    expect(payload.channelKey).toBe('workspace:ws_1');
    expect(payload.suggestions).toEqual([{ id: 's1', text: 'Open a widget' }]);
  });

  it('emits the previously-dead `cleared` event', async () => {
    const wrapper = mountChat({ compactInput: false }, spies);
    wrapper.vm.confirmModalRef.showModal = vi.fn().mockResolvedValue(true);
    await wrapper.vm.onClearChat();
    expect(wrapper.emitted('cleared')).toHaveLength(1);
  });

  it('omits the welcome message when the host supplies none', async () => {
    const wrapper = mountChat({ compactInput: false, welcomeMessage: '' }, spies);
    wrapper.vm.confirmModalRef.showModal = vi.fn().mockResolvedValue(true);
    await wrapper.vm.onClearChat();
    expect(spies.clearConversation.mock.calls[0][1].welcomeMessage).toBeNull();
  });

  it('never clears when no confirm host is mounted', async () => {
    const wrapper = mountChat({ compactInput: false }, spies);
    wrapper.vm.confirmModalRef = null;
    await wrapper.vm.onClearChat();
    expect(spies.clearConversation).not.toHaveBeenCalled();
  });

  it('clicking the overflow item runs the action', async () => {
    const wrapper = mountChat({ compactInput: true }, spies);
    const showModal = vi.fn().mockResolvedValue(true);
    wrapper.vm.confirmModalRef.showModal = showModal;
    await openOverflow(wrapper);
    await findClearItem(wrapper).trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(spies.clearConversation).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceChatWidget — the surface from the bug report', () => {
  it('renders a working Clear chat action', async () => {
    const spies = {
      initializeChannel: vi.fn(),
      clearConversation: vi.fn(),
      setSuggestions: vi.fn(),
    };
    const wrapper = mount(WorkspaceChatWidget, {
      props: { widgetInstanceId: 'inst_1' },
      global: {
        plugins: [makeStore(spies)],
        directives: { tooltip: noopDirective, 'click-outside': noopDirective },
        provide: {
          workspaceChatChannelFor: (id) => `workspace:ws_1:${id}`,
          workspacePageState: { workspaceState: { id: 'ws_1' } },
          workspaceFrontendEvent: null,
          workspaceSuggestions: [],
        },
        stubs: {
          teleport: true,
          MessageItem: true,
          ProcessingState: true,
          QuickActions: true,
          ChatScrollControls: true,
          ChatProviderSelector: true,
          ChatToolSelector: true,
        },
      },
    });

    await wrapper.find('.chat-overflow-btn').trigger('click');
    const item = wrapper.findAll('.chat-overflow-item').find((b) => b.text().includes('Clear chat'));
    expect(item, 'workspace chat has no Clear action').toBeTruthy();

    const ucc = wrapper.findComponent(UnifiedChatContainer);
    ucc.vm.confirmModalRef.showModal = vi.fn().mockResolvedValue(true);
    await item.trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    // Clears THIS widget's own conversation, not a sibling chat's.
    expect(spies.clearConversation.mock.calls[0][1].channelKey).toBe('workspace:ws_1:inst_1');
  });
});

/**
 * Structural guards. The bug was that a host had no clear affordance at all,
 * which is invisible to any test of the button in isolation.
 */
describe('UnifiedChatContainer hosts — clear affordance wiring', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        walk(full, out);
      } else if (e.name.endsWith('.vue')) {
        out.push(full);
      }
    }
    return out;
  };

  const hosts = walk(SRC)
    .map((f) => ({ file: f, src: fs.readFileSync(f, 'utf8') }))
    .filter(({ src }) => src.includes('<UnifiedChatContainer'));

  it('finds every host (anti-vacuity)', () => {
    expect(hosts.length).toBeGreaterThanOrEqual(7);
  });

  // Markup only. An earlier version of this guard also accepted a
  // `handleClearChat` definition, which meant a panel could delete its button
  // and still pass on a dead handler — caught by negative control NC3.
  const markup = (src) => src.split(/<script[\s>]/)[0];

  it('every host either inherits the composer action or renders its own clear button', () => {
    const offenders = hosts
      .filter(({ src }) => /:show-clear-action="false"/.test(src))
      .filter(({ src }) => !/clear-chat-button/.test(markup(src)))
      .map(({ file }) => path.relative(SRC, file));

    expect(
      offenders,
      `These hosts suppress the built-in clear action without providing their own:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the workspace chat widget keeps the built-in action (regression: it had none)', () => {
    const wsc = hosts.find(({ file }) => file.endsWith('WorkspaceChatWidget.vue'));
    expect(wsc).toBeTruthy();
    expect(wsc.src).not.toMatch(/:show-clear-action="false"/);
    expect(markup(wsc.src)).not.toMatch(/clear-chat-button/);
  });
});
