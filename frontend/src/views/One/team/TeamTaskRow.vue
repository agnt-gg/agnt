<template>
  <button type="button" class="r" @click="$emit('open', task)">
    <span class="col-dot" :style="{ background: statusColor(task.status) }"></span>
    <span class="r-text">
      <strong>{{ task.title }}</strong>
      <small>{{ statusLabel(task.status) }}<template v-if="task.due"> · due {{ task.due }}</template><template v-if="spaceName"> · {{ spaceName }}</template></small>
    </span>
    <span v-if="task.agentState === 'running'" class="pulse" aria-label="Working"></span>
    <span v-else-if="agentStateLabel(task.agentState)" class="tag" :class="task.agentState === 'waiting' ? 'pink' : 'amber'">{{ agentStateLabel(task.agentState) }}</span>
    <TeamAvatar v-if="task.assignee" :who="task.assignee" :label="ctx.people.value.find((p) => p.id === task.assignee.id)?.name || ''" size="sm" />
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
