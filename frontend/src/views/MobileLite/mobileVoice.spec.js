/**
 * Voice on the phone client.
 *
 * voiceParity.spec.js proves this surface uses the shared engine and supplies
 * every adapter — but a source contract cannot prove the adapters WORK. These
 * mount the real component and drive the seams the composable actually pulls:
 * the submit path, the streaming answer, the epoch, and the secure-context
 * gate that decides whether a microphone exists here at all.
 *
 * The engine itself is mocked on purpose. useVoiceEngines is covered by its own
 * suites; what is unproven is this host's half of the contract, and a real
 * WebRTC session in jsdom would test neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

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
    (messages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content })),
}));

vi.mock('@/services/mobileLiteApi.js', () => ({
  listConversations: vi.fn(async () => []),
  loadConversation: vi.fn(async () => ({
    outputId: 'out-1',
    title: 'T',
    conversationId: 'conv-2',
    messages: [],
  })),
  saveConversation: vi.fn(async () => ({ id: 'out-1' })),
  newConversationId: () => 'conv-1',
  newMessageId: () => `m-${Math.random().toString(36).slice(2, 8)}`,
  resolveLiteProviderModelAsync: vi.fn(async () => ({
    provider: 'openai',
    model: 'gpt-4o',
    source: 'test',
  })),
}));

/** Whether this origin may open a microphone. Flipped per test, before mount. */
const env = vi.hoisted(() => ({ secure: true }));
vi.mock('@/services/mobileLiteNative.js', () => ({
  canUseMediaCapture: () => env.secure,
  canUseWebCamera: () => env.secure,
  isCapacitorNative: () => false,
  isRemoteInsecureHost: () => !env.secure,
  nativeShellSetupUrl: () => 'agntchat://localhost/?setup=1',
  bounceToNativeShellForSetup: () => false,
}));

/** Captures what the host handed the shared engine, and fakes the bindings back. */
const voice = vi.hoisted(() => ({ options: null, toggles: 0, bindings: null }));
vi.mock('@/composables/useVoiceEngines', async () => {
  const { ref } = await import('vue');
  return {
    useVoiceEngines: (options) => {
      voice.options = options;
      voice.bindings = {
        voiceActive: ref(false),
        voiceState: ref('listening'),
        voicePartial: ref(''),
        voiceError: ref(''),
        voiceNatural: ref(true),
      };
      return {
        ...voice.bindings,
        voiceLevel: ref(0),
        toggleVoice: () => {
          voice.toggles += 1;
        },
        stopVoice: () => {},
        isSupported: true,
      };
    },
  };
});

import { armVoiceTurn } from '@/services/voiceTurn.js';
import MobileChat from './MobileChat.vue';

const store = createStore({
  state: {
    agents: { agents: [] },
    theme: { currentTheme: 'dark' },
    userAuth: { token: 'tok' },
  },
});

async function mountChat() {
  const w = mount(MobileChat, {
    global: {
      plugins: [store],
      stubs: { ProviderSetup: true, GoalProgressWidget: true, Tooltip: true, Teleport: true },
    },
  });
  await flushPromises();
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.secure = true;
  voice.options = null;
  voice.toggles = 0;
  voice.bindings = null;
  // Leave no arm behind: it is module state, and a stray one would silently
  // mark the next test's typed turn as spoken.
  armVoiceTurn('');
});

describe('the voice control is reachable', () => {
  it('renders a voice button in the composer', async () => {
    const w = await mountChat();
    expect(w.find('.ml-voice-btn').exists()).toBe(true);
    w.unmount();
  });

  it('is clickable, not decoration', async () => {
    const w = await mountChat();
    await w.find('.ml-voice-btn').trigger('click');
    expect(voice.toggles).toBe(1);
    w.unmount();
  });

  it('stays available mid-stream, because barge-in needs it', async () => {
    const w = await mountChat();
    w.vm.streaming = true;
    await flushPromises();
    expect(w.find('.ml-voice-btn').exists()).toBe(true);
    w.unmount();
  });

  it('shows the status strip only while a session is live', async () => {
    const w = await mountChat();
    expect(w.find('.ml-voice').exists()).toBe(false);
    voice.bindings.voiceActive.value = true;
    await flushPromises();
    expect(w.find('.ml-voice').exists()).toBe(true);
    expect(w.find('.voice-engine-badge').exists()).toBe(true);
    w.unmount();
  });
});

