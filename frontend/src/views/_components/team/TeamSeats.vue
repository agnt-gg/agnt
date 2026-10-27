<template>
  <!-- Seats for the team instance this person owns: the same control as
       agnt.gg/account, so adding a teammate never means leaving the app. -->
  <div v-if="instance" class="team-seats" aria-label="Team seats">
    <div class="seat-summary">
      <strong>{{ used }} of {{ total }} seats in use</strong>
      <span>{{ SEATS_INCLUDED }} included with Business Cloud · extra seats ${{ SEAT_PRICE }}/mo each</span>
    </div>
    <div class="seat-stepper">
      <button type="button" aria-label="Fewer seats" :disabled="busy || target <= floor" @click="target--">&minus;</button>
      <b aria-live="polite">{{ target }}</b>
      <button type="button" aria-label="More seats" :disabled="busy || target >= SEATS_MAX" @click="target++">+</button>
      <button type="button" class="primary" :disabled="busy || target === total" @click="save">{{ actionLabel }}</button>
    </div>
    <p v-if="message" class="seat-note" role="status">{{ message }}</p>
    <p v-if="error" class="seat-note error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup>
import { computed, onMounted, ref } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { tenantRequest } from '@/utils/teamClient.js';
// Mirrors agnt.gg/account (agnt-instance.js) and the server's clamp (resolveSeats).
import { SEATS_INCLUDED, SEATS_MAX, SEAT_PRICE, seatActionLabel } from './teamSeats.js';

const props = defineProps({ slug: { type: String, default: '' } });
const emit = defineEmits(['changed']);
const instance = ref(null), target = ref(0), busy = ref(false), message = ref(''), error = ref('');
const used = computed(() => instance.value?.seats?.used ?? 0);
const total = computed(() => instance.value?.seats?.total ?? SEATS_INCLUDED);
// Never offer a number the server refuses: not below the people already in.
const floor = computed(() => Math.max(SEATS_INCLUDED, used.value));
const actionLabel = computed(() => seatActionLabel(target.value - total.value));

/** The Business instance to size: the one named, or the one this person owns. */
async function load() {
  const { tenants = [] } = await tenantRequest('');
  const owned = tenants.filter((t) => t.isOwner && t.plan === 'business' && !['destroyed', 'purged'].includes(t.status));
  const chosen = owned.find((t) => t.slug === props.slug) || (props.slug ? null : owned[0]);
  instance.value = chosen ? await tenantRequest('/' + chosen.slug) : null;
  target.value = total.value;
}

async function remote(path, seats) {
  const response = await fetch(API_CONFIG.REMOTE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
    body: JSON.stringify({ seats }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Could not change seats'), { reason: data.reason });
  return data;
}

async function save() {
  busy.value = true; message.value = ''; error.value = '';
  try {
    let result;
    try {
      result = await remote('/users/subscription/seats', target.value);
    } catch (failure) {
      // An operator's instance has no Stripe subscription; it is sized directly.
      if (failure.reason !== 'no_subscription') throw failure;
      result = await remote('/tenants/' + encodeURIComponent(instance.value.slug) + '/seats', target.value);
    }
    message.value = result?.message || 'Seats updated.';
    await load();
    emit('changed');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

onMounted(() => load().catch((failure) => { console.warn('[TeamSeats] load:', failure.message); }));
defineExpose({ reload: load });
</script>
<style scoped>
.team-seats { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
.seat-summary { display: flex; flex-direction: column; gap: 2px; }
.seat-summary span, .seat-note { color: var(--color-text-muted); font-size: 0.85em; }
.seat-note.error { color: var(--color-red); }
.seat-stepper { display: flex; align-items: center; gap: 8px; }
.seat-stepper b { min-width: 2.5em; text-align: center; }
</style>
