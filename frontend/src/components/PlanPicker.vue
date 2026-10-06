<template>
  <div class="plan-picker">
    <div class="plan-tabs" role="tablist">
      <button
        v-for="p in plans"
        :key="p.id"
        type="button"
        role="tab"
        :aria-selected="selected === p.id"
        :class="['tab', { active: selected === p.id, current: p.id === currentPlan }]"
        @click="selected = p.id"
      >
        <span class="tab-name">{{ p.name }}</span>
        <span class="tab-price">${{ p.price }}<small>/mo</small></span>
        <span v-if="p.id === currentPlan" class="tab-current">Current</span>
      </button>
    </div>

    <div class="plan-body" role="tabpanel">
      <p class="tagline">{{ plan.tagline }}</p>
      <ul class="includes">
        <li v-for="row in plan.includes" :key="row.label"><span>{{ row.label }}</span><b>{{ row.value }}</b></li>
      </ul>
      <p class="meta">{{ plan.meta }}</p>
      <p v-if="reason" class="reason"><i class="fas fa-lock"></i> {{ reason }}</p>
    </div>

    <div class="plan-foot">
      <label class="interval"><input v-model="yearly" type="checkbox" /> Annual billing <small>(${{ plan.yearly }}/yr)</small></label>
      <button type="button" class="btn-primary" :disabled="busy || selected === currentPlan" @click="choose">
        {{ busy ? 'Opening checkout…' : selected === currentPlan ? 'Your current plan' : cta }}
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script>
/**
 * The plan picker: AGNT's paid plans as tabs, what each includes, annual or
 * monthly, and one button. It is the body of the upgrade modal AND Billing's
 * "Compare plans", so both places show the same thing. It decides nothing
 * about checkout: it emits `choose({ planType, interval })` and the host runs
 * its own path (the modal's checkout, Billing's upgrade/downgrade flows).
 */
import { PLANS } from './plans.js';

export default {
  name: 'PlanPicker',
  props: {
    /** The plan the user is on ('personal' | 'always_on' | 'business'), or null on free. */
    currentPlan: { type: String, default: null },
    /** Which tab to open on. */
    suggest: { type: String, default: 'personal' },
    /** Why a gate sent the user here, e.g. "Web search is included with AGNT Pro." */
    reason: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  emits: ['choose'],
  data() {
    return { selected: this.suggest, yearly: false, plans: PLANS };
  },
  computed: {
    plan() {
      return this.plans.find((p) => p.id === this.selected) || this.plans[0];
    },
    cta() {
      return this.currentPlan ? `Switch to ${this.plan.name}` : `Get ${this.plan.name}`;
    },
  },
  watch: {
    suggest(id) {
      this.selected = id;
    },
  },
  methods: {
    choose() {
      this.$emit('choose', { planType: this.selected, interval: this.yearly ? 'yearly' : 'monthly' });
    },
  },
};
</script>

<style scoped>
.plan-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.tab { position: relative; text-align: left; padding: 12px 14px; border: 1px solid var(--terminal-border-color); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.tab.active { border-color: var(--color-pink); background: rgba(var(--pink-rgb), 0.08); }
.tab-name { display: block; font-weight: 650; font-size: 13px; }
.tab-price { display: block; font-size: 20px; font-weight: 700; letter-spacing: -0.03em; margin-top: 4px; }
.tab-price small { font-size: 11px; font-weight: 400; color: var(--color-text-secondary); }
.tab-current { position: absolute; top: 8px; right: 8px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-green); }
.plan-body { margin-top: 18px; }
.tagline { font-weight: 650; margin: 0 0 10px; }
.includes { list-style: none; margin: 0; padding: 0; }
.includes li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--terminal-border-color); font-size: 13px; }
.includes li span { color: var(--color-text-secondary); }
.meta { margin: 10px 0 0; font-size: 12px; color: var(--color-text-secondary); }
.reason { margin: 14px 0 0; padding: 10px 12px; border-radius: 6px; background: rgba(var(--pink-rgb), 0.1); font-size: 13px; }
.plan-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 18px; }
.interval { font-size: 13px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; }
.btn-primary { padding: 12px 20px; border-radius: 6px; border: 0; background: var(--color-pink); color: var(--text-on-fill); font-weight: 700; cursor: pointer; font: inherit; font-weight: 700; }
.btn-primary:disabled { opacity: 0.6; cursor: default; }
.error { margin: 10px 0 0; color: var(--color-red); font-size: 13px; }
@media (max-width: 640px) {
  .plan-tabs { grid-template-columns: 1fr; }
  .plan-foot { flex-direction: column; align-items: stretch; }
}
</style>
