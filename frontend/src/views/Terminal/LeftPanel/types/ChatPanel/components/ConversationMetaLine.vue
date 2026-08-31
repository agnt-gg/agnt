<template>
  <div class="output-meta" :class="{ 'has-speaker': !!speaker }">
    <AgentAvatarStack
      :participants="participantsWithIcons"
      :annie-icon="annieAvatar"
      :speaking-id="speaker ? speaker.id : null"
      :size="14"
      :max="3"
    />
    <span v-if="speaker" class="output-speaker">
      <span class="speaking-name">{{ speaker.name }}</span>
      <span class="speaking-verb"> speaking</span>
    </span>
    <span class="output-date">{{ date }}</span>
  </div>
</template>

<script setup>
/**
 * ONE SAVED-CHAT ROW'S META LINE: who is in the conversation, who is talking
 * right now, and when it last changed.
 *
 * WHY A COMPONENT FOR TWO ELEMENTS. OutputList renders a conversation row in
 * FOUR places — inside a group, ungrouped, the flat no-groups list, and
 * archived — and those four copies have already drifted once (the archived
 * copy silently lost the streaming indicator and the unread dot). Four copies
 * of a meta line that is about to grow avatars and a speaking state would
 * drift the same way, so there is one copy and four call sites.
 *
 * AVATARS LEAD THE LINE. Reading order is who-then-when: the faces are the
 * fixed-width part, so the timestamps still line up down the column, and the
 * eye can scan either the left edge for people or the right for time.
 *
 * "SOL SPEAKING" ONLY APPEARS WHILE SOMETHING IS RUNNING. A permanent
 * attribution would spend the timestamp column on a fact the avatars already
 * carry; spending it only when there is live news is what keeps a list of a
 * thousand rows scannable.
 *
 * ─── WHAT COMPETES FOR THE LINE, AND WHO LOSES ─────────────────────────────
 *
 * THE BUG THIS SHAPE FIXES: the speaker and the date used to live in ONE
 * ellipsised span, with the date written LAST. `text-overflow: ellipsis`
 * truncates the END of a line, so the moment a roster grew — three avatars,
 * a long agent name — the part that got eaten was the TIMESTAMP. The most
 * durable fact in the row was sacrificed for the most transient one.
 *
 * They are separate elements now, with an explicit and deliberate order of
 * sacrifice:
 *
 *   1. The DATE never shrinks (flex: 0 0 auto). It is short, bounded, and it
 *      is the thing this list is sorted by — losing it makes a row unreadable.
 *   2. The SPEAKER absorbs all the pressure (flex: 0 1 auto + ellipsis). An
 *      agent name has no length bound, it is already shown as a face beside
 *      the text, and it is only on screen while a run is in flight.
 *   3. The AVATARS never shrink either — the stack is bounded by design
 *      (`max: 3`, everything past it collapses to "+N"), so its width is
 *      predictable no matter how many agents join.
 *
 * That is what makes the line dynamic: it adapts by giving up the name a
 * character at a time, and never by dropping the time.
 */
import { computed } from 'vue';
import { useStore } from 'vuex';
import AgentAvatarStack from '@/components/common/AgentAvatarStack.vue';
import { attachIcons } from '@/utils/agentAvatar.js';
import annieAvatar from '@/assets/images/annie-avatar.png';

const props = defineProps({
  /** Stored roster, agents only, in join order: [{ id, name }]. */
  participants: { type: Array, default: () => [] },
  /** { id, name } while a run is in flight in this conversation, else null. */
  speaker: { type: Object, default: null },
  /** Already-formatted relative date string. */
  date: { type: String, required: true },
});

const store = useStore();

/**
 * THE STORED ROSTER CARRIES NO PICTURES — only [{id, name}], because an icon
 * is an inline data-URL up to ~233KB and a sidebar row has to stay tiny. So
 * the face is resolved here, against the agents already in the store
 * (fetched in phase 1 of initializeStore, before this panel can render).
 *
 * An agent missing from the index — deleted, or not yet fetched — keeps no
 * icon and draws its initial, which is a real answer rather than a hole.
 */
const participantsWithIcons = computed(() =>
  attachIcons(props.participants, store.getters['agents/avatarIndex']),
);
</script>

<style scoped>
.output-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/*
 * THE TIMESTAMP IS NOT NEGOTIABLE. `flex: 0 0 auto` — it never shrinks and
 * never truncates, because it is what the list is sorted by and it is a
 * handful of characters. Everything else on this line yields to it.
 */
.output-date {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-xxs, 10px);
  opacity: 0.7;
  white-space: nowrap;
}

/*
 * THE SPEAKER IS THE PART THAT GIVES WAY. `flex: 0 1 auto` + `min-width: 0`
 * so it may shrink below its content, and the ellipsis lands on the AGENT
 * NAME instead of on the time. `min-width: 0` is load-bearing: a flex item
 * defaults to `min-width: auto`, which refuses to shrink past its content
 * and would push the date out of the row instead of truncating.
 */
.output-speaker {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xxs, 10px);
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The separator belongs to the date, not to the speaker: drawn as generated
   content on the element that cannot shrink, it can never be half-eaten by
   the truncation next to it. */
.has-speaker .output-date::before {
  content: '·';
  margin-right: 5px;
  opacity: 0.55;
}

/* The NAME is the news, so it gets the ink; the verb stays quiet and lets the
   eye jump name-to-name down a column of running conversations. */
.speaking-name {
  color: var(--color-primary);
  font-weight: 600;
}

.speaking-verb {
  opacity: 0.85;
}
</style>
