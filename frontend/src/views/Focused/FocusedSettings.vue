<template>
  <section class="focused-page" :aria-label="page.title">
    <template v-if="section === 'members'">
      <button type="button" class="focused-page-back" @click="nav.go({ page: 'settings' })"><i class="fas fa-arrow-left" aria-hidden="true"></i>Settings</button>
      <MembersSettings @open-billing="nav.studio('SettingsScreen', { section: 'billing' })" @close="nav.go({ page: 'settings' })" />
      <TeamFilesAiSettings />
      <PluginPolicySettings />
    </template>
    <template v-else>
    <header class="focused-page-head">
      <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.sub }} Changes save as you go.</p>
      </div>
    </header>

    <div class="v2-settings">
    <!-- Every section on one page, with a list to jump to each. -->
    <nav class="v2-settings-nav" aria-label="Settings sections" data-testid="settings-nav">
      <button v-for="s in SETTINGS_SECTIONS" :key="s.id" type="button" :class="{ on: current === s.id }" :data-jump="s.id" @click="jump(s.id)"><i :class="s.icon" aria-hidden="true"></i>{{ s.label }}</button>
    </nav>
    <div class="v2-settings-body">
    <!-- No banner above the settings: the plan's own row (Billing) offers the
         upgrade, next to what it changes. The one exception: an account with
         no AI of its own is asked to connect one first (ConnectYourAi). -->
    <ConnectYourAi @api-key="nav.studio('SettingsScreen', { section: 'providers' })" />
    <!-- Appearance: Studio's own theme settings (themes, font, scale, custom background with its
         opacity and blur, greyscale), embedded rather than re-implemented, so both modes set the
         same preferences the same way. -->
    <section id="settings-appearance" class="focused-edit-block" data-section="theme">
      <div class="focused-edit-block-head"><h3>Appearance</h3></div>
      <div class="focused-edit-card focused-theme-card">
        <ThemeSelector />
      </div>
    </section>

    <!-- data-section="providers": the "Connect your AI" tour step points here. -->
    <section id="settings-model" class="focused-edit-block" data-section="providers">
      <div class="focused-edit-block-head">
        <h3>AI model</h3>
        <span class="focused-edit-hint">Used unless a chat or an agent picks another.</span>
      </div>
      <div class="focused-edit-card">
        <div class="focused-edit-row">
          <span class="focused-edit-label">Model</span>
          <div class="focused-edit-pair">
            <CustomSelect
              :model-value="provider"
              placeholder="Choose a provider"
              :options="providerOptions.map((p) => ({ label: p, value: p }))"
              @update:model-value="setProvider"
            />
            <CustomSelect
              v-if="provider"
              :model-value="model"
              placeholder="Choose a model"
              :options="modelOptions.map((m) => ({ label: m, value: m }))"
              :disabled="switching"
              @update:model-value="setModel"
            />
          </div>
        </div>
        <div class="focused-edit-row">
          <span class="focused-edit-label">More</span>
          <button type="button" class="focused-btn" data-action="model-settings" @click="nav.studio('SettingsScreen', { section: 'providers' })">Fallback models and chat behaviour</button>
        </div>
      </div>
    </section>

    <section id="settings-account" class="focused-edit-block">
      <div class="focused-edit-block-head"><h3>Account</h3></div>
      <div class="focused-edit-card">
        <div class="focused-edit-row"><span class="focused-edit-label">Name</span><span>{{ userName || '—' }}</span></div>
        <div class="focused-edit-row"><span class="focused-edit-label">Email</span><span>{{ userEmail || '—' }}</span></div>
        <div class="focused-edit-row">
          <span class="focused-edit-label">Members</span>
          <button type="button" class="focused-btn" @click="nav.go({ page: 'settings', section: 'members' })"><i class="fas fa-users" aria-hidden="true"></i>Manage members</button>
        </div>
        <div class="focused-edit-row">
          <span class="focused-edit-label">Session</span>
          <button type="button" class="focused-btn" @click="logOut"><i class="fas fa-sign-out-alt" aria-hidden="true"></i>Log out</button>
        </div>
      </div>
    </section>

    <section id="settings-billing" class="focused-edit-block">
      <div class="focused-edit-block-head">
        <h3>Billing</h3>
        <span class="focused-flex"></span>
        <button type="button" class="focused-link" @click="nav.studio('SettingsScreen', { section: 'billing' })">Full billing</button>
      </div>
      <div class="focused-edit-card">
        <div class="focused-edit-row">
          <span class="focused-edit-label">Plan</span>
          <span class="focused-billing-plan">
            <strong>{{ billing.plan }}</strong>
            <span v-if="!billing.isFree" class="focused-status-pill" :class="{ live: billing.status === 'Active', bad: billing.status === 'Past due' }">{{ billing.status }}</span>
          </span>
          <span class="focused-flex"></span>
          <button type="button" :class="billing.isFree ? 'focused-primary' : 'focused-btn'" :disabled="billingBusy" @click="upgradeOpen = true">
            {{ billing.isFree ? 'Upgrade' : 'Change plan' }}
          </button>
        </div>
        <div v-if="billing.renewsAt" class="focused-edit-row">
          <span class="focused-edit-label">{{ billing.renewLabel }}</span>
          <span>{{ new Date(billing.renewsAt).toLocaleDateString() }}</span>
        </div>
        <div v-if="billing.canCancel || billing.canReactivate" class="focused-edit-row">
          <span class="focused-edit-label">Subscription</span>
          <button v-if="billing.canReactivate" type="button" class="focused-btn" :disabled="billingBusy" @click="reactivate">
            {{ billingBusy ? 'Working…' : 'Reactivate' }}
          </button>
          <button v-else type="button" class="focused-btn danger" :disabled="billingBusy" @click="cancelPlan">
            {{ billingBusy ? 'Working…' : 'Cancel subscription' }}
          </button>
        </div>
      </div>
    </section>
    <UpgradeModal :open="upgradeOpen" :suggest="billing.isFree ? 'personal' : planType" @close="closeUpgrade" />

    <!-- Usage: Studio's own Usage page (Settings › Usage), embedded rather than
         re-implemented, so both modes show the numbers the services enforce. -->
    <section id="settings-usage" class="focused-edit-block focused-usage">
      <div class="focused-edit-block-head">
        <h3>Usage</h3>
        <span class="focused-edit-hint">AGNT Flash and every hosted service, this month.</span>
      </div>
      <UsageManager />
    </section>

    <!-- Every other setting, in Studio's groups (2026-10-23); each row opens its section. -->
    <div id="settings-more"></div>
    <section v-for="group in moreSettings" :key="group.label" class="focused-edit-block" :data-settings-group="group.label">
      <div class="focused-edit-block-head"><h3>{{ group.label }}</h3></div>
      <ul class="focused-list">
        <li v-for="item in group.items" :key="item.id">
          <button type="button" class="focused-row" :data-settings-section="item.id" @click="openSetting(item)">
            <span class="focused-row-icon" aria-hidden="true"><i :class="item.icon"></i></span>
            <span class="focused-row-text"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
            <i class="fas fa-chevron-right focused-row-go" aria-hidden="true"></i>
          </button>
        </li>
      </ul>
    </section>
    <!-- AGNT One or Studio (custom pages, dashboard, goals, forges, Navigation settings): last, it is rarely changed. -->
    <div id="settings-layout"><UiModeSetting /></div>
    </div>
    </div>
    </template>
  </section>
