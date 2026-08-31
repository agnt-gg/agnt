<template>
  <span
    class="agent-avatar"
    :class="[`is-${resolved.kind}`, { 'is-annie': agent.isAnnie, 'is-speaking': speaking }]"
    :style="avatarStyle"
    v-tooltip="tooltip"
  >
    <img
      v-if="resolved.kind === 'image'"
      :src="resolved.src"
      :alt="agent.name || ''"
      loading="lazy"
      decoding="async"
      @error="imageFailed = true"
    />
    <i v-else-if="resolved.kind === 'fontawesome'" :class="resolved.className"></i>
    <span v-else-if="resolved.kind === 'emoji'" class="avatar-glyph">{{ resolved.glyph }}</span>
    <span v-else class="avatar-letter">{{ resolved.letter }}</span>
  </span>
</template>

<script setup>
/**
 * ONE AGENT'S FACE, at any size.
 *
 * All four rungs of the ladder live in utils/agentAvatar.js so this component
 * is only ever presentation — the chat roster and the sidebar cannot disagree
 * about what an agent looks like, because neither of them decides.
 *
 * A BROKEN IMAGE FALLS BACK RATHER THAN LEAVING A HOLE. Icons are stored as
 * inline data-URLs, and a truncated one loads as nothing at all: the @error
 * handler drops this avatar to the initial rung, which always renders. An
 * empty circle in a row of faces reads as a bug; a lettered circle reads as
 * an agent.
 */
import { computed, ref, watch } from 'vue';
import { resolveAvatar, ANNIE_NAME } from '@/utils/agentAvatar';

const props = defineProps({
  agent: { type: Object, required: true },
  /** Rendered diameter in px. 16 is the sidebar size; 14 is the floor. */
  size: { type: Number, default: 16 },
  /** Paint the "this one is talking right now" ring. */
  speaking: { type: Boolean, default: false },
  /** Tooltip text. Defaults to the agent's name. */
  tooltip: { type: String, default: undefined },
});

const imageFailed = ref(false);
// A new agent in this slot deserves a fresh attempt — otherwise one bad icon
// permanently poisons a recycled v-for node for every agent that follows it.
watch(() => props.agent, () => { imageFailed.value = false; });

const resolved = computed(() => {
  const base = resolveAvatar(props.agent);
  if (base.kind === 'image' && imageFailed.value) {
    return resolveAvatar({ ...props.agent, icon: null });
  }
  return base;
});

const tooltip = computed(() => props.tooltip ?? (props.agent.name || ANNIE_NAME));

const avatarStyle = computed(() => {
  const style = {
    width: `${props.size}px`,
    height: `${props.size}px`,
    // Glyphs and letters scale WITH the circle rather than sitting at a fixed
    // size, so one component covers 14px in a sidebar and 28px in a header
    // without a second set of rules per call site.
    fontSize: `${Math.round(props.size * 0.58)}px`,
  };
  if (resolved.value.kind === 'initial') {
    // The FILL is per-agent so it has to be computed; the INK on that fill is
    // a theme token (--text-on-fill), applied by the .is-initial rule below.
    // Setting a literal white here is the unpaired-fill defect the theme
    // guards exist to catch — it reads correctly in whichever theme its
    // author had open and wrong in the other.
    style.background = `hsl(${resolved.value.hue} 42% 42%)`;
  }
  return style;
});
</script>

<style scoped>
.agent-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-raised);
  color: var(--color-text);
  line-height: 1;
  /* The ring is the ROW's background colour, not a colour of its own: it is
     what separates overlapping avatars in a stack, so it has to disappear
     into whatever the row is painted. Call sites override it when the row
     changes colour (selected, hovered). */
  border: 1.5px solid var(--avatar-ring, var(--color-darker-0));
  box-sizing: content-box;
  user-select: none;
}

.agent-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-glyph,
.avatar-letter {
  display: block;
  line-height: 1;
}

.avatar-letter {
  font-weight: 700;
  /* Letterforms need a touch more optical room than an emoji at the same
     nominal size, or they crowd the circle. */
  transform: scale(0.92);
}

/* Both of these paint INK ON A COLOURED FILL, which is a token PAIR in this
   codebase (--text-on-fill), not a colour chosen per call site. Hardcoding
   white here measures 5.15:1 in one theme and 1.53:1 in another — see
   styles/onFillContrast.spec.js. */
.agent-avatar.is-initial {
  color: var(--text-on-fill);
}

.agent-avatar.is-annie {
  background: linear-gradient(135deg, var(--color-accent-light, var(--color-primary)), var(--color-primary));
  color: var(--text-on-fill);
}

/* WHO IS TALKING RIGHT NOW. A ring rather than a badge: it reads at 16px,
   costs no layout, and cannot collide with a neighbour in a stack. */
.agent-avatar.is-speaking {
  box-shadow: 0 0 0 1.5px var(--color-primary);
  animation: agent-avatar-pulse 1.6s ease-in-out infinite;
}

@keyframes agent-avatar-pulse {
  0%, 100% { box-shadow: 0 0 0 1.5px rgba(var(--primary-rgb), 1); }
  50% { box-shadow: 0 0 0 1.5px rgba(var(--primary-rgb), 0.3); }
}

@media (prefers-reduced-motion: reduce) {
  .agent-avatar.is-speaking {
    animation: none;
  }
}
</style>
