<template>
  <div class="tour-settings">
    <div class="setting-group">
      <h3>Guidance</h3>
      <p class="description">How AGNT helps you get going.</p>

      <div class="setting-row">
        <div class="setting-info">
          <label class="setting-label" for="tours-enabled">Getting-started help</label>
          <p class="setting-description">The checklist in the corner and the short missions that walk you through doing things.</p>
        </div>
        <label class="toggle-switch">
          <input id="tours-enabled" v-model="enabled" type="checkbox" @change="save" />
          <span class="slider"></span>
        </label>
      </div>

      <div v-if="enabled" class="setting-row">
        <div class="setting-info">
          <label class="setting-label" for="tours-offers">Offer a mission on first visit</label>
          <p class="setting-description">The first time you open a page, suggest the one thing worth doing there.</p>
        </div>
        <label class="toggle-switch">
          <input id="tours-offers" v-model="offers" type="checkbox" @change="save" />
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="setting-group">
      <div class="group-head">
        <h3>Zero to hero</h3>
        <span class="count">{{ checklist.done }} of {{ checklist.total }} done</span>
      </div>
      <p class="description">
        Done items are worked out from what is in your account, so anything Annie built for you from chat counts too.
        <button v-if="progress.checklistHidden" type="button" class="inline-link" @click="showChecklist">Show the checklist again</button>
      </p>
      <ol class="mission-list">
        <li v-for="item in checklist.items" :key="item.id" class="mission-item">
          <span class="mark" :class="{ done: item.done }" aria-hidden="true">{{ item.done ? '✓' : '' }}</span>
          <div class="mission-info">
            <span class="mission-name">{{ item.title }}</span>
            <p class="mission-description">{{ item.outcome }}</p>
          </div>
          <button type="button" :class="item.done ? 'btn-reset' : 'btn-start'" @click="start(item.mission)">
            {{ item.done ? 'Replay' : 'Start' }}
          </button>
        </li>
      </ol>
    </div>

    <div class="setting-group">
      <h3>On every page</h3>
      <p class="description">One useful thing to do on each of these pages.</p>
      <ol class="mission-list">
        <li v-for="mission in pageMissions" :key="mission.id" class="mission-item">
          <span class="mark" :class="{ done: progress.done[mission.id] }" aria-hidden="true">{{ progress.done[mission.id] ? '✓' : '' }}</span>
          <div class="mission-info">
            <span class="mission-name">{{ mission.title }}</span>
            <p class="mission-description">{{ mission.pitch }}</p>
          </div>
          <button type="button" :class="progress.done[mission.id] ? 'btn-reset' : 'btn-start'" @click="start(mission.id)">
            {{ progress.done[mission.id] ? 'Replay' : 'Start' }}
          </button>
        </li>
      </ol>
    </div>

    <div class="setting-group">
      <h3>Start over</h3>
      <div class="bulk-actions">
        <button type="button" class="btn-reset-all" @click="resetAll">Reset getting-started progress</button>
        <button type="button" class="btn-reset-all" @click="replayOnboarding">Replay first-time setup</button>
      </div>
    </div>

    <SimpleModal ref="modal" />
  </div>
</template>

<script setup>
/**
 * Settings → Tours. Controls the journey (composables/useJourney.js): the two
 * switches the app has always stored in localStorage, the checklist, every
 * page's mission, and a reset.
 *
 * Starting or replaying a mission switches guidance on first: a mission the
 * person explicitly asked for must not be swallowed by the switch they turned
 * off earlier. That is the only switch it touches; the old Start button also
 * flipped auto-start back on for every page without asking.
 */
import { computed, ref } from 'vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { MISSIONS } from '@/services/journey/missions.js';
import { TOURS_AUTO_START_KEY, TOURS_ENABLED_KEY } from '@/services/journey/journeyProgress.js';
import { useJourney } from '@/composables/useJourney.js';

const journey = useJourney();
const { checklist, progress } = journey;
const modal = ref(null);

const enabled = ref(localStorage.getItem(TOURS_ENABLED_KEY) !== 'false');
const offers = ref(localStorage.getItem(TOURS_AUTO_START_KEY) !== 'false');

const pageMissions = computed(() =>
  Object.entries(MISSIONS)
    .filter(([, mission]) => !mission.milestone)
    .map(([id, mission]) => ({ id, ...mission })),
);

function save() {
  localStorage.setItem(TOURS_ENABLED_KEY, String(enabled.value));
  localStorage.setItem(TOURS_AUTO_START_KEY, String(offers.value));
  journey.refreshSettings();
}

function start(missionId) {
  if (!enabled.value) {
    enabled.value = true;
    save();
  }
  journey.startMission(missionId);
}

function showChecklist() {
  journey.setChecklistHidden(false);
}

async function resetAll() {
  const confirmed = await modal.value.showModal({
    title: 'Reset getting-started progress',
    message: 'Missions you finished or turned down will be offered again. Nothing in your account changes.',
    confirmText: 'Reset',
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: 'btn-danger',
  });
  if (confirmed) journey.resetProgress();
}

function replayOnboarding() {
  localStorage.removeItem('hasCompletedOnboarding');
  window.location.reload();
}
</script>

<style scoped>
.tour-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setting-group h3 {
  color: var(--color-primary);
  font-size: 1.2em;
  font-weight: 500;
  margin: 0;
}

.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.count {
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.description {
  color: var(--color-text-muted);
  font-size: 0.95em;
  margin: 0;
}

.inline-link {
  border: none;
  background: transparent;
  padding: 0;
  margin-left: 6px;
  color: var(--color-primary);
  text-decoration: underline;
  cursor: pointer;
  font-size: 1em;
}

.setting-row,
.mission-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
}

.setting-info,
.mission-info {
  flex: 1;
  min-width: 0;
}

.setting-label,
.mission-name {
  display: block;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 500;
  margin-bottom: 2px;
}

.setting-description,
.mission-description {
  color: var(--color-text-muted);
  font-size: 0.9em;
  margin: 0;
}

.mission-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mark {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--terminal-border-color);
  font-size: 12px;
}

.mark.done {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--on-fill-accent);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: rgba(127, 129, 147, 0.3);
  transition: 0.3s;
  border-radius: 28px;
  border: 1px solid var(--terminal-border-color);
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: var(--color-text-muted);
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

input:checked + .slider:before {
  transform: translateX(24px);
  background-color: var(--color-white);
}

input:focus-visible + .slider {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.btn-reset,
.btn-start {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  font-size: 0.9em;
  cursor: pointer;
}

button.btn-reset {
  background: var(--color-darker-1);
  color: var(--color-text) !important;
}

button.btn-start {
  background: var(--color-primary);
  color: var(--on-fill-accent) !important;
}

.bulk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button.btn-reset-all {
  padding: 10px 20px;
  background: var(--color-darker-1);
  color: var(--color-text) !important;
  border: none;
  border-radius: 8px;
  font-size: 0.95em;
  cursor: pointer;
}

.btn-reset-all:hover {
  background: var(--color-darker-2);
}
</style>
