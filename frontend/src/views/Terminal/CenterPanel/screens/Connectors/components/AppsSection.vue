<!-- The Plugins page, shared by Studio (Connectors) and Focused (FocusedConnectors).

     Four tabs, one detail pane:
       Installed        one card per thing you connected (services/appCards):
                        plugins that share a sign-in are one card
       Browse           every plugin on the Market
       Accounts & keys  every sign-in and the plugins it turns on
       Built by me      what you made in the Forge or Pack Studio

     The page owns browsing, the install consent flow and plugin lifecycle
     (update, pin, uninstall). Signing in stays with each shell's existing flow:
     this component only emits connect / reconnect / disconnect with the card
     or connection, and the host decides how. -->
<template>
  <div ref="root" class="apps-studio">
    <SimpleModal ref="modal" />
    <header class="ap-head">
      <div class="ap-head-copy">
        <h1>Plugins</h1>
        <p>A plugin can add tools, triggers, agents, workflows, skills and widgets. Sign in to a service once, and every plugin that uses it is ready.</p>
      </div>
      <div ref="buildMenuRoot" class="ap-head-actions">
        <button type="button" class="ap-btn primary" data-action="build" aria-haspopup="menu" :aria-expanded="String(buildMenuOpen)" @click="buildMenuOpen = !buildMenuOpen">
          <AppsIcon name="plus" /> Build a plugin
        </button>
        <div v-if="buildMenuOpen" class="ap-menu" role="menu" @keydown.esc="buildMenuOpen = false">
          <button type="button" role="menuitem" data-forge="builder" @click="openForge('builder')">
            <span class="ap-inside-icon"><AppsIcon name="tool" /></span>
            <span><strong>Describe it to the Forge</strong><small>AGNT writes the tool code and its sign-in setup</small></span>
          </button>
          <button type="button" role="menuitem" data-forge="pack-studio" @click="openForge('pack-studio')">
            <span class="ap-inside-icon"><AppsIcon name="pack" /></span>
            <span><strong>Pack items from your library</strong><small>Agents, workflows, skills, widgets and tools you made</small></span>
          </button>
        </div>
      </div>
    </header>

    <nav class="ap-tabs" role="tablist" aria-label="Plugins">
      <button v-for="entry in tabs" :key="entry.id" type="button" role="tab" class="ap-tab" :data-tab="entry.id" :aria-selected="String(tab === entry.id)" @click="switchTab(entry.id)">
        {{ entry.label }} <span class="ap-count">{{ entry.count }}</span>
        <span v-if="entry.id === 'installed' && needsYouCount" class="ap-count warn" data-testid="needs-you-count" v-tooltip="`${needsYouCount} need you`">{{ needsYouCount }}</span>
      </button>
    </nav>

    <p v-if="error" class="ap-notice error" role="alert">{{ error }} <button type="button" class="ap-link" @click="reload">Retry</button></p>
    <p v-if="notice" class="ap-notice" role="status">{{ notice }}</p>

    <div class="ap-layout" :class="{ 'has-detail': hasDetail }">
      <!-- plugins.catalog: the "Give Annie hands" mission (services/journey/missions.js) points here. -->
      <section class="ap-main" data-tour-id="plugins.catalog" :aria-label="tabLabel">
        <!-- ── Installed ─────────────────────────────────────── -->
        <template v-if="tab === 'installed'">
          <div class="ap-toolbar">
            <label class="ap-search"><AppsIcon name="search" /><input v-model="queries.installed" type="search" placeholder="Search plugins and what’s inside" aria-label="Search installed plugins" /></label>
            <div class="ap-chips" role="group" aria-label="Show">
              <button v-for="option in INSTALLED_FILTERS" :key="option.id" type="button" class="ap-chip" :data-filter="option.id" :aria-pressed="String(filters.installed === option.id)" @click="filters.installed = option.id">{{ option.label }}</button>
            </div>
          </div>
          <div v-if="firstReview" class="ap-banner" role="status">
            <AppsIcon name="shield" />
            <p><b>{{ firstReview.displayName }} has an update that asks for new access.</b> <span>{{ firstReview.added }} Nothing was installed.</span></p>
            <button type="button" class="ap-btn small" data-action="open-review" @click="openPlugin(firstReview.name)">Review update</button>
          </div>
          <p v-if="loading && !yourCards.length" class="ap-empty" role="status">Loading plugins…</p>
          <div v-else-if="!yourCards.length" class="ap-empty">
            <h2>No plugins installed yet</h2>
            <p>Browse the Market to add your first capability.</p>
            <div class="ap-empty-actions"><button type="button" class="ap-btn primary" data-action="browse" @click="switchTab('browse')">Browse {{ marketRows.length }} plugins</button></div>
          </div>
          <div v-else-if="!visibleCards.length" class="ap-empty">
            <h2>No matching plugins</h2>
            <p>Try another word or filter.</p>
            <div class="ap-empty-actions"><button type="button" class="ap-btn" data-action="clear" @click="clearFilters('installed')">Clear filters</button></div>
          </div>
          <template v-else>
            <template v-for="section in installedView" :key="section.id">
              <h3 class="ap-group-label" :data-section="section.id">{{ section.label }} <span>{{ section.cards.length }}</span></h3>
              <div class="ap-list">
                <InstalledCardRow
                  v-for="card in section.cards" :key="card.id"
                  :card="card" :rows="rowsByName" :notices="notices" :selected-key="selectedKey"
                  @open-card="openAccount(card.providerId || card.id)"
                  @open-plugin="openPlugin"
                  @connect="(c) => emit('connect', c)"
                  @reconnect="(c) => emit('reconnect', c)"
                  @open-ai-models="emit('open-ai-models')"
                />
              </div>
            </template>
          </template>
          <p class="ap-footnote">
            Also in Plugins:
            <button type="button" class="ap-link" data-section-link="mcp-servers" @click="emit('open-section', 'mcp-servers')">MCP servers</button>
            <button type="button" class="ap-link" data-section-link="webhooks" @click="emit('open-section', 'webhooks')">Webhooks</button>
            <button type="button" class="ap-link" data-section-link="email-server" @click="emit('open-section', 'email-server')">Email inbox</button>
          </p>
        </template>

        <!-- ── Browse ────────────────────────────────────────── -->
        <template v-else-if="tab === 'browse'">
          <div class="ap-toolbar">
            <label class="ap-search"><AppsIcon name="search" /><input v-model="queries.browse" type="search" placeholder="Search the Market" aria-label="Search the Market" /></label>
          </div>
          <div v-if="browseCategories.length > 1" class="ap-chips ap-toolbar" role="group" aria-label="Category">
            <button type="button" class="ap-chip" data-filter="all" :aria-pressed="String(filters.browse === 'all')" @click="filters.browse = 'all'">All</button>
            <button v-for="category in browseCategories" :key="category" type="button" class="ap-chip" :data-filter="category" :aria-pressed="String(filters.browse === category)" @click="filters.browse = category">{{ category }}</button>
          </div>
          <p v-if="loading && !marketRows.length" class="ap-empty" role="status">Loading the Market…</p>
          <div v-else-if="!visibleMarket.length" class="ap-empty">
            <h2>{{ queries.browse || filters.browse !== 'all' ? 'Nothing on the Market matches' : 'The Market is empty right now' }}</h2>
            <p>Describe what you need and the Forge can build it.</p>
            <div class="ap-empty-actions">
              <button v-if="queries.browse || filters.browse !== 'all'" type="button" class="ap-btn" data-action="clear" @click="clearFilters('browse')">Clear filters</button>
              <button type="button" class="ap-btn primary" data-action="forge" @click="openForge('builder')">Build it in the Forge</button>
            </div>
          </div>
          <div v-else class="ap-list">
            <div v-for="row in visibleMarket" :key="row.name" class="ap-row" :class="{ selected: selectedKey === row.name }" :data-listing="row.name">
              <span class="ap-logo"><SvgIcon :name="row.icon || 'puzzle-piece'" /></span>
              <div class="ap-row-body">
                <div class="ap-row-title">
                  <button type="button" class="ap-row-open" @click="openPlugin(row.name)">{{ row.displayName }}</button>
                  <span v-if="row.isPack" class="ap-badge pack">Capability pack</span>
                  <span v-if="tierOf(row)" class="ap-badge" :class="tierOf(row).id" v-tooltip="tierOf(row).detail">{{ tierOf(row).label }}</span>
                </div>
                <p class="ap-row-desc">{{ row.description || 'No description yet.' }}</p>
                <div class="ap-row-meta">
                  <span v-for="part in compositionFor(row)" :key="part.key" class="ap-meta-item"><AppsIcon :name="part.icon" />{{ part.label }}</span>
                  <span v-if="row.authorName" class="ap-meta-item">by {{ row.authorName }}</span>
                  <span v-if="!row.installed && readyWith(row)" class="ap-meta-item ok"><AppsIcon name="check" />Ready with your {{ readyWith(row) }} sign-in</span>
                </div>
              </div>
              <div class="ap-row-side">
                <span class="ap-price">{{ priceLabel(row) || 'Free' }}</span>
                <span v-if="row.installed" class="ap-installed"><AppsIcon name="check" />Installed</span>
                <button v-else type="button" class="ap-btn small" :class="{ primary: !priceLabel(row) }" data-action="install" :disabled="!!installing" @click="install(row)">
                  {{ installing === row.name ? 'Checking…' : priceLabel(row) ? `Get · ${priceLabel(row)}` : 'Install' }}
                </button>
              </div>
            </div>
          </div>
          <p class="ap-footnote">Agents, workflows and widgets have their own shelves. <button type="button" class="ap-link" data-testid="open-marketplace" @click="emit('open-market')">Open the full Marketplace</button></p>
        </template>

        <!-- ── Accounts & keys ───────────────────────────────── -->
        <template v-else-if="tab === 'accounts'">
          <div class="ap-toolbar">
            <label class="ap-search"><AppsIcon name="search" /><input v-model="queries.accounts" type="search" placeholder="Search sign-ins and keys" aria-label="Search sign-ins and keys" /></label>
            <div class="ap-chips" role="group" aria-label="Kind">
              <button v-for="option in ACCOUNT_FILTERS" :key="option.id" type="button" class="ap-chip" :data-filter="option.id" :aria-pressed="String(filters.accounts === option.id)" @click="filters.accounts = option.id">{{ option.label }}</button>
            </div>
            <span class="ap-grow"></span>
            <button type="button" class="ap-btn small" data-action="check-health" :disabled="checkingHealth" @click="checkHealth"><AppsIcon name="refresh" />{{ checkingHealth ? 'Checking…' : 'Check status' }}</button>
          </div>
          <template v-for="section in accountsView" :key="section.id">
            <h3 class="ap-group-label" :data-section="section.id">{{ section.label }} <span>{{ section.rows.length }}</span></h3>
            <div class="ap-list">
              <div v-for="account in section.rows" :key="account.id" class="ap-row" :class="{ selected: selectedKey === account.id }" :data-account="account.id">
                <span class="ap-logo"><SvgIcon :name="account.icon || 'connect'" /></span>
                <div class="ap-row-body">
                  <div class="ap-row-title">
                    <button type="button" class="ap-row-open" @click="openAccount(account.id)">{{ account.name }}</button>
                    <span class="ap-badge">{{ account.kind }}</span>
                  </div>
                  <div v-if="account.apps.length" class="ap-plugin-strip">
                    <button v-for="app in account.apps" :key="app.name" type="button" class="ap-plugin-chip" :data-plugin="app.name" @click="openPlugin(app.name)">
                      <span class="ap-logo"><SvgIcon :name="app.icon || account.icon || 'puzzle-piece'" /></span>{{ app.displayName }}
                    </button>
                  </div>
                  <p v-else class="ap-row-desc">No plugin uses it yet.</p>
                </div>
                <div class="ap-row-side">
                  <span class="ap-status" :class="accountTone(account.status)">{{ accountStatus(account.status) }}</span>
                  <button v-if="account.status === 'reconnect'" type="button" class="ap-btn primary small" data-action="reconnect" @click="emit('reconnect', account.card)">Reconnect</button>
                  <button v-else-if="account.status === 'connect'" type="button" class="ap-btn primary small" data-action="connect" @click="emit('connect', account.card)">Connect</button>
                </div>
              </div>
            </div>
          </template>
          <p v-if="!accountsView.length" class="ap-empty">{{ queries.accounts || filters.accounts !== 'all' ? 'No sign-in or key matches.' : 'Nothing connected yet. Connect a service below, or install a plugin and connect what it needs.' }}</p>

          <div class="ap-section-title"><h2>Connect another service</h2><span>{{ discover.length }} services AGNT can sign in to</span></div>
          <div v-if="discover.length" class="ap-list">
            <div v-for="service in shownDiscover" :key="service.id" class="ap-row" :data-service="service.providerId">
              <span class="ap-logo"><SvgIcon :name="service.icon || 'connect'" /></span>
              <div class="ap-row-body">
                <div class="ap-row-title"><strong>{{ service.name }}</strong><span class="ap-badge">{{ connectionKind(service.connectionType) }}</span></div>
                <p v-if="service.suggested.length" class="ap-row-desc">Plugins for it: {{ service.suggested.map((s) => s.displayName).join(', ') }}</p>
              </div>
              <div class="ap-row-side"><button type="button" class="ap-btn small" data-action="connect" @click="emit('connect', service)">Connect</button></div>
            </div>
          </div>
          <button v-if="discover.length > shownDiscover.length" type="button" class="ap-btn quiet small" data-action="show-all-services" @click="showAllServices = true">Show all {{ discover.length }}</button>
          <p class="ap-footnote">
            AI model keys live in <button type="button" class="ap-link" data-action="ai-models" @click="emit('open-ai-models')">Settings › AI Models</button>
            <button type="button" class="ap-link" data-action="integrations" @click="emit('open-integrations')">Edit integrations</button>
            <button type="button" class="ap-link" data-action="add-integration" @click="emit('add-account')">Add a custom integration</button>
          </p>
        </template>

        <!-- ── Built by me ───────────────────────────────────── -->
        <template v-else>
          <div class="ap-toolbar">
            <p class="ap-grow ap-hint">Plugins you made in the Forge or packed from your library. Publish one to share it on the Market.</p>
            <button type="button" class="ap-btn small" data-forge="builder" @click="openForge('builder')">Describe it to the Forge</button>
            <button type="button" class="ap-btn small" data-forge="pack-studio" @click="openForge('pack-studio')">Pack from your library</button>
          </div>
          <div v-if="forgeDraft || mine.length" class="ap-list">
            <div v-if="forgeDraft" class="ap-row" data-draft="forge">
              <span class="ap-logo"><AppsIcon name="tool" /></span>
              <div class="ap-row-body">
                <div class="ap-row-title"><button type="button" class="ap-row-open" @click="openForge('builder')">{{ forgeDraft.title }}</button></div>
                <p v-if="forgeDraft.description" class="ap-row-desc">{{ forgeDraft.description }}</p>
                <div class="ap-row-meta"><span class="ap-meta-item">{{ forgeDraft.detail }}</span></div>
              </div>
              <div class="ap-row-side">
                <span class="ap-status warn">Unfinished in the Forge</span>
                <button type="button" class="ap-btn primary small" data-forge="builder" @click="openForge('builder')">Continue in the Forge</button>
              </div>
            </div>
            <div v-for="entry in mine" :key="entry.row.name" class="ap-row" :class="{ selected: selectedKey === entry.row.name }" :data-app="entry.row.name">
              <span class="ap-logo"><SvgIcon :name="entry.row.icon || 'puzzle-piece'" /></span>
              <div class="ap-row-body">
                <div class="ap-row-title">
                  <button type="button" class="ap-row-open" @click="openPlugin(entry.row.name)">{{ entry.row.displayName }}</button>
                  <span v-if="entry.row.isPack" class="ap-badge pack">Capability pack</span>
                </div>
                <p v-if="entry.row.description" class="ap-row-desc">{{ entry.row.description }}</p>
                <div class="ap-row-meta"><span v-for="part in compositionFor(entry.row)" :key="part.key" class="ap-meta-item"><AppsIcon :name="part.icon" />{{ part.label }}</span><span v-if="entry.row.version" class="ap-meta-item">v{{ entry.row.version }}</span></div>
              </div>
              <div class="ap-row-side">
                <span class="ap-status" :class="entry.listing ? 'ok' : ''">{{ entry.listing ? `Published · v${entry.listing.current_version} is live` : 'Only on this computer' }}</span>
                <button type="button" class="ap-btn small" data-forge="mine" @click="openForge('mine')">{{ entry.listing ? 'Publish an update' : 'Publish' }}</button>
              </div>
            </div>
          </div>
          <div v-else class="ap-empty">
            <h2>Nothing built yet</h2>
            <p>Describe a plugin and AGNT writes it, or pack agents, workflows and skills you already made.</p>
          </div>
        </template>
      </section>

      <aside v-if="hasDetail" class="ap-detail" aria-label="Details">
        <button type="button" class="ap-btn quiet small ap-back" data-action="back" @click="closeDetail"><AppsIcon name="back" /> {{ tabLabel }}</button>
        <PluginDetail
          v-if="selected" ref="detailView" :key="selected.name"
          :plugin="selected" :assets="assets" :assets-loading="assetsLoading" :assets-error="assetsError"
          :connections="connections" :card="selectedCard" :notice="selectedNotice" :agents="selectedAgents"
          :model-provider-ids="modelProviderIds" :installing="installing === selected.name" :install-busy="!!installing"
          :busy="busy && busy.name === selected.name ? busy.action : null" :installed-widget-ids="installedWidgetIds"
          @install="install(selected)" @connect="(c) => emit('connect', c)" @reconnect="(c) => emit('reconnect', c)"
          @open-app="emit('open-app', selected.name)" @open-widget="(id) => emit('open-widget', id)" @retry-assets="loadAssets(selected)"
          @review-update="reviewUpdate(selected)" @keep-version="keepVersion(selected)" @set-policy="(policy) => setPolicy(selected, policy)"
          @uninstall="uninstall(selected)" @open-account="openAccount" @open-ai-models="emit('open-ai-models')"
        />
        <AccountDetail
          v-else-if="selectedAccountCard" ref="detailView" :key="selectedAccountCard.id"
          :card="selectedAccountCard" :rows="rowsByName" :notices="notices" :install-busy="!!installing" :installing-name="installing"
          @connect="(c) => emit('connect', c)" @reconnect="(c) => emit('reconnect', c)" @disconnect="(c) => emit('disconnect', c)"
          @open-plugin="openPlugin" @install="(name) => install(rowsByName.get(name))"
        />
        <div v-else class="ap-detail-empty" role="status">
          <h2>{{ loading ? 'Loading plugin…' : 'This plugin isn’t available' }}</h2>
          <p v-if="!loading">It may no longer be in the catalog. Your other plugins are still here.</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import AppsIcon from './AppsIcon.vue';
