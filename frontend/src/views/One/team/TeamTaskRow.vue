<template>
  <button type="button" class="r" @click="$emit('open', task)">
    <span class="col-dot" :style="{ background: statusColor(task.status) }"></span>
    <span class="r-text">
      <strong>{{ task.title }}</strong>
      <small>{{ statusLabel(task.status) }}<template v-if="spaceName"> · {{ spaceName }}</template><template v-if="stoppedFor"> · stopped {{ stoppedFor }}</template><template v-if="task.holdingUp"> · holding up {{ plural(task.holdingUp, 'card') }}</template><template v-if="task.due"> · due {{ task.due }}</template></small>
    </span>
    <span v-if="task.agentState === 'running'" class="pulse" aria-label="Working"></span>
    <span v-else-if="stateLine" class="tag" :class="stateLine.tone">{{ stateLine.label }}</span>
    <span v-if="checks" class="tag" :class="checks.tone">{{ checks.label }}</span>
    <TeamAvatar v-if="task.assignee" :who="task.assignee" :label="ctx.people.value.find((p) => p.id === task.assignee.id)?.name || ''" size="sm" />
  </button>
</template>

<script setup>
import { computed, inject } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { statusColor, statusLabel, cardStateLine, checksSummary, ago, plural } from './teamModel.js';

const props = defineProps({ task: { type: Object, required: true } });
defineEmits(['open']);
const ctx = inject('teamCtx');
const spaceName = computed(() => ctx.spaces.value.find((s) => s.id === props.task.workspaceId)?.name || '');
// Why the agent stopped or waits, in words ("Stopped: not published here yet").
const stateLine = computed(() => cardStateLine(props.task));
// A result waiting for review says what its agent checked.
const checks = computed(() => (props.task.agentState === 'waiting' ? checksSummary(props.task.checks) : null));
const stoppedFor = computed(() => {
  if (props.task.agentState !== 'blocked') return '';
  const since = ago(props.task.agentStateAt);
  return !since || since === 'just now' ? since : `${since} ago`;
});
</script>
