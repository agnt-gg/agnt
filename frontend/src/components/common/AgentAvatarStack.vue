<template>
  <span class="agent-avatar-stack" :class="{ 'is-overlapped': overlap }">
    <!--
      DOM ORDER IS PAINT ORDER, AND UNDER row-reverse IT IS ALSO RIGHT-TO-LEFT.
      So this list is emitted BACK-TO-FRONT: the overflow count first (drawn at
      the far right, underneath nothing), then the roster reversed so ANNIE IS
      LAST — which puts her at the visual LEFT and paints her ON TOP.
      See the note above `painted` in the script block.
    -->
    <span
      v-if="roster.overflow > 0"
      class="agent-avatar-overflow"
      :style="overflowStyle"
      v-tooltip="overflowTooltip"
    >+{{ roster.overflow }}</span>
    <AgentAvatar
      v-for="member in painted"
      :key="member.id || member.name"
      :agent="member"
      :size="size"
      :speaking="isSpeaking(member)"
      :tooltip="tooltipFor(member)"
    />
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
import { buildRoster, ANNIE_ID, ANNIE_NAME } from '@/utils/agentAvatar.js';

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

/**
 * The roster in PAINT order: back to front.
 *
 * `buildRoster` returns reading order — Annie first. The template needs the
 * opposite, because two separate mechanisms both key off DOM order and both
 * want Annie last:
 *
 *   1. PAINT. In an overlapping cluster the later sibling covers the earlier
 *      one. Annie must be the face that is never clipped, so she must be last.
 *   2. POSITION. `flex-direction: row-reverse` lays children out right to
 *      left, so the last child sits at the far LEFT — where Annie belongs,
 *      leading the line.
 *
 * Reversing here rather than in `buildRoster` keeps that function's output in
 * the order a human reads it, which is what every other caller wants.
 */
const painted = computed(() => [...roster.value.shown].reverse());

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
  /* ROW-REVERSE IS LOAD-BEARING — it is what makes DOM order paint order AND
     right-to-left at once, so emitting Annie last puts her both on top and at
     the far left. The children run right to left, so every margin below is
     margin-RIGHT: a negative one pulls a face over its right-hand neighbour. */
  flex-direction: row-reverse;
}

.agent-avatar-stack.is-overlapped > :deep(.agent-avatar),
.agent-avatar-stack.is-overlapped > .agent-avatar-overflow {
  margin-right: -6px;
}

/*
 * THE FACE AT THE VISUAL RIGHT EDGE KEEPS ITS FULL BOX.
 *
 * THE BUG THIS FIXES: this rule used to say `:last-child`. Under row-reverse
 * the last child is the LEFTMOST one, so the rule zeroed a margin at the edge
 * nothing touches, and left the -6px on the child at the RIGHT edge — the one
 * standing next to the text. A negative margin there shrinks the stack's box
 * out from under its own ink: the avatar rendered 6px past the box, which is
 * exactly the `gap: 6px` .output-meta puts between them. MEASURED: 6px of
 * declared gap, 0px of actual daylight, on every row with two or more faces.
 * A solo row was unaffected — one child is both first and last — which is why
 * this looked like "multiple agents break the spacing".
 */
.agent-avatar-stack.is-overlapped > :deep(.agent-avatar:first-child),
.agent-avatar-stack.is-overlapped > .agent-avatar-overflow:first-child {
  margin-right: 0;
}

/*
 * THE COUNT IS NEVER COVERED. "+4" is two glyphs in a 14px circle; letting the
 * neighbouring face overlap it ate the digit and left an unreadable chip. The
 * face to its left stands off by 3px instead, so the cluster reads as
 * "these people, and four more" rather than as one smear.
 */
.agent-avatar-stack.is-overlapped > .agent-avatar-overflow + :deep(.agent-avatar) {
  margin-right: 3px;
}

.agent-avatar-stack:not(.is-overlapped) > :deep(.agent-avatar),
.agent-avatar-stack:not(.is-overlapped) > .agent-avatar-overflow {
  margin-right: 3px;
}

/* Same edge, same reason: the rightmost child must not push into the gap. */
.agent-avatar-stack:not(.is-overlapped) > :deep(.agent-avatar:first-child),
.agent-avatar-stack:not(.is-overlapped) > .agent-avatar-overflow:first-child {
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
}
</style>