import InstalledCardRow from './apps/InstalledCardRow.vue';
import PluginDetail from './apps/PluginDetail.vue';
import AccountDetail from './apps/AccountDetail.vue';
import './apps/apps-ui.css';
import { useAppCards } from '@/composables/useAppCards.js';
import { findAppCard, appDisplayName } from '@/services/appCards.js';
import { studioCatalog, pluginConnections, installDisclosure, escapeDisclosure } from '@/services/studioApps.js';
import {
  pluginInventory, compositionOf, trustTier, matchesQuery, reviewNotices, cardNeedsYou, installedSections, accountRows,
  connectionKind, builtByMe, priceLabel, signInReadiness, agentAccess, hasTriggers, isPack, capabilityLabel,
} from '@/services/pluginDirectory.js';
import { inspectPlugin, fetchPluginAssets, fetchUpdateStatus, requestUpdate, setUpdatePolicy, uninstallPlugin } from '@/services/pluginLifecycle.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';

// selectedPlugin: undefined keeps the selection local; a host that routes it passes a name or null.
// vaultActive: the host's route says the Accounts & keys tab is open (Studio ?section=oauth, Focused tab=vault).
const props = defineProps({ selectedPlugin: { type: String, default: undefined }, vaultActive: Boolean });
const emit = defineEmits([
  'connect', 'reconnect', 'disconnect', 'open-app', 'open-widget', 'build-app', 'add-account', 'open-vault', 'open-plugins',
  'select-app', 'close-app', 'open-market', 'open-integrations', 'open-ai-models', 'open-section',
]);

