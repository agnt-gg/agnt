<template>
  <div v-if="account" class="agnt-flash-meter" :class="{ low: isLow }">
    <div class="afm-row">
      <span class="afm-dot" aria-hidden="true"></span>
      <span class="afm-label">AGNT Flash · {{ account.trial ? 'Free trial' : account.planName || 'Credits' }}</span>
      <span class="afm-bar" aria-hidden="true"><i :style="{ width: `${Math.round(share * 100)}%` }"></i></span>
      <!-- A free trial shows the bar only: a raw credit count means nothing to
           someone who has not bought credits. Paid accounts keep the number. -->
      <span v-if="account.trial" class="afm-left">{{ exhausted ? 'Used up' : '' }}</span>
      <span v-else class="afm-left">{{ formatCredits(account.remainingCredits) }} left<template v-if="account.balanceMicroUSD > 0"> · ${{ (account.balanceMicroUSD / 1e6).toFixed(2) }} prepaid</template></span>
    </div>
    <div v-if="showNudge" class="afm-nudge" role="status">
      <span v-if="account.trial"><b>Your free AGNT Flash credits are almost used up.</b> Upgrade or top up so Annie never stops mid-task.</span>
      <span v-else><b>{{ formatCredits(account.remainingCredits) }} credits left.</b> Top up or upgrade so Annie never stops mid-task.</span>
      <button type="button" class="afm-btn" :disabled="busy" @click="topUp">{{ busy ? 'Opening…' : 'Top up $10' }}</button>
      <button type="button" class="afm-btn" @click="upgradeOpen = true">Upgrade</button>
      <button type="button" class="afm-close" aria-label="Dismiss" @click="dismiss"><i class="fas fa-times"></i></button>
    </div>
    <UpgradeModal :open="upgradeOpen" reason="Upgrading adds monthly AGNT Flash credits." @close="upgradeOpen = false" />
  </div>
</template>

<script>
/**
 * AGNT Flash credits at a glance, above the composer, while AGNT is the chat's
 * provider. At 80% used it offers a top-up or upgrade once per allowance
 * period, so running out is never the first anyone hears of it.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import UpgradeModal from '@/components/UpgradeModal.vue';
import { fetchFlashAccount, startFlashTopUp, formatCredits, usedShare, LOW_CREDIT_SHARE } from '@/services/agntFlash.js';

const DISMISS_KEY = 'agnt-flash-low-dismissed';

export default {
  name: 'AgntFlashMeter',
  components: { UpgradeModal },
  setup() {
    const store = useStore();
    const account = ref(null);
    const busy = ref(false);
    const upgradeOpen = ref(false);
    const dismissedFor = ref(localStorage.getItem(DISMISS_KEY));

    const share = computed(() => usedShare(account.value));
    const isLow = computed(() => share.value >= LOW_CREDIT_SHARE);
    const exhausted = computed(() => !!account.value && account.value.includedCredits > 0 && account.value.remainingCredits <= 0);
    // One nudge per allowance: the trial, or each monthly reset.
    const periodKey = computed(() => (account.value ? `${account.value.source}:${account.value.resetAt ?? 'once'}` : ''));
    const showNudge = computed(() => isLow.value && account.value.remainingCredits > 0 && dismissedFor.value !== periodKey.value);

    async function refresh() {
      try {
        account.value = await fetchFlashAccount();
      } catch {
        account.value = null; // signed out or unreachable: show nothing rather than a wrong number
      }
    }

    function dismiss() {
      dismissedFor.value = periodKey.value;
      localStorage.setItem(DISMISS_KEY, periodKey.value);
    }

    async function topUp() {
      busy.value = true;
      try {
        await startFlashTopUp(1000);
      } catch (e) {
        console.warn('AGNT Flash top-up could not start:', e?.message || e);
      } finally {
        busy.value = false;
      }
    }

    // A finished turn is when the balance moves.
    watch(
      () => store.state.chat.isStreaming,
      (streaming, wasStreaming) => {
        if (wasStreaming && !streaming) refresh();
      },
    );
    onMounted(refresh);

    // An out-of-credits notice in chat means the balance just changed: re-read it,
    // so the meter never sits on a stale number beside "used up".
    watch(
      () => store.state.chat.messages?.length,
      () => refresh(),
    );

    return { account, busy, upgradeOpen, share, isLow, exhausted, showNudge, formatCredits, dismiss, topUp };
  },
};
</script>

<style scoped>
/* The conversation's own column (Chat.vue .conversation-container: 800px,
   centred), so the meter and its low-credit notice never span the panel. In
   Focused the column is --focused-chat-column-width (focused.css). */
.agnt-flash-meter { width: min(800px, 100%); margin: 0 auto 6px; box-sizing: border-box; font-size: 11.5px; color: var(--color-text-secondary); }
:global(.ui-focused) .agnt-flash-meter { width: var(--focused-chat-column-width, min(768px, 100%)); }
/* One centred line under the conversation, not a left-aligned label. */
.afm-row { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 4px; }
.afm-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-green); flex: none; }
.low .afm-dot { background: var(--color-yellow); }
.afm-bar { width: 60px; height: 4px; border-radius: 3px; background: var(--terminal-border-color); overflow: hidden; flex: none; }
.afm-bar i { display: block; height: 100%; background: var(--color-green); }
.low .afm-bar i { background: var(--color-yellow); }
.afm-left { white-space: nowrap; }
.afm-nudge { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 8px 10px; border: 1px solid rgba(255, 215, 0, 0.3); background: rgba(var(--yellow-rgb), 0.05); border-radius: 8px; color: var(--color-text); }
.afm-nudge span { flex: 1; min-width: 0; }
.afm-btn { border: 1px solid var(--terminal-border-color); background: transparent; color: var(--color-text); border-radius: 6px; padding: 4px 10px; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.afm-btn:disabled { opacity: 0.6; cursor: default; }
.afm-close { background: none; border: 0; color: var(--color-text-secondary); cursor: pointer; }
</style>
