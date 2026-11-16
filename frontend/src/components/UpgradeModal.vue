<template>
  <Teleport to="body">
    <div v-if="open" class="upgrade-backdrop" @click.self="close" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
      <div class="upgrade-modal">
        <button class="upgrade-close" aria-label="Close" @click="close"><i class="fas fa-times"></i></button>

        <div class="upgrade-head">
          <div class="eyebrow">AGNT Pro</div>
          <h2 id="upgrade-title">{{ headline }}</h2>
          <p class="lead">Six services. One subscription. Nothing else to buy.</p>
        </div>

        <PlanPicker
          v-show="!quote"
          :current-plan="currentPlan"
          :current-interval="currentInterval"
          :suggest="suggest"
          :reason="reason"
          :busy="busy"
          :error="quote ? '' : error"
          @choose="go"
        />
        <div v-if="quote" class="upgrade-confirm">
          <p class="confirm-text">{{ quoteText }}</p>
          <p v-if="error" class="confirm-error">{{ error }}</p>
          <div class="confirm-actions">
            <button type="button" class="btn-back" :disabled="busy" @click="back">Back</button>
            <button type="button" class="btn-confirm" :disabled="busy" @click="confirm">{{ busy ? 'Working…' : confirmText }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
/**
 * The one upgrade surface. Every Pro gate opens this; it calls the same
 * subscription actions the Billing page does, so there is exactly one path to
 * Stripe. The plans themselves are PlanPicker (also Billing's "Compare plans").
 *
 * A subscriber's change is priced by the server first and confirmed with the
 * amount on the button; only then is it made, with the same request.
 */
import { mapActions, mapState } from 'vuex';
import PlanPicker from './PlanPicker.vue';
import { PLANS } from './plans.js';
import { confirmLabel, describeQuote, planChangeRequest } from './planChange.js';

const failure = (error, fallback) => error?.response?.data?.error || error?.message || fallback;

// Kept as a re-export: the plan table's home is plans.js.
export { PLANS } from './plans.js';

export default {
  name: 'UpgradeModal',
  components: { PlanPicker },
  props: {
    open: { type: Boolean, default: false },
    /** Why the gate opened, e.g. "Web search is included with AGNT Pro." */
    reason: { type: String, default: '' },
    /** Which tab to land on. */
    suggest: { type: String, default: 'personal' },
  },
  emits: ['close'],
  data() {
    return { busy: false, error: '', quote: null, request: null };
  },
  computed: {
    ...mapState('userAuth', ['planType', 'subscription']),
    currentPlan() {
      return this.planType && this.planType !== 'free' ? this.planType : null;
    },
    /** How the plan is billed ('monthly' | 'yearly'), or null when unknown. */
    currentInterval() {
      return this.subscription?.interval || null;
    },
    headline() {
      return this.currentPlan ? 'Change your plan' : 'Go Pro';
    },
    quoteText() {
      if (!this.quote) return '';
      const planName = PLANS.find((p) => p.id === this.request.newPlanType)?.name;
      return describeQuote(this.quote, { switching: !!this.request.interval, planName });
    },
    confirmText() {
      return this.quote ? confirmLabel(this.quote) : '';
    },
  },
  watch: {
    open(v) {
      if (v) this.back();
    },
  },
  methods: {
    ...mapActions('userAuth', ['createSubscription', 'updateSubscription', 'previewSubscriptionChange', 'fetchSubscription']),
    close() {
      if (!this.busy) this.$emit('close');
    },
    back() {
      this.quote = null;
      this.request = null;
      this.error = '';
    },
    async go(choice) {
      this.busy = true;
      this.error = '';
      try {
        if (!this.currentPlan) {
          await this.createSubscription({
            planType: choice.planType,
            interval: choice.interval,
            successUrl: `${window.location.origin}/settings?subscription=success`,
            cancelUrl: `${window.location.origin}/settings?subscription=cancelled`,
          });
          this.$emit('close');
          return;
        }
        const request = planChangeRequest(choice, { currentPlan: this.currentPlan, currentInterval: this.currentInterval });
        const quote = await this.previewSubscriptionChange(request);
        this.request = request;
        this.quote = quote;
      } catch (e) {
        if (e?.response?.data?.reason === 'already_subscribed') {
          // Subscribed somewhere this app has not caught up with: show the real plan.
          await this.fetchSubscription({ forceRefresh: true });
          this.error = 'You already have a plan, so nothing was charged. Choose the change you want.';
        } else {
          this.error = failure(e, this.currentPlan ? 'Could not price that change. Please try again.' : 'Could not start checkout. Please try again.');
        }
      } finally {
        this.busy = false;
      }
    },
    async confirm() {
      this.busy = true;
      this.error = '';
      try {
        await this.updateSubscription(this.request);
        await this.fetchSubscription({ forceRefresh: true });
        this.$emit('close');
      } catch (e) {
        this.error = failure(e, 'Could not change your plan. Please try again.');
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style scoped>
.upgrade-backdrop { position: fixed; inset: 0; background: var(--scrim); display: flex; align-items: center; justify-content: center; z-index: 10000; }
.upgrade-modal { position: relative; width: min(680px, calc(100% - 32px)); background: var(--color-background); color: var(--color-text); border: 1px solid var(--terminal-border-color); border-radius: 12px; padding: 28px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5); }
.upgrade-close { position: absolute; top: 14px; right: 14px; background: none; border: 0; color: var(--color-text-secondary); cursor: pointer; font-size: 16px; }
.eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; color: var(--color-pink); }
.upgrade-head h2 { margin: 8px 0 4px; font-size: 26px; letter-spacing: -0.03em; }
.lead { margin: 0 0 18px; color: var(--color-text-secondary); }
.confirm-text { margin: 0; padding: 14px 16px; border: 1px solid var(--terminal-border-color); border-radius: 8px; font-size: 14px; line-height: 1.5; }
.confirm-error { margin: 10px 0 0; color: var(--color-red); font-size: 13px; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn-back { padding: 12px 18px; border-radius: 6px; border: 1px solid var(--terminal-border-color); background: transparent; color: inherit; cursor: pointer; font: inherit; }
.btn-confirm { padding: 12px 20px; border-radius: 6px; border: 0; background: var(--color-pink); color: var(--text-on-fill); cursor: pointer; font: inherit; font-weight: 700; }
.btn-back:disabled,
.btn-confirm:disabled { opacity: 0.6; cursor: default; }
</style>
