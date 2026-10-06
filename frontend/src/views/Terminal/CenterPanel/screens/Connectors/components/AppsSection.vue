<!-- Shared package browser. Shells supply navigation and existing account-connection flows. -->
<template>
  <div class="apps-studio">
    <SimpleModal ref="modal" />
    <div class="apps-nav">
      <nav aria-label="Plugin library">
        <button type="button" :class="{ active: tab === 'explore' }" @click="switchTab('explore')">Explore</button>
        <button type="button" :class="{ active: tab === 'installed' }" @click="switchTab('installed')">Installed <span>{{ installedCount }}</span></button>
        <button type="button" :class="{ active: tab === 'market' }" @click="switchTab('market')">Market <span>{{ marketCount }}</span></button>
      </nav>
      <div class="apps-nav-actions">
        <button type="button" @click="emit('build-app')"><AppsIcon name="plus" /> New plugin</button>
        <button type="button" @click="emit('add-account')">Custom sign-in</button>
      </div>
    </div>

    <p v-if="error" class="apps-notice error" role="alert">{{ error }} <button type="button" @click="reload">Retry</button></p>
    <p v-if="notice" class="apps-notice" role="status">{{ notice }}</p>

    <div v-if="selectedName && !selected" class="apps-empty" role="status">
      <h2>{{ loading ? 'Loading plugin…' : 'This plugin isn’t available' }}</h2>
      <p v-if="!loading">It may no longer be in the catalog. Your other plugins are still here.</p>
      <button type="button" class="apps-secondary" @click="closePlugin">All plugins</button>
    </div>
    <template v-else-if="!selected">
      <div class="apps-heading">
        <div><h1>A little more capable.</h1><p>Good tools. Great agents. Find your next plugin.</p></div>
        <label class="apps-search"><AppsIcon name="search" /><input v-model="query" type="search" placeholder="Search plugins" aria-label="Search plugins" /></label>
      </div>
      <div class="apps-toolbar">
        <div class="apps-categories" aria-label="Categories">
          <button v-for="name in categories" :key="name" type="button" :aria-pressed="category === name" :class="{ active: category === name }" @click="category = name">{{ name }}</button>
        </div>
        <span>{{ filtered.length }} {{ filtered.length === 1 ? 'plugin' : 'plugins' }}</span>
      </div>

      <section v-if="featured && !query && category === 'All plugins' && tab === 'explore'" class="apps-feature">
        <div class="feature-copy"><span class="eyebrow">{{ featured.isPack ? 'MADE TO WORK TOGETHER' : 'EXTEND YOUR TOOLKIT' }}</span><h2>{{ featured.displayName }}.<br>A little more possibility.</h2><p>{{ featured.description || 'Explore what this plugin brings to AGNT.' }}</p><button type="button" @click="openPlugin(featured)">Explore {{ featured.isPack ? 'the pack' : 'the plugin' }} <AppsIcon name="arrow" /></button></div>
        <div class="feature-art" aria-hidden="true"><div class="feature-orbit"></div><div class="feature-sheet"><span class="eyebrow">YOUR NEXT CAPABILITY</span><span class="app-logo feature-logo"><SvgIcon :name="featured.icon || 'puzzle-piece'" /></span><strong>{{ featured.displayName }}</strong><div class="feature-lines"><i></i><i></i></div><span class="feature-chip">{{ composition(featured) }}</span></div><span class="feature-float"><AppsIcon name="plugin" /> Built for AGNT</span></div>
      </section>

      <div class="apps-section-label"><h2>{{ sectionTitle }}</h2><span>{{ tab === 'market' ? 'Every plugin on the AGNT Market.' : 'Pick a capability. Make it yours.' }}</span></div>
      <p v-if="loading && !catalog.length" class="apps-empty" role="status">Loading plugins…</p>
      <div v-else-if="!filtered.length" class="apps-empty">
        <AppsIcon name="search" />
        <h2>{{ query ? 'No matching plugins' : tab === 'installed' ? 'No plugins installed yet' : 'No plugins here yet' }}</h2>
        <p>{{ query ? 'Try another name or category.' : 'Find one on the Market to add your first plugin.' }}</p>
        <div class="apps-empty-actions">
          <button v-if="query || category !== 'All plugins'" type="button" class="apps-secondary" @click="resetFilters">Clear filters</button>
          <button v-else-if="tab !== 'market' && marketCount" type="button" class="apps-secondary" @click="switchTab('market')">Browse {{ marketCount }} on the Market</button>
          <button type="button" class="apps-primary" data-testid="open-marketplace" @click="emit('open-market')">Open the Marketplace</button>
        </div>
      </div>
      <div v-else class="apps-grid">
        <article v-for="app in filtered" :key="app.name" class="apps-card" :data-app="app.name">
          <div class="card-top"><span class="app-logo"><SvgIcon :name="app.icon || 'puzzle-piece'" /></span><span v-if="app.installed" class="card-status"><AppsIcon name="check" /> Installed</span><span v-else class="card-type">{{ app.isPack ? 'Capability pack' : app.category }}</span></div>
          <h3><button type="button" class="card-title" @click="openPlugin(app)">{{ app.displayName }}</button></h3><p>{{ app.description || 'Explore this plugin’s capabilities.' }}</p>
          <div class="card-bottom"><span>{{ composition(app) }}</span><AppsIcon name="arrow" /></div>
        </article>
      </div>
    </template>

    <template v-else>
      <button type="button" class="apps-back" @click="closePlugin"><AppsIcon name="back" /> All plugins</button>
      <div class="apps-detail-hero">
        <span class="app-logo large"><SvgIcon :name="selected.icon || 'puzzle-piece'" /></span>
        <div class="detail-identity"><span class="eyebrow">{{ selected.authorName ? `BY ${selected.authorName}` : 'PLUGIN' }} · {{ selected.category }}</span><h1 ref="detailHeading" tabindex="-1">{{ selected.displayName }}</h1><p>{{ selected.description || 'Explore the capabilities included in this plugin.' }}</p></div>
        <div class="hero-action"><button v-if="!selected.installed" type="button" class="apps-primary" :disabled="!!installing" @click="install(selected)"><AppsIcon name="plus" /> {{ installing === selected.name ? 'Preparing…' : price(selected) ? 'Get plugin' : 'Install plugin' }}</button><button v-else type="button" class="apps-secondary" @click="emit('open-app', selected.name)"><AppsIcon name="check" /> Manage installed plugin</button><span>{{ selected.installed ? 'Installed' : price(selected) || 'Free' }}<template v-if="selected.version"> · v{{ selected.version }}</template></span></div>
      </div>
      <div class="apps-detail-columns">
        <div>
          <div class="apps-preview"><span class="eyebrow">{{ selected.isPack ? 'ONE PACK. CONNECTED CAPABILITIES.' : 'YOUR TOOLS. IN YOUR WORKSPACE.' }}</span><h2>Make it part of your toolkit.</h2><div class="preview-flow"><span><AppsIcon name="plugin" />Install the plugin</span><i></i><span><AppsIcon name="agent" />Give agents access</span><i></i><span><AppsIcon name="flow" />Put it to work</span></div></div>
          <div class="apps-section-label contents-heading"><h2>What’s inside</h2><span>{{ capabilityCount }} listed capabilities</span></div>
          <p v-if="detailLoading" class="detail-message" role="status">Loading installed contents…</p>
          <p v-if="detailError" class="detail-message" role="alert">{{ detailError }} <button type="button" class="apps-link" @click="loadAssets(selected)">Retry</button></p>
          <div class="apps-contents">
            <details v-for="(group, index) in groups" :key="`${selected.name}:${group.key}`" class="asset-group" :open="index === firstPopulatedGroup">
              <summary><span class="asset-type"><AppsIcon :name="group.icon" /></span><span class="asset-heading"><strong>{{ group.label }} <span>{{ group.known ? group.items.length : '—' }}</span></strong><small>{{ group.items.slice(0, 2).map((item) => item.name).join(' · ') || (group.known ? 'Not included' : 'Not listed by publisher') }}</small></span><AppsIcon class="expand" name="plus" /></summary>
              <div class="asset-items"><p v-if="!group.items.length">{{ group.known ? 'This plugin does not include any ' + group.label.toLowerCase() + '.' : 'The catalog does not provide this inventory yet.' }}</p><div v-for="(item, index) in group.items" :key="item.id || index" class="asset-item"><span class="asset-dot"></span><div><strong>{{ item.name }}</strong><p v-if="item.description">{{ item.description }}</p></div><button v-if="group.key === 'widgets' && installedWidgetIds.has(item.id)" type="button" class="apps-link" @click="emit('open-widget', item.id)">Open</button></div></div>
            </details>
          </div>
        </div>
        <aside>
          <div class="apps-setup"><h2><AppsIcon name="plugin" /> Make it yours</h2><p>Install the plugin. Connect the services its tools need.</p><span class="eyebrow">ACCOUNT CONNECTIONS</span>
            <div v-for="connection in connections" :key="connection.providerId" class="app-connection"><span class="connection-logo"><SvgIcon :name="connection.icon" /></span><div><strong>{{ connection.name }}</strong><small>{{ connection.tools.slice(0, 2).join(', ') }}</small></div><span v-if="connection.status === 'connected'" class="connection-check" aria-label="Connected"><AppsIcon name="check" /><span class="sr-only">Connected</span></span><button v-else type="button" class="apps-small" :disabled="!connection.known" @click="emit(connection.status === 'reconnect' ? 'reconnect' : 'connect', connection)">{{ connection.known ? connection.status === 'reconnect' ? 'Reconnect' : 'Connect' : 'Unavailable' }}</button></div>
            <p v-if="!connections.length" class="connection-note">No account connections declared by this plugin’s tools.</p><p v-else class="connection-note">These tools need a connected account to run.</p>
            <p class="setup-note"><AppsIcon name="check" /> One plugin, all its included capabilities.</p>
          </div>
          <details class="apps-access"><summary><AppsIcon name="lock" /> Access & permissions <AppsIcon name="down" /></summary><p v-if="permissions.length">Declared access: {{ permissions.join(', ') }}.</p><p>Plugins run code with access to your device. Only install from publishers you trust.</p><p v-if="!selected.installed">We’ll inspect the package before asking you to confirm.</p></details>
          <dl class="apps-package"><dt>Publisher</dt><dd>{{ selected.authorName || 'Not listed' }}</dd><dt>Version</dt><dd>{{ selected.version || 'Not listed' }}</dd><template v-if="selected.license"><dt>License</dt><dd>{{ selected.license }}</dd></template></dl>
        </aside>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import AppsIcon from './AppsIcon.vue';
