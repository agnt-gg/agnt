<template>
  <div
    ref="rootEl"
    class="focused-starters"
    aria-label="Things you can do"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <!-- What the composer does, said once, under it. -->
    <p class="focused-hint" data-testid="composer-hint"><span><b>Enter</b> to send</span><span><b>Shift + Enter</b> for a new line</span><span>Drop files anywhere to attach</span></p>
    <div class="focused-starters-grid">
      <button
        v-for="(card, slot) in cards"
        :key="slot"
        type="button"
        class="focused-starter"
        v-tooltip="card.prompt"
        @click="$emit('pick', card.prompt)"
      >
        <!-- :key on the content, not the button: a swap re-mounts only the
             text, so the enter animation plays and focus stays put. -->
        <span :key="card.index + ':' + swapGen[slot]" class="focused-starter-body" :class="{ swap: animated }" :style="{ animationDelay: delays[slot] }">
          <!-- eslint-disable-next-line vue/no-v-html -- static icons from focusedStarters.js, never user data -->
          <svg class="focused-starter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="card.icon"></svg>
          <span class="focused-starter-label">{{ card.label }}</span>
        </span>
      </button>
      <button type="button" class="focused-starters-more" :class="{ turned }" aria-label="More ideas" v-tooltip="'More ideas'" @click="moreIdeas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
        </svg>
      </button>
    </div>

    <!-- Pick up where you left off, and what Annie can reach: Home and Apps, one click away. -->
    <div v-if="needsYou || workingApps.length" class="focused-catchup" data-testid="focused-catchup">
      <button v-if="needsYou" type="button" class="focused-catchup-row" data-action="catch-up" @click="nav?.go({ page: 'team', view: 'home' })">
        <span class="focused-catchup-icon is-needs" aria-hidden="true"><i class="fas fa-bell"></i></span>
        <span class="focused-catchup-text">{{ needsYou }} {{ needsYou === 1 ? 'thing needs' : 'things need' }} you</span>
        <span class="focused-catchup-go">Catch up<i class="fas fa-chevron-right" aria-hidden="true"></i></span>
      </button>
      <button v-if="workingApps.length" type="button" class="focused-catchup-row" data-action="apps" @click="nav?.go({ page: 'connectors' })">
        <span class="focused-catchup-icon" aria-hidden="true"><i class="fas fa-plug"></i></span>
        <span class="focused-catchup-text">Annie can use {{ appsLine }}</span>
        <span class="focused-catchup-go">Apps<i class="fas fa-chevron-right" aria-hidden="true"></i></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue';
import { createStarterRotation, starterAt, STARTER_INTERVAL_MS, STARTER_SLOTS } from './focusedStarters.js';
import { useAppCards } from '@/composables/useAppCards.js';
import { cardNeedsYou } from '@/services/pluginDirectory.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import { appsSentence } from './focusedCatchUp.js';

defineEmits(['pick']);

// Outside AGNT One (no frame to provide these) the rows simply do not show.
const nav = inject('focusedNav', null);
const needsYouRef = inject('oneNeedsYou', null);
const needsYou = computed(() => (nav ? Number(needsYouRef?.value) || 0 : 0));
// Your working apps, by name. AI models are not apps (they are chosen in Settings).
const MODEL_IDS = new Set(AI_PROVIDERS_WITH_API.map((id) => String(id).toLowerCase()));
// The app cards are read only inside the frame that shows the row.
const appCards = nav ? useAppCards().cards : ref({ yours: [] });
const workingApps = computed(() => (nav ? (appCards.value?.yours || []) : [])
  .filter((card) => card && card.name && !cardNeedsYou(card) && !MODEL_IDS.has(String(card.providerId || '').toLowerCase()))
  .map((card) => card.name));
const appsLine = computed(() => appsSentence(workingApps.value));

const rotation = createStarterRotation();
const cards = ref(rotation.fill().map(starterAt));
const swapGen = ref(Array(STARTER_SLOTS).fill(0));
const delays = ref(Array(STARTER_SLOTS).fill('0ms'));
const animated = ref(false); // no entrance animation on first paint
const turned = ref(false);
const hovered = ref(false);
const focused = ref(false);
const rootEl = ref(null);
let timer = null;

