<template>
  <div class="output-meta">
    <AgentAvatarStack
      :participants="participantsWithIcons"
      :annie-icon="annieAvatar"
      :speaking-id="speaker ? speaker.id : null"
      :size="14"
      :max="3"
    />
    <span class="output-date">
      <template v-if="speaker">
        <span class="speaking-name">{{ speaker.name }}</span>
        <span class="speaking-verb"> speaking</span>
        <span class="meta-sep"> · </span>
      </template>{{ date }}
    </span>
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

.output-date {
  color: var(--color-text-muted);
  font-size: var(--font-size-xxs, 10px);
  opacity: 0.7;
  /* The line must never wrap or grow the row: a long agent name truncates
     rather than pushing the timestamp onto a second line and making one row
     taller than its neighbours. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* The NAME is the news, so it gets the ink; the verb and separator stay quiet
   and let the eye jump name-to-name down a column of running conversations. */
.speaking-name {
  color: var(--color-primary);
  font-weight: 600;
}

.speaking-verb,
.meta-sep {
  opacity: 0.85;
}
</style>