import { API_CONFIG } from '@/tt.config.js';
import { apiFetch } from '@/utils/apiFetch.js';
import { studioCatalog, pluginContents, pluginConnections, installDisclosure, escapeDisclosure } from '@/services/studioApps.js';

// Undefined keeps Studio's local selection; Focused supplies a route-backed name (or null).
const props = defineProps({ selectedPlugin: { type: String, default: undefined } });
const emit = defineEmits(['connect', 'reconnect', 'disconnect', 'open-app', 'open-widget', 'build-app', 'add-account', 'select-app', 'close-app', 'open-market']);
const store = useStore();
const modal = ref(null);
const query = ref('');
const category = ref('All plugins');
const tab = ref('explore');
const selectedName = ref(null);
const detailHeading = ref(null);
const installing = ref(null);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const assets = ref([]);
const detailLoading = ref(false);
const detailError = ref('');
let detailRequest = 0;
let alive = true;
const catalog = computed(() => studioCatalog(store.getters['apps/installed'], store.getters['apps/available']));
const installedCount = computed(() => catalog.value.filter((app) => app.installed).length);
const marketCount = computed(() => catalog.value.filter((app) => app.onMarket).length);
// Which plugins each tab lists, before category and search narrow it.
const inTab = (app) => (tab.value === 'installed' ? app.installed : tab.value === 'market' ? app.onMarket : true);
const sectionTitle = computed(() => (tab.value === 'installed' ? 'Installed plugins' : tab.value === 'market' ? `On the Market${category.value === 'All plugins' ? '' : ' · ' + category.value}` : category.value));
const selected = computed(() => catalog.value.find((app) => app.name === selectedName.value));
const categories = computed(() => ['All plugins', ...new Set(catalog.value.map((app) => app.category))]);
const filtered = computed(() => catalog.value.filter((app) => inTab(app) && (category.value === 'All plugins' || app.category === category.value) && `${app.displayName} ${app.description} ${app.category}`.toLowerCase().includes(query.value.trim().toLowerCase())));
const featured = computed(() => catalog.value.find((app) => app.isPack && !app.installed) || catalog.value.find((app) => app.isPack) || catalog.value.find((app) => !app.installed));
const groups = computed(() => pluginContents(selected.value, assets.value));
const capabilityCount = computed(() => groups.value.reduce((total, group) => total + group.items.length, 0));
const firstPopulatedGroup = computed(() => groups.value.findIndex((group) => group.items.length));
const connections = computed(() => pluginConnections(selected.value, store.state.appAuth?.allProviders, store.getters['appAuth/connectedApps'], store.state.appAuth?.connectionHealth?.providers));
const installedWidgetIds = computed(() => new Set((store.getters['widgetDefinitions/allDefinitions'] || []).map((widget) => widget.id)));
const permissions = computed(() => selected.value?.permissions?.capabilities || selected.value?.declaredPermissions || []);
function composition(app) {
  return app.groups.filter((group) => group.items.length).map((group) => `${group.items.length} ${group.items.length === 1 ? group.label.slice(0, -1) : group.label}`.toLowerCase()).slice(0, 3).join(' · ') || 'Explore what’s included';
}
function price(app) {
  const amount = Number(app.price);
  return Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount) : '';
}
function switchTab(value) { tab.value = value; closePlugin(); }
function resetFilters() { query.value = ''; category.value = 'All plugins'; }
async function openPlugin(app) {
  selectedName.value = app.name;
  notice.value = '';
  emit('select-app', app.name);
  await nextTick();
  detailHeading.value?.focus({ preventScroll: true });
  detailHeading.value?.scrollIntoView?.({ block: 'nearest' });
}
function closePlugin() { selectedName.value = null; emit('close-app'); }
watch(() => props.selectedPlugin, (name) => {
  if (name !== undefined) selectedName.value = name;
}, { immediate: true });
// A deep link may arrive before the catalog. Also re-read assets after an install,
// but not on every credential refresh or parent render.
watch([() => selected.value?.name, () => selected.value?.installed], () => {
  if (selected.value) loadAssets(selected.value);
  else {
    detailRequest++;
    assets.value = [];
    detailError.value = '';
    detailLoading.value = false;
  }
}, { immediate: true });
async function loadAssets(app) {
  const request = ++detailRequest;
  assets.value = [];
  detailError.value = '';
  detailLoading.value = !!app.installed;
  if (!app.installed) return;
  try {
    const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/${encodeURIComponent(app.name)}/assets`);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load installed contents.');
    if (request === detailRequest && alive) assets.value = result.assets || [];
  } catch (failure) {
    if (request === detailRequest && alive) detailError.value = failure.message;
    console.error('[AppsSection] contents:', failure);
  } finally {
    if (request === detailRequest && alive) detailLoading.value = false;
  }
}
async function reload() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    await Promise.all([
      store.dispatch('apps/fetchInstalled', { force: true }),
      store.dispatch('apps/fetchAvailable', { force: true }),
      store.dispatch('appAuth/fetchAllProviders'),
      store.dispatch('appAuth/fetchConnectedApps'),
      store.dispatch('appAuth/checkConnectionHealth'),
      store.dispatch('widgetDefinitions/fetchDefinitions'),
    ]);
    const loadError = store.state.apps?.error || store.state.apps?.availableError;
    if (loadError) throw new Error(loadError);
  } catch (failure) {
    error.value = failure.message || 'Unable to load plugins. Please retry.';
    console.error('[AppsSection] catalog:', failure);
  } finally { loading.value = false; }
}
async function install(app) {
  if (installing.value || app.installed) return;
  installing.value = app.name;
  error.value = '';
  notice.value = '';
  try {
    const itemId = app.marketplace_item_id || app.id;
    if (price(app)) {
      if (!itemId) throw new Error('This paid plugin has no marketplace purchase link.');
      const purchased = await store.dispatch('marketplace/checkPurchaseStatus', itemId);
      if (!purchased) {
        const confirmed = await modal.value.showModal({ title: `Get ${app.displayName}`, message: `This plugin costs ${escapeDisclosure(price(app))}. Continue to checkout?`, confirmText: 'Continue to checkout', showCancel: true });
        if (confirmed) await store.dispatch('marketplace/purchaseItem', { itemId });
        return;
      }
    }
    const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/inspect/${encodeURIComponent(app.name)}`);
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || 'Unable to inspect this package. Please retry.');
    const message = installDisclosure(report);
    const confirmed = await modal.value.showModal({ title: `Install ${app.displayName}?`, message, confirmText: 'Install plugin', cancelText: 'Cancel', showCancel: true, confirmClass: 'btn-primary' });
    if (!confirmed || !alive) return;
    await store.dispatch('marketplace/installPlugin', { pluginName: app.name });
    notice.value = `${app.displayName} installed.`;
    await reload();
  } catch (failure) {
    error.value = failure.message || 'Installation failed. Please retry.';
    console.error('[AppsSection] install:', failure);
  } finally { installing.value = null; }
}
onMounted(reload);
onBeforeUnmount(() => { alive = false; detailRequest++; });
</script>

