<template>
  <div
    ref="rootEl"
    class="simple-starters"
    aria-label="Things you can do"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <div class="simple-starters-grid">
      <button
        v-for="(card, slot) in cards"
        :key="slot"
        type="button"
        class="simple-starter"
        v-tooltip="card.prompt"
        @click="$emit('pick', card.prompt)"
      >
        <!-- :key on the content, not the button: a swap re-mounts only the
             text, so the enter animation plays and focus stays put. -->
        <span :key="card.index + ':' + swapGen[slot]" class="simple-starter-body" :class="{ swap: animated }" :style="{ animationDelay: delays[slot] }">
          <span class="simple-starter-tag">
            <!-- eslint-disable-next-line vue/no-v-html -- static icons from simpleStarters.js, never user data -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="card.icon"></svg>
            {{ card.laneLabel }}
          </span>
          <span class="simple-starter-label">{{ card.label }}</span>
        </span>
      </button>
    </div>
    <button type="button" class="simple-starters-more" :class="{ turned }" @click="moreIdeas">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
      </svg>
      More ideas
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { createStarterRotation, starterAt, STARTER_INTERVAL_MS, STARTER_SLOTS } from './simpleStarters.js';

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
.simple-starters {
  width: 100%;
  margin-top: 10px;
}
.simple-starters-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.simple-starter {
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
.simple-starter:hover {
  background: var(--surface-raised);
  border-color: var(--fill-brand);
  box-shadow: 0 0 0 3px rgba(var(--pink-rgb), 0.12);
}
.simple-starter:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.simple-starter-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
  width: 100%;
}
.simple-starter-body.swap {
  animation: simple-starter-in 0.38s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes simple-starter-in {
  from {
    opacity: 0;
    transform: translateY(7px);
  }
}
.simple-starter-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-secondary);
}
.simple-starter-tag svg {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--fill-brand);
}
.simple-starter-label {
  display: block;
  max-width: 100%;
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.simple-starters-more {
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
.simple-starters-more:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.simple-starters-more svg {
  width: 12px;
  height: 12px;
  transition: transform 0.4s;
}
.simple-starters-more.turned svg {
  transform: rotate(180deg);
}
/* Phones: one column, like the demo. */
@media (max-width: 720px) {
  .simple-starters-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .simple-starter-body.swap {
    animation: none;
  }
}
</style>
