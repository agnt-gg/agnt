<template>
  <div v-if="checklist.visible && !view" class="journey">
    <div v-if="open" id="journey-popover" class="journey-popover" role="region" aria-label="Getting started">
      <header class="journey-head">
        <div>
          <strong>Zero to hero</strong>
          <span>{{ checklist.done }} of {{ checklist.total }} done</span>
        </div>
        <button type="button" class="journey-x" aria-label="Collapse" @click="open = false">&times;</button>
      </header>
      <div class="journey-bar" aria-hidden="true"><i :style="{ width: percent }"></i></div>
      <ol class="journey-list">
        <li
          v-for="(item, index) in checklist.items"
          :key="item.id"
          :class="{ 'is-done': item.done, 'is-next': checklist.next && item.id === checklist.next.id }"
        >
          <span class="journey-mark" aria-hidden="true">{{ item.done ? '✓' : index + 1 }}</span>
          <div class="journey-copy">
            <strong>{{ item.title }}</strong>
            <small>{{ item.outcome }}</small>
          </div>
          <span v-if="item.done" class="visually-hidden">Done</span>
          <button v-else type="button" class="journey-go" @click="start(item.mission)">
            {{ checklist.next && item.id === checklist.next.id ? 'Start' : 'Go' }}
          </button>
        </li>
      </ol>
      <footer class="journey-foot">
        <button type="button" class="journey-link" @click="hide">Hide this list</button>
        <span>Bring it back in Settings → Tours</span>
      </footer>
    </div>
    <button
      type="button"
      class="journey-popup-pill"
      :aria-expanded="open"
      aria-controls="journey-popover"
      @click="open = !open"
    >
      <svg viewBox="0 0 36 36" class="journey-ring" aria-hidden="true">
        <circle cx="18" cy="18" r="15" class="journey-ring-track" />
        <circle cx="18" cy="18" r="15" class="journey-ring-fill" :style="{ strokeDashoffset: dashOffset }" />
      </svg>
      <span class="journey-popup-pill-label">
        {{ checklist.next ? `Next: ${checklist.next.title}` : 'Getting started' }}
      </span>
      <b>{{ checklist.done }}/{{ checklist.total }}</b>
    </button>
  </div>
</template>

<script setup>
/**
 * The getting-started checklist: a small pill in the corner that says what to
 * do next, and expands to the whole journey. Each row starts that milestone's
 * mission. It steps aside while a coach card is up, and leaves for good once
 * every milestone is done.
 */
import { computed, ref } from 'vue';
import { useJourney } from '@/composables/useJourney.js';

const { checklist, view, startMission, setChecklistHidden } = useJourney();
const open = ref(false);

const CIRCUMFERENCE = 2 * Math.PI * 15;
const share = computed(() => (checklist.value.total ? checklist.value.done / checklist.value.total : 0));
const percent = computed(() => `${Math.round(share.value * 100)}%`);
const dashOffset = computed(() => CIRCUMFERENCE * (1 - share.value));

function start(missionId) {
  open.value = false;
  startMission(missionId);
}

function hide() {
  open.value = false;
  setChecklistHidden(true);
}
</script>

<style scoped>
.journey {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 9990;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  font-size: 14px;
}

.journey-popup-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(320px, calc(100vw - 40px));
  padding: 6px 14px 6px 6px;
  border-radius: 999px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-popup);
  color: var(--text-primary);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.journey-popup-pill:hover,
.journey-popup-pill:focus-visible {
  border-color: var(--color-primary);
}

.journey-popup-pill-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.journey-popup-pill b {
  color: var(--color-primary);
}

.journey-ring {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  transform: rotate(-90deg);
}

.journey-ring circle {
  fill: none;
  stroke-width: 4;
}

.journey-ring-track {
  stroke: var(--color-darker-2);
}

.journey-ring-fill {
  stroke: var(--color-primary);
  stroke-linecap: round;
  stroke-dasharray: 94.25;
  transition: stroke-dashoffset 0.4s ease;
}

.journey-popover {
  width: min(360px, calc(100vw - 40px));
  max-height: min(560px, calc(100vh - 120px));
  overflow-y: auto;
  box-sizing: border-box;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-popup);
  color: var(--text-primary);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
}

.journey-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.journey-head strong {
  display: block;
  font-size: 16px;
}

.journey-head span {
  color: var(--text-secondary);
  font-size: 12px;
}

.journey-x {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 20px;
  cursor: pointer;
}

.journey-bar {
  height: 4px;
  margin: 12px 0;
  border-radius: 4px;
  background: var(--color-darker-2);
  overflow: hidden;
}

.journey-bar i {
  display: block;
  height: 100%;
  background: var(--color-primary);
  transition: width 0.4s ease;
}

.journey-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.journey-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 10px;
}

.journey-list li.is-next {
  background: var(--color-darker-1);
}

.journey-mark {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--terminal-border-color);
  font-size: 12px;
  color: var(--text-secondary);
}

.is-done .journey-mark {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--on-fill-accent);
}

.journey-copy {
  flex: 1;
  min-width: 0;
}

.journey-copy strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
}

.is-done .journey-copy strong {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.journey-copy small {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
}

.journey-go {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.is-next .journey-go {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--on-fill-accent);
}

.journey-foot {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.journey-link {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--text-secondary);
  text-decoration: underline;
  font-size: 12px;
  cursor: pointer;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

@media (max-width: 600px) {
  .journey {
    right: 12px;
    bottom: 12px;
  }
}
</style>