<style scoped>
.apps-studio { --apps-tint: rgba(var(--primary-rgb), 0.07); --apps-border: var(--terminal-border-color); width: 100%; max-width: 1140px; margin: 0 auto; color: var(--text-primary); font-family: inherit; line-height: 1.4; container-type: inline-size; }
.apps-studio *, .apps-studio *::before, .apps-studio *::after { box-sizing: border-box; }
.apps-studio button, .apps-studio input { font: inherit; }
.apps-studio button { cursor: pointer; }
.apps-studio button:disabled { opacity: .6; cursor: default; }
.apps-studio button:focus-visible, .apps-studio summary:focus-visible, .apps-studio input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 4px; }
.apps-studio h1, .apps-studio h2, .apps-studio h3 { color: var(--text-primary); font-weight: 600; line-height: 1.1; margin: 0; opacity: 1; }
.apps-studio p { font-weight: 400; opacity: 1; }
.apps-nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--apps-border); margin-bottom: 34px; }
.apps-nav nav, .apps-nav-actions { display: flex; align-items: center; gap: 22px; }
.apps-nav button { background: none; border: 0; padding: 12px 0; color: var(--text-secondary); font-size: 14px; display: inline-flex; align-items: center; gap: 6px; }
.apps-nav nav button { border-bottom: 2px solid transparent; }
.apps-nav nav button.active { color: var(--text-primary); border-color: var(--color-primary); }
.apps-nav nav span { border: 1px solid var(--apps-border); border-radius: 4px; padding: 0 5px; font-size: 11px; }
.apps-nav-actions button { font-size: 12px; }
.apps-nav-actions :deep(svg) { width: 15px; height: 15px; }
.apps-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.apps-heading h1 { font-size: clamp(28px, 3.4cqi, 38px); letter-spacing: -.9px; }
.apps-heading p { margin: 9px 0 0; color: var(--text-secondary); font-size: 15px; }
.apps-search { display: flex; align-items: center; gap: 10px; min-width: 220px; width: 280px; height: 44px; border: 1px solid var(--apps-border); border-radius: 8px; background: var(--color-darker-0); padding: 0 13px; color: var(--text-secondary); }
.apps-search input { width: 100%; min-width: 0; background: none; border: 0; color: var(--text-primary); padding: 0; font-size: 14px; }
.apps-search input::placeholder { color: var(--text-tertiary); }
.apps-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 23px; }
.apps-toolbar > span { color: var(--text-tertiary); font-size: 12px; white-space: nowrap; }
.apps-categories { display: flex; flex-wrap: wrap; gap: 5px; }
.apps-categories button { border: 1px solid transparent; border-radius: 6px; padding: 6px 10px; background: none; color: var(--text-secondary); font-size: 13px; }
.apps-categories button.active { border-color: var(--apps-border); background: var(--surface-active); color: var(--text-primary); }
.apps-feature { display: grid; grid-template-columns: 1.1fr 1fr; overflow: hidden; min-height: 252px; border: 1px solid rgba(var(--primary-rgb), 0.25); border-radius: 12px; background: linear-gradient(115deg, var(--apps-tint), rgba(var(--blue-rgb), 0.1)); margin-bottom: 29px; }
.feature-copy { padding: 28px 31px; z-index: 1; }
.eyebrow { color: var(--text-secondary); font-size: 10px; letter-spacing: 1.4px; font-weight: 500; }
.feature-copy h2 { font-size: 29px; font-weight: 500; letter-spacing: -.6px; margin-top: 14px; overflow-wrap: anywhere; }
.feature-copy p { margin: 12px 0 20px; max-width: 390px; font-size: 14px; line-height: 1.4; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.feature-copy button { background: none; border: 0; color: var(--text-primary); padding: 0; display: flex; align-items: center; gap: 15px; font-size: 14px; }
.feature-art { position: relative; display: grid; place-items: center; padding: 30px; isolation: isolate; }
.feature-orbit { position: absolute; width: 330px; height: 250px; border: 1px solid rgba(var(--primary-rgb), 0.22); border-radius: 50%; transform: rotate(-20deg); z-index: -1; }
.feature-sheet { width: 235px; max-width: 100%; padding: 19px 21px; background: var(--color-popup); color: var(--text-primary); border: 1px solid rgba(var(--primary-rgb), 0.18); border-radius: 10px; box-shadow: var(--shadow-lg); transform: rotate(6deg); }
.feature-sheet > .eyebrow { font-size: 8px; }
.feature-sheet > strong { display: block; font-size: 22px; line-height: 1.1; font-weight: 500; overflow-wrap: anywhere; margin-top: 10px; }
.feature-logo { margin-top: 15px; }
.feature-lines { display: flex; flex-direction: column; gap: 5px; margin: 14px 0; }
.feature-lines i { height: 4px; background: var(--surface-active); width: 95%; border-radius: 2px; }
.feature-lines i:last-child { width: 65%; }
.feature-chip { font-size: 10px; color: var(--text-secondary); border-top: 1px solid var(--apps-border); padding-top: 8px; display: block; }
.feature-float { position: absolute; bottom: 24px; left: 12%; display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: var(--color-popup); border: 1px solid var(--apps-border); color: var(--text-primary); font-size: 11px; border-radius: 7px; transform: rotate(-5deg); box-shadow: var(--shadow-md); }
.feature-float :deep(svg) { width: 15px; height: 15px; }
.apps-section-label { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.apps-section-label h2 { font-size: 20px; letter-spacing: -.3px; }
.apps-section-label > span { color: var(--text-tertiary); font-size: 12px; }
.apps-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.apps-card { position: relative; min-width: 0; padding: 20px 20px 0; border: 1px solid var(--apps-border); border-radius: 10px; background: var(--color-darker-0); transition: transform 150ms, border-color 150ms; }
.apps-card:hover { transform: translateY(-2px); border-color: var(--text-tertiary); }
.card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 17px; }
.app-logo { display: grid; place-items: center; width: 43px; height: 43px; flex: none; border-radius: 11px; border: 1px solid rgba(var(--primary-rgb), 0.18); background: var(--apps-tint); }
.app-logo :deep(svg) { width: 24px; height: 24px; }
.card-status, .card-type { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }
.card-status :deep(svg) { width: 13px; height: 13px; }
.apps-card h3 { font-size: 20px; letter-spacing: -.3px; }
.card-title { padding: 0; background: none; border: 0; color: var(--text-primary); text-align: left; font-weight: 600 !important; }
.card-title::after { content: ''; position: absolute; inset: 0; border-radius: 10px; }
.apps-card p { font-size: 13px; line-height: 1.4; min-height: 37px; color: var(--text-secondary); margin: 8px 0 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-bottom { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; padding: 11px 0; border-top: 1px solid var(--apps-border); font-size: 11px; color: var(--text-tertiary); }
.card-bottom :deep(svg) { width: 16px; height: 16px; }
.apps-primary, .apps-secondary, .apps-small { border: 1px solid var(--apps-border); border-radius: 8px; padding: 11px 16px; display: inline-flex; justify-content: center; align-items: center; gap: 8px; background: var(--color-darker-0); color: var(--text-primary); font-size: 14px !important; }
.apps-primary { background: var(--fill-accent); color: var(--on-fill-accent); border-color: var(--fill-accent); font-weight: 600 !important; }
.apps-primary:hover:not(:disabled) { filter: brightness(1.08); }
.apps-back { background: none; border: 0; padding: 0; margin: 0 0 27px; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 8px; font-size: 14px !important; }
.apps-detail-hero { display: flex; align-items: center; gap: 21px; margin-bottom: 33px; }
.app-logo.large { width: 78px; height: 78px; border-radius: 18px; }
.app-logo.large :deep(svg) { width: 43px; height: 43px; }
.detail-identity { flex: 1; min-width: 0; }
.detail-identity h1 { font-size: clamp(27px, 3.4cqi, 37px); letter-spacing: -.8px; margin: 7px 0; overflow-wrap: anywhere; }
.detail-identity p { margin: 0; font-size: 14px; line-height: 1.4; color: var(--text-secondary); max-width: 550px; }
.hero-action { display: flex; flex-direction: column; gap: 8px; align-items: center; flex: none; }
.hero-action > span { font-size: 12px; color: var(--text-tertiary); }
.apps-detail-columns { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 28px; align-items: start; }
.apps-preview { padding: 25px; border-radius: 10px; background: var(--apps-tint); border: 1px solid rgba(var(--primary-rgb), 0.2); }
.apps-preview h2 { font-size: 26px; font-weight: 500; letter-spacing: -.5px; margin-top: 9px; }
.preview-flow { display: flex; align-items: center; gap: 13px; margin-top: 25px; }
.preview-flow > span { flex: 1; font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; flex-direction: column; gap: 9px; text-align: center; }
.preview-flow :deep(svg) { width: 38px; height: 38px; padding: 8px; border: 1px solid var(--apps-border); border-radius: 9px; background: var(--color-darker-0); color: var(--text-primary); }
.preview-flow > i { height: 1px; width: 28px; background: var(--apps-border); align-self: flex-start; margin-top: 19px; }
.contents-heading { margin-top: 27px; }
.apps-contents { border: 1px solid var(--apps-border); border-radius: 10px; overflow: hidden; background: var(--color-darker-0); }
.asset-group + .asset-group { border-top: 1px solid var(--apps-border); }
.asset-group summary { display: flex; align-items: center; gap: 13px; padding: 16px 19px; min-height: 75px; list-style: none; cursor: pointer; }
.asset-group summary::-webkit-details-marker, .apps-access summary::-webkit-details-marker { display: none; }
.asset-group summary:hover { background: var(--surface-hover); }
.asset-type { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; border: 1px solid var(--apps-border); background: var(--apps-tint); }
.asset-type :deep(svg) { width: 18px; height: 18px; }
.asset-heading { flex: 1; min-width: 0; }
.asset-heading strong { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 500; }
.asset-heading strong span { font-size: 11px; border: 1px solid var(--apps-border); background: var(--surface-active); border-radius: 4px; padding: 0 5px; color: var(--text-secondary); }
.asset-heading small { display: block; font-size: 12px; color: var(--text-secondary); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-group .expand { width: 16px; height: 16px; color: var(--text-secondary); }
.asset-group[open] .expand { transform: rotate(45deg); }
.asset-group[open] .asset-heading small { display: none; }
.asset-items { padding: 0 19px 12px 31px; }
.asset-items > p { color: var(--text-secondary); font-size: 13px; }
.asset-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
.asset-item > div { flex: 1; min-width: 0; }
.asset-item strong { font-weight: 500; font-size: 14px; overflow-wrap: anywhere; }
.asset-item p { margin: 3px 0 0; color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.asset-dot { width: 5px; height: 5px; flex: none; border-radius: 50%; background: var(--text-tertiary); }
.apps-setup { padding: 22px; background: var(--color-darker-0); border: 1px solid var(--apps-border); border-radius: 10px; }
.apps-setup h2 { display: flex; align-items: center; gap: 9px; font-size: 19px; }
.apps-setup > p { font-size: 14px; line-height: 1.4; color: var(--text-secondary); margin: 12px 0 26px; }
.apps-setup .eyebrow { font-size: 9px; }
.app-connection { display: flex; align-items: center; gap: 9px; padding: 14px 0; border-bottom: 1px solid var(--apps-border); }
.connection-logo { width: 30px; height: 32px; border-radius: 7px; display: grid; place-items: center; border: 1px solid var(--apps-border); background: var(--surface-hover); flex: none; }
.connection-logo :deep(svg) { width: 17px; height: 17px; }
.app-connection > div { flex: 1; min-width: 0; }
.app-connection strong { font-size: 14px; font-weight: 500; }
.app-connection small { color: var(--text-secondary); display: block; font-size: 11px; overflow-wrap: anywhere; }
.connection-check { color: var(--text-primary); }
.apps-small { padding: 5px 8px; font-size: 12px !important; border-radius: 6px; }
.apps-setup .connection-note { font-size: 11px; margin: 12px 0 20px; }
.apps-setup .setup-note { display: flex; align-items: center; gap: 7px; padding-top: 17px; border-top: 1px solid var(--apps-border); font-size: 11px; margin-bottom: 0; }
.setup-note :deep(svg) { width: 14px; height: 14px; }
.apps-access { margin-top: 18px; }
.apps-access summary { display: flex; align-items: center; gap: 7px; font-size: 12px; list-style: none; color: var(--text-secondary); cursor: pointer; }
.apps-access summary :deep(svg) { width: 14px; height: 14px; }
.apps-access summary :deep(svg:last-child) { margin-left: auto; }
.apps-access p { color: var(--text-secondary); font-size: 12px; margin: 10px 0; }
.apps-package { display: grid; grid-template-columns: 1fr auto; gap: 9px; border-top: 1px solid var(--apps-border); margin-top: 20px; padding-top: 17px; font-size: 12px; }
.apps-package dt { color: var(--text-secondary); }
.apps-package dd { margin: 0; color: var(--text-primary); overflow-wrap: anywhere; text-align: right; }
.apps-empty { text-align: center; color: var(--text-secondary); padding: 45px 15px; }
.apps-empty-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.apps-empty h2 { margin: 15px 0 8px; font-size: 24px; }
.apps-notice { padding: 12px 16px; border: 1px solid var(--apps-border); background: var(--apps-tint); border-radius: 8px; color: var(--text-primary); font-size: 14px; }
.apps-notice.error { border-color: var(--color-red); }
.apps-notice button, .apps-link { background: none; border: 0; text-decoration: underline; color: var(--text-primary); font-size: 12px; padding: 0; }
.detail-message { color: var(--text-secondary); font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@container (max-width: 850px) { .apps-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .apps-detail-columns { grid-template-columns: minmax(0, 1fr) 245px; gap: 20px; } .apps-setup { padding: 18px; } .feature-copy { padding: 25px; } .feature-copy h2 { font-size: 25px; } .feature-sheet { width: 210px; } .apps-heading h1 { font-size: 30px; } .app-logo.large { width: 62px; height: 62px; } .apps-detail-hero { flex-wrap: wrap; } .hero-action { margin-left: auto; } }
@container (max-width: 620px) { .apps-heading { flex-direction: column; align-items: stretch; gap: 20px; } .apps-search { width: 100%; } .apps-heading h1 { font-size: 33px; } .apps-nav { flex-wrap: wrap; gap: 3px; } .apps-nav-actions { gap: 15px; } .apps-toolbar > span { display: none; } .apps-feature { grid-template-columns: 1.25fr .8fr; } .feature-art { padding: 20px 0; } .feature-sheet { margin-right: -60px; width: 190px; max-width: none; } .feature-float { display: none; } .feature-copy h2 { font-size: 25px; } .feature-copy .eyebrow { font-size: 8px; } .apps-section-label > span { display: none; } .apps-detail-columns { grid-template-columns: 1fr; } .apps-detail-hero { gap: 15px; } .hero-action { width: 100%; flex-direction: row; justify-content: space-between; } .detail-identity h1 { font-size: 30px; } .apps-card { padding: 16px 15px 0; } .card-type { display: none; } .apps-card h3 { font-size: 18px; } .apps-card p { font-size: 12px; min-height: 34px; } .card-bottom { font-size: 10px; } }
@container (max-width: 360px) { .apps-grid { grid-template-columns: 1fr; } .apps-feature { grid-template-columns: 1fr; } .feature-art { display: none; } .apps-nav nav { gap: 16px; } .apps-preview { padding: 18px; } .preview-flow { gap: 5px; } .preview-flow > i { width: 15px; } .preview-flow > span { font-size: 10px; } }
@media (prefers-reduced-motion: reduce) { .apps-card { transition: none; } }
</style>