const INSTALLED_FILTERS = [
  { id: 'all', label: 'All' }, { id: 'attention', label: 'Needs you' }, { id: 'triggers', label: 'Has triggers' }, { id: 'packs', label: 'Capability packs' },
];
const ACCOUNT_FILTERS = [{ id: 'all', label: 'All' }, { id: 'oauth', label: 'Sign-ins' }, { id: 'apikey', label: 'API keys' }];
const DISCOVER_SHOWN = 12;
const TAB_LABELS = { installed: 'Installed', browse: 'Browse', accounts: 'Accounts & keys', mine: 'Built by me' };

const store = useStore();
const root = ref(null);
const modal = ref(null);
const detailView = ref(null);
const buildMenuRoot = ref(null);
const buildMenuOpen = ref(false);
const tab = ref('installed');
const queries = reactive({ installed: '', browse: '', accounts: '' });
const filters = reactive({ installed: 'all', browse: 'all', accounts: 'all' });
const showAllServices = ref(false);
const selectedName = ref(null);
const selectedAccountId = ref(null);
const installing = ref(null);
const busy = ref(null);
const loading = ref(false);
const checkingHealth = ref(false);
const error = ref('');
const notice = ref('');
const assets = ref([]);
const assetsLoading = ref(false);
const assetsError = ref('');
const updateStatus = ref(null);
// Reviews resolved here (updated or pinned) stay resolved until the next background pass rewrites the status.
const resolvedReviews = ref(new Set());
let assetsRequest = 0;
let alive = true;

