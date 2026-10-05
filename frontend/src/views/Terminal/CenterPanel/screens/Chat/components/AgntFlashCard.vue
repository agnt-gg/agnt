<template>
  <div class="agnt-flash-card" role="region" aria-label="Keep going with Annie">
    <div class="afc-head">
      <h3>{{ title }}</h3>
      <p class="afc-sub">Your chat and everything Annie built are saved. Pick how she keeps going and your last message is sent again.</p>
      <template v-if="account">
        <div class="afc-meter" aria-hidden="true"><i :style="{ width: `${Math.round(share * 100)}%` }"></i></div>
        <div class="afc-meter-label">
          <span>{{ formatCredits(account.usedCredits) }} / {{ formatCredits(account.includedCredits) }} {{ account.trial ? 'trial credits used' : 'credits used' }}</span>
          <span>{{ account.trial ? 'One-time trial' : resetLabel }}</span>
        </div>
      </template>
    </div>

    <div v-if="state === 'ready'" class="afc-ready"><i class="fas fa-check-circle"></i> You're all set. Sending your message again…</div>

    <div v-else class="afc-lanes" :class="{ 'two-up': isPaid }">
      <section v-if="!isPaid" class="afc-lane recommended">
        <div class="afc-lane-head"><h4>Upgrade AGNT</h4><span class="afc-tag pink">Everything included</span></div>
        <p>AGNT Flash credits every month, plus your hosted agent, search, sandbox, mail and webhooks.</p>
        <div class="afc-plans" role="radiogroup" aria-label="Plan">
          <button
            v-for="plan in plans"
            :key="plan.id"
            type="button"
            role="radio"
            :aria-checked="selectedPlan === plan.id"
            :class="['afc-plan', { selected: selectedPlan === plan.id }]"
            @click="selectedPlan = plan.id"
          >
            <span class="afc-plan-name">{{ plan.name }}</span>
            <span class="afc-plan-credits">{{ flashCredits(plan) }}</span>
            <span class="afc-plan-price">${{ yearly ? plan.yearly : plan.price }}<small>/{{ yearly ? 'yr' : 'mo' }}</small></span>
          </button>
        </div>
        <label class="afc-interval"><input v-model="yearly" type="checkbox" /> Yearly billing <small>(2 months free)</small></label>
        <button type="button" class="afc-btn primary" :disabled="busy" @click="upgrade">{{ busy === 'upgrade' ? 'Opening checkout…' : `Get ${currentPlan.name}` }}</button>
      </section>

      <section class="afc-lane">
        <div class="afc-lane-head"><h4>Top up AGNT Flash</h4><span class="afc-tag blue">Pay as you go</span></div>
        <p>Just credits, no subscription. Spend them whenever you like.</p>
        <div class="afc-topups">
          <button v-for="option in topUps" :key="option.cents" type="button" class="afc-btn topup" :disabled="busy" @click="topUp(option.cents)">
            <b>{{ busy === option.cents ? 'Opening…' : option.label }}</b>
            <small>{{ formatCredits(option.cents * CREDITS_PER_CENT) }} credits</small>
          </button>
        </div>
      </section>

      <section class="afc-lane">
        <div class="afc-lane-head"><h4>Bring your own</h4><span class="afc-tag green">Free</span></div>
        <p>Already pay for an AI? Connect it and Annie runs on it at no AGNT cost.</p>
        <ProviderSetup class="afc-providers" @provider-connected="onProviderConnected" />
      </section>
    </div>

    <div v-if="state === 'waiting'" class="afc-wait">
      <span><i class="fas fa-hourglass-half"></i> Finish checkout in your browser. I'll pick it up here automatically.</span>
      <button type="button" class="afc-link" @click="checkNow">I've paid, continue</button>
    </div>
    <p v-if="error" class="afc-error">{{ error }}</p>
  </div>
</template>

