<template>
  <span class="agent-avatar-stack" :class="{ 'is-overlapped': overlap }">
    <AgentAvatar
      v-for="member in roster.shown"
      :key="member.id || member.name"
      :agent="member"
      :size="size"
      :speaking="isSpeaking(member)"
      :tooltip="tooltipFor(member)"
    />
    <span
      v-if="roster.overflow > 0"
      class="agent-avatar-overflow"
      :style="overflowStyle"
      v-tooltip="overflowTooltip"
    >+{{ roster.overflow }}</span>
  </span>
</template>

<script setup>
/**
 * WHO IS IN THIS CONVERSATION — Annie plus everyone she has handed the floor
 * to, as a compact cluster of faces.
 *
 * ANNIE IS ALWAYS FIRST AND ALWAYS PRESENT. She is the constant, so the eye
 * lands on the same face in every row and reads the DIFFERENCE — who else is
 * here. She is never stored in a roster for the same reason (see
 * backend/src/utils/transcriptParticipants.js); every surface adds her.
 *
 * PAST `max` FACES IT COUNTS INSTEAD OF DRAWING. A row's width has to be
 * predictable whether a conversation has one agent or twelve, or the
 * timestamp beside it moves around as agents join and the column stops
 * scanning cleanly.
 */
import { computed } from 'vue';
import AgentAvatar from './AgentAvatar.vue';
import { buildRoster, ANNIE_ID, ANNIE_NAME } from '@/utils/agentAvatar';

const props = defineProps({
  /** Stored roster: [{ id, name }], agents only, in join order. */
  participants: { type: Array, default: () => [] },
  /** Rendered diameter per face, px. */
  size: { type: Number, default: 16 },
  /** Total faces drawn, Annie included. Anything beyond becomes "+N". */
  max: { type: Number, default: 3 },
  /** Overlap the faces into a stack rather than spacing them out. */
  overlap: { type: Boolean, default: true },
  /** Annie's avatar asset, passed in so this component owns no asset paths. */
  annieIcon: { type: String, default: null },
  /**
   * Who is talking RIGHT NOW: an agent id, or ANNIE_ID for the orchestrator.
   * Null when nothing is streaming.
   */
  speakingId: { type: String, default: null },
});

const roster = computed(() =>
  buildRoster(props.participants, { max: props.max, annieIcon: props.annieIcon }),
);

function isSpeaking(member) {
  if (!props.speakingId) return false;
  return (member.id || member.name) === props.speakingId;
}

function tooltipFor(member) {
  const name = member.name || ANNIE_NAME;
  return isSpeaking(member) ? `${name} — speaking now` : name;
}

/**
 * The overflow chip names who it is hiding. It is the only way to find out
 * without opening the conversation, and a bare "+4" that answers no question
 * is decoration rather than information.
 */
const overflowTooltip = computed(() => {
  const hidden = props.participants.slice(Math.max(0, props.max - 1));
  return hidden.map((p) => p.name || 'Agent').join(', ');
});

const overflowStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(7, Math.round(props.size * 0.46))}px`,
}));

defineExpose({ ANNIE_ID });
</script>

<style scoped>
.agent-avatar-stack {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  /* ROW-REVERSE IS LOAD-BEARING. In an overlapped stack the LAST painted
     element sits on top, and Annie must be the one on top — she is the
     anchor. Reversing the visual order lets the template emit her first
     (which is what every reader of this file expects) while she still paints
     last. The children are laid out right-to-left, so the negative margin
     below is margin-RIGHT. */
  flex-direction: row-reverse;
}

.agent-avatar-stack.is-overlapped > :deep(.agent-avatar),
.agent-avatar-stack.is-overlapped > .agent-avatar-overflow {
  margin-right: -6px;
}

/* The leftmost-drawn face (last in DOM, first visually) keeps its full box so
   the cluster does not sit 6px off from whatever follows it. */
.agent-avatar-stack.is-overlapped > :deep(.agent-avatar:last-child) {
  margin-right: 0;
}

.agent-avatar-stack:not(.is-overlapped) > :deep(.agent-avatar),
.agent-avatar-stack:not(.is-overlapped) > .agent-avatar-overflow {
  margin-right: 3px;
}

.agent-avatar-stack:not(.is-overlapped) > :deep(.agent-avatar:last-child) {
  margin-right: 0;
}

.agent-avatar-overflow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--surface-raised);
  color: var(--color-text-secondary);
  font-weight: 700;
  line-height: 1;
  border: 1.5px solid var(--avatar-ring, var(--color-darker-0));
  box-sizing: content-box;
  user-select: none;
  /* Drawn FIRST in the template so it lands at the BACK of the stack — the
     count is the least important thing in the cluster. */
  order: 0;
}
</style>
