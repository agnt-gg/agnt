<!-- The Annie chat on the left of an AGNT One editor, like the Plugin Forge's.
     The context comes from focusedForgeChat.js. `draft` carries what Annie
     generated (field updates, a whole agent or workflow) for the editor to
     fill in (focusedForgeDraft.js); `changed`, after her tool calls settle,
     lets the editor show what she saved. -->
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
import { computed, onMounted, onBeforeUnmount } from 'vue';
import UnifiedChatContainer from '@/views/_components/chat/UnifiedChatContainer.vue';
import { forgeChatContext, savedItemId } from './focusedForgeChat.js';

const props = defineProps({
  kind: { type: String, required: true },
  itemId: { type: String, default: null },
  /** The item as it would be saved: stored record + live edits. */
  record: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['changed', 'draft']);

const ctx = computed(() => forgeChatContext(props.kind, { itemId: props.itemId, record: props.record }));

// Several tool calls can finish in one turn: reload once, after they settle.
let timer = null;
let createdId = null;
function onEvent(eventType, data, toolCall) {
  if (eventType !== 'tool-completed') {
    emit('draft', { eventType, data: data || {}, toolCall: toolCall || null });
    return;
  }
  createdId = createdId || savedItemId(props.kind, toolCall);
  clearTimeout(timer);
  timer = setTimeout(() => {
    emit('changed', { createdId });
    createdId = null;
  }, 700);
}
// update_workflow sends its graph by realtime broadcast, re-dispatched on
// window as `workflow-updated` (utils/workflowBroadcast.js).
function onWorkflowBroadcast(event) {
  emit('draft', { eventType: 'workflow-updated', data: event.detail || {}, toolCall: null });
}
onMounted(() => {
  if (props.kind === 'workflows') window.addEventListener('workflow-updated', onWorkflowBroadcast);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  window.removeEventListener('workflow-updated', onWorkflowBroadcast);
});
</script>
