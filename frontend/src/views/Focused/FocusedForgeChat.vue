<!-- The Annie chat on the left of an AGNT One editor, like the Plugin Forge's.
     The context comes from focusedForgeChat.js. When Annie finishes a tool
     call, `changed` tells the editor to reload what she may have saved. -->
<template>
  <aside class="focused-forge-chat" :aria-label="'Chat with Annie about this ' + kind">
    <UnifiedChatContainer
      v-if="ctx"
      :key="ctx.channelKey"
      :channel-key="ctx.channelKey"
      :chat-type="ctx.chatType"
      :page-context="ctx.pageContext"
      :page-state="ctx.pageState"
      :on-frontend-event="onEvent"
      :welcome-message="ctx.welcome"
      :empty-icon="ctx.icon"
      :placeholder="ctx.placeholder"
      :initial-suggestions="ctx.suggestions"
      :suggestions-context-label="kind"
    />
  </aside>
</template>

<script setup>
import { computed, onBeforeUnmount } from 'vue';
import UnifiedChatContainer from '@/views/_components/chat/UnifiedChatContainer.vue';
import { forgeChatContext, savedItemId } from './focusedForgeChat.js';

const props = defineProps({
  kind: { type: String, required: true },
  itemId: { type: String, default: null },
  /** The item as it would be saved: stored record + live edits. */
  record: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['changed']);

const ctx = computed(() => forgeChatContext(props.kind, { itemId: props.itemId, record: props.record }));

// Several tool calls can finish in one turn: reload once, after they settle.
let timer = null;
let createdId = null;
function onEvent(eventType, _data, toolCall) {
  if (eventType !== 'tool-completed') return;
  createdId = createdId || savedItemId(props.kind, toolCall);
  clearTimeout(timer);
  timer = setTimeout(() => {
    emit('changed', { createdId });
    createdId = null;
  }, 700);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>
