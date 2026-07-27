<template>
  <div class="wsc-root">
    <UnifiedChatContainer
      :key="channelKey"
      :channel-key="channelKey"
      chat-type="orchestrator"
      :page-state="pageState"
      :compact-input="true"
      :show-avatar="true"
      message-item-mode="full"
      :on-frontend-event="onFrontendEvent"
      welcome-message="One canvas. Ask for anything — the widgets you need will open around this conversation."
      empty-icon="fas fa-layer-group"
      placeholder="Ask, build, or steer…"
      :initial-suggestions="suggestions"
      suggestions-context-label="workspace"
    />
  </div>
</template>

<script>
/**
 * Workspace Chat Widget
 *
 * A thin wrapper around UnifiedChatContainer that reads its configuration from
 * the workspace's provide/inject context. This lets chat behave as a regular
 * grid widget — draggable, resizable, closeable, re-addable from the palette —
 * while still binding to a workspace conversation channel.
 *
 * Channels are PER INSTANCE: the workspace provides a resolver
 * (workspaceChatChannelFor) that maps this widget's instanceId to its own
 * conversation channel. The primary chat (created with the workspace) binds
 * `workspace:<wsId>`; every chat added afterwards binds
 * `workspace:<wsId>:<instanceId>` — an independent, initially BLANK
 * conversation. Without this, every chat widget shared one channel, so a
 * freshly added chat appeared pre-filled with the existing thread.
 *
 * The workspace provides:
 *   workspaceChatChannelFor — (instanceId) => channel string   (preferred)
 *   workspaceChatChannel    — legacy single-channel fallback
 *   workspacePageState      — computed { workspaceState: { id, name, ... } }
 *   workspaceFrontendEvent  — (type, data) => void (auto-open handler)
 *   workspaceSuggestions    — initial suggestion chips
 */
import { computed, inject, unref } from 'vue';
import UnifiedChatContainer from '@/views/_components/chat/UnifiedChatContainer.vue';

export default {
  name: 'WorkspaceChatWidget',
  components: { UnifiedChatContainer },
  props: {
    // Injected by the canvas host (Workspace.vue passes it to every widget
    // component). Keys this instance's conversation channel.
    widgetInstanceId: { type: String, default: '' },
  },
  setup(props) {
    const channelFor = inject('workspaceChatChannelFor', null);
    const legacyChannel = inject('workspaceChatChannel', 'workspace:default');
    const pageState = inject('workspacePageState', null);
    const onFrontendEvent = inject('workspaceFrontendEvent', null);
    const suggestions = inject('workspaceSuggestions', []);

    const channelKey = computed(() => {
      if (typeof channelFor === 'function' && props.widgetInstanceId) {
        const resolved = channelFor(props.widgetInstanceId);
        if (resolved) return resolved;
      }
      return unref(legacyChannel) || 'workspace:default';
    });

    return { channelKey, pageState, onFrontendEvent, suggestions };
  },
};
</script>

<style scoped>
.wsc-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
