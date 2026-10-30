<template>
  <!-- The approved mockup's chat list: New chat, private to you, the chats
       waiting for your OK first, then everything else. Real conversations. -->
  <div class="mk mk-chatlist-host">
    <div class="chat-list" data-testid="mk-chat-list">
      <button type="button" class="d-item" style="color: var(--text-primary); font-weight: 500" @click="$emit('new-chat')"><MkIcon name="pen" size="sm" />New chat</button>
      <div class="d-head"><MkIcon name="lock" size="xs" /> Private to you</div>
      <template v-if="need.length">
        <div class="tc-group">Needs you</div>
        <button v-for="c in need" :key="c.id" type="button" class="d-item tc-chatrow" :class="{ 'is-active': c.id === activeId }" @click="$emit('open', c.id)">
          <span class="tc-dot need"></span><span class="tc-chatrow-t"><span>{{ c.title }}</span><small>{{ c.sub }}</small></span>
        </button>
        <div class="tc-group">Everything else</div>
      </template>
      <button v-for="c in rest" :key="c.id" type="button" class="d-item tc-chatrow" :class="{ 'is-active': c.id === activeId }" @click="$emit('open', c.id)">
        <span class="tc-dot" :class="c.working ? 'run' : 'none'"></span><span class="tc-chatrow-t"><span>{{ c.title }}</span><small>{{ c.sub }}</small></span>
      </button>
      <p v-if="!rows.length" class="d-note">No chats yet. Start one and it shows up here.</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './MkIcon.vue';
import { recentConversations } from '@/views/Focused/focusedModel.js';
import { useCheckpoints } from '@/composables/useCheckpoints.js';
import { ago } from '@/views/One/team/teamModel.js';

const KIND = Object.freeze({ plan: 'Plan to approve', review: 'Something to check', run: 'Run to approve', final: 'Final review', routine: 'Routine to approve' });
defineProps({ activeId: { type: String, default: null } });
defineEmits(['open', 'new-chat']);
const store = useStore();
const checkpoints = useCheckpoints();

const rows = computed(() => recentConversations(store.getters['contentOutputs/visibleOutputs'], '', 80, store.getters['contentOutputs/subChatIdSet'], { workingIds: store.getters['chat/streamingOutputIds'], speakingById: store.getters['chat/speakingByOutputId'] }));
const waitingByChat = computed(() => new Map(checkpoints.state.pending.filter((c) => c.outputId).map((c) => [String(c.outputId), c])));
const decorate = (r) => {
  const waiting = waitingByChat.value.get(String(r.id));
  const sub = waiting ? KIND[waiting.kind] || 'Needs your OK' : r.working ? 'Working' : ago(new Date(r.at).toISOString());
  return { ...r, sub };
};
const need = computed(() => rows.value.filter((r) => waitingByChat.value.has(String(r.id))).map(decorate));
const rest = computed(() => rows.value.filter((r) => !waitingByChat.value.has(String(r.id))).map(decorate));

onMounted(() => {
  if (!store.getters['contentOutputs/outputs']?.length) store.dispatch('contentOutputs/fetchOutputs').catch(() => {});
  checkpoints.loadPending();
});
</script>
