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

        <div class="upgrade-tabs" role="tablist">
          <button v-for="p in plans" :key="p.id" role="tab" :aria-selected="selected === p.id" :class="['tab', { active: selected === p.id, current: p.id === currentPlan }]" @click="selected = p.id">
            <span class="tab-name">{{ p.name }}</span>
            <span class="tab-price">${{ p.price }}<small>/mo</small></span>
            <span v-if="p.id === currentPlan" class="tab-current">Current</span>
          </button>
        </div>

        <div class="upgrade-body" role="tabpanel">
          <p class="tagline">{{ plan.tagline }}</p>
          <ul class="includes">
            <li v-for="row in plan.includes" :key="row.label"><span>{{ row.label }}</span><b>{{ row.value }}</b></li>
          </ul>
          <p class="meta">{{ plan.meta }}</p>
          <p v-if="reason" class="reason"><i class="fas fa-lock"></i> {{ reason }}</p>
        </div>

        <div class="upgrade-foot">
          <label class="interval"><input type="checkbox" v-model="yearly" /> Annual billing <small>(${{ plan.yearly }}/yr)</small></label>
          <button class="btn-primary" :disabled="busy || selected === currentPlan" @click="go">
            {{ busy ? 'Opening checkout…' : selected === currentPlan ? 'Your current plan' : cta }}
          </button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script>
/**
 * The one upgrade surface. Every Pro gate opens this; it calls the same
 * subscription actions the Billing page does, so there is exactly one path to
 * Stripe. Prices and allowances mirror the live plan tables — change them
 * there first.
 */
import { mapActions, mapState } from 'vuex';

// Exported so the chat's out-of-credits card sells from the same table.
export const PLANS = [
  {
    id: 'personal',
    name: 'AGNT Pro',
    price: 29,
    yearly: 290,
    tagline: 'Your agent, hosted. Everything included.',
    includes: [
      { label: 'Hosted instance', value: 'Sleeps when idle · up to 8 active hrs/day' },
      { label: 'AGNT Flash', value: '100M credits / mo' },
      { label: 'Search', value: '150 searches + 750 pages / mo' },
      { label: 'Sandbox', value: '100 compute-minutes / mo' },
      { label: 'Mail', value: '1,000 units · 1 inbox' },
      { label: 'Webhooks', value: '1,000 units · 3 endpoints' },
    ],
    meta: '1 seat.',
  },
  {
    id: 'always_on',
    name: 'Pro + Always-On',
    price: 49,
    yearly: 490,
    tagline: 'Pro, awake around the clock.',
    includes: [
      { label: 'Hosted instance', value: 'Never sleeps' },
      { label: 'AGNT Flash', value: '300M credits / mo' },
      { label: 'Search', value: '500 searches + 2,500 pages / mo' },
      { label: 'Sandbox', value: '300 compute-minutes / mo' },
      { label: 'Mail', value: '5,000 units · 5 inboxes' },
      { label: 'Webhooks', value: '5,000 units · 3 endpoints' },
    ],
    meta: '1 seat. $29 Pro + $20 Always-On.',
  },
  {
    id: 'business',
    name: 'AGNT Team',
    price: 99,
    yearly: 990,
    tagline: 'Always-On for three people, one shared instance.',
    includes: [
      { label: 'Hosted instance', value: 'Never sleeps · shared vault · audit receipts' },
      { label: 'AGNT Flash', value: '600M credits / mo' },
      { label: 'Search', value: '1,400 searches + 7,000 pages / mo' },
      { label: 'Sandbox', value: '600 compute-minutes / mo' },
      { label: 'Mail', value: '20,000 units · 15 inboxes' },
      { label: 'Webhooks', value: '20,000 units · 10 endpoints' },
    ],
    meta: '3 seats included · +$25/mo each extra.',
  },
];