// ── Data ──────────────────────────────────────────────────────────────
const { cards } = useAppCards('', { autoload: false });
const yourCards = computed(() => cards.value.yours);
const catalog = computed(() => studioCatalog(store.getters['apps/installed'], store.getters['apps/available']));
const rowsByName = computed(() => new Map(catalog.value.map((row) => [row.name, row])));
const installedRows = computed(() => catalog.value.filter((row) => row.installed));
const marketRows = computed(() => catalog.value.filter((row) => row.onMarket));
const modelProviderIds = AI_PROVIDERS_WITH_API.map((id) => String(id).toLowerCase());
const connectedApps = computed(() => store.getters['appAuth/connectedApps'] || []);
const providerNames = computed(() => new Map((store.state.appAuth?.allProviders || []).map((p) => [String(p.id).toLowerCase(), p.name || p.id])));
const installedWidgetIds = computed(() => new Set((store.getters['widgetDefinitions/allDefinitions'] || []).map((widget) => widget.id)));

const notices = computed(() => reviewNotices(
  updateStatus.value,
  installedRows.value.filter((row) => row.updatePolicy !== 'pinned' && !resolvedReviews.value.has(row.name)).map((row) => row.name),
));
const needsYouCount = computed(() => yourCards.value.filter((card) => cardNeedsYou(card, notices.value)).length);
const firstReview = computed(() => {
  const row = installedRows.value.find((candidate) => notices.value.has(candidate.name));
  if (!row) return null;
  const added = notices.value.get(row.name).added.map((cap) => capabilityLabel(cap).toLowerCase());
  return { name: row.name, displayName: row.displayName, added: added.length ? `It wants to: ${added.join(', ')}.` : 'It asks for more access than the version you have.' };
});

