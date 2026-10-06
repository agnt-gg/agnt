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

        <PlanPicker :current-plan="currentPlan" :suggest="suggest" :reason="reason" :busy="busy" :error="error" @choose="go" />
      </div>
    </div>
  </Teleport>
</template>

<script>
/**
 * The one upgrade surface. Every Pro gate opens this; it calls the same
 * subscription actions the Billing page does, so there is exactly one path to
 * Stripe. The plans themselves are PlanPicker (also Billing's "Compare plans").
 */
import { mapActions, mapState } from 'vuex';
import PlanPicker from './PlanPicker.vue';
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
    return { busy: false, error: '' };
  },
  computed: {
    ...mapState('userAuth', ['planType']),
    currentPlan() {
      return this.planType && this.planType !== 'free' ? this.planType : null;
    },
    headline() {
      return this.currentPlan ? 'Change your plan' : 'Go Pro';
    },
  },
  watch: {
    open(v) {
      if (v) this.error = '';
    },
  },
  methods: {
    ...mapActions('userAuth', ['createSubscription', 'updateSubscription']),
    close() {
      if (!this.busy) this.$emit('close');
    },
    async go({ planType, interval }) {
      this.busy = true;
      this.error = '';
      try {
        if (!this.currentPlan) {
          await this.createSubscription({
            planType,
            interval,
            successUrl: `${window.location.origin}/settings?subscription=success`,
            cancelUrl: `${window.location.origin}/settings?subscription=cancelled`,
          });
        } else {
          await this.updateSubscription({ newPlanType: planType, interval });
        }
        this.$emit('close');
      } catch (e) {
        this.error = e?.response?.data?.error || e?.message || 'Could not start checkout. Please try again.';
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
</style>