describe('no microphone, no button', () => {
  it('hides the control when the origin is not a secure context', async () => {
    env.secure = false;
    const w = await mountChat();
    expect(w.find('.ml-voice-btn').exists()).toBe(false);
    w.unmount();
  });

  it('says why instead of leaving a silent gap', async () => {
    env.secure = false;
    const w = await mountChat();
    expect(w.text()).toContain('Voice needs a secure connection');
    w.unmount();
  });
});

describe('the adapters this host supplies actually work', () => {
  it('submit() sends the text as a real user turn', async () => {
    const w = await mountChat();
    await voice.options.submit('what is on my calendar');
    await flushPromises();
    expect(streamChat).toHaveBeenCalledTimes(1);
    const [args] = streamChat.mock.calls[0];
    expect(args.messages.at(-1)).toEqual({ role: 'user', content: 'what is on my calendar' });
    w.unmount();
  });

  it('streamingAnswer() reads the assistant text as it arrives', async () => {
    const w = await mountChat();
    let emit;
    let finish;
    streamChat.mockImplementationOnce(({ onEvent }) => {
      emit = onEvent;
      return new Promise((res) => {
        finish = res;
      });
    });

    const pending = voice.options.submit('hello');
    await flushPromises();
    expect(voice.options.streamingAnswer()).toBe('');

    emit('content_delta', { delta: 'Three tests were failing.' });
    await flushPromises();
    expect(voice.options.streamingAnswer()).toBe('Three tests were failing.');

    finish();
    await pending;
    await flushPromises();
    // Settled: nothing is streaming, so there is nothing left to speak.
    expect(voice.options.streamingAnswer()).toBe('');
    w.unmount();
  });

  it('isStreaming tracks the turn, so the spoken call can resolve', async () => {
    const w = await mountChat();
    let finish;
    streamChat.mockImplementationOnce(
      () =>
        new Promise((res) => {
          finish = res;
        })
    );

    expect(voice.options.isStreaming.value).toBe(false);
    const pending = voice.options.submit('hi');
    await flushPromises();
    expect(voice.options.isStreaming.value).toBe(true);

    finish();
    await pending;
    await flushPromises();
    expect(voice.options.isStreaming.value).toBe(false);
    w.unmount();
  });

  it('bumps the epoch on a conversation switch, so a session cannot cross chats', async () => {
    const w = await mountChat();
    const before = voice.options.epoch.value;
    await w.vm.openConversation('out-1');
    await flushPromises();
    expect(voice.options.epoch.value).toBe(before + 1);
    w.unmount();
  });

  it('bumps the epoch on a new chat too', async () => {
    const w = await mountChat();
    const before = voice.options.epoch.value;
    w.vm.startNew();
    await flushPromises();
    expect(voice.options.epoch.value).toBe(before + 1);
    w.unmount();
  });
});

describe('a spoken turn asks for the spoken register', () => {
  it('sends voiceMode when the turn was armed by voice', async () => {
    const w = await mountChat();
    armVoiceTurn('read me the summary');
    await voice.options.submit('read me the summary');
    await flushPromises();
    expect(streamChat.mock.calls[0][0].pageContext).toEqual({ voiceMode: true });
    w.unmount();
  });

  it('does NOT send voiceMode for a typed turn', async () => {
    const w = await mountChat();
    w.vm.draft = 'typed by hand';
    await w.vm.send();
    await flushPromises();
    expect(streamChat.mock.calls[0][0].pageContext).toEqual({});
    w.unmount();
  });

  it('does not leak the arm onto the NEXT turn', async () => {
    const w = await mountChat();
    armVoiceTurn('spoken one');
    await voice.options.submit('spoken one');
    await flushPromises();

    w.vm.draft = 'typed after';
    await w.vm.send();
    await flushPromises();

    expect(streamChat.mock.calls[0][0].pageContext).toEqual({ voiceMode: true });
    expect(streamChat.mock.calls[1][0].pageContext).toEqual({});
    w.unmount();
  });

  it('a typed turn that is not the armed text leaves the arm alone', async () => {
    const w = await mountChat();
    armVoiceTurn('the spoken one');

    w.vm.draft = 'something else entirely';
    await w.vm.send();
    await flushPromises();
    expect(streamChat.mock.calls[0][0].pageContext).toEqual({});

    await voice.options.submit('the spoken one');
    await flushPromises();
    expect(streamChat.mock.calls[1][0].pageContext).toEqual({ voiceMode: true });
    w.unmount();
  });
});
