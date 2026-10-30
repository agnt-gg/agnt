<template>
  <!-- The approved mockup's task strip, above a chat that is a task: its
       status, its board card, how much is approved, and a jump to what needs you. -->
  <div v-if="cards.length" class="mk mk-strip-host">
    <div class="tc-strip" data-testid="mk-task-strip">
      <span class="tc-status" :class="status">{{ STATUS[status] }}</span>
      <button v-if="task" type="button" class="link" @click="$emit('open-task', task)"><MkIcon name="task" size="xs" /> Task on the board</button>
      <span>{{ decided }} of {{ cards.length }} approved</span>
      <span class="fill"></span>
      <button v-if="pending" type="button" class="link" @click="jump">Jump to what needs you ↓</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { useCheckpoints } from '@/composables/useCheckpoints.js';
import MkIcon from './MkIcon.vue';

const STATUS = Object.freeze({ need: 'Needs you', run: 'Working', done: 'Done' });
const props = defineProps({ conversationId: { type: String, default: null } });
defineEmits(['open-task']);
const checkpoints = useCheckpoints();
const loaded = ref([]);

async function load() {
  if (!props.conversationId) { loaded.value = []; return; }
  try {
    const response = await fetch(API_CONFIG.BASE_URL + '/checkpoints?conversationId=' + encodeURIComponent(props.conversationId), { headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') } });
    loaded.value = response.ok ? await response.json() : [];
  } catch {
    loaded.value = [];
  }
}
// A replaced card is history, not a step; the live copy of each card wins.
const cards = computed(() => loaded.value.filter((c) => c.state !== 'superseded').map((c) => checkpoints.get(c.id) || c));
const pending = computed(() => cards.value.find((c) => c.state === 'pending') || null);
const decided = computed(() => cards.value.filter((c) => c.state === 'approved' || c.state === 'skipped').length);
const status = computed(() => (pending.value ? 'need' : cards.value.some((c) => (c.kind === 'final' || c.kind === 'routine') && c.state === 'approved') ? 'done' : 'run'));
const task = computed(() => cards.value.find((c) => c.task)?.task || null);
function jump() {
  const el = document.querySelector(`[data-testid="checkpoint-${pending.value.id}"]`);
  if (!el) return;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}
watch(() => props.conversationId, load, { immediate: true });
watch(() => checkpoints.state.pending.map((c) => c.id).join(), load);
</script>
