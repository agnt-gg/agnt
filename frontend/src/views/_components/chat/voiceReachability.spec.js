/**
 * VOICE REACHABILITY — can a human actually get at this feature?
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Hands-free voice shipped with 277 passing tests and was INVISIBLE IN THE
 * ENTIRE APP. Two independent wiring failures, neither of which any test of the
 * voice modules could ever have caught:
 *
 *   1. It was wired into UnifiedChatContainer.vue, which the MAIN CHAT SCREEN
 *      does not use. `/chat` renders BaseScreen.vue, which owns its own
 *      composer. So the surface the user actually types into never had it.
 *
 *   2. Where it WAS wired, the button sat inside
 *      `<template v-if="!compactInput" #extra-buttons>`. `compactInput`
 *      defaults to TRUE and no host overrides it, so that slot never rendered
 *      either. Net reach: zero surfaces.
 *
 * Every test below asserts REACHABILITY, not behaviour. The logic is covered in
 * src/voice/*.spec.js; this file exists purely to answer "is it on screen?",
 * because that is the question 6,000 lines of green tests failed to ask.
 *
 * The sibling UnifiedChatContainer.clear.spec.js was written after the exact
 * same class of bug (an action that existed but no host rendered). That lesson
 * was already paid for once. This file is the same guard for the composer's
 * primary controls, generalised so the next one cannot slip through either.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import UnifiedChatContainer from './UnifiedChatContainer.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../..');
const BASE_SCREEN = path.join(SRC, 'views/Terminal/CenterPanel/BaseScreen.vue');
const UNIFIED = path.join(HERE, 'UnifiedChatContainer.vue');

vi.mock('@/services/chatChannelConfig.js', () => ({ getChannelConfig: () => null }));

vi.mock('@/composables/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: ref(false),
    isSupported: ref(false),
    transcript: ref(''),
    toggleListening: vi.fn(),
  }),
}));

const noopDirective = { mounted() {}, unmounted() {} };

function makeStore() {
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
        actions: { initializeChannel: vi.fn(), clearConversation: vi.fn(), setSuggestions: vi.fn() },
      },
      aiProvider: {
        namespaced: true,
        state: () => ({ selectedProvider: null, selectedModel: null }),
        actions: { setProvider: vi.fn(), setModel: vi.fn() },
      },
    },
  });
}

function mountChat(props = {}) {
  return mount(UnifiedChatContainer, {
    props: {
      channelKey: 'workspace:ws_1',
      chatType: 'orchestrator',
      welcomeMessage: 'Your workspace.',
      ...props,
    },
    global: {
      plugins: [makeStore()],
      directives: { tooltip: noopDirective, 'click-outside': noopDirective },
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
}

describe('voice is reachable in the sidebar/workspace composer', () => {
  it('renders the voice button in the COMPACT composer (the default, and the shipped bug)', () => {
    // compactInput defaults to true. This is the case that was broken: every
    // real host uses the default, so a slot gated on !compactInput reached
    // nobody at all.
    const wrapper = mountChat({ compactInput: true });
    expect(wrapper.find('.chat-voice-btn').exists()).toBe(true);
  });

  it('renders the voice button in the WIDE composer', () => {
    const wrapper = mountChat({ compactInput: false });
    expect(wrapper.find('.chat-voice-btn').exists()).toBe(true);
  });

  it('renders it by default, with no props supplied at all', () => {
    const wrapper = mountChat();
    expect(wrapper.find('.chat-voice-btn').exists()).toBe(true);
  });

  it('the button is clickable, not decoration', async () => {
    const wrapper = mountChat();
    const btn = wrapper.find('.chat-voice-btn');
    expect(btn.attributes('aria-pressed')).toBe('false');
    // Clicking must not throw. It will fail to open a mic in jsdom, which the
    // composable surfaces as an error rather than an exception.
    await btn.trigger('click');
    expect(wrapper.find('.chat-voice-btn').exists()).toBe(true);
  });

  it('still shows voice while a turn is streaming (barge-in needs the control)', () => {
    // The provider/tools buttons hide mid-stream. Voice must not: talking over
    // a reply is the entire point, so hiding the control mid-turn removes the
    // one capability that distinguishes it from push-to-talk.
    const wrapper = mountChat({ compactInput: false });
    const src = fs.readFileSync(path.join(HERE, 'UnifiedChatContainer.vue'), 'utf8');
    const voiceBlock = src.slice(src.indexOf('chat-voice-btn') - 800, src.indexOf('chat-voice-btn'));
    expect(voiceBlock).not.toMatch(/v-if="[^"]*!streaming[^"]*"\s*$/);
    expect(wrapper.find('.chat-voice-btn').exists()).toBe(true);
  });
});

describe('voice is reachable in the MAIN chat screen', () => {
  /**
   * BaseScreen.vue is ~2,500 lines with deep store and panel-geometry
   * dependencies, so the repo's established pattern for it is a source guard
   * (see Workspace.spec.js "BaseScreen panel geometry (source guards)").
   * Weaker than a mount, but it catches the defect that actually happened:
   * the file not being wired at all.
   */
  let src;
  beforeEach(() => {
    src = fs.readFileSync(BASE_SCREEN, 'utf8');
  });

  it('imports the voice session composable', () => {
    expect(src).toMatch(/import\s*\{\s*useVoiceSession\s*\}\s*from\s*'@\/composables\/useVoiceSession'/);
  });

  it('actually calls it (an unused import reaches nobody)', () => {
    expect(src).toMatch(/useVoiceSession\s*\(/);
  });

  it('renders a voice button in its composer', () => {
    expect(src).toContain('chat-voice-button');
    expect(src).toMatch(/@click="toggleVoice"/);
  });

  it('exposes the bindings its own template reads', () => {
    // A template referencing an unreturned setup binding renders nothing and
    // warns only at runtime — invisible to a source-free check.
    for (const binding of ['voiceActive', 'voiceState', 'toggleVoice', 'voicePartial', 'voiceError']) {
      expect(src).toMatch(new RegExp(`${binding}[,:]`));
    }
  });

  it('shows a status strip so the mode is legible', () => {
    expect(src).toContain('voice-status-strip');
  });

  it('does not hide the voice control mid-stream', () => {
    const at = src.indexOf('chat-voice-button');
    const block = src.slice(Math.max(0, at - 600), at);
    expect(block).not.toMatch(/v-if="[^"]*!isStreaming/);
  });
});

