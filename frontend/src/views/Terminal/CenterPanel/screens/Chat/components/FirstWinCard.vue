<template>
  <!-- Under the reply that finished the account's first task, once: what it
       ran on, then one ask. A step in the run, like ShareCard, not a banner. -->
  <div class="first-win" role="note" data-testid="first-win">
    <div class="first-win-line">
      <span class="first-win-ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg></span>
      <span><b>{{ claim.firstTask ? 'First task, done.' : 'Done.' }}</b>{{ receipt ? ` ${receipt}` : '' }}</span>
    </div>
    <p class="first-win-ask">If that saved you some time, a follow or a star tells us to keep going.</p>
    <GiveBackLinks class="first-win-actions" compact>
      <button type="button" class="first-win-later" data-action="first-win-later" @click="emit('dismiss')">Not now</button>
    </GiveBackLinks>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import GiveBackLinks from '@/views/_components/feature/GiveBackLinks.vue';
import { fetchFlashAccount } from '@/services/agntFlash.js';
import { ICONS } from '@/services/giveBack.js';
import { receiptFor } from '@/services/firstWin.js';

const props = defineProps({
  /** The claim from useFirstWin: { messageId, firstTask, ranOn }. */
  claim: { type: Object, required: true },
});
const emit = defineEmits(['dismiss']);

const flashAccount = ref(null);
const receipt = computed(() => receiptFor(props.claim.ranOn, flashAccount.value));

let live = true;
onMounted(async () => {
  if (props.claim.ranOn?.kind !== 'flash') return;
  try {
    const account = await fetchFlashAccount();
    if (live) flashAccount.value = account;
  } catch (error) {
    // Signed out or offline: the receipt names AGNT Flash without a share.
    console.warn('[FirstWinCard] AGNT Flash account unavailable:', error?.message || error);
  }
});
onBeforeUnmount(() => {
  live = false;
});
</script>

<style scoped>
.first-win {
  width: fit-content;
  max-width: 100%;
  margin: 12px 0 2px;
  padding: 11px 13px 11px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-darker-0);
  font-size: 13.5px;
  color: var(--color-text);
}
.first-win-line {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  line-height: 1.45;
}
.first-win-line b {
  font-weight: 600;
}
.first-win-ok {
  width: 18px;
  height: 18px;
  flex: none;
  margin-top: 1px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--fill-success);
  color: var(--on-fill-success);
}
.first-win-ok svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 3.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.first-win-ask {
  margin: 4px 0 9px 27px;
  line-height: 1.45;
  color: var(--color-text-muted);
}
.first-win-actions {
  margin-left: 27px;
}
.first-win-later {
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 12.5px;
  color: var(--color-text-muted);
  text-decoration: underline;
  text-decoration-color: var(--terminal-border-color);
  text-underline-offset: 3px;
  cursor: pointer;
}
.first-win-later:hover {
  color: var(--color-text);
}
</style>
