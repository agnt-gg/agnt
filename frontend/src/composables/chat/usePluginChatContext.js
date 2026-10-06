// usePluginChatContext — page-state capture for the Plugin Forge chat.
//
// Same contract as useWidgetChatContext, one difference: the draft lives in
// the `pluginBuilder` store rather than in the editor component, so the chat
// (LeftPanel) reads it directly instead of through provide/inject between
// sibling panels — the gap Widget Forge has to paper over with a DB fetch.
//
// Outbound: every turn ships the whole draft as `pluginState` (see
// backend orchestrator/pluginTools.js for the shape).
// Inbound: `plugin-*` events from the chat's tools are applied to the store
// HERE, by the chat that received them, so a change lands even if the Forge
// pane is not mounted. They are then re-broadcast as `chat-sse-event` for the
// pane's own reactions (switch to the Test tab, refresh the plugin list).

import { computed } from 'vue';
import { useStore } from 'vuex';
import { PLUGIN_FORGE_CHANNEL_KEY } from '@/store/features/pluginBuilder.js';

/**
 * Window event `{ detail: { text } }`: send `text` to the Forge chat. The Forge
 * pane (Ask to fix) and the chat panel are siblings with no shared parent
 * component to pass a ref through.
 */
export const PLUGIN_FORGE_ASK_EVENT = 'plugin-forge-ask';

export function askPluginForge(text) {
  window.dispatchEvent(new CustomEvent(PLUGIN_FORGE_ASK_EVENT, { detail: { text } }));
}

export function usePluginChatContext() {
  const store = useStore();

  const draftName = computed(() =>
    store.getters['pluginBuilder/isGenerationComplete'] ? store.getters['pluginBuilder/pluginName'] : '',
  );

  const channelKey = computed(() => PLUGIN_FORGE_CHANNEL_KEY);
  const pageContext = computed(() => ({ pluginContext: { name: draftName.value } }));
  const pageState = computed(() => ({
    pluginState: {
      name: draftName.value,
      files: store.getters['pluginBuilder/draftFiles'],
      installState: store.getters['pluginBuilder/draftInstallState'],
    },
  }));

  const onFrontendEvent = (eventType, eventData) => {
    if (!eventType) return;
    if (eventType.startsWith('plugin-')) {
      store.dispatch('pluginBuilder/applyChatEvent', { eventType, eventData });
    }
    window.dispatchEvent(new CustomEvent('chat-sse-event', { detail: { eventType, eventData } }));
  };

  return {
    channelKey,
    chatType: 'plugin',
    pageContext,
    pageState,
    onFrontendEvent,
  };
}