describe('voice is reachable in the Agents chat tab', () => {
  /**
   * The last live surface without voice (filed as triage/chattab-legacy-mic
   * when the legacy mic was removed everywhere else). Same source-guard
   * pattern as BaseScreen: the defect class is "not wired at all", and these
   * catch exactly that.
   */
  const CHAT_TAB = path.join(
    SRC,
    'views/Terminal/CenterPanel/screens/Agents/components/AgentDetails/tabs/ChatTab.vue'
  );
  let src;
  beforeEach(() => {
    src = fs.readFileSync(CHAT_TAB, 'utf8');
  });

  it('wires the voice session and renders the button', () => {
    expect(src).toMatch(/import\s*\{\s*useVoiceSession\s*\}/);
    expect(src).toMatch(/useVoiceSession\s*\(/);
    expect(src).toContain('chat-voice-button');
    expect(src).toMatch(/@click="toggleVoice"/);
    expect(src).toContain('voice-status-strip');
  });

  it('script setup exposes the aliases its template reads', () => {
    for (const b of ['voiceActive', 'voiceState', 'voicePartial', 'voiceError', 'toggleVoice']) {
      expect(src).toMatch(new RegExp(`const ${b} = voice\\.`));
    }
  });

  it('no longer carries the legacy dictation mic', () => {
    expect(src).not.toContain('useSpeechRecognition');
    expect(src).not.toContain('chat-mic-button');
  });

  it('voice is not disabled mid-stream — only an offline agent disables it', () => {
    const at = src.indexOf('class="chat-voice-button"');
    const block = src.slice(Math.max(0, at - 400), at);
    expect(block).toContain(':disabled="selectedAgent.status !== \'ACTIVE\'"');
    expect(block).not.toMatch(/:disabled="[^"]*isProcessing/);
  });

  it('ends the session when the selected agent changes', () => {
    expect(src).toMatch(/props\.selectedAgent\?\.id,\s*\n\s*\(\) => \{\s*\n\s*if \(voice\.isActive\.value\) voice\.stop\(\);/);
  });
});

describe('natural voice (speech-to-speech) is reachable and orchestrator-backed', () => {
  /**
   * The point of this engine is that it is BOTH natural AND runs AGNT. Wiring
   * it without the run_agnt bridge would give a lovely voice attached to
   * something that cannot do the work — the exact failure mode the design
   * exists to avoid — so these guard the bridge, not just the import.
   */
  let src;
  beforeEach(() => {
    src = fs.readFileSync(BASE_SCREEN, 'utf8');
  });

  it('wires the realtime session into the main chat', () => {
    expect(src).toMatch(/import\s*\{\s*useRealtimeVoice\s*\}/);
    expect(src).toMatch(/useRealtimeVoice\s*\(/);
  });

  it('THE POINT: the model\u2019s one tool runs through the real send path', () => {
    expect(src).toMatch(/onRunAgnt:\s*runAgntForVoice/);
    // runAgntForVoice must actually submit through the composer, not fabricate
    // an answer or call some parallel API.
    const at = src.indexOf('const runAgntForVoice');
    const body = src.slice(at, at + 2600);
    expect(body).toMatch(/currentUserInput\.value = instruction/);
    expect(body).toMatch(/triggerSubmit\(\)/);
    expect(body).toMatch(/resolve\(/);
  });

  it('completes on the stream ending, not on a timer', () => {
    const at = src.indexOf('const runAgntForVoice');
    const body = src.slice(at, at + 2600);
    expect(body).toMatch(/watch\(isStreaming/);
    expect(body).not.toMatch(/setTimeout/);
  });

  it('falls back to the cascade when natural voice is unavailable', () => {
    // No credit is a normal state, and an error the user cannot act on
    // mid-sentence is worse than quietly using the engine that works.
    const at = src.indexOf('const toggleVoice');
    const body = src.slice(at, at + 700);
    expect(body).toMatch(/realtime\.unavailable\.value/);
    expect(body).toMatch(/voice\.toggle\(\)/);
  });

  it('one button drives whichever engine is running', () => {
    const at = src.indexOf('const toggleVoice');
    const body = src.slice(at, at + 700);
    expect(body).toMatch(/realtime\.isActive\.value.*realtime\.stop\(\)/s);
    expect(body).toMatch(/voice\.isActive\.value.*voice\.stop\(\)/s);
  });

  it('the status strip says which engine is live', () => {
    expect(src).toContain('voice-engine-badge');
    expect(src).toMatch(/voiceNatural/);
  });

  it('SPEAKS AS IT STREAMS — sentence by sentence, not after the whole turn', () => {
    // Waiting for the falling edge of isStreaming before speaking a word means
    // silence for as long as the turn takes. The answer arrives progressively,
    // so it is emitted progressively.
    expect(src).toMatch(/import\s*\{\s*createSentenceChunker\s*\}\s*from\s*'@\/voice\/sentenceChunker'/);
    const at = src.indexOf('const runAgntForVoice');
    const body = src.slice(at, at + 2600);
    expect(body).toMatch(/runAgntForVoice = \(instruction, emit\)/);
    expect(body).toMatch(/chunker\.push\(raw\)/);
    expect(body).toMatch(/chunker\.flush\(\)/);
    expect(body).toMatch(/emit\(chunk\)/);
  });

  it('reuses the tested chunker rather than re-deriving sentences or stripping', () => {
    // sentenceChunker owns both "where does a sentence end" (it will not split
    // v2.17.2) and "what must never be read aloud". A second definition of
    // either would drift from it.
    expect(src).not.toMatch(/function stripUnspeakable/);
    expect(src).not.toMatch(/replace\(\/```/);
    expect(src).not.toMatch(/split\(\/\[\.\!\?\]/);
  });

  it('tears BOTH watchers down before resolving', () => {
    const at = src.indexOf('const runAgntForVoice');
    const body = src.slice(at, at + 2600);
    expect(body).toMatch(/stopContent\(\);\s*\n\s*stopStream\(\);/);
    expect(body.indexOf('stopStream();')).toBeLessThan(body.indexOf('resolve(spokeSomething'));
  });
});

describe('the voice is locked to its conversation, like every other chat state', () => {
  /**
   * Reported: switching chats carried the voice over, or it started up on a
   * message in the newly-opened chat. Three mechanisms, one root cause — the
   * realtime session was added after the conversation-switch guard and never
   * inherited a conversation identity:
   *
   *   1. the switch handler stopped only the cascade engine
   *   2. runAgntForVoice calls triggerSubmit(), which sends to whatever
   *      conversation is active AT THAT MOMENT
   *   3. its isStreaming watcher mirrors the ACTIVE conversation, so it
   *      resolved off a different chat's reply
   */
  let src;
  beforeEach(() => {
    src = fs.readFileSync(BASE_SCREEN, 'utf8');
  });

  it('a conversation switch stops BOTH engines, not just the cascade', () => {
    expect(src).toMatch(/stopAllVoiceSessions = \(\) => \{[\s\S]{0,200}realtime\.stop\(\)/);
    expect(src).toMatch(/stopAllVoiceSessions = \(\) => \{[\s\S]{0,200}voice\.stop\(\)/);
    const at = src.indexOf('chat/SET_ACTIVE_CONVERSATION');
    expect(src.slice(at, at + 1200)).toMatch(/stopAllVoiceSessions\(\)/);
  });

  it('the stop hook is assigned, not referenced — the engines are in TDZ there', () => {
    // The subscriber is registered ~300 lines before the engines exist; a
    // mutation during setup would otherwise throw on their temporal dead zone.
    expect(src).toMatch(/let stopAllVoiceSessions = \(\) => \{\};/);
    expect(src.indexOf('let stopAllVoiceSessions')).toBeLessThan(
      src.indexOf('chat/SET_ACTIVE_CONVERSATION')
    );
    expect(src.indexOf('stopAllVoiceSessions = () => {\n      if (voice')).toBeGreaterThan(
      src.indexOf('const realtime = useRealtimeVoice')
    );
  });

  it('an in-flight run is bound to the conversation it started in', () => {
    const at = src.indexOf('const runAgntForVoice');
    const body = src.slice(at, at + 2600);
    expect(body).toMatch(/const convAtStart = draftKey\.value/);
    // BOTH watchers must check it: the content watcher (or it speaks another
    // chat's reply) and the completion watcher (or it resolves off one).
    expect(body.match(/draftKey\.value !== convAtStart/g) || []).toHaveLength(2);
  });
});

describe('one voice system, not two', () => {
  /**
   * 2026-08-04: the legacy push-to-talk dictation mic was REPLACED by the
   * voice session. The old button was a strict subset of the new one — speech
   * in, nothing out, user as the endpointer — and keeping both meant two
   * adjacent microphone controls with subtly different behaviour. These
   * guards pin the replacement so the old control cannot quietly return on
   * one surface and not the other.
   */
  it('no live chat surface renders the legacy dictation mic', () => {
    // BaseScreen, the shared composer, and the Agents ChatTab are the three
    // live composers. The remaining useSpeechRecognition imports live only in
    // dead *ChatContainer files (imported by nothing; filed for deletion).
    for (const f of [
      BASE_SCREEN,
      path.join(SRC, 'views/Terminal/CenterPanel/screens/Agents/components/AgentDetails/tabs/ChatTab.vue'),
    ]) {
      const s = fs.readFileSync(f, 'utf8');
      expect(s, f).not.toContain('chat-mic-button');
      expect(s, f).not.toContain('useSpeechRecognition');
    }
  });

  it('the shared composer no longer renders the legacy dictation mic', () => {
    const wrapper = mountChat();
    expect(wrapper.find('.chat-mic-btn').exists()).toBe(false);
    expect(wrapper.find('.chat-voice-btn').exists()).toBe(true);
  });

  it('a host can still opt out of voice entirely', () => {
    // showVoiceInput used to gate the old mic; it now gates the new button,
    // so `:show-voice-input="false"` keeps its meaning.
    const wrapper = mountChat({ showVoiceInput: false });
    expect(wrapper.find('.chat-voice-btn').exists()).toBe(false);
  });
});

describe('the voice button looks like the control it sits beside', () => {
  /**
   * The first version styled itself after the old dictation mic — a bare glyph
   * — while every other button in that composer is a 36px circle. It read as a
   * different KIND of thing, which is a real defect: a control's appearance is
   * how a user knows what it is.
   *
   * These compare the voice button's declarations against its actual
   * neighbours rather than against hardcoded values, so the row can be
   * restyled wholesale and this still means "matches its siblings".
   */
  const ruleFor = (src, selector) => {
    const at = src.indexOf(`\n${selector} {`);
    if (at === -1) return null;
    return src.slice(at, src.indexOf('}', at));
  };

  const declared = (block, prop) => {
    const m = block && block.match(new RegExp(`(?:^|\\n)\\s*${prop}:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };

  // The properties that make these buttons read as one family.
  const SHAPE = ['width', 'height', 'border-radius', 'background', 'color', 'margin-left', 'flex-shrink'];

  it('the main chat voice button matches its neighbours exactly when idle', () => {
    const src = fs.readFileSync(BASE_SCREEN, 'utf8');
    const voice = ruleFor(src, '.chat-voice-button');
    const attach = ruleFor(src, '.chat-attach-button');

    expect(voice).toBeTruthy();
    expect(attach).toBeTruthy();
    for (const prop of SHAPE) {
      expect(declared(attach, prop), `sibling declares ${prop}`).toBeTruthy();
      expect(declared(voice, prop), `voice button ${prop}`).toBe(declared(attach, prop));
    }
  });

  it('it is a circle, not a bare glyph (the regression, stated plainly)', () => {
    const src = fs.readFileSync(BASE_SCREEN, 'utf8');
    const voice = ruleFor(src, '.chat-voice-button');
    expect(declared(voice, 'border-radius')).toBe('50%');
    expect(declared(voice, 'background')).not.toBe('none');
  });

  it('hover behaves like its neighbours', () => {
    const src = fs.readFileSync(BASE_SCREEN, 'utf8');
    const voice = ruleFor(src, '.chat-voice-button:hover:not(:disabled)');
    const attach = ruleFor(src, '.chat-attach-button:hover:not(:disabled)');
    expect(voice).toBeTruthy();
    expect(declared(voice, 'background')).toBe(declared(attach, 'background'));
    expect(declared(voice, 'transform')).toBe(declared(attach, 'transform'));
  });

  it('active states tint the circle rather than removing it', () => {
    const src = fs.readFileSync(BASE_SCREEN, 'utf8');
    for (const state of ['voice-on', 'voice-listening,\n.chat-voice-button.voice-reopen', 'voice-thinking', 'voice-speaking']) {
      const block = ruleFor(src, `.chat-voice-button.${state}`);
      expect(block, state).toBeTruthy();
      expect(declared(block, 'background'), `${state} background`).toMatch(/^rgba\(var\(--\w+-rgb\), 0\.2\)$/);
      expect(declared(block, 'color'), `${state} color`).toMatch(/^var\(--color-\w+\)$/);
    }
  });

  it('the generic active rule precedes the specific states (equal specificity)', () => {
    // `.voice-on` and `.voice-<state>` are both 0-2-0, so source order decides.
    // If .voice-on moved below them it would override every specific colour.
    const src = fs.readFileSync(BASE_SCREEN, 'utf8');
    const on = src.indexOf('.chat-voice-button.voice-on {');
    const listening = src.indexOf('.chat-voice-button.voice-listening');
    const speaking = src.indexOf('.chat-voice-button.voice-speaking');
    expect(on).toBeGreaterThan(-1);
    expect(on).toBeLessThan(listening);
    expect(on).toBeLessThan(speaking);
  });

  it('ChatInputBar pierces the circle into SLOTTED buttons (the panel-chat bug)', () => {
    // Scoped CSS does not reach slot content — slotted elements carry the
    // host's scope id — so a plain `.chat-icon-btn` rule styles only
    // ChatInputBar's own buttons. Voice (and provider/tools/clear) arrive via
    // slots, and without the :deep variant they rendered as bare glyphs next
    // to the composer's own circles on every panel chat.
    const bar = fs.readFileSync(path.join(HERE, 'ChatInputBar.vue'), 'utf8');
    const deep = ruleFor(bar, '.chat-icon-btn,\n.chat-input-row :deep(.chat-icon-btn)');
    expect(deep, ':deep circle rule exists').toBeTruthy();
    expect(declared(deep, 'border-radius')).toBe('50%');
    expect(declared(deep, 'width')).toBe('36px');
  });

  it('the shared composer inherits the circle and only adds the tint', () => {
    const src = fs.readFileSync(UNIFIED, 'utf8');
    // It must NOT redeclare the shape — .chat-icon-btn owns that.
    const base = ruleFor(src, '.chat-voice-btn');
    expect(declared(base, 'width')).toBeNull();
    expect(declared(base, 'border-radius')).toBeNull();
    // ...and its active states tint like the main chat's.
    const listening = ruleFor(src, '.chat-voice-btn.voice-listening,\n.chat-voice-btn.voice-reopen');
    expect(declared(listening, 'background')).toBe('rgba(var(--green-rgb), 0.2)');
  });
});

describe('anti-vacuity: these guards can actually fail', () => {
  it('the BaseScreen file it reads is real and substantial', () => {
    const src = fs.readFileSync(BASE_SCREEN, 'utf8');
    expect(src.length).toBeGreaterThan(50000);
    expect(src).toContain('chat-voice-button'); // the control this file guards
  });

  it('a mounted chat renders a composer at all', () => {
    const wrapper = mountChat();
    expect(wrapper.find('textarea').exists()).toBe(true);
  });
});
