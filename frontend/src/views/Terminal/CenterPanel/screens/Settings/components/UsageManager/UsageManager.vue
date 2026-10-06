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

    <!-- Free account: its own AGNT Flash allowance, measured, and every paid
         service with what AGNT Pro includes and its own Upgrade button. This
         used to be one locked card with no numbers at all. -->
    <template v-if="!isPremium">
      <p v-if="error" class="usage-error"><i class="fas fa-exclamation-triangle"></i> {{ error }}</p>
      <div class="usage-grid">
        <div class="usage-card free-flash" data-testid="free-flash">
          <div class="card-head">
            <i :class="ICONS.models"></i>
            <h3>{{ NAMES.models }}</h3>
            <span class="plan-pill">{{ flash?.trial ? 'Free trial' : 'Free' }}</span>
          </div>
          <template v-if="flash">
            <div class="meter">
              <div class="meter-row">
                <span class="meter-label">Model credits</span>
                <span class="meter-value"><strong>{{ fmt(flash.usedCredits, 'credits') }}</strong><template v-if="flash.includedCredits"> / {{ fmt(flash.includedCredits, 'credits') }}</template></span>
              </div>
              <div v-if="flash.includedCredits" class="meter-bar" v-tooltip="Math.round(flashShare * 100) + '% used'">
                <div class="meter-fill" :class="{ warn: flashShare >= 0.8, full: flashShare >= 1 }" :style="{ width: Math.min(100, flashShare * 100) + '%' }"></div>
              </div>
            </div>
            <p class="card-note">{{ fmt(flash.remainingCredits, 'credits') }} credits left<template v-if="flash.balanceMicroUSD > 0"> · ${{ (flash.balanceMicroUSD / 1e6).toFixed(2) }} prepaid</template></p>
          </template>
          <p v-else-if="!loading" class="card-note">Free AGNT Flash credits are included with your account.</p>
          <p class="card-note muted">AGNT Pro: {{ proIncludes('AGNT Flash') }}</p>
          <div class="card-actions">
            <button type="button" class="card-btn" :disabled="topUpBusy" @click="topUp">{{ topUpBusy ? 'Opening…' : 'Top up $10' }}</button>
            <button type="button" class="card-btn primary" @click="openUpgrade(NAMES.models)"><i class="fas fa-arrow-up"></i> Upgrade</button>
          </div>
        </div>

        <div v-for="s in UPGRADE_SERVICES" :key="s.key" class="usage-card locked" :data-testid="`upgrade-${s.key}`">
          <div class="card-head">
            <i :class="s.icon"></i>
            <h3>{{ s.name }}</h3>
            <span class="plan-pill pro"><i class="fas fa-crown"></i> Pro</span>
          </div>
          <p class="card-note">{{ s.what }}</p>
          <p class="card-note muted">AGNT Pro: {{ proIncludes(s.planLabel) || 'Included' }}</p>
          <div class="card-actions">
            <button type="button" class="card-btn primary" @click="openUpgrade(s.name)"><i class="fas fa-arrow-up"></i> Upgrade</button>
          </div>
        </div>
      </div>
      <UpgradeModal :open="upgradeOpen" :reason="upgradeReason" suggest="personal" @close="upgradeOpen = false" />
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
import { fetchFlashAccount, startFlashTopUp, usedShare } from '@/services/agntFlash.js';

const SERVICE_ORDER = ['models', 'search', 'sandbox', 'mail', 'webhooks', 'mobile'];
const NAMES = { models: 'AGNT Flash', search: 'Search', sandbox: 'Sandbox', mail: 'Mail', webhooks: 'Webhooks', mobile: 'Text Annie' };
const ICONS = { models: 'fas fa-bolt', search: 'fas fa-search', sandbox: 'fas fa-terminal', mail: 'fas fa-envelope', webhooks: 'fas fa-plug', mobile: 'fas fa-sms' };

/**
 * What a free account can upgrade into, one card each. `planLabel` is the row
 * in plans.js (the table every upgrade surface sells from), so the allowance
 * shown here is the one checkout charges for; Text Annie has no row there yet,
 * so its card says "Included" rather than inventing a number.
 */
const UPGRADE_SERVICES = Object.freeze([
  { key: 'search', name: NAMES.search, icon: ICONS.search, planLabel: 'Search', what: 'Live web search and page reading for your agents.' },
  { key: 'sandbox', name: NAMES.sandbox, icon: ICONS.sandbox, planLabel: 'Sandbox', what: 'Run code safely in a hosted sandbox.' },
  { key: 'mail', name: NAMES.mail, icon: ICONS.mail, planLabel: 'Mail', what: 'Your own inbox to send and receive email from workflows.' },
  { key: 'webhooks', name: NAMES.webhooks, icon: ICONS.webhooks, planLabel: 'Webhooks', what: 'Public webhook URLs that trigger your workflows.' },
  { key: 'mobile', name: NAMES.mobile, icon: ICONS.mobile, planLabel: 'Text Annie', what: 'Text Annie from your phone and get replies by text.' },
  { key: 'hosted', name: 'Hosted instance', icon: 'fas fa-cloud', planLabel: 'Hosted instance', what: 'Your agent keeps running in the cloud when this computer is off.' },
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
    const topUpBusy = ref(false);
    const upgradeOpen = ref(false);
    const upgradeReason = ref('');
    const proIncludes = (label) => PRO?.includes.find((row) => row.label === label)?.value || '';
    const openUpgrade = (name) => {
      upgradeReason.value = `${name} comes with AGNT Pro.`;
      upgradeOpen.value = true;
    };
    async function topUp() {
      topUpBusy.value = true;
      try {
        await startFlashTopUp(1000);
      } catch (e) {
        error.value = e?.message || 'Could not open checkout';
      } finally {
        topUpBusy.value = false;
      }
    }
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
      SERVICE_ORDER, NAMES, ICONS, UPGRADE_SERVICES, isPremium, loading, error, cards, period, periodLabel, resetLabel, fetchedAt, pct, fmt, load,
      flash, flashShare, topUpBusy, topUp, upgradeOpen, upgradeReason, openUpgrade, proIncludes,
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
.card-actions { display: flex; gap: 8px; margin-top: auto; }
.card-btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border: 1px solid var(--terminal-border-color); border-radius: 7px; background: transparent; color: var(--color-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.card-btn:disabled { opacity: 0.6; cursor: default; }
.card-btn.primary { border-color: var(--color-yellow); background: var(--color-yellow); color: var(--text-on-fill); }
.card-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
</style>
