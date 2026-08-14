<template>
  <section class="settings-card" :class="{ 'is-hero': hero, 'is-collapsed': collapsible && !isOpen }">
    <div
      class="settings-card-head"
      :class="{ 'is-toggle': collapsible }"
      :role="collapsible ? 'button' : null"
      :tabindex="collapsible ? 0 : null"
      :aria-expanded="collapsible ? String(isOpen) : null"
      @click="onHeadClick"
      @keydown.enter.prevent="onHeadClick"
      @keydown.space.prevent="onHeadClick"
    >
      <span class="settings-card-num">{{ num }}</span>
      <h3 class="settings-card-title">
        {{ title }}<span v-if="question" class="settings-card-q">{{ question }}</span>
      </h3>
      <span class="settings-card-spacer"></span>
      <!-- Whatever belongs at the right of the header: a summary value, a
           toggle, a save indicator. One slot, because every card needs exactly
           one of those and offering two invites inconsistent alignment. -->
      <slot name="value" />
      <span v-if="collapsible" class="settings-card-caret" aria-hidden="true">
        <i class="fas fa-chevron-right"></i>
      </span>
    </div>

    <div v-show="!collapsible || isOpen" class="settings-card-body" :class="{ 'is-indented': indented }">
      <slot />
    </div>
  </section>
</template>

<script>
import { ref } from 'vue';

/**
 * SettingsCard — the single card idiom for the Default AI Provider page.
 *
 * WHY THIS EXISTS
 * ───────────────
 * That page had grown nine sibling blocks in one flat scroll, each inventing
 * its own chrome: three different toggle patterns, three different "saved"
 * indicators, two heading levels, two preset-chip rows. Nothing was grouped and
 * nothing was ranked, so every control read as equally important — the model
 * picker people use daily sat at the same visual weight as a tool-loop cap they
 * set once and never touch.
 *
 * One card component fixes the chrome half of that. The ORDER is fixed by the
 * page (Connectors.vue) rendering the cards by how often they are actually
 * used, and the numbering makes that ranking visible rather than implied.
 *
 * The header always carries the card's CURRENT VALUE, so the page is readable
 * without opening or scrolling anything. That is what lets card 04 collapse
 * without hiding information: its three numbers live in the header, so you
 * never open the drawer just to read them.
 */
export default {
  name: 'SettingsCard',
  props: {
    /** Rank, shown in mono. Purely to make the priority order legible. */
    num: { type: String, required: true },
    title: { type: String, required: true },
    /** The sub-question this card answers, e.g. "— which model answers?" */
    question: { type: String, default: '' },
    /** Accent border. Exactly one card per page should set this. */
    hero: { type: Boolean, default: false },
    /** Collapsible cards start closed; their value stays in the header. */
    collapsible: { type: Boolean, default: false },
    /** Indent the body to align with the title rather than the rank number. */
    indented: { type: Boolean, default: true },
    defaultOpen: { type: Boolean, default: false },
  },
  setup(props) {
    const isOpen = ref(props.defaultOpen);
    const onHeadClick = () => {
      if (props.collapsible) isOpen.value = !isOpen.value;
    };
    return { isOpen, onHeadClick };
  },
};
</script>

<style scoped>
.settings-card {
  background: var(--surface-raised);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 100%;
}

/* The one card that is the reason people opened the page. */
.settings-card.is-hero {
  border-color: rgba(var(--green-rgb), 0.28);
}

.settings-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.settings-card.is-collapsed .settings-card-head {
  border-bottom: none;
}

.settings-card-head.is-toggle {
  cursor: pointer;
  user-select: none;
}

.settings-card-head.is-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.settings-card-num {
  font-family: var(--font-family-mono);
  font-size: 0.65em;
  color: var(--color-text-dull);
  width: 16px;
  flex: 0 0 auto;
}

.settings-card-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.3;
}

.settings-card-q {
  margin-left: 8px;
  font-size: 0.78rem;
  font-weight: 300;
  color: var(--color-text-muted);
}

.settings-card-spacer {
  flex: 1;
}

.settings-card-caret {
  color: var(--color-text-muted);
  font-size: 0.75em;
  transition: transform 0.2s ease;
}

.settings-card:not(.is-collapsed) .settings-card-caret {
  transform: rotate(90deg);
}

/*
  TOP PADDING IS NOT OPTIONAL.
  The first draft of this layout ran `padding: 0 18px 18px 45px`, so the first
  control in every card sat flush against the header rule with no separation at
  all. 20px matches the header's own horizontal padding so the body reads as
  the same box rather than a different one.
*/
.settings-card-body {
  padding: 20px;
}

/* 20px padding + 16px number + 12px gap — aligns the body under the title. */
.settings-card-body.is-indented {
  padding-left: 48px;
}

@media (max-width: 760px) {
  .settings-card-body.is-indented {
    padding-left: 20px;
  }
}
</style>
