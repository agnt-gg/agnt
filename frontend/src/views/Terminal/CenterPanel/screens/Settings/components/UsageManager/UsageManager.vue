<template>
  <div class="usage-manager">
    <div class="usage-header">
      <div class="header-content">
        <h2>This month</h2>
        <p v-if="!isPremium">Your free AGNT Flash credits, and the services AGNT Pro adds.</p>
        <p v-else-if="period">{{ periodLabel }} · resets {{ resetLabel }}</p>
        <p v-else>Included with your plan. Allowances reset monthly.</p>
      </div>
      <div class="header-actions">
        <button class="refresh-btn" :disabled="loading" @click="load(true)"><i class="fas fa-sync-alt" :class="{ spinning: loading }"></i> Refresh</button>
      </div>
    </div>

    <!-- Free account: the AGNT Flash credits it really has, as one meter, then
         everything AGNT Pro adds as ONE dimmed list with ONE Upgrade. A card
         and an Upgrade button per service crowded the whole page. -->
    <template v-if="!isPremium">
      <p v-if="error" class="usage-error"><i class="fas fa-exclamation-triangle"></i> {{ error }}</p>
      <div class="usage-card free-flash" data-testid="free-flash">
        <div class="card-head">
          <i :class="ICONS.models"></i>
          <h3>{{ NAMES.models }}</h3>
          <span class="plan-pill">{{ flash?.trial ? 'Free trial' : 'Free' }}</span>
        </div>
        <div v-if="flash" class="meter">
          <div class="meter-row">
            <span class="meter-label">{{ fmt(flash.remainingCredits, 'credits') }} credits left<template v-if="flash.balanceMicroUSD > 0"> · ${{ (flash.balanceMicroUSD / 1e6).toFixed(2) }} prepaid</template></span>
            <span class="meter-value"><strong>{{ fmt(flash.usedCredits, 'credits') }}</strong><template v-if="flash.includedCredits"> / {{ fmt(flash.includedCredits, 'credits') }}</template></span>
          </div>
          <div v-if="flash.includedCredits" class="meter-bar" v-tooltip="Math.round(flashShare * 100) + '% used'">
            <div class="meter-fill" :class="{ warn: flashShare >= 0.8, full: flashShare >= 1 }" :style="{ width: Math.min(100, flashShare * 100) + '%' }"></div>
          </div>
        </div>
        <p v-else-if="!loading" class="card-note">Free AGNT Flash credits are included with your account.</p>
      </div>

      <section class="pro-services" data-testid="pro-services" aria-label="Included with AGNT Pro">
        <div class="pro-services-head">
          <span class="plan-pill pro"><i class="fas fa-crown"></i> AGNT Pro</span>
          <span class="pro-services-note">More AGNT Flash plus hosted services</span>
          <button type="button" class="card-btn primary" @click="upgradeOpen = true"><i class="fas fa-arrow-up"></i> Upgrade</button>
        </div>
        <ul class="pro-services-list">
          <li v-for="s in PRO_SERVICES" :key="s.key" :data-testid="`pro-${s.key}`">
            <i :class="s.icon" aria-hidden="true"></i>
            <span class="pro-name">{{ s.name }}</span>
            <span class="pro-amount">{{ proIncludes(s.planLabel) || 'Included' }}</span>
          </li>
        </ul>
      </section>
      <UpgradeModal :open="upgradeOpen" reason="AGNT Pro adds more AGNT Flash and every hosted service." suggest="personal" @close="upgradeOpen = false" />
    </template>

    <template v-else>
      <p v-if="error" class="usage-error"><i class="fas fa-exclamation-triangle"></i> {{ error }}</p>
      <div class="usage-grid">
        <div v-for="s in cards" :key="s.service" class="usage-card" :class="{ unavailable: !s.ok }">
          <div class="card-head">
            <i :class="ICONS[s.service]"></i>
            <h3>{{ NAMES[s.service] }}</h3>
            <span v-if="s.plan && s.ok" class="plan-pill">{{ s.plan }}</span>
            <span v-else-if="!s.ok" class="plan-pill off">unavailable</span>
          </div>

          <p v-if="!s.ok" class="card-note">{{ s.error }}</p>

          <div v-for="m in s.meters" :key="m.key" class="meter">
            <div class="meter-row">
              <span class="meter-label">{{ m.label }}</span>
              <span class="meter-value"><strong>{{ fmt(m.used, m.unit) }}</strong><template v-if="m.included != null"> / {{ fmt(m.included, m.unit) }}</template></span>
            </div>
            <div v-if="m.included" class="meter-bar" v-tooltip="Math.round(pct(m)) + '% used'">
              <div class="meter-fill" :class="{ warn: pct(m) >= 80, full: pct(m) >= 100 }" :style="{ width: Math.min(100, pct(m)) + '%' }"></div>
            </div>
          </div>

          <p v-if="s.ok && s.balanceMicroUSD > 0" class="card-note">Prepaid balance: ${{ (s.balanceMicroUSD / 1e6).toFixed(2) }}</p>
          <p v-if="s.ok && s.allowOverage" class="card-note muted">Overage on — usage past the allowance draws on your balance.</p>
        </div>
      </div>
      <p class="fetched" v-if="fetchedAt">Updated {{ new Date(fetchedAt).toLocaleTimeString() }}</p>
    </template>
  </div>