function onFocusOut(e) {
  if (!rootEl.value?.contains(e.relatedTarget)) focused.value = false;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// Never change a card under the pointer, under focus, or where nobody can see it.
const paused = () => hovered.value || focused.value || document.hidden || reducedMotion();

function bump(slot) {
  const next = swapGen.value.slice();
  next[slot] += 1;
  swapGen.value = next;
}

function tick() {
  if (paused()) return;
  const { slot, index } = rotation.swapOne();
  animated.value = true;
  delays.value = Array(STARTER_SLOTS).fill('0ms');
  const next = cards.value.slice();
  next[slot] = starterAt(index);
  cards.value = next;
  bump(slot);
}

function startLoop() {
  clearInterval(timer);
  timer = setInterval(tick, STARTER_INTERVAL_MS);
}

function moreIdeas() {
  turned.value = !turned.value;
  animated.value = true;
  cards.value = rotation.fill().map(starterAt);
  delays.value = cards.value.map((_, slot) => `${slot * 60}ms`);
  swapGen.value = swapGen.value.map((g) => g + 1);
  startLoop(); // a manual shuffle restarts the clock
}

onMounted(startLoop);
onBeforeUnmount(() => clearInterval(timer));

defineExpose({ tick, moreIdeas });
</script>

<style scoped>
.focused-starters {
  width: 100%;
  margin-top: 10px;
}
.focused-starters-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 10px;
}
.focused-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 16px;
  margin: 2px 0 18px;
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.focused-hint b {
  font-weight: 600;
  color: var(--text-secondary);
}
.focused-starter {
  display: flex;
  flex: 0 1 auto;
  max-width: 280px;
  /* Stated, never inherited: Electron 33's Chromium (the engine the app ships)
     gives every <button> a built-in align-items: flex-start, newer Chromium
     does not. Left unset, the content sat at the top in the app and centred
     in a browser. flexAlignment.spec.js holds this. */
  align-items: stretch;
  min-width: 0;
  height: 40px;
  padding: 0 16px;
  text-align: left;
  border: 1px solid var(--terminal-border-color);
  border-radius: 999px;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.focused-starter:hover {
  background: var(--surface-hover);
  border-color: rgba(var(--green-rgb), 0.3);
  box-shadow: 0 0 0 3px rgba(var(--green-rgb), 0.1);
}
.focused-starter:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.focused-starter-body {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}
.focused-starter-icon {
  width: 15px;
  height: 15px;
  flex: none;
  color: var(--text-green);
}
.focused-starter-body.swap {
  animation: focused-starter-in 0.38s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes focused-starter-in {
  from {
    opacity: 0;
    transform: translateY(7px);
  }
}
.focused-starter-label {
  display: block;
  max-width: 100%;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.focused-starters-more {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--terminal-border-color);
  border-radius: 50%;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}
.focused-starters-more:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.focused-starters-more svg {
  width: 15px;
  height: 15px;
  transition: transform 0.4s;
}
.focused-catchup {
  margin-top: 28px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  overflow: hidden;
}
.focused-catchup-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 14.5px;
  text-align: left;
  cursor: pointer;
}
.focused-catchup-row + .focused-catchup-row {
  border-top: 1px solid var(--terminal-border-color);
}
.focused-catchup-row:hover {
  background: var(--surface-hover);
}
.focused-catchup-icon {
  width: 30px;
  height: 30px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: 13px;
}
.focused-catchup-icon.is-needs {
  background: rgba(var(--pink-rgb), 0.14);
  color: var(--color-pink);
}
.focused-catchup-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focused-catchup-go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-secondary);
}
.focused-catchup-go i {
  font-size: 11px;
}
.focused-starters-more.turned svg {
  transform: rotate(180deg);
}
/* Phones: one suggestion per row, like the demo. */
@media (max-width: 720px) {
  .focused-starter {
    flex-basis: 100%;
    max-width: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .focused-starter-body.swap {
    animation: none;
  }
}
</style>
