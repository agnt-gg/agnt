<template>
  <!-- The year in review: a capsule in the top bar during the season (Dec 1 to Jan 31),
       and the cards, which More opens at any time (the year so far). -->
  <div v-if="season.inSeason" class="one-capsule-anchor">
    <button type="button" class="one-capsule is-set one-wrapped-capsule" data-testid="one-wrapped-capsule" :aria-label="`Your ${season.year}, wrapped`" @click="open()">
      <svg class="one-wrapped-capsule-mark" viewBox="0 0 37 36" aria-hidden="true"><circle v-for="([cx, cy], k) in MARK_DOTS" :key="k" :cx="cx" :cy="cy" r="4.5" /></svg>
      <span class="one-wrapped-capsule-label">Your {{ season.year }}, wrapped</span>
      <span v-if="!seen" class="one-wrapped-new">New</span>
    </button>
  </div>
  <Teleport to="body">
    <WrappedStory v-if="openYear" :year="openYear" :status="status" :data="data" :error="error" @close="close" @retry="load" />
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { getYearInReview } from '@/services/wrappedService.js';
import WrappedStory from './WrappedStory.vue';
import { MARK_DOTS, hasStory, loadSeenYears, saveSeenYear, wrappedSeason } from './wrappedModel.js';
import './wrapped.css';

const store = useStore();
const account = computed(() => store.getters['userAuth/userEmail'] || store.state.userAuth?.user?.id || null);
const season = wrappedSeason(new Date());
const seenYears = ref(loadSeenYears(account.value));
watch(account, (who) => {
  seenYears.value = loadSeenYears(who);
});
const seen = computed(() => seenYears.value.includes(season.year));

const openYear = ref(null);
const status = ref('loading');
const data = ref(null);
const error = ref('');
let opener = null;
let request = 0;

async function load() {
  const year = openYear.value;
  if (!year) return;
  const mine = ++request;
  status.value = 'loading';
  error.value = '';
  try {
    const result = await getYearInReview(year);
    if (mine !== request) return; // closed, or opened again, while this was loading
    data.value = result;
    status.value = hasStory(result) ? 'ready' : 'empty';
  } catch (e) {
    if (mine !== request) return;
    console.warn('[AGNT One] year in review unavailable:', e?.message || e);
    error.value = e?.response?.data?.error || e?.message || 'Something went wrong.';
    status.value = 'error';
  }
}

/** Opens the cards for a year: by default the season's (or, out of season, this year so far). */
function open(year = season.year) {
  opener = document.activeElement;
  data.value = null;
  openYear.value = year;
  if (season.inSeason && year === season.year) seenYears.value = saveSeenYear(account.value, year);
  load();
}

function close() {
  request++;
  openYear.value = null;
  const back = opener;
  opener = null;
  nextTick(() => back?.isConnected && back.focus?.({ preventScroll: true }));
}

defineExpose({ open });
</script>