</template>

<script setup>
defineProps({ section: { type: String, default: null } });
import MembersSettings from '@/views/Terminal/CenterPanel/screens/Settings/components/MembersSettings.vue';
import PluginPolicySettings from './PluginPolicySettings.vue';
import TeamFilesAiSettings from './TeamFilesAiSettings.vue';
import UiModeSetting from './UiModeSetting.vue';
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import ConnectYourAi from '@/views/_components/feature/ConnectYourAi.vue';
import UpgradeModal from '@/components/UpgradeModal.vue';
import UsageManager from '@/views/Terminal/CenterPanel/screens/Settings/components/UsageManager/UsageManager.vue';
import ThemeSelector from '@/views/Terminal/CenterPanel/screens/Settings/components/ThemeSelector/ThemeSelector.vue';
import { FOCUSED_PAGES, billingSummary } from './focusedModel.js';
import { settingsDirectory } from '@/mobile/sectionDirectories.js';

const store = useStore();
const router = useRouter();
const nav = inject('focusedNav');
// The section list: one click to each part of this page.
const SETTINGS_SECTIONS = Object.freeze([
  { id: 'appearance', label: 'Appearance', icon: 'fas fa-palette' },
  { id: 'model', label: 'AI model', icon: 'fas fa-robot' },
  { id: 'account', label: 'Account', icon: 'fas fa-user' },
  { id: 'billing', label: 'Billing', icon: 'fas fa-credit-card' },
  { id: 'usage', label: 'Usage', icon: 'fas fa-chart-bar' },
  { id: 'more', label: 'More settings', icon: 'fas fa-sliders-h' },
  { id: 'layout', label: 'Layout', icon: 'fas fa-columns' },
]);
const current = ref('appearance');
function jump(id) {
  current.value = id;
  document.getElementById('settings-' + id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}
// Shown in full above: Theme (Studio's ThemeSelector), Members, Usage. Default model and Billing
// are summaries above with a link to the full section. 'general' is the sign-in form (Account
// above). Navigation arranges Studio's sidebar; One's rail is fixed, so it changes nothing here.
// Every other Studio settings section stays listed below and opens in full.
const SHOWN_ABOVE = new Set(['providers', 'theme', 'members', 'billing', 'usage', 'general', 'navigation']);
const moreSettings = settingsDirectory
  .map((group) => ({ label: group.label === 'General' ? 'Preferences' : group.label, items: group.items.filter((item) => !SHOWN_ABOVE.has(item.id)) }))
  .filter((group) => group.items.length);
// A section opens in full (Studio's screen, with a way back); Learning is its own screen.
function openSetting(item) {
  if (item.screen) nav.openScreen(item.screen);
  else nav.studio('SettingsScreen', { section: item.id });
}

// The same sign-out Studio's Settings uses (LoginSection.logout).
async function logOut() {
  await store.dispatch('userAuth/logout');
  // Terminal tears down the entire shell as soon as the session is invalid.
  await router.replace({ path: '/settings', query: { section: 'login' } });
}
const page = FOCUSED_PAGES.settings;


const provider = computed(() => store.state.aiProvider?.selectedProvider || '');
const model = computed(() => store.state.aiProvider?.selectedModel || '');
const providerOptions = computed(() => {
  const list = (store.getters['aiProvider/filteredProviders'] || []).map((p) => (typeof p === 'string' ? p : p.name || p.id));
  return provider.value && !list.includes(provider.value) ? [provider.value, ...list] : list;
});
const modelOptions = computed(() => {
  const ids = (store.state.aiProvider?.allModels?.[provider.value] || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  return model.value && !ids.includes(model.value) ? [model.value, ...ids] : ids;
});
const switching = ref(false);
async function setProvider(p) {
  if (!p) return;
  switching.value = true;
  try {
    // Loads the provider's models, sets it, then keeps the model valid.
    await store.dispatch('aiProvider/setProviderWithModelFetch', { provider: p, source: 'focused-settings' });
    nav.toast(`Default model: ${p}.`);
  } catch (e) {
    nav.toast('Couldn’t change it. ' + (e?.message || e));
  } finally {
    switching.value = false;
  }
}
async function setModel(m) {
  await store.dispatch('aiProvider/setModel', m);
  nav.toast(`Default model: ${m}.`);
}

const userName = computed(() => store.getters['userAuth/userName']);
const userEmail = computed(() => store.getters['userAuth/userEmail']);

// Billing: a summary of Studio's Billing page, through the same userAuth
// actions, and the one upgrade surface (UpgradeModal) every Pro gate uses.
const planType = computed(() => String(store.state.userAuth?.planType || store.getters['userAuth/planType'] || 'free'));
const billing = computed(() => billingSummary(planType.value, store.state.userAuth?.subscription));
const upgradeOpen = ref(false);
const billingBusy = ref(false);
const refreshSubscription = () => store.dispatch('userAuth/fetchSubscription').catch((e) => console.warn('[Focused] could not load billing:', e?.message || e));
function closeUpgrade() {
  upgradeOpen.value = false;
  refreshSubscription();
}
async function changeSubscription(action, done) {
  billingBusy.value = true;
  try {
    await store.dispatch(action);
    await refreshSubscription();
    nav.toast(done);
  } catch (e) {
    nav.toast('Couldn’t change your subscription. ' + (e?.message || e));
  } finally {
    billingBusy.value = false;
  }
}
async function cancelPlan() {
  const ok = await nav.confirm({
    title: `Cancel ${billing.value.plan}?`,
    message: 'You keep everything until the end of this billing period.',
    confirmText: 'Cancel subscription',
    danger: true,
  });
  if (ok) await changeSubscription('userAuth/cancelSubscription', 'Subscription cancelled.');
}
const reactivate = () => changeSubscription('userAuth/reactivateSubscription', 'Subscription reactivated.');
onMounted(refreshSubscription);
</script>

<style scoped>
/* The section list beside the settings, on desktop; above them on a narrow window. */
.v2-settings { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 28px; align-items: start; }
.v2-settings-nav { position: sticky; top: 8px; display: flex; flex-direction: column; gap: 2px; }
.v2-settings-nav button { display: flex; align-items: center; gap: 11px; height: 40px; padding: 0 12px; border: 0; border-radius: 10px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 14.5px; text-align: left; cursor: pointer; }
.v2-settings-nav button i { width: 16px; text-align: center; color: var(--text-tertiary); }
.v2-settings-nav button:hover { background: var(--surface-hover); color: var(--text-primary); }
.v2-settings-nav button.on { background: var(--surface-active); color: var(--text-primary); font-weight: 600; }
.v2-settings-body { min-width: 0; }
.v2-settings-body > [id^='settings-'] { scroll-margin-top: 12px; }
@media (max-width: 900px) {
  .v2-settings { grid-template-columns: minmax(0, 1fr); }
  .v2-settings-nav { position: static; flex-direction: row; flex-wrap: wrap; }
}
</style>