</template>

<script>
/**
 * One page for the six metered services. Reads /api/agnt-services/usage,
 * which asks each service for its own numbers, so what is shown here is what
 * the service will enforce — not a local estimate.
 */
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config';
import UpgradeModal from '@/components/UpgradeModal.vue';
import { PLANS } from '@/components/plans.js';
import { fetchFlashAccount, usedShare } from '@/services/agntFlash.js';

const SERVICE_ORDER = ['models', 'search', 'sandbox', 'mail', 'webhooks', 'mobile'];
const NAMES = { models: 'AGNT Flash', search: 'Search', sandbox: 'Sandbox', mail: 'Mail', webhooks: 'Webhooks', mobile: 'Text Annie' };
const ICONS = { models: 'fas fa-bolt', search: 'fas fa-search', sandbox: 'fas fa-terminal', mail: 'fas fa-envelope', webhooks: 'fas fa-plug', mobile: 'fas fa-sms' };

/**
 * What AGNT Pro adds, one dimmed row each under a single Upgrade button.
 * `planLabel` is the row in plans.js (the table checkout sells from); Text
 * Annie has no row there yet, so it says "Included" rather than a number.
 */
const PRO_SERVICES = Object.freeze([
  { key: 'models', name: NAMES.models, icon: ICONS.models, planLabel: 'AGNT Flash' },
  { key: 'search', name: NAMES.search, icon: ICONS.search, planLabel: 'Search' },
  { key: 'sandbox', name: NAMES.sandbox, icon: ICONS.sandbox, planLabel: 'Sandbox' },
  { key: 'mail', name: NAMES.mail, icon: ICONS.mail, planLabel: 'Mail' },
  { key: 'webhooks', name: NAMES.webhooks, icon: ICONS.webhooks, planLabel: 'Webhooks' },
  { key: 'mobile', name: NAMES.mobile, icon: ICONS.mobile, planLabel: 'Text Annie' },
  { key: 'hosted', name: 'Hosted instance', icon: 'fas fa-cloud', planLabel: 'Hosted instance' },
]);

const PRO = PLANS.find((p) => p.id === 'personal');