<script>
/**
 * The "keep going" card chat shows when AGNT Flash refuses for lack of credit.
 * Three ways forward: upgrade (one click to Stripe), top up prepaid credit
 * (one click to Stripe) or connect your own provider. When one of them lands,
 * the card emits `resume` and chat resends the message that was refused.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { PLANS } from '@/components/UpgradeModal.vue';
import ProviderSetup from './ProviderSetup.vue';
import { TOP_UP_OPTIONS, fetchFlashAccount, startFlashTopUp, formatCredits, usedShare, hasMoreToSpend } from '@/services/agntFlash.js';

// $0.025 per million credits: one cent buys 400k credits.
const CREDITS_PER_CENT = 400_000;
const POLL_MS = 5000;
// Long enough for checkout plus the gateway's plan re-check; bounded so a
// card left on screen never polls forever.
const POLL_LIMIT = 180;

export default {
  name: 'AgntFlashCard',
  components: { ProviderSetup },
  props: {
    code: { type: String, required: true },
  },
  emits: ['resume'],
  setup(props, { emit }) {
    const store = useStore();
    const account = ref(null);
    const baseline = ref(null);
    const state = ref('choosing'); // choosing | waiting | ready
    const busy = ref(null);
    const error = ref('');
    const selectedPlan = ref('personal');
    const yearly = ref(true);
    let pollTimer = null;
    let polls = 0;
    let unmounted = false;

    const isPaid = computed(() => {
      const plan = store.getters['userAuth/planType'];
      return !!plan && plan !== 'free';
    });
    const currentPlan = computed(() => PLANS.find((p) => p.id === selectedPlan.value) || PLANS[0]);
    const share = computed(() => usedShare(account.value));
    const title = computed(() =>
      props.code === 'trial_credit_exhausted' ? 'Your free AGNT Flash credits are used up' : "You're out of AGNT Flash credits",
    );
    const resetLabel = computed(() =>
      account.value?.resetAt ? `Resets ${new Date(account.value.resetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '',
    );
    const flashCredits = (plan) => plan.includes.find((row) => row.label === 'AGNT Flash')?.value || '';

    async function refresh() {
      try {
        account.value = await fetchFlashAccount();
      } catch {
        // The card still works without the meter; checkout and connect do not need it.
      }
      return account.value;
    }

    function finish() {
      if (state.value === 'ready') return;
      state.value = 'ready';
      clearTimeout(pollTimer);
      emit('resume');
    }

    async function poll() {
      if (unmounted) return;
      const latest = await refresh();
      if (hasMoreToSpend(latest, baseline.value)) return finish();
      if (++polls >= POLL_LIMIT) {
        state.value = 'choosing';
        error.value = "Still waiting on checkout. If you've paid, press \"I've paid, continue\".";
        return;
      }
      pollTimer = setTimeout(poll, POLL_MS);
    }

    async function waitForPayment() {
      // Compare against what was there BEFORE checkout, never against nothing:
      // a leftover trial balance must not read as a payment that landed.
      if (!baseline.value) baseline.value = (await refresh()) || { remainingCredits: 0, balanceMicroUSD: 0 };
      error.value = '';
      state.value = 'waiting';
      polls = 0;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(poll, POLL_MS);
    }

    async function upgrade() {
      busy.value = 'upgrade';
      error.value = '';
      try {
        // No success/cancel URL: the app's own origin is localhost or file://, which
        // Stripe cannot return to. The server lands the browser on agnt.gg instead,
        // and this card notices the new credits by polling.
        await store.dispatch('userAuth/createSubscription', {
          planType: selectedPlan.value,
          interval: yearly.value ? 'yearly' : 'monthly',
        });
        await waitForPayment();
      } catch (e) {
        error.value = e?.response?.data?.error || e?.message || 'Could not open checkout. Please try again.';
      } finally {
        busy.value = null;
      }
    }

    async function topUp(cents) {
      busy.value = cents;
      error.value = '';
      try {
        await startFlashTopUp(cents);
        await waitForPayment();
      } catch (e) {
        error.value = e?.message || 'Could not open checkout. Please try again.';
      } finally {
        busy.value = null;
      }
    }

    async function checkNow() {
      const latest = await refresh();
      if (hasMoreToSpend(latest, baseline.value)) finish();
      else error.value = "Payment hasn't arrived yet. It usually takes a few seconds after checkout completes.";
    }

    // ProviderSetup has already switched chat to the provider it connected.
    const onProviderConnected = () => finish();

    onMounted(async () => {
      baseline.value = await refresh();
    });
    onBeforeUnmount(() => {
      unmounted = true;
      clearTimeout(pollTimer);
    });

    return {
      account, state, busy, error, selectedPlan, yearly, isPaid, currentPlan, share, title, resetLabel,
      plans: PLANS, topUps: TOP_UP_OPTIONS, CREDITS_PER_CENT,
      formatCredits, flashCredits, upgrade, topUp, checkNow, onProviderConnected,
    };
  },
};
</script>

<style scoped>
.agnt-flash-card { margin-top: 12px; border: 1px solid var(--terminal-border-color); border-radius: 12px; padding: 16px; background: var(--color-background); }
.afc-head h3 { margin: 0 0 2px; font-size: 16px; color: var(--color-text); }
.afc-sub { margin: 0; font-size: 12.5px; color: var(--color-text-secondary); }
.afc-meter { height: 6px; border-radius: 4px; background: var(--terminal-border-color); margin: 12px 0 4px; overflow: hidden; }
.afc-meter i { display: block; height: 100%; background: var(--color-pink); border-radius: 4px; }
.afc-meter-label { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--color-text-secondary); }
.afc-lanes { display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 10px; margin-top: 14px; }
.afc-lanes.two-up { grid-template-columns: 1fr 1fr; }
.afc-lane { border: 1px solid var(--terminal-border-color); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.afc-lane.recommended { border-color: var(--color-pink); }
.afc-lane p { margin: 0; font-size: 12px; color: var(--color-text-secondary); }
.afc-lane-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.afc-lane-head h4 { margin: 0; font-size: 13.5px; color: var(--color-text); }
.afc-tag { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; white-space: nowrap; }
.afc-tag.pink { color: var(--color-pink); background: rgba(var(--pink-rgb), 0.12); }
.afc-tag.blue { color: var(--text-blue); background: rgba(var(--blue-rgb), 0.1); }
.afc-tag.green { color: var(--text-green); background: rgba(var(--green-rgb), 0.1); }
.afc-plans { display: flex; flex-direction: column; gap: 5px; }
.afc-plan { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; text-align: left; border: 1px solid var(--terminal-border-color); border-radius: 8px; padding: 6px 9px; background: transparent; color: inherit; cursor: pointer; }
.afc-plan.selected { border-color: var(--color-pink); background: rgba(var(--pink-rgb), 0.06); }
.afc-plan-name { font-weight: 650; font-size: 12.5px; }
.afc-plan-credits { grid-row: 2; font-size: 11px; color: var(--color-text-secondary); }
.afc-plan-price { grid-row: 1 / span 2; grid-column: 2; align-self: center; font-weight: 700; font-size: 14px; }
.afc-plan-price small { font-weight: 400; font-size: 10.5px; color: var(--color-text-secondary); }
.afc-interval { font-size: 11.5px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; }
.afc-btn { border: 0; border-radius: 7px; padding: 9px 12px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.afc-btn:disabled { opacity: 0.6; cursor: default; }
.afc-btn.primary { margin-top: auto; background: var(--color-pink); color: var(--text-on-fill); }
.afc-topups { display: flex; flex-direction: column; gap: 6px; }
.afc-btn.topup { display: flex; justify-content: space-between; align-items: center; background: transparent; border: 1px solid var(--terminal-border-color); color: var(--color-text); }
.afc-btn.topup:hover:not(:disabled) { border-color: var(--color-blue); }
.afc-btn.topup small { font-weight: 400; color: var(--color-text-secondary); }
.afc-providers { max-height: 260px; overflow: auto; }
.afc-wait { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; padding: 8px 10px; border: 1px dashed var(--terminal-border-color); border-radius: 8px; font-size: 12px; color: var(--color-text-secondary); }
.afc-link { background: none; border: 0; color: var(--text-blue); cursor: pointer; font: inherit; font-size: 12px; }
.afc-ready { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--color-green); border-radius: 8px; font-size: 13px; color: var(--color-text); }
.afc-ready i { color: var(--text-green); margin-right: 6px; }
.afc-error { margin: 10px 0 0; font-size: 12.5px; color: var(--color-red); }
@media (max-width: 900px) { .afc-lanes, .afc-lanes.two-up { grid-template-columns: 1fr; } }
</style>
