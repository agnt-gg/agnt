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
          <span class="focused-starter-tag">
            <!-- eslint-disable-next-line vue/no-v-html -- static icons from focusedStarters.js, never user data -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="card.icon"></svg>
            {{ card.laneLabel }}
          </span>
          <span class="focused-starter-label">{{ card.label }}</span>
        </span>
      </button>
    </div>
    <button type="button" class="focused-starters-more" :class="{ turned }" @click="moreIdeas">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
      </svg>
      More ideas
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { createStarterRotation, starterAt, STARTER_INTERVAL_MS, STARTER_SLOTS } from './focusedStarters.js';

defineEmits(['pick']);

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
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.focused-starter {
  display: flex;
  min-width: 0;
  padding: 10px 14px;
  text-align: left;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
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
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
  width: 100%;
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
.focused-starter-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-secondary);
}
.focused-starter-tag svg {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--text-green);
}
.focused-starter-label {
  display: block;
  max-width: 100%;
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.focused-starters-more {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px auto 0;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.focused-starters-more:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.focused-starters-more svg {
  width: 12px;
  height: 12px;
  transition: transform 0.4s;
}
.focused-starters-more.turned svg {
  transform: rotate(180deg);
}
/* Phones: one column, like the demo. */
@media (max-width: 720px) {
  .focused-starters-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .focused-starter-body.swap {
    animation: none;
  }
}
</style>