const cardRows = (card) => card.apps.map((app) => rowsByName.value.get(app.name)).filter(Boolean);
function cardMatches(card) {
  const rows = cardRows(card);
  if (filters.installed === 'attention' && !cardNeedsYou(card, notices.value)) return false;
  if (filters.installed === 'triggers' && !rows.some(hasTriggers)) return false;
  if (filters.installed === 'packs' && !rows.some(isPack)) return false;
  if (!queries.installed.trim()) return true;
  return matchesQuery({ name: card.name, displayName: card.providerId || '', description: card.description }, queries.installed)
    || rows.some((row) => matchesQuery(row, queries.installed));
}
const visibleCards = computed(() => yourCards.value.filter(cardMatches));
const installedView = computed(() => {
  const { needsYou, ready } = installedSections(visibleCards.value, notices.value);
  return [
    { id: 'needs-you', label: 'Needs you', cards: needsYou },
    { id: 'ready', label: 'Ready', cards: ready },
  ].filter((section) => section.cards.length);
});

const browseCategories = computed(() => [...new Set(marketRows.value.map((row) => row.category).filter(Boolean))].sort());
const visibleMarket = computed(() => marketRows.value.filter((row) => (filters.browse === 'all' || row.category === filters.browse) && matchesQuery(row, queries.browse)));
const compositionFor = (row) => compositionOf(pluginInventory(row));
const tierOf = (row) => trustTier(row);
function readyWith(row) {
  const { ready, providers } = signInReadiness(row, connectedApps.value, modelProviderIds);
  return ready ? providers.map((id) => providerNames.value.get(id) || appDisplayName({ name: id })).join(' and ') : '';
}