export default {
  name: 'UsageManager',
  components: { UpgradeModal },
  setup() {
    const store = useStore();
    const isPremium = computed(() => store.getters['userAuth/isPremium']);
    const loading = ref(false);
    const error = ref('');
    const services = ref([]);
    const fetchedAt = ref(null);

    // Free account: its own AGNT Flash allowance (models/account answers for
    // free accounts; the hosted usage route is Pro-gated).
    const flash = ref(null);
    const flashShare = computed(() => usedShare(flash.value));
    const upgradeOpen = ref(false);
    const proIncludes = (label) => PRO?.includes.find((row) => row.label === label)?.value || '';
    async function loadFree() {
      loading.value = true;
      error.value = '';
      try {
        flash.value = await fetchFlashAccount();
        fetchedAt.value = Date.now();
      } catch (e) {
        flash.value = null;
        error.value = e?.message ? `AGNT Flash usage unavailable: ${e.message}` : 'Could not load AGNT Flash usage';
      } finally {
        loading.value = false;
      }
    }

    const cards = computed(() => SERVICE_ORDER.map((name) => services.value.find((s) => s.service === name) || { service: name, ok: false, error: 'Not loaded', meters: [] }));
    const period = computed(() => services.value.find((s) => s.ok && s.period)?.period || null);
    const resetAt = computed(() => services.value.find((s) => s.ok && s.resetAt)?.resetAt || null);
    const periodLabel = computed(() => {
      if (!period.value) return '';
      const [y, m] = period.value.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    });
    const resetLabel = computed(() => (resetAt.value ? new Date(resetAt.value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''));

    const pct = (m) => (m.included ? (m.used / m.included) * 100 : 0);
    const fmt = (n, unit) => {
      if (n == null) return '—';
      if (unit === 'bytes') return n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB';
      if (unit === 'credits') return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n);
      return n.toLocaleString();
    };

    async function load(force = false) {
      if (!isPremium.value) return loadFree();
      loading.value = true;
      error.value = '';
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_CONFIG.BASE_URL}/agnt-services/usage${force ? '?t=' + Date.now() : ''}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Usage request failed (${res.status})`);
        const data = await res.json();
        services.value = data.services || [];
        fetchedAt.value = data.fetchedAt || Date.now();
      } catch (e) {
        error.value = e.message || 'Could not load usage';
      } finally {
        loading.value = false;
      }
    }
    onMounted(load);

    return {
      SERVICE_ORDER, NAMES, ICONS, PRO_SERVICES, isPremium, loading, error, cards, period, periodLabel, resetLabel, fetchedAt, pct, fmt, load,
      flash, flashShare, upgradeOpen, proIncludes,
    };
  },
};
</script>

<style scoped>
.usage-manager { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 1400px; margin: 0 auto; }
.usage-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; background: rgba(var(--primary-rgb), 0.05); border: 1px solid var(--terminal-border-color); border-radius: 12px; gap: 20px; }
.header-content h2 { color: var(--color-primary); font-size: 1.4em; font-weight: 700; margin: 0 0 4px; }
.header-content p { margin: 0; color: var(--color-text-secondary); font-size: 13px; }
.refresh-btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--terminal-border-color); border-radius: 6px; background: transparent; color: var(--color-text); cursor: pointer; font-size: 13px; }
.refresh-btn:disabled { opacity: 0.6; cursor: default; }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.usage-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.usage-card { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; border: 1px solid var(--terminal-border-color); border-radius: 12px; background: var(--color-background); }
.usage-card.unavailable { opacity: 0.7; }
.card-head { display: flex; align-items: center; gap: 10px; }
.card-head i { color: var(--color-primary); width: 18px; text-align: center; }
.card-head h3 { margin: 0; font-size: 15px; font-weight: 650; flex: 1; }
.plan-pill { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--terminal-border-color); color: var(--color-text-secondary); text-transform: capitalize; }
.plan-pill.off { color: var(--color-red); }
.meter { display: flex; flex-direction: column; gap: 6px; }
.meter-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; }
.meter-label { color: var(--color-text-secondary); }
.meter-value { color: var(--color-text-secondary); }
.meter-value strong { color: var(--color-text); font-weight: 650; }
.meter-bar { height: 6px; border-radius: 999px; background: rgba(var(--primary-rgb), 0.12); overflow: hidden; }
.meter-fill { height: 100%; border-radius: 999px; background: var(--color-primary); transition: width 0.3s ease; }
.meter-fill.warn { background: var(--color-yellow); }
.meter-fill.full { background: var(--color-red); }
.card-note { margin: 0; font-size: 12px; color: var(--color-text-secondary); }
.card-note.muted { opacity: 0.75; }
.usage-error { margin: 0; padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255, 80, 80, 0.4); color: var(--color-red); font-size: 13px; }
.fetched { margin: 0; font-size: 11px; color: var(--color-text-muted); text-align: right; }
.plan-pill.pro { display: inline-flex; align-items: center; gap: 5px; border-color: rgba(var(--yellow-rgb), 0.35); background: rgba(var(--yellow-rgb), 0.1); color: var(--color-text); text-transform: none; }
.card-btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border: 1px solid var(--terminal-border-color); border-radius: 7px; background: transparent; color: var(--color-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.card-btn:disabled { opacity: 0.6; cursor: default; }
.card-btn.primary { border-color: var(--color-yellow); background: var(--color-yellow); color: var(--text-on-fill); }
.card-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.pro-services { padding: 14px 18px; border: 1px dashed var(--terminal-border-color); border-radius: 12px; }
.pro-services-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.pro-services-note { flex: 1; font-size: 13px; color: var(--color-text-secondary); }
.pro-services-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px 20px; margin: 0; padding: 0; list-style: none; opacity: 0.55; }
.pro-services-list li { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: var(--color-text-secondary); min-width: 0; }
.pro-services-list i { width: 14px; text-align: center; color: var(--color-text-muted); }
.pro-name { flex: none; color: var(--color-text); font-weight: 600; }
.pro-amount { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