export default {
  name: 'UpgradeModal',
  props: {
    open: { type: Boolean, default: false },
    /** Why the gate opened, e.g. "Web search is included with AGNT Pro." */
    reason: { type: String, default: '' },
    /** Which tab to land on. */
    suggest: { type: String, default: 'personal' },
  },
  emits: ['close'],
  data() {
    return { selected: this.suggest, yearly: false, busy: false, error: '', plans: PLANS };
  },
  computed: {
    ...mapState('userAuth', ['planType']),
    currentPlan() {
      return this.planType && this.planType !== 'free' ? this.planType : null;
    },
    plan() {
      return this.plans.find((p) => p.id === this.selected) || this.plans[0];
    },
    headline() {
      return this.currentPlan ? 'Change your plan' : 'Go Pro';
    },
    cta() {
      return this.currentPlan ? `Switch to ${this.plan.name}` : `Get ${this.plan.name}`;
    },
  },
  watch: {
    open(v) {
      if (v) {
        this.selected = this.suggest;
        this.error = '';
      }
    },
  },
  methods: {
    ...mapActions('userAuth', ['createSubscription', 'updateSubscription']),
    close() {
      if (!this.busy) this.$emit('close');
    },
    async go() {
      this.busy = true;
      this.error = '';
      try {
        const interval = this.yearly ? 'yearly' : 'monthly';
        if (!this.currentPlan) {
          await this.createSubscription({
            planType: this.selected,
            interval,
            successUrl: `${window.location.origin}/settings?subscription=success`,
            cancelUrl: `${window.location.origin}/settings?subscription=cancelled`,
          });
        } else {
          await this.updateSubscription({ newPlanType: this.selected, interval });
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
.upgrade-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; z-index: 10000; }
.upgrade-modal { position: relative; width: min(680px, calc(100% - 32px)); background: var(--color-background); color: var(--color-text); border: 1px solid var(--terminal-border-color); border-radius: 12px; padding: 28px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5); }
.upgrade-close { position: absolute; top: 14px; right: 14px; background: none; border: 0; color: var(--color-text-secondary); cursor: pointer; font-size: 16px; }
.eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; color: var(--color-pink); }
.upgrade-head h2 { margin: 8px 0 4px; font-size: 26px; letter-spacing: -0.03em; }
.lead { margin: 0 0 18px; color: var(--color-text-secondary); }
.upgrade-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.tab { position: relative; text-align: left; padding: 12px 14px; border: 1px solid var(--terminal-border-color); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
.tab.active { border-color: var(--color-pink); background: rgba(229, 61, 143, 0.08); }
.tab-name { display: block; font-weight: 650; font-size: 13px; }
.tab-price { display: block; font-size: 20px; font-weight: 700; letter-spacing: -0.03em; margin-top: 4px; }
.tab-price small { font-size: 11px; font-weight: 400; color: var(--color-text-secondary); }
.tab-current { position: absolute; top: 8px; right: 8px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-green); }
.upgrade-body { margin-top: 18px; }
.tagline { font-weight: 650; margin: 0 0 10px; }
.includes { list-style: none; margin: 0; padding: 0; }
.includes li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--terminal-border-color); font-size: 13px; }
.includes li span { color: var(--color-text-secondary); }
.meta { margin: 10px 0 0; font-size: 12px; color: var(--color-text-secondary); }
.reason { margin: 14px 0 0; padding: 10px 12px; border-radius: 6px; background: rgba(229, 61, 143, 0.1); font-size: 13px; }
.upgrade-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 18px; }
.interval { font-size: 13px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; }
.btn-primary { padding: 12px 20px; border-radius: 6px; border: 0; background: var(--color-pink); color: var(--color-background); font-weight: 700; cursor: pointer; }
.btn-primary:disabled { opacity: 0.6; cursor: default; }
.error { margin: 10px 0 0; color: var(--color-red); font-size: 13px; }
@media (max-width: 640px) { .upgrade-tabs { grid-template-columns: 1fr; } .upgrade-foot { flex-direction: column; align-items: stretch; } }
</style>