const accounts = computed(() => accountRows(yourCards.value).filter((account) =>
  (filters.accounts === 'all' || account.connectionType === filters.accounts)
  && matchesQuery({ name: account.name, description: account.apps.map((app) => app.displayName).join(' ') }, queries.accounts)));
const accountsView = computed(() => [
  { id: 'needs-you', label: 'Needs you', rows: accounts.value.filter((a) => a.status !== 'ready') },
  { id: 'connected', label: 'Connected', rows: accounts.value.filter((a) => a.status === 'ready') },
].filter((section) => section.rows.length));
const discover = computed(() => cards.value.discover.filter((service) =>
  (filters.accounts === 'all' || String(service.connectionType).toLowerCase() === filters.accounts)
  && matchesQuery({ name: service.name, description: `${service.providerId} ${service.suggested.map((s) => s.displayName).join(' ')}` }, queries.accounts)));
const shownDiscover = computed(() => (showAllServices.value || queries.accounts ? discover.value : discover.value.slice(0, DISCOVER_SHOWN)));
const accountStatus = (status) => (status === 'reconnect' ? 'Sign-in stopped working' : status === 'connect' ? 'Not connected' : 'Connected');
const accountTone = (status) => (status === 'reconnect' ? 'bad' : status === 'connect' ? 'warn' : 'ok');

const builder = computed(() => store.state.pluginBuilder || {});
const mine = computed(() => builtByMe({ installed: installedRows.value, builtNames: builder.value.builtPluginNames, published: store.state.marketplace?.myPublishedItems }));
const forgeDraft = computed(() => {
  const manifest = builder.value.generatedManifest;
  if (!manifest || !store.getters['pluginBuilder/hasUninstalledWork']) return null;
  const tools = Array.isArray(manifest.tools) ? manifest.tools.length : 0;
  return {
    title: appDisplayName({ name: manifest.name || 'new-plugin', displayName: manifest.displayName }),
    description: manifest.description || '',
    detail: `${tools} ${tools === 1 ? 'tool' : 'tools'} · not installed`,
  };
});

const tabs = computed(() => [
  { id: 'installed', label: TAB_LABELS.installed, count: installedRows.value.length },
  { id: 'browse', label: TAB_LABELS.browse, count: marketRows.value.length },
  { id: 'accounts', label: TAB_LABELS.accounts, count: accountRows(yourCards.value).length },
  { id: 'mine', label: TAB_LABELS.mine, count: mine.value.length + (forgeDraft.value ? 1 : 0) },
]);
const tabLabel = computed(() => TAB_LABELS[tab.value]);

// ── Selection ─────────────────────────────────────────────────────────
const selected = computed(() => rowsByName.value.get(selectedName.value) || null);
const selectedAccountCard = computed(() => (selectedAccountId.value ? findAppCard(cards.value, selectedAccountId.value) : null));
const hasDetail = computed(() => !!selectedName.value || !!selectedAccountCard.value);
const selectedKey = computed(() => selectedName.value || selectedAccountId.value || null);
const selectedCard = computed(() => (selected.value ? yourCards.value.find((card) => card.apps.some((app) => app.name === selected.value.name)) || null : null));
const connections = computed(() => pluginConnections(selected.value, store.state.appAuth?.allProviders, connectedApps.value, store.state.appAuth?.connectionHealth?.providers));
const selectedNotice = computed(() => (selected.value ? notices.value.get(selected.value.name) || null : null));
const selectedAgents = computed(() => agentAccess(store.getters['agents/allAgents'], selected.value));

