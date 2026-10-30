<template>
  <button type="button" class="ot-r" @click="$emit('open', task)">
    <span class="ot-col-dot" :style="{ background: statusColor(task.status) }"></span>
    <span class="ot-r-text">
      <strong>{{ task.title }}</strong>
      <small>{{ statusLabel(task.status) }}<template v-if="task.due"> · due {{ task.due }}</template><template v-if="spaceName"> · {{ spaceName }}</template></small>
    </span>
    <span v-if="task.agentState === 'running'" class="ot-pulse" aria-label="Working"></span>
    <span v-else-if="agentStateLabel(task.agentState)" class="ot-tag" :class="task.agentState === 'waiting' ? 'is-pink' : 'is-amber'">{{ agentStateLabel(task.agentState) }}</span>
    <TeamAvatar v-if="task.assignee" :who="task.assignee" size="sm" />
  </button>
</template>

<script setup>
import { computed, inject } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { statusColor, statusLabel, agentStateLabel } from './teamModel.js';

const props = defineProps({ task: { type: Object, required: true } });
defineEmits(['open']);
const ctx = inject('teamCtx');
const spaceName = computed(() => ctx.spaces.value.find((s) => s.id === props.task.workspaceId)?.name || '');
</script>
