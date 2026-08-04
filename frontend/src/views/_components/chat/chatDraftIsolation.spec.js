/**
 * DRAFT ISOLATION — the composer belongs to its conversation.
 *
 * Before this, both composers held their draft in a plain component ref: text
 * typed into one conversation followed the user into the next, and a reload
 * destroyed it. These tests mount the REAL container and drive the REAL
 * textarea, because the defect class here is wiring (a ref that is not keyed
 * by anything), and unit tests of the storage module cannot see wiring.
 *
 * Same discipline as voiceReachability.spec.js: behavioural tests against the
 * mounted shared composer, source guards for BaseScreen (whose store/panel
 * dependency graph makes a full mount impractical — the repo's established
 * pattern for that file).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import UnifiedChatContainer from './UnifiedChatContainer.vue';
import { getDraft } from '@/services/chatDrafts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../..');
const BASE_SCREEN = path.join(SRC, 'views/Terminal/CenterPanel/BaseScreen.vue');
const UNIFIED = path.join(HERE, 'UnifiedChatContainer.vue');

vi.mock('@/services/chatChannelConfig.js', () => ({ getChannelConfig: () => null }));

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
      agents: { namespaced: true, getters: { allAgents: () => [] } },
    },
  });
}

function mountChat(props = {}) {
  return mount(UnifiedChatContainer, {
    props: { channelKey: 'workspace:ws_A', chatType: 'orchestrator', welcomeMessage: 'hi', ...props },
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

beforeEach(() => {
  localStorage.removeItem('chatDraftsV1');
});

describe('shared composer — drafts are per conversation', () => {
  it('THE CORE CASE: a draft typed in one conversation does not appear in another', async () => {
    const a = mountChat({ channelKey: 'workspace:ws_A' });
    await a.find('textarea').setValue('half-finished thought for A');
    a.unmount();

    const b = mountChat({ channelKey: 'workspace:ws_B' });
    expect(b.find('textarea').element.value).toBe('');
    b.unmount();
  });

  it('the draft is waiting when you come back', async () => {
    const a1 = mountChat({ channelKey: 'workspace:ws_A' });
    await a1.find('textarea').setValue('half-finished thought for A');
    a1.unmount();

    const a2 = mountChat({ channelKey: 'workspace:ws_A' });
    expect(a2.find('textarea').element.value).toBe('half-finished thought for A');
    a2.unmount();
  });

  it('two conversations hold two different drafts at once', async () => {
    const a = mountChat({ channelKey: 'workspace:ws_A' });
    await a.find('textarea').setValue('draft A');
    a.unmount();
    const b = mountChat({ channelKey: 'workspace:ws_B' });
    await b.find('textarea').setValue('draft B');
    b.unmount();

    expect(getDraft('workspace:ws_A')).toBe('draft A');
    expect(getDraft('workspace:ws_B')).toBe('draft B');
  });

  it('clearing the input clears the stored draft — no stale resurrection', async () => {
    const a = mountChat({ channelKey: 'workspace:ws_A' });
    await a.find('textarea').setValue('temporary');
    await a.find('textarea').setValue('');
    a.unmount();
    expect(getDraft('workspace:ws_A')).toBe('');
  });

  it('an in-place channelKey swap loads the new conversation draft', async () => {
    // Most hosts :key the container and remount; this pins the fallback path
    // for hosts that swap the prop directly.
    const w = mountChat({ channelKey: 'workspace:ws_A' });
    await w.find('textarea').setValue('draft A');
    await w.setProps({ channelKey: 'workspace:ws_B' });
    expect(w.find('textarea').element.value).toBe('');
    await w.setProps({ channelKey: 'workspace:ws_A' });
    expect(w.find('textarea').element.value).toBe('draft A');
    w.unmount();
  });
});

describe('main chat screen — source guards', () => {
  let src;
  beforeEach(() => {
    src = fs.readFileSync(BASE_SCREEN, 'utf8');
  });

  it('keys the draft by the active conversation id', () => {
    expect(src).toMatch(/chatDrafts/);
    expect(src).toMatch(/activeConversationId/);
    expect(src).toMatch(/const currentUserInput = ref\(getDraft\(draftKey\.value\)\)/);
  });

  it('writes through synchronously — the race is documented and closed', () => {
    expect(src).toMatch(/setDraft\(draftKey\.value, v\), \{ flush: 'sync' \}/);
  });

  it('loads the incoming draft on conversation switch', () => {
    expect(src).toMatch(/watch\(draftKey, \(next\) => \{[\s\S]{0,300}getDraft\(next\)/);
  });

  it('ends a live voice session on conversation switch', () => {
    expect(src).toMatch(/watch\(draftKey, \(\) => \{\s*\n\s*if \(voice\.isActive\.value\) voice\.stop\(\);/);
  });
});

describe('shared composer — voice dies with its channel', () => {
  it('the channelKey watch stops an active session (source guard)', () => {
    const src = fs.readFileSync(UNIFIED, 'utf8');
    expect(src).toMatch(/props\.channelKey,\s*\(\) => \{\s*\n\s*if \(voice\.isActive\.value\) voice\.stop\(\);/);
  });
});

describe('anti-vacuity', () => {
  it('the textarea drive actually persists through the real module', async () => {
    const a = mountChat({ channelKey: 'workspace:ws_A' });
    await a.find('textarea').setValue('proof');
    expect(getDraft('workspace:ws_A')).toBe('proof');
    a.unmount();
  });
});