async function focusDetail() {
  await nextTick();
  detailView.value?.focus?.();
  root.value?.querySelector('.ap-detail')?.scrollIntoView?.({ block: 'nearest' });
}
function openPlugin(name) {
  if (!name) return;
  selectedAccountId.value = null;
  selectedName.value = name;
  notice.value = '';
  emit('select-app', name);
  focusDetail();
}
function openAccount(id) {
  if (!id) return;
  if (selectedName.value) {
    selectedName.value = null;
    emit('close-app');
  }
  selectedAccountId.value = id;
  focusDetail();
}
function closeDetail() {
  selectedAccountId.value = null;
  if (selectedName.value) {
    selectedName.value = null;
    emit('close-app');
  }
}
function switchTab(id) {
  if (id === tab.value && !hasDetail.value) return;
  closeDetail();
  tab.value = id;
  if (id === 'accounts' && !props.vaultActive) emit('open-vault');
  else if (id !== 'accounts' && props.vaultActive) emit('open-plugins');
  if (id === 'mine') loadPublished();
}
function clearFilters(which) {
  queries[which] = '';
  filters[which] = 'all';
}
function openForge(view) {
  buildMenuOpen.value = false;
  // The Forge screen opens on the view the shared connectors store names.
  Promise.resolve(store.dispatch('connectors/setActiveTab', view)).catch(() => {});
  emit('build-app');
}

watch(() => props.selectedPlugin, (name) => {
  if (name === undefined) return;
  selectedName.value = name;
  if (name) selectedAccountId.value = null;
}, { immediate: true });
watch(() => props.vaultActive, (active) => {
  if (active) tab.value = 'accounts';
  else if (tab.value === 'accounts') tab.value = 'installed';
}, { immediate: true });
// A deep link to a plugin you don't have yet reads best from Browse.
watch(() => selected.value?.name, () => {
  if (selected.value && !selected.value.installed && tab.value === 'installed') tab.value = 'browse';
});

// ── Loading ───────────────────────────────────────────────────────────
const quiet = (promise) => Promise.resolve(promise).catch(() => {});
async function loadUpdateStatus() {
  const status = await fetchUpdateStatus();
  if (!alive) return;
  // The status file changes only when a background pass runs. Until then an
  // update resolved here (applied or pinned) must not reappear as pending.
  if (status?.checkedAt !== updateStatus.value?.checkedAt) resolvedReviews.value = new Set();
  updateStatus.value = status;
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
      loadUpdateStatus(),
    ]);
    const loadError = store.state.apps?.error || store.state.apps?.availableError;
    if (loadError) throw new Error(loadError);
  } catch (failure) {
    error.value = failure.message || 'Unable to load plugins. Please retry.';
    console.error('[AppsSection] catalog:', failure);
  } finally {
    loading.value = false;
  }
}
function loadPublished() {
  quiet(store.dispatch('marketplace/fetchMyPublishedItems'));
}
async function checkHealth() {
  checkingHealth.value = true;
  try {
    await store.dispatch('appAuth/checkConnectionHealth');
  } catch (failure) {
    error.value = failure.message || 'Could not check connection status.';
  } finally {
    checkingHealth.value = false;
  }
}
// Re-read assets when a different plugin is selected or one gets installed, not on every refresh.
watch([() => selected.value?.name, () => selected.value?.installed], () => {
  if (selected.value) loadAssets(selected.value);
  else {
    assetsRequest++;
    assets.value = [];
    assetsError.value = '';
    assetsLoading.value = false;
  }
}, { immediate: true });
async function loadAssets(app) {
  const request = ++assetsRequest;
  assets.value = [];
  assetsError.value = '';
  assetsLoading.value = !!app.installed;
  if (!app.installed) return;
  try {
    const result = await fetchPluginAssets(app.name);
    if (request === assetsRequest && alive) assets.value = result;
  } catch (failure) {
    if (request === assetsRequest && alive) assetsError.value = failure.message;
    console.error('[AppsSection] contents:', failure);
  } finally {
    if (request === assetsRequest && alive) assetsLoading.value = false;
  }
}

// ── Install: purchase check, package inspection, consent, the one installer ──
function installSummary(app) {
  const parts = compositionOf(pluginInventory(app), { operations: true }).map((part) => part.label);
  const lines = [];
  if (parts.length) lines.push(`It adds ${escapeDisclosure(parts.join(', '))}.`);
  const { providers, ready } = signInReadiness(app, connectedApps.value, modelProviderIds);
  if (providers.length) {
    const names = escapeDisclosure(providers.map((id) => providerNames.value.get(id) || appDisplayName({ name: id })).join(' and '));
    lines.push(ready ? `It uses your ${names} sign-in, so it’s ready right away.` : `It signs in with ${names}. You’ll connect after installing.`);
  }
  return lines.join('<br><br>');
}
async function install(app) {
  if (!app || installing.value || app.installed) return;
  installing.value = app.name;
  error.value = '';
  notice.value = '';
  try {
    const itemId = app.marketplace_item_id || app.id;
    const price = priceLabel(app);
    if (price) {
      if (!itemId) throw new Error('This paid plugin has no marketplace purchase link.');
      const purchased = await store.dispatch('marketplace/checkPurchaseStatus', itemId);
      if (!purchased) {
        const confirmed = await modal.value.showModal({ title: `Get ${app.displayName}`, message: `This plugin costs ${escapeDisclosure(price)}. Continue to checkout?`, confirmText: 'Continue to checkout', showCancel: true });
        if (confirmed) await store.dispatch('marketplace/purchaseItem', { itemId });
        return;
      }
    }
    const report = await inspectPlugin(app.name);
    const message = [installSummary(app), installDisclosure(report)].filter(Boolean).join('<br><br>');
    const confirmed = await modal.value.showModal({ title: `Install ${app.displayName}?`, message, confirmText: 'Install plugin', cancelText: 'Cancel', showCancel: true, confirmClass: 'btn-primary' });
    if (!confirmed || !alive) return;
    await store.dispatch('marketplace/installPlugin', { pluginName: app.name });
    notice.value = `${app.displayName} installed.`;
    await reload();
  } catch (failure) {
    error.value = failure.message || 'Installation failed. Please retry.';
    console.error('[AppsSection] install:', failure);
  } finally {
    installing.value = null;
  }
}

// ── Lifecycle: update review, pin, uninstall ───────────────────────────
async function reviewUpdate(app) {
  if (busy.value) return;
  busy.value = { name: app.name, action: 'update' };
  error.value = '';
  try {
    // Ask without consent first so the access shown is the server's current answer.
    let result = await requestUpdate(app.name);
    if (result.requiresConsent) {
      const added = (result.permissionDiff?.added || []).map((cap) => `<b>${escapeDisclosure(capabilityLabel(cap))}</b>`);
      const confirmed = await modal.value.showModal({
        title: `${app.displayName} wants new access`,
        message: `The new version adds access the installed one does not have:<br><br>${added.join('<br>') || '<b>New permissions</b>'}<br><br>Nothing has been installed. Allow this and update?`,
        confirmText: 'Allow and update', cancelText: 'Not now', showCancel: true, confirmClass: 'btn-primary',
      });
      if (!confirmed || !alive) return;
      result = await requestUpdate(app.name, { acceptedPermissions: true });
      if (result.requiresConsent) throw new Error('The update still needs your consent. Please retry.');
    }
    resolvedReviews.value = new Set([...resolvedReviews.value, app.name]);
    notice.value = `${app.displayName} updated${result.version ? ` to v${result.version}` : ''}.`;
    await reload();
  } catch (failure) {
    error.value = failure.message;
    console.error('[AppsSection] update:', failure);
  } finally {
    busy.value = null;
  }
}
async function keepVersion(app) {
  await setPolicy(app, 'pinned');
  if (!error.value) {
    resolvedReviews.value = new Set([...resolvedReviews.value, app.name]);
    notice.value = `Staying on v${app.version}. Automatic updates are off for ${app.displayName}.`;
  }
}
async function setPolicy(app, policy) {
  if (busy.value) return;
  busy.value = { name: app.name, action: 'policy' };
  error.value = '';
  try {
    await setUpdatePolicy(app.name, policy);
    await store.dispatch('apps/fetchInstalled', { force: true });
  } catch (failure) {
    error.value = failure.message;
    console.error('[AppsSection] update policy:', failure);
  } finally {
    busy.value = null;
  }
}
async function uninstall(app) {
  if (busy.value) return;
  const signIn = selectedCard.value?.kind === 'account' ? selectedCard.value.name : '';
  const confirmed = await modal.value.showModal({
    title: `Uninstall ${app.displayName}?`,
    message: [
      'Its tools stop working for every agent and workflow that uses them.',
      'Agents, workflows and widgets it added that you edited are kept as your own.',
      signIn ? `Your ${escapeDisclosure(signIn)} sign-in stays in Accounts &amp; keys.` : '',
    ].filter(Boolean).join('<br><br>'),
    confirmText: 'Uninstall', cancelText: 'Cancel', showCancel: true, confirmClass: 'btn-danger',
  });
  if (!confirmed || !alive) return;
  busy.value = { name: app.name, action: 'uninstall' };
  error.value = '';
  try {
    await uninstallPlugin(app.name);
    notice.value = `${app.displayName} uninstalled.`;
    closeDetail();
    quiet(store.dispatch('tools/refreshAllTools'));
    await reload();
  } catch (failure) {
    error.value = failure.message;
    console.error('[AppsSection] uninstall:', failure);
  } finally {
    busy.value = null;
  }
}

// ── Mount ─────────────────────────────────────────────────────────────
function closeMenuOnOutsideClick(event) {
  if (buildMenuOpen.value && !buildMenuRoot.value?.contains(event.target)) buildMenuOpen.value = false;
}
onMounted(() => {
  document.addEventListener('mousedown', closeMenuOnOutsideClick);
  reload();
  if (!store.getters['agents/allAgents']?.length) quiet(store.dispatch('agents/fetchAgents'));
  if (!store.getters['skills/allSkills']?.length) quiet(store.dispatch('skills/fetchSkills'));
});
onBeforeUnmount(() => {
  alive = false;
  assetsRequest++;
  document.removeEventListener('mousedown', closeMenuOnOutsideClick);
});
</script>
