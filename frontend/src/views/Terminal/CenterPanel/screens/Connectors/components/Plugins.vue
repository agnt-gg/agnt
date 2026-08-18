<template>
  <div class="plugins-container">
    <!-- PRO Badge Header -->
    <div class="plugins-header">
      <h3>
        Plugin Manager
        <span v-if="!isPro" class="pro-badge-label"> <i class="fas fa-lock"></i> PRO </span>
      </h3>
      <p class="subtitle">Install and manage plugins to extend AGNT functionality</p>
    </div>

    <!-- Manual Install Section (Collapsible) - Only for PRO -->
    <div v-if="isPro" class="manual-install-section" :class="{ collapsed: isManualInstallCollapsed }">
      <div class="section-header" @click="isManualInstallCollapsed = !isManualInstallCollapsed">
        <h4><i class="fas fa-upload"></i> Manual Installation</h4>
        <i class="fas" :class="isManualInstallCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
      </div>
      <div v-if="!isManualInstallCollapsed" class="section-content">
        <p>Install a plugin from a .agnt file</p>
        <div class="upload-area" @click="triggerFileUpload" @dragover.prevent @drop.prevent="handleFileDrop">
          <input type="file" ref="fileInput" accept=".agnt,.tar.gz,.tgz" @change="handleFileSelect" style="display: none" />
          <i class="fas fa-cloud-upload-alt"></i>
          <span>Click or drag & drop .agnt plugin file here</span>
        </div>
      </div>
    </div>

    <!-- Controls Bar - Only for PRO -->
    <div v-if="isPro" class="controls-bar">
      <div class="search-wrapper">
        <BaseInput v-model="searchQuery" placeholder="Search plugins..." :clearable="true" />
      </div>
    </div>

    <!-- Tabs - Only for PRO -->
    <div v-if="isPro" class="tabs">
      <button class="tab" :class="{ active: activeTab === 'installed' }" @click="activeTab = 'installed'">
        <i class="fas fa-check-circle"></i> Installed ({{ installedPlugins.length }})<!--
        The only badge left on this screen, and it counts one thing: updates
        held back because they asked for more than the installed version had.
        --><span v-if="reviewCount > 0" class="review-count">{{ reviewCount }}</span>
      </button>
      <button class="tab" :class="{ active: activeTab === 'marketplace' }" @click="activeTab = 'marketplace'">
        <i class="fas fa-store"></i> Marketplace ({{ marketplacePlugins.length }})
      </button>
      <button class="tab" :class="{ active: activeTab === 'builder' }" @click="activeTab = 'builder'">
        <i class="fas fa-magic"></i> Build Plugin
      </button>
      <button class="tab" :class="{ active: activeTab === 'pack-studio' }" @click="activeTab = 'pack-studio'">
        <i class="fas fa-box-open"></i> Pack Studio
      </button>
      <button class="tab" :class="{ active: activeTab === 'publish' }" @click="activeTab = 'publish'">
        <i class="fas fa-cloud-upload-alt"></i> Publish
      </button>
    </div>

    <!-- Example plugins for non-pro users -->
    <div v-if="!isPro" class="plugins-list locked">
      <div v-for="i in 3" :key="'example-' + i" class="plugin-card locked">
        <div class="plugin-header">
          <div class="plugin-icon">
            <i class="fas fa-puzzle-piece"></i>
          </div>
          <div class="plugin-info">
            <h3 class="plugin-name">Example Plugin {{ i }}</h3>
            <span class="plugin-version">v1.0.0</span>
          </div>
          <div class="plugin-status">
            <span class="status-badge installed"><i class="fas fa-check"></i> Installed</span>
          </div>
        </div>
        <p class="plugin-description">This is an example plugin that extends AGNT with additional functionality.</p>
        <div class="plugin-tools">
          <span class="tools-label">Tools:</span>
          <div class="tools-list">
            <span class="tool-badge">Example Tool</span>
            <span class="tool-badge">Another Tool</span>
          </div>
        </div>
        <div class="plugin-meta">
          <span class="meta-item"> <i class="fas fa-user"></i> Developer </span>
          <span class="meta-item"> <i class="fas fa-file"></i> 2.5 MB </span>
        </div>
      </div>
      <div class="locked-overlay">
        <i class="fas fa-lock"></i>
        <p>Upgrade to unlock</p>
      </div>
    </div>

    <!-- Loading State -->
    <div v-else-if="isLoading" class="loading-state"><i class="fas fa-spinner fa-spin"></i> Loading plugins...</div>

    <!-- Installed Plugins Tab -->
    <div v-else-if="activeTab === 'installed'" class="plugins-list">
      <div v-if="filteredInstalledPlugins.length === 0" class="empty-state">
        <i class="fas fa-puzzle-piece"></i>
        <p>No plugins installed yet.</p>
        <BaseButton variant="primary" @click="activeTab = 'marketplace'">Browse Marketplace</BaseButton>
      </div>

      <div v-else class="plugins-grid" @click.self="deselectPlugin">
        <div
          v-for="plugin in filteredInstalledPlugins"
          :key="plugin.name"
          class="plugin-card installed"
          :class="{ selected: selectedPlugin?.name === plugin.name }"
          @click="selectPlugin(plugin)"
        >
          <div class="plugin-header">
            <div class="plugin-icon">
              <SvgIcon :name="plugin.icon || 'custom'" />
            </div>
            <div class="plugin-info">
              <h3 class="plugin-name">{{ getDisplayName(plugin) }}</h3>
              <span class="plugin-version">v{{ plugin.version }}</span>
              <!-- trust system Layer 6: display-only trust badge (0.6.0 ladder) -->
              <Tooltip
                v-if="plugin.trustTier"
                :title="trustTierLabel(plugin.trustTier)"
                :text="trustTooltipText(plugin)"
                position="top"
                width="300px"
              >                <span class="trust-badge" :class="'trust-' + plugin.trustTier">
                  <span class="trust-dot"></span>
                  {{ plugin.trustTier }}
                </span>
              </Tooltip>
            </div>
            <div class="plugin-status">
              <!-- At most one chip, and it is only actionable for a refused update. -->
              <button
                v-if="pluginNotices[plugin.name]?.needsReview"
                class="notice-chip review"
                :disabled="updatingName === plugin.name"
                @click.stop="reviewUpdate(plugin)"
              >
                <i class="fas fa-shield-alt"></i>
                {{ updatingName === plugin.name ? 'Updating…' : 'Update needs review' }}
              </button>
              <span
                v-else-if="pluginNotices[plugin.name]"
                class="notice-chip"
                :class="pluginNotices[plugin.name].kind"
                v-tooltip="pluginNotices[plugin.name].detail"
              >
                <i :class="pluginNotices[plugin.name].icon"></i> {{ pluginNotices[plugin.name].label }}
              </span>
              <span v-else class="status-badge installed"><i class="fas fa-check"></i> Installed</span>

              <div class="card-menu" v-click-outside="() => closeMenu(plugin.name)">
                <button class="card-menu-btn" aria-label="More actions" @click.stop="toggleMenu(plugin.name)">
                  <i class="fas fa-ellipsis-h"></i>
                </button>
                <div v-if="openMenuFor === plugin.name" class="card-menu-items">
                  <button class="card-menu-item" @click.stop="togglePin(plugin)">
                    <i class="fas" :class="isPinned(plugin) ? 'fa-unlock' : 'fa-thumbtack'"></i>
                    {{ isPinned(plugin) ? 'Allow automatic updates' : 'Pin to v' + plugin.version }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <p class="plugin-description">{{ plugin.description || 'No description available' }}</p>

          <div class="plugin-tools" v-if="plugin.tools && plugin.tools.length">
            <span class="tools-label">Tools:</span>
            <div class="tools-list">
              <span v-for="tool in plugin.tools" :key="tool.type" class="tool-badge">
                {{ tool.schema?.title || tool.type }}
              </span>
            </div>
          </div>

          <div class="plugin-meta">
            <span v-if="plugin.author" class="meta-item"> <i class="fas fa-user"></i> {{ plugin.author }} </span>
            <span v-if="plugin.size" class="meta-item"> <i class="fas fa-file"></i> {{ formatSize(plugin.size) }} </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Marketplace Tab -->
    <div v-else-if="activeTab === 'marketplace'" class="plugins-list">
      <div v-if="filteredMarketplacePlugins.length === 0" class="empty-state">
        <i class="fas fa-store"></i>
        <p>No plugins available in marketplace.</p>
        <p class="hint">Check back later or install plugins manually.</p>
      </div>

      <div v-else class="plugins-grid" @click.self="deselectPlugin">
        <div
          v-for="plugin in filteredMarketplacePlugins"
          :key="plugin.name"
          class="plugin-card"
          :class="{ selected: selectedPlugin?.name === plugin.name }"
          @click="selectPlugin(plugin)"
        >
          <div class="plugin-header">
            <div class="plugin-icon">
              <SvgIcon :name="plugin.icon || 'puzzle-piece'" />
            </div>            <div class="plugin-info">
              <h3 class="plugin-name">{{ getDisplayName(plugin) }}</h3>
              <span class="plugin-version">v{{ plugin.version }}</span>
              <!-- trust system Layer 6: pre-install trust badge (from stamped marketplace record) -->
              <Tooltip
                v-if="plugin.trustTier"
                :title="trustTierLabel(plugin.trustTier)"
                :text="trustTooltipText(plugin, true)"
                position="top"
                width="300px"
              >
                <span class="trust-badge" :class="'trust-' + plugin.trustTier">
                  <span class="trust-dot"></span>
                  {{ plugin.trustTier }}
                </span>
              </Tooltip>
            </div>
            <div class="plugin-status">
              <span v-if="isPluginInstalled(plugin.name)" class="status-badge installed"><i class="fas fa-check"></i> Installed</span>
              <span v-else-if="plugin.price > 0" class="status-badge paid">${{ plugin.price.toFixed(2) }}</span>
              <span v-else class="status-badge free">FREE</span>
            </div>
          </div>

          <p class="plugin-description">{{ plugin.description || 'No description available' }}</p>

          <div class="plugin-tools" v-if="plugin.tools && plugin.tools.length">
            <span class="tools-label">Tools:</span>
            <div class="tools-list">
              <span v-for="tool in plugin.tools" :key="tool.type" class="tool-badge">
                {{ tool.schema?.title || tool.type }}
              </span>
            </div>
          </div>

          <div class="plugin-meta">
            <span v-if="plugin.author" class="meta-item"> <i class="fas fa-user"></i> {{ plugin.author }} </span>
            <span v-if="plugin.size" class="meta-item"> <i class="fas fa-file"></i> {{ formatSize(plugin.size) }} </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Plugin Builder Tab -->
    <div v-else-if="activeTab === 'builder'" class="plugins-list">
      <PluginBuilder @show-alert="(title, msg) => emit('show-alert', title, msg)" @plugin-installed="onPluginInstalled" />
    </div>

    <!-- Pack Studio Tab — no-code ecosystem-pack composer -->
    <div v-else-if="activeTab === 'pack-studio'" class="plugins-list">
      <PackStudio @show-alert="(title, msg) => emit('show-alert', title, msg)" @plugin-installed="onPluginInstalled" />
    </div>

    <!-- Publish Tab -->
    <div v-else-if="activeTab === 'publish'" class="plugins-list">
      <div class="publish-section">
        <div class="publish-header">
          <h3><i class="fas fa-cloud-upload-alt"></i> Publish to Marketplace</h3>
          <p>Share your plugins with the AGNT community</p>
        </div>

        <!-- Select Plugin to Publish -->
        <div class="publish-step">
          <div class="step-header">
            <span class="step-badge">1</span>
            <h4>Select Plugin</h4>
          </div>
          <div class="plugin-select-grid">
            <div
              v-for="plugin in sortedInstalledPlugins"
              :key="plugin.name"
              class="plugin-select-card"
              :class="{ selected: publishSelectedPlugin?.name === plugin.name }"
              @click="selectPluginToPublish(plugin)"
            >
              <div class="plugin-select-icon">
                <SvgIcon :name="plugin.icon || 'custom'" />
              </div>
              <div class="plugin-select-info">
                <span class="plugin-select-name">{{ getDisplayName(plugin) }}</span>
                <span class="plugin-select-version">
                  v{{ plugin.version }}
                  <span v-if="publishedListingFor(plugin)" class="published-chip">
                    published v{{ publishedListingFor(plugin).current_version }}
                  </span>
                </span>
              </div>
              <i v-if="publishSelectedPlugin?.name === plugin.name" class="fas fa-check-circle selected-check"></i>
            </div>
          </div>
          <div v-if="sortedInstalledPlugins.length === 0" class="empty-state small">
            <i class="fas fa-puzzle-piece"></i>
            <p>No plugins to publish. Build one first!</p>
            <BaseButton variant="primary" size="small" @click="activeTab = 'builder'"> <i class="fas fa-magic"></i> Build Plugin </BaseButton>
          </div>
        </div>

        <!-- Plugin Details -->
        <div v-if="publishSelectedPlugin" class="publish-step">
          <div class="step-header">
            <span class="step-badge">2</span>
            <h4>{{ isUpdateMode ? 'Release Notes' : 'Plugin Details' }}</h4>
          </div>

          <!-- Update mode: listing copy is edited from the marketplace panel;
               here we only ship the new package + changelog. -->
          <div v-if="isUpdateMode" class="publish-form">
            <div class="version-summary" :class="{ blocked: !versionCanPublish }">
              <i class="fas" :class="versionCanPublish ? 'fa-arrow-up' : 'fa-exclamation-triangle'"></i>
              <span v-if="versionCanPublish">
                Publishing <b>v{{ selectedPublishedListing.current_version }}</b> &rarr; <b>v{{ publishSelectedPlugin.version }}</b>
              </span>
              <span v-else>{{ versionBlockReason }}</span>
            </div>
            <div class="form-row">
              <label>Changelog</label>
              <textarea v-model="publishForm.changelog" placeholder="What changed in this version?" rows="3"></textarea>
            </div>
          </div>

          <div v-else>
          <div class="publish-form">
            <div class="form-row">
              <label>Display Name</label>
              <BaseInput v-model="publishForm.displayName" placeholder="My Awesome Plugin" />
            </div>
            <div class="form-row">
              <label>Description</label>
              <textarea v-model="publishForm.description" placeholder="Describe what your plugin does..." rows="3"></textarea>
            </div>
            <div class="form-row">
              <label>Category</label>
              <BaseSelect
                v-model="publishForm.category"
                :options="[
                  { value: 'integration', label: 'Integration' },
                  { value: 'utility', label: 'Utility' },
                  { value: 'ai', label: 'AI/ML' },
                  { value: 'data', label: 'Data' },
                  { value: 'communication', label: 'Communication' },
                  { value: 'other', label: 'Other' },
                ]"
              />
            </div>
            <div class="form-row">
              <label>Tags (comma-separated)</label>
              <BaseInput v-model="publishForm.tags" placeholder="api, automation, productivity" />
            </div>
            <div class="form-row checkbox-row">
              <label>
                <input type="checkbox" v-model="publishForm.isFree" />
                <span>Free Plugin</span>
              </label>
            </div>
            <div v-if="!publishForm.isFree" class="form-row">
              <label>Price (USD)</label>
              <BaseInput v-model="publishForm.price" type="number" placeholder="9.99" />
            </div>

            <!-- Revenue Info (when price > 0) -->
            <div v-if="!publishForm.isFree && parseFloat(publishForm.price) > 0" class="revenue-info">
              <div class="revenue-main">
                <i class="fas fa-info-circle"></i>
                <span>{{ getRevenueMainText() }}</span>
              </div>
              <div class="revenue-comparison">{{ getRevenueComparisonText() }}</div>
            </div>

            <!-- Stripe Connect Warning -->
            <div v-if="!publishForm.isFree && parseFloat(publishForm.price) > 0 && !stripeConnected" class="stripe-warning">
              <i class="fas fa-exclamation-triangle"></i>
              <p>You need to set up Stripe Connect to sell paid plugins.</p>
              <button type="button" class="setup-stripe-btn" @click="setupStripe">
                <i class="fas fa-credit-card"></i>
                Set Up Payments
              </button>
            </div>
          </div>
          </div>
        </div>

        <!-- Publish Button -->
        <div v-if="publishSelectedPlugin" class="publish-step">
          <div class="step-header">
            <span class="step-badge">3</span>
            <h4>{{ isUpdateMode ? 'Ship Update' : 'Publish' }}</h4>
          </div>
          <div class="publish-actions">
            <p class="publish-note">
              <i class="fas fa-info-circle"></i>
              <span v-if="isUpdateMode">
                The new package is re-scanned on upload. Users on an older version see it via plugin updates.
              </span>
              <span v-else>Your plugin will be reviewed before appearing in the marketplace.</span>
            </p>
            <BaseButton variant="primary" @click="publishPlugin" :disabled="isPublishing || (isUpdateMode && !versionCanPublish)">
              <i class="fas" :class="isPublishing ? 'fa-spinner fa-spin' : isUpdateMode ? 'fa-arrow-up' : 'fa-cloud-upload-alt'"></i>
              <template v-if="isPublishing">{{ isUpdateMode ? 'Publishing update...' : 'Publishing...' }}</template>
              <template v-else-if="isUpdateMode">Publish v{{ publishSelectedPlugin.version }}</template>
              <template v-else>Publish to Marketplace</template>
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Simple Modal for Confirmations -->
    <SimpleModal ref="modalRef" />
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue';
import { useStore } from 'vuex';
import BaseInput from '@/views/Terminal/_components/BaseInput.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import PluginBuilder from './PluginBuilder.vue';
import PackStudio from './PackStudio.vue';
import { API_CONFIG } from '@/tt.config.js';
import { checkPluginVersionPublishable } from '@/utils/pluginVersion.js';
import { apiFetch } from '@/utils/apiFetch.js';
import { useLicense } from '@/composables/useLicense';

/** Close an open card menu on any click that lands outside it. */
const clickOutside = {
  beforeMount(el, binding) {
    el.__clickOutside__ = (event) => {
      if (!(el === event.target || el.contains(event.target))) binding.value(event);
    };
    document.addEventListener('click', el.__clickOutside__);
  },
  unmounted(el) {
    document.removeEventListener('click', el.__clickOutside__);
    delete el.__clickOutside__;
  },
};

/**
 * SimpleModal renders `message` with v-html, and a permission string is not
 * ours: normalizePermissions() passes any string in a plugin's manifest
 * through verbatim, including `domain:<anything>`. The consent dialog is the
 * one place a refused update still gets to put text on screen, so it is the
 * one place that must not let that text become markup.
 */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

export default {
  name: 'Plugins',
  directives: { clickOutside },
  components: {
    BaseInput,
    BaseSelect,
    BaseButton,
    SvgIcon,
    SimpleModal,
    Tooltip,
    PluginBuilder,
    PackStudio,
  },
  emits: ['show-alert'],
  setup(props, { emit }) {
    const store = useStore();
    const modalRef = ref(null);
    const searchQuery = ref('');
    const isLoading = ref(false);
    const installedPlugins = ref([]);
    const marketplacePlugins = ref([]);
    const installingPlugin = ref(null);
    const uninstallingPlugin = ref(null);
    const fileInput = ref(null);
    const isManualInstallCollapsed = ref(true);
    const playSound = inject('playSound', () => {});

    // Plugins are now free for all users
    const { isPremium, hasPlugins, maxPlugins } = useLicense();
    const isPro = computed(() => true);

    // Publish tab state
    const publishSelectedPlugin = ref(null);
    const isPublishing = ref(false);
    // Listings this user has already published, keyed by plugin asset_id.
    // Drives update-vs-create: `POST /marketplace/publish` is create-only and
    // 409s on a second call, so publishing an update needs the listing id.
    const myPublishedPlugins = ref([]);
    /** The user's own marketplace listing for an installed plugin, if any. */
    function publishedListingFor(plugin) {
      if (!plugin?.name) return null;
      return myPublishedPlugins.value.find((item) => item.asset_id === plugin.name) || null;
    }

    const selectedPublishedListing = computed(() => publishedListingFor(publishSelectedPlugin.value));
    const isUpdateMode = computed(() => Boolean(selectedPublishedListing.value));

    const versionCheck = computed(() => {
      const listing = selectedPublishedListing.value;
      if (!listing) return { ok: true, reason: '' };
      return checkPluginVersionPublishable(publishSelectedPlugin.value?.version, listing.current_version);
    });

    const versionCanPublish = computed(() => versionCheck.value.ok);
    const versionBlockReason = computed(() => versionCheck.value.reason);

    /**
     * Single source of truth: the marketplace store owns fetching + caching +
     * the older-server fallback. Duplicating the fetch here is how the two
     * would drift.
     */
    async function fetchMyPublishedPlugins() {
      try {
        if (!localStorage.getItem('token')) return;
        await store.dispatch('marketplace/fetchMyPublishedItems', { force: true });
        const items = store.state.marketplace?.myPublishedItems || [];
        myPublishedPlugins.value = items.filter((item) => item.asset_type === 'plugin');
      } catch (error) {
        // Non-fatal: without this the tab simply falls back to create-only.
        console.warn('Could not load published plugin listings:', error.message);
      }
    }

    const publishForm = ref({
      displayName: '',
      description: '',
      category: 'utility',
      tags: '',
      isFree: true,
      price: '',
      changelog: '',
    });

    /**
     * Best-effort owner/repo from a plugin manifest. Stored as
     * metadata.repository on first publish: the provenance endpoint matches a
     * listing by that field, so a listing without it can never be upgraded to
     * the verified tier no matter how the CI workflow is configured.
     */
    function extractRepository(plugin) {
      const candidates = [plugin?.repository?.url, plugin?.repository, plugin?.homepage].filter((v) => typeof v === 'string');
      for (const candidate of candidates) {
        const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/#?]|$)/i.exec(candidate);
        if (match) return match[1];
      }
      return undefined;
    }

    // Shared state from store
    const activeTab = computed({
      get: () => store.getters['connectors/activeTab'],
      set: (val) => store.dispatch('connectors/setActiveTab', val),
    });

    const selectedPlugin = computed(() => store.getters['connectors/selectedPlugin']);

    // Stripe Connect status from store
    const stripeConnected = computed(() => store.getters['userAuth/stripeConnected'] || false);

    // Watch for refresh trigger from SecretsPanel
    watch(
      () => store.getters['connectors/refreshTrigger'],
      () => {
        refreshPlugins();
      },
    );

    const filteredInstalledPlugins = computed(() => {
      let plugins = [...installedPlugins.value];
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        plugins = plugins.filter((p) => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
      }
      // Sort alphabetically by display name
      plugins.sort((a, b) => {
        const nameA = (a.displayName || a.name).toLowerCase();
        const nameB = (b.displayName || b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      return plugins;
    });

    const filteredMarketplacePlugins = computed(() => {
      let plugins = [...marketplacePlugins.value];
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        plugins = plugins.filter((p) => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
      }
      // Sort alphabetically by display name
      plugins.sort((a, b) => {
        const nameA = (a.displayName || a.name).toLowerCase();
        const nameB = (b.displayName || b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      return plugins;
    });

    // Sorted installed plugins for publish tab (no search filter, just alphabetical)
    const sortedInstalledPlugins = computed(() => {
      return [...installedPlugins.value].sort((a, b) => {
        const nameA = (a.displayName || a.name).toLowerCase();
        const nameB = (b.displayName || b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    });

    function isPluginInstalled(name) {
      return installedPlugins.value.some((p) => p.name === name);
    }

    function getDisplayName(plugin) {
      if (plugin.displayName) return plugin.displayName;
      return plugin.name
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    // ============ Updates: silent by default, one interrupt ============
    //
    // Updating is infrastructure, not a decision. The background scheduler
    // applies anything that does not widen a plugin's powers, and the
    // permission-diff gate refuses anything that does — so the refusal is the
    // only event worth a human. Everything else is a chip on the card the
    // plugin already occupies.
    //
    // What used to be here: an Updates tab, a "Check for Updates" button, a
    // "Check automatically (daily)" checkbox and an auto/notify/pinned
    // dropdown on every row — 2 + 2N controls, none of which asked a question
    // the user could answer better than the program could.
    const updateStatus = ref(null);
    const updatingName = ref(null);
    const openMenuFor = ref(null);

    /**
     * At most ONE chip per installed plugin, ranked.
     *
     * A card has room for exactly one fact, and "this needs your decision"
     * outranks "this changed on its own", which outranks "this is frozen".
     * Assignment therefore runs lowest priority first and lets later writes win.
     */
    const pluginNotices = computed(() => {
      const status = updateStatus.value || {};
      const notices = {};

      for (const plugin of installedPlugins.value) {
        if (plugin.updatePolicy === 'pinned') {
          notices[plugin.name] = {
            kind: 'pinned',
            icon: 'fas fa-thumbtack',
            label: 'Pinned',
            detail: `Staying on v${plugin.version}. Updates are not applied.`,
          };
        }
      }

      for (const entry of status.autoUpdated || []) {
        notices[entry.name] = {
          kind: 'updated',
          icon: 'fas fa-check-circle',
          label: `Updated to v${entry.version}`,
          detail: 'Applied automatically because it requested nothing new.',
        };
      }

      // `failed` was `notified` before the notify policy was removed. Only its
      // error entries ever carried anything, so old status files still read.
      const failures = [...(status.failed || []), ...(status.notified || []).filter((n) => n && n.error)];
      for (const entry of failures) {
        notices[entry.name] = {
          kind: 'failed',
          icon: 'fas fa-exclamation-triangle',
          label: 'Update failed',
          detail: String(entry.error || 'Unknown error'),
        };
      }

      for (const entry of status.blockedOnConsent || []) {
        const added = (entry.permissionDiff?.added || []).join(', ');
        notices[entry.name] = {
          kind: 'review',
          icon: 'fas fa-shield-alt',
          label: 'Update needs review',
          needsReview: true,
          detail: added
            ? `The new version requests ${added}. Nothing was installed.`
            : 'The new version requests permissions the installed one does not have. Nothing was installed.',
        };
      }

      return notices;
    });

    // Scoped to plugins that are actually installed, so a stale status entry
    // for something since removed cannot advertise work that no longer exists.
    const reviewCount = computed(
      () => installedPlugins.value.filter((p) => pluginNotices.value[p.name]?.needsReview).length,
    );

    /**
     * The last background pass. A missing summary is not an error — it means
     * no pass has run — and a client can outlive the server it talks to, so a
     * 404 whose body is not JSON must not throw here.
     */
    async function loadUpdateStatus() {
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update-status`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.success) updateStatus.value = data.status;
      } catch (err) {
        console.warn('[Plugins] update status unavailable:', err.message);
      }
    }

    function isPinned(plugin) {
      return plugin.updatePolicy === 'pinned';
    }

    function toggleMenu(name) {
      openMenuFor.value = openMenuFor.value === name ? null : name;
    }

    function closeMenu(name) {
      if (openMenuFor.value === name) openMenuFor.value = null;
    }

    /**
     * Pinning is what earns the right to update silently: someone who cannot
     * tolerate a version moving under them has somewhere to say so. It lives
     * in the overflow menu because almost nobody needs it.
     */
    async function togglePin(plugin) {
      openMenuFor.value = null;
      const policy = isPinned(plugin) ? 'auto' : 'pinned';
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update-policy/${encodeURIComponent(plugin.name)}`, {
          method: 'POST',
          body: JSON.stringify({ policy }),
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'unknown error');
        await fetchInstalledPlugins();
      } catch (err) {
        emit('show-alert', 'Error', `Could not change the update setting: ${err.message}`);
      }
    }

    /**
     * The one interrupt.
     *
     * Reached only from a card whose update was refused for asking more than
     * the installed version had — everything else applied itself. Re-POSTs
     * without consent first so the diff on screen is the server's current
     * answer rather than a possibly-stale line from the status file.
     */
    async function reviewUpdate(plugin, acceptedPermissions = false) {
      updatingName.value = plugin.name;
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update/${encodeURIComponent(plugin.name)}`, {
          method: 'POST',
          body: JSON.stringify({ acceptedPermissions }),
        });
        const data = await resp.json();

        if (data.requiresConsent) {
          const added = (data.permissionDiff?.added || []).map(escapeHtml);
          const confirmed = await modalRef.value.showModal({
            title: `"${plugin.name}" update requests new permissions`,
            message:
              `This update adds capabilities the currently installed version does not have:<br><br>` +
              `<b>${added.join('</b><br><b>')}</b><br><br>` +
              `Nothing has been installed. Grant these permissions and update?`,
            confirmText: 'Grant & Update',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-danger',
          });
          if (confirmed) {
            updatingName.value = null;
            return reviewUpdate(plugin, true);
          }
          return;
        }

        if (data.success) {
          emit('show-alert', 'Success', `"${plugin.name}" updated to v${data.version}${data.trustTier ? ` · ${data.trustTier}` : ''}`);
          await Promise.all([fetchInstalledPlugins(), loadUpdateStatus()]);
        } else {
          emit('show-alert', 'Error', `Update failed: ${data.error}`);
        }
      } catch (err) {
        emit('show-alert', 'Error', `Update failed: ${err.message}`);
      } finally {
        updatingName.value = null;
      }
    }

    // trust system Layer 6: human-readable trust labels (no backend jargon
    // like "tofu" ever reaches the UI).
    function trustTierLabel(tier) {
      if (tier === 'official') return 'Official — built & maintained by AGNT';
      if (tier === 'community') return 'Community — verified & fully declared';
      if (tier === 'unverified') return 'Unverified — undeclared capabilities';
      return 'Unaudited — could not be scanned';
    }

    function integrityLabel(state) {
      if (state === 'verified') return 'Package verified against the marketplace record.';
      if (state === 'tofu') return 'Fingerprint recorded on first use — any future tampering will be detected.';
      if (state === 'mismatch') return 'Package does NOT match its marketplace record!';
      return 'No integrity record yet.';
    }    function trustTooltipText(plugin, isMarketplace = false) {
      const parts = [];
      if (plugin.trustTier === 'official') {
        parts.push('First-party AGNT plugin — built, scanned, and integrity-tracked by the AGNT team.');
      } else if (plugin.trustTier === 'community') {
        parts.push('This plugin is integrity-tracked and every capability it uses is declared by its author.');
      } else if (plugin.trustTier === 'unverified') {
        parts.push('This plugin uses capabilities its author has not declared yet.');
      } else {
        parts.push('This plugin could not be scanned.');
      }
      if (isMarketplace) {
        // Pre-install: the record carries a verified hash; the package will be
        // checked against it during installation.
        parts.push('Package will be verified against its marketplace record during installation.');
        const caps = (plugin.declaredPermissions && plugin.declaredPermissions.length && plugin.declaredPermissions) || plugin.detectedCapabilities || [];
        if (caps.length) parts.push('Requests: ' + caps.join(', ') + '.');
      } else {
        parts.push(integrityLabel(plugin.integrityState));
        if (plugin.grantedPermissions && plugin.grantedPermissions.length) {
          parts.push('Granted: ' + plugin.grantedPermissions.join(', ') + '.');
        } else if (plugin.detectedCapabilities && plugin.detectedCapabilities.length) {
          parts.push('Detected: ' + plugin.detectedCapabilities.join(', ') + '.');
        }
      }
      return parts.join(' ');
    }

    function formatSize(bytes) {
      if (!bytes) return '';
      if (bytes < 1024) {
        return `${bytes} B`;
      } else if (bytes < 1024 * 1024) {
        const kb = bytes / 1024;
        return `${kb.toFixed(1)} KB`;
      } else {
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
      }
    }

    // Sanitize plugin data by stripping large base64 strings that block the UI
    function sanitizePluginData(plugin) {
      const MAX_BASE64_LENGTH = 5000; // ~3.7KB decoded, enough for small icons
      const sanitized = { ...plugin };

      // Strip or truncate preview_image if it's a huge base64 string
      if (sanitized.preview_image && typeof sanitized.preview_image === 'string') {
        if (sanitized.preview_image.startsWith('data:') && sanitized.preview_image.length > MAX_BASE64_LENGTH) {
          sanitized.preview_image = null; // Remove it entirely
        }
      }

      // Also check icon field if it contains base64
      if (sanitized.icon && typeof sanitized.icon === 'string') {
        if (sanitized.icon.startsWith('data:') && sanitized.icon.length > MAX_BASE64_LENGTH) {
          sanitized.icon = 'custom'; // Fallback to default icon
        }
      }

      // Recursively sanitize tools array if present
      if (sanitized.tools && Array.isArray(sanitized.tools)) {
        sanitized.tools = sanitized.tools.map((tool) => {
          const sanitizedTool = { ...tool };
          if (sanitizedTool.preview_image && typeof sanitizedTool.preview_image === 'string') {
            if (sanitizedTool.preview_image.startsWith('data:') && sanitizedTool.preview_image.length > MAX_BASE64_LENGTH) {
              sanitizedTool.preview_image = null;
            }
          }
          return sanitizedTool;
        });
      }

      return sanitized;
    }

    async function fetchInstalledPlugins() {
      try {
        console.log('[Plugins] Fetching installed plugins...');
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed`);
        const data = await response.json();
        console.log('[Plugins] API response:', data.success, 'plugins:', data.plugins?.length);
        if (data.success) {
          // Sanitize plugin data to remove large base64 strings
          const sanitized = (data.plugins || []).map(sanitizePluginData);
          console.log(
            '[Plugins] Setting installed plugins:',
            sanitized.map((p) => p.name),
          );
          installedPlugins.value = sanitized;
        } else {
          console.error('[Plugins] API returned success=false:', data.error);
        }
      } catch (error) {
        console.error('[Plugins] Error fetching installed plugins:', error);
      }
    }

    async function fetchMarketplacePlugins() {
      try {
        // Optimization: Use cached marketplace items if available
        let marketplaceItems = store.getters['marketplace/filteredMarketplaceItems'] || [];
        if (marketplaceItems.length === 0) {
          await store.dispatch('marketplace/fetchMarketplaceItems');
          marketplaceItems = store.getters['marketplace/filteredMarketplaceItems'] || [];
        }

        // Fetch from local backend (has full plugin manifest data with icons, tools, etc.)
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/marketplace`);
        const data = await response.json();
        if (data.success) {
          const localPlugins = data.plugins || [];

          if (marketplaceItems.length > 0) {
            // Create a map of plugin prices by name/asset_id
            const priceMap = {};
            marketplaceItems
              .filter((item) => item.asset_type === 'plugin')
              .forEach((item) => {
                const pluginName = item.asset_data?.manifest?.name || item.asset_id;
                if (pluginName) {
                  priceMap[pluginName] = {
                    price: item.price || 0,
                    marketplace_item_id: item.id,
                  };
                }
              });

            // Merge price data into local plugins and sanitize
            marketplacePlugins.value = localPlugins.map((plugin) =>
              sanitizePluginData({
                ...plugin,
                price: priceMap[plugin.name]?.price || 0,
                marketplace_item_id: priceMap[plugin.name]?.marketplace_item_id || null,
              }),
            );
          } else {
            // No marketplace items yet, use local plugins without price (sanitized)
            marketplacePlugins.value = localPlugins.map(sanitizePluginData);
          }
        }
      } catch (error) {
        console.error('Error fetching marketplace plugins:', error);
      }
    }

    async function refreshPlugins() {
      isLoading.value = true;
      try {
        await Promise.all([
          fetchInstalledPlugins(),
          fetchMarketplacePlugins(),
          store.dispatch('marketplace/fetchMyPurchases'),
          store.dispatch('marketplace/fetchMyInstalls'),
        ]);
      } finally {
        isLoading.value = false;
      }
    }

    // trust system Layer 1: human-readable capability labels for the
    // pre-install disclosure modal.
    const CAPABILITY_LABELS = {
      network: ['🌐', 'Network access', 'makes requests to the internet'],
      filesystem: ['📁', 'File system access', 'reads or writes files on your computer'],
      'spawn-process': ['⚙️', 'Runs system processes', 'executes commands on your machine'],
      'env-access': ['🔑', 'Environment variables', 'can read env vars, which may include API keys'],
      'dynamic-eval': ['⚡', 'Dynamic code execution', 'runs dynamically generated code'],
      'dynamic-import': ['📦', 'Dynamic module loading', 'loads additional code at runtime'],
    };

    /**
     * trust system Layer 1: pre-install disclosure & consent. Inspects the
     * package server-side (download + scan, NO install), then shows a
     * blocking modal with capabilities, integrity state, and trust tier.
     * Returns true only if the user explicitly confirms. An integrity
     * mismatch blocks installation outright.
     */
    async function showInstallDisclosure(plugin) {
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/inspect/${encodeURIComponent(plugin.name)}`);
        const report = await resp.json();
        if (!report.success) throw new Error(report.error || 'inspection failed');

        if (report.integrityState === 'mismatch') {
          await modalRef.value.showModal({
            title: '🚨 Integrity Check Failed — Install Blocked',
            message:
              `The downloaded package for "<b>${getDisplayName(plugin)}</b>" does <b>NOT</b> match the marketplace record.<br><br>` +
              `<b>Expected:</b> <code>${report.expectedIntegrity}</code><br>` +
              `<b>Got:</b> <code>${report.integrity}</code><br><br>` +
              `The artifact may be corrupted or tampered with. Installation has been blocked — nothing was installed.`,
            confirmText: 'Close',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
          return false;
        }

        const caps = Object.keys(report.detected || {});
        const capRows = caps.length
          ? caps
              .map((cap) => {
                const [icon, label, desc] = CAPABILITY_LABELS[cap] || ['❔', cap, ''];
                const undeclared = report.undeclared?.includes(cap) ? ' <span style="color:var(--color-yellow);">(undeclared by author)</span>' : '';
                const ex = report.detected[cap]?.example;
                const evidence = ex ? ` <span style="opacity:0.55;">(${ex.file}:${ex.line})</span>` : '';
                return `${icon} <b>${label}</b>${undeclared} — ${desc}${evidence}`;
              })
              .join('<br>')
          : '✅ No sensitive capabilities detected in first-party source';

        const integrityLine =
          report.integrityState === 'verified'
            ? '🔐 <b>Integrity verified</b> — package bytes match the marketplace record exactly'
            : "📌 <b>No integrity record yet</b> — AGNT will record this package's fingerprint now and alert you if it ever changes";        // Theme-colored dot matching the badge colors (modal message is v-html)
        const tierColor =
          report.trustTier === 'official'
            ? 'var(--color-green)'
            : report.trustTier === 'community'
              ? 'var(--color-green)'
              : report.trustTier === 'unverified'
                ? 'var(--color-yellow)'
                : 'var(--color-red)';
        const tierIcon = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${tierColor};margin-right:2px;"></span>`;

        const validLine = report.valid
          ? ''
          : `<br><span style="color:#ff6b6b;">⚠️ Package validation problems: ${(report.validationErrors || []).join('; ')}</span>`;

        const confirmed = await modalRef.value.showModal({
          title: `Install "${getDisplayName(plugin)}" v${report.version || plugin.version || '?'}?`,
          message:
            `${tierIcon} Trust tier: <b>${report.trustTier}</b><br>` +
            `${integrityLine}<br><br>` +
            `<b>This plugin can:</b><br>${capRows}${validLine}<br><br>` +
            `<span style="opacity:0.7;">Plugins run with full access to your machine. Only install plugins you trust.</span>`,
          confirmText: 'Install',
          cancelText: 'Cancel',
          showCancel: true,
          confirmClass: 'btn-primary',
        });
        return !!confirmed;
      } catch (err) {
        // Inspection unavailable — NEVER silently install; fall back to an
        // explicit basic consent that says exactly what we don't know.
        console.warn('[Plugins] Pre-install inspection unavailable:', err.message);
        const confirmed = await modalRef.value.showModal({
          title: `Install "${getDisplayName(plugin)}"?`,
          message:
            `⚠️ Pre-install inspection unavailable (${err.message}).<br><br>` +
            `This package could not be scanned before install. Plugins run with full access to your machine.`,
          confirmText: 'Install Anyway',
          cancelText: 'Cancel',
          showCancel: true,
          confirmClass: 'btn-danger',
        });
        return !!confirmed;
      }
    }
    async function installPlugin(plugin) {
      installingPlugin.value = plugin.name;
      try {
        const marketplaceItemId = plugin.marketplace_item_id || plugin.id;

        // Check if this is a paid plugin from the marketplace
        if (plugin.price && plugin.price > 0) {
          // Verify we have a valid marketplace item ID for purchase
          if (!marketplaceItemId) {
            emit('show-alert', 'Error', `This plugin is marked as paid but is not available for purchase through the marketplace.`);
            installingPlugin.value = null;
            return;
          }

          // Check if user has already purchased
          const hasPurchased = await store.dispatch('marketplace/checkPurchaseStatus', marketplaceItemId);

          if (!hasPurchased) {
            // Show purchase confirmation modal
            const confirmed = await modalRef.value.showModal({
              title: 'Purchase Required',
              message: `"${getDisplayName(plugin)}" costs $${plugin.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
              confirmText: 'Purchase Now',
              cancelText: 'Cancel',
              showCancel: true,
              confirmClass: 'btn-primary',
            });

            if (confirmed) {
              emit('show-alert', 'Info', `Redirecting to checkout for "${getDisplayName(plugin)}"...`);
              // Redirect to Stripe checkout
              await store.dispatch('marketplace/purchaseItem', {
                itemId: marketplaceItemId,
              });
              // Note: User will be redirected to Stripe, so code after this won't execute
            }
            installingPlugin.value = null;
            return;
          }
        }

        // If free or already purchased, proceed with installation
        // trust system Layer 1: BLOCKING pre-install disclosure & consent.
        // The user sees exactly what this plugin can do before any bytes land.
        const consented = await showInstallDisclosure(plugin);
        if (!consented) {
          installingPlugin.value = null;
          return;
        }

        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/install`, {
          method: 'POST',
          body: JSON.stringify({ name: plugin.name, version: plugin.version || 'latest' }),
        });
        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${plugin.name}" installed successfully!${data.trustTier ? ` Trust tier: ${data.trustTier}.` : ''}`);
          await refreshPlugins();
          await store.dispatch('tools/refreshAllTools');
        } else {
          throw new Error(data.error || 'Installation failed');
        }
      } catch (error) {
        // Handle specific payment-related errors
        if (error.code === 'PAYMENT_REQUIRED') {
          const marketplaceItemId = plugin.marketplace_item_id || plugin.id;
          if (!marketplaceItemId) {
            emit('show-alert', 'Error', `This plugin requires payment but is not properly configured for purchase.`);
            return;
          }

          emit('show-alert', 'Error', `This plugin costs $${plugin.price}. Payment required.`);
          const confirmed = await modalRef.value.showModal({
            title: 'Payment Required',
            message: `This plugin costs $${plugin.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
            confirmText: 'Purchase Now',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (confirmed) {
            await store.dispatch('marketplace/purchaseItem', {
              itemId: marketplaceItemId,
            });
          }
        } else if (error.message.includes('invalid payment') || error.message.includes('Stripe')) {
          emit('show-alert', 'Error', `Payment setup error: ${error.message}`);
        } else {
          emit('show-alert', 'Error', `Failed to install plugin: ${error.message}`);
        }
      } finally {
        installingPlugin.value = null;
      }
    }

    // This is now mainly for the marketplace or manual calls, as SecretsPanel handles its own uninstall
    async function confirmUninstall(plugin) {
      const confirmed = await modalRef.value.showModal({
        title: 'Confirm Uninstall',
        message: `Are you sure you want to uninstall "${plugin.name}"?`,
        confirmText: 'Uninstall',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      uninstallingPlugin.value = plugin.name;
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/${plugin.name}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${plugin.name}" uninstalled successfully!`);
          await refreshPlugins();
          await store.dispatch('tools/refreshAllTools');
          // If uninstalled plugin was selected, deselect it
          if (selectedPlugin.value?.name === plugin.name) {
            store.dispatch('connectors/selectPlugin', null);
          }
        } else {
          throw new Error(data.error || 'Uninstallation failed');
        }
      } catch (error) {
        emit('show-alert', 'Error', `Failed to uninstall plugin: ${error.message}`);
      } finally {
        uninstallingPlugin.value = null;
      }
    }

    function selectPlugin(plugin) {
      playSound('typewriterKeyPress');
      const isInstalled = isPluginInstalled(plugin.name);
      store.dispatch('connectors/selectPlugin', { ...plugin, _isInstalled: isInstalled });
    }

    function deselectPlugin() {
      store.dispatch('connectors/selectPlugin', null);
    }

    function triggerFileUpload() {
      fileInput.value?.click();
    }

    async function handleFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        await uploadPluginFile(file);
      }
      event.target.value = '';
    }

    async function handleFileDrop(event) {
      const file = event.dataTransfer.files[0];
      if (file && (file.name.endsWith('.agnt') || file.name.endsWith('.tar.gz') || file.name.endsWith('.tgz'))) {
        await uploadPluginFile(file);
      } else {
        emit('show-alert', 'Error', 'Please drop a .agnt plugin file');
      }
    }

    async function uploadPluginFile(file) {
      isLoading.value = true;
      try {
        const reader = new FileReader();
        const fileData = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const pluginName = file.name.replace(/\.(agnt|tar\.gz|tgz)$/, '');

        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/install-file`, {
          method: 'POST',
          body: JSON.stringify({
            name: pluginName,
            fileData: fileData,
            fileName: file.name,
          }),
        });

        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${pluginName}" installed successfully!`);
          await refreshPlugins();
          await store.dispatch('tools/refreshAllTools');
        } else {
          throw new Error(data.error || 'Installation failed');
        }
      } catch (error) {
        emit('show-alert', 'Error', `Failed to install plugin: ${error.message}`);
      } finally {
        isLoading.value = false;
      }
    }

    async function onPluginInstalled() {
      // refresh every store the plugin could have touched. Tool-only
      // plugins need tool/plugin refresh; ecosystem packs also drop new
      // agents/workflows/skills/widgets in DB and we want those visible
      // immediately on their respective pages.
      await refreshPlugins();
      await Promise.all([
        store.dispatch('tools/refreshAllTools').catch(() => {}),
        store.dispatch('agents/fetchAgents', { force: true }).catch(() => {}),
        store.dispatch('workflows/fetchWorkflows', { force: true }).catch(() => {}),
        store.dispatch('skills/fetchSkills').catch(() => {}),
        store.dispatch('widgetDefinitions/fetchDefinitions').catch(() => {}),
      ]);
      // Stay on the current tab — switching to 'installed' is jarring when
      // the user just built a pack and might want to keep iterating.
    }

    // Revenue calculation functions for paid plugins
    function getRevenueMainText() {
      const price = parseFloat(publishForm.value.price) || 0;
      if (price <= 0) return '';

      const planType = store.getters['userAuth/planType'] || 'free';

      // Calculate earnings for each buyer tier
      const tiers = {
        enterprise: { fee: 0, earnings: price * 1.0, label: 'Enterprise (0% fee)' },
        business: { fee: 5, earnings: price * 0.95, label: 'Business (5% fee)' },
        personal: { fee: 10, earnings: price * 0.9, label: 'Personal (10% fee)' },
        free: { fee: 20, earnings: price * 0.8, label: 'Free (20% fee)' },
      };

      const userTier = tiers[planType];
      const userEarnings = userTier.earnings.toFixed(2);

      return `As a ${userTier.label} seller, you'll earn $${userEarnings} per sale.`;
    }

    function getRevenueComparisonText() {
      const price = parseFloat(publishForm.value.price) || 0;
      if (price <= 0) return '';

      // Calculate earnings for each buyer tier
      const tiers = {
        enterprise: { fee: 0, earnings: price * 1.0, label: 'Enterprise (0% fee)' },
        business: { fee: 5, earnings: price * 0.95, label: 'Business (5% fee)' },
        personal: { fee: 10, earnings: price * 0.9, label: 'Personal (10% fee)' },
        free: { fee: 20, earnings: price * 0.8, label: 'Free (20% fee)' },
      };

      // Build comparison text
      const allTiers = Object.entries(tiers)
        .map(([key, tier]) => `${tier.label}: $${tier.earnings.toFixed(2)}`)
        .join(' • ');

      return `All tiers: ${allTiers}`;
    }

    function setupStripe() {
      // Navigate to billing/payments settings to set up Stripe Connect
      store.dispatch('navigation/navigateTo', { page: 'settings', tab: 'billing' });
    }

    // Publish functions
    function selectPluginToPublish(plugin) {
      const listing = publishedListingFor(plugin);
      if (listing) {
        // Update mode: the listing already owns title/description/price. Editing
        // those is `PUT /marketplace/items/:id` and belongs to the marketplace
        // panel; this tab ships bytes.
        publishSelectedPlugin.value = plugin;
        publishForm.value.changelog = '';
        return;
      }
      playSound('typewriterKeyPress');
      publishSelectedPlugin.value = plugin;
      // Pre-fill form with plugin data
      publishForm.value.displayName = getDisplayName(plugin);
      publishForm.value.description = plugin.description || '';
      publishForm.value.category = 'utility';
      publishForm.value.tags = '';
      publishForm.value.isFree = true;
      publishForm.value.price = '';
      publishForm.value.changelog = '';
    }

    async function publishPlugin() {
      if (!publishSelectedPlugin.value) {
        emit('show-alert', 'Error', 'Please select a plugin to publish');
        return;
      }

      if (!isUpdateMode.value && (!publishForm.value.displayName || !publishForm.value.description)) {
        emit('show-alert', 'Error', 'Please fill in all required fields');
        return;
      }

      isPublishing.value = true;
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required. Please log in.');
        }

        // First, get the plugin package data
        const packageResponse = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed/${publishSelectedPlugin.value.name}/package`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const packageData = await packageResponse.json();
        if (!packageData.success) {
          throw new Error(packageData.error || 'Failed to get plugin package');
        }

        // UPDATE: an existing listing takes new bytes through the version
        // endpoint. /marketplace/publish is create-only and 409s here.
        if (isUpdateMode.value) {
          const listing = selectedPublishedListing.value;
          const updateResponse = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${listing.id}/version`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              packageData: packageData.data,
              changelog: publishForm.value.changelog || `Version ${publishSelectedPlugin.value.version}`,
            }),
          });
          const updateResult = await updateResponse.json();
          if (!updateResponse.ok) throw new Error(updateResult.error || 'Failed to publish update');

          triggerConfetti();
          emit(
            'show-alert',
            'Update Published',
            `${getDisplayName(publishSelectedPlugin.value)} is now at v${updateResult.version}. ` +
              `Existing users will see it as an available update.`
          );
          await fetchMyPublishedPlugins();
          publishSelectedPlugin.value = null;
          publishForm.value.changelog = '';
          return;
        }

        // CREATE: first publish of this plugin id.
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/publish`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // Required fields for marketplace API
            asset_type: 'plugin',
            asset_id: publishSelectedPlugin.value.name, // Plugin name serves as the asset ID
            asset_data: {
              manifest: publishSelectedPlugin.value,
              downloadUrl: null, // Will be set by server after storing the package
              packageData: packageData.data, // Base64 encoded .agnt file
              size: packageData.size,
              // Recording the repo is the handshake that makes the GitHub
              // Actions provenance publish path reachable for this listing.
              // Without it the provenance endpoint can never match a listing.
              repository: extractRepository(publishSelectedPlugin.value),
              homepage: publishSelectedPlugin.value.homepage || undefined,
            },
            // Listing metadata
            title: publishForm.value.displayName,
            description: publishForm.value.description,
            category: publishForm.value.category,
            tags: publishForm.value.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
            price: publishForm.value.isFree ? 0 : parseFloat(publishForm.value.price) || 0,
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Failed to publish plugin');
        }

        // Trigger confetti celebration!
        triggerConfetti();

        emit('show-alert', 'Success', `Plugin "${publishForm.value.displayName}" submitted for review!`);

        await fetchMyPublishedPlugins();

        // Reset form
        publishSelectedPlugin.value = null;
        publishForm.value = {
          displayName: '',
          description: '',
          category: 'utility',
          tags: '',
          isFree: true,
          price: '',
          changelog: '',
        };
      } catch (error) {
        emit('show-alert', 'Error', `Failed to publish: ${error.message}`);
      } finally {
        isPublishing.value = false;
      }
    }

    // Confetti animation
    const triggerConfetti = () => {
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 2000 };

      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }

      const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Create confetti from two origins
        if (window.confetti) {
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          });
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          });
        }
      }, 250);
    };

    // Handler for realtime plugin install events
    const handlePluginInstalled = async () => {
      console.log('[Plugins] Received plugin-installed event, refreshing...');
      try {
        await fetchInstalledPlugins();
        // A background auto-update broadcasts this too, so the chip that
        // reports it has to be re-read here, not only at mount.
        await loadUpdateStatus();
        await store.dispatch('tools/refreshAllTools');
        console.log(
          '[Plugins] Refresh complete, installed plugins:',
          installedPlugins.value.map((p) => p.name),
        );
      } catch (error) {
        console.error('[Plugins] Error refreshing after plugin install:', error);
      }
    };

    const handlePluginUninstalled = async () => {
      console.log('[Plugins] Received plugin-uninstalled event, refreshing...');
      try {
        await fetchInstalledPlugins();
        await store.dispatch('tools/refreshAllTools');
        console.log('[Plugins] Refresh complete after uninstall');
      } catch (error) {
        console.error('[Plugins] Error refreshing after plugin uninstall:', error);
      }
    };

    onMounted(() => {
      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }

      if (isPro.value) {
        refreshPlugins();
        // Needed before the Publish tab can tell create from update.
        fetchMyPublishedPlugins();
        // Drives the review badge — the only thing on this screen still
        // allowed to ask for attention.
        loadUpdateStatus();
      }

      // Listen for realtime plugin events
      window.addEventListener('plugin-installed', handlePluginInstalled);
      window.addEventListener('plugin-uninstalled', handlePluginUninstalled);
    });

    onUnmounted(() => {
      // Clean up event listeners
      window.removeEventListener('plugin-installed', handlePluginInstalled);
      window.removeEventListener('plugin-uninstalled', handlePluginUninstalled);
    });

    return {
      emit,
      modalRef,
      searchQuery,
      activeTab,
      isLoading,
      installedPlugins,
      marketplacePlugins,
      filteredInstalledPlugins,
      filteredMarketplacePlugins,
      sortedInstalledPlugins,
      selectedPlugin,
      installingPlugin,
      uninstallingPlugin,
      fileInput,
      isManualInstallCollapsed,
      publishSelectedPlugin,
      isPublishing,
      publishForm,
      publishedListingFor,
      selectedPublishedListing,
      isUpdateMode,
      versionCanPublish,
      versionBlockReason,
      isPluginInstalled,
      getDisplayName,
      trustTierLabel,
      trustTooltipText,
      updatingName,
      updateStatus,
      pluginNotices,
      reviewCount,
      reviewUpdate,
      isPinned,
      togglePin,
      openMenuFor,
      toggleMenu,
      closeMenu,
      formatSize,
      refreshPlugins,
      installPlugin,
      confirmUninstall,
      selectPlugin,
      deselectPlugin,
      triggerFileUpload,
      handleFileSelect,
      handleFileDrop,
      onPluginInstalled,
      selectPluginToPublish,
      publishPlugin,
      stripeConnected,
      getRevenueMainText,
      getRevenueComparisonText,
      setupStripe,
      isPro,
    };
  },
};
</script>

<style scoped>
.plugins-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* PRO Badge Header */
.plugins-header {
  margin-bottom: 8px;
}

.plugins-header h3 {
  margin: 0 0 8px 0;
  font-size: 1.5em;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 12px;
}

.pro-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.5em;
  color: var(--color-yellow);
  background: rgba(255, 215, 0, 0.15);
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 215, 0, 0.4);
  font-weight: 600;
}

.subtitle {
  margin: 0;
  color: var(--color-light-med-navy);
  font-size: 0.9em;
}

/* Locked State */
.plugins-list.locked {
  position: relative;
  pointer-events: none;
  user-select: none;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
}

.plugin-card.locked {
  filter: grayscale(100%);
  opacity: 0.5;
}

.locked-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  background: rgba(0, 0, 0, 0.8);
  padding: 24px 32px;
  border-radius: 12px;
  border: 2px solid var(--color-yellow);
  pointer-events: all;
  z-index: 10;
}

.locked-overlay i {
  font-size: 2.5em;
  color: var(--color-yellow);
  margin-bottom: 12px;
  display: block;
}

.locked-overlay p {
  margin: 0;
  color: var(--text-on-scrim);
  font-weight: 600;
  font-size: 1.1em;
}

.controls-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-wrapper {
  flex: 1;
}

.tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--terminal-border-color);
}

.tab {
  background: transparent;
  border: none;
  padding: 12px 24px;
  cursor: pointer;
  color: var(--color-text-muted);
  font-weight: 500;
  font-size: 0.95em;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}

.tab:hover {
  color: var(--color-text);
  background: rgba(var(--green-rgb), 0.05);
}

.tab.active {
  color: var(--color-green);
  border-bottom-color: var(--color-green);
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--color-text-muted);
}

.empty-state i {
  font-size: 3em;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0 0 16px 0;
}

.empty-state .hint {
  font-size: 0.9em;
  opacity: 0.7;
}

.plugins-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.plugin-card {
  background: transparent;
  border: 2px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 16px;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

body.dark .plugin-card {
  background: transparent;
  border-color: var(--terminal-border-color);
}

.plugin-card:hover {
  border-color: var(--color-green);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.1);
  transform: translateY(-2px);
}

.plugin-card.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.2);
}

button.base-button.primary.refresh {
  padding: 7px 12px;
  border-radius: 8px;
}

.plugin-card.installed {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.03);
}

.plugin-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.plugin-icon {
  width: 48px;
  height: 48px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5em;
  color: var(--color-green);
  flex-shrink: 0;
}

.plugin-icon :deep(svg) {
  width: 32px;
  height: 32px;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  margin: 0 0 4px 0;
  font-size: 1.1em;
  font-weight: 600;
  color: var(--color-text);
}

.plugin-version {
  font-size: 0.85em;
  color: var(--color-text-muted);
  background: rgba(127, 129, 147, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
}

/* Updates surface: one chip per card, and the overflow that holds the pin. */
.review-count {
  background: var(--color-yellow);
  color: var(--color-bg, #111);
  border-radius: 10px;
  padding: 0 7px;
  margin-left: 6px;
  font-size: 0.75em;
  font-weight: 700;
}

.notice-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  padding: 3px 9px;
  border-radius: 4px;
  white-space: nowrap;
  border: 1px solid transparent;
  background: rgba(127, 129, 147, 0.15);
  color: var(--color-text-muted);
}

.notice-chip.review {
  color: var(--color-yellow);
  background: color-mix(in srgb, var(--color-yellow) 14%, transparent);
  border-color: color-mix(in srgb, var(--color-yellow) 45%, transparent);
  font-weight: 600;
  cursor: pointer;
}

.notice-chip.review:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-yellow) 26%, transparent);
}

.notice-chip.review:disabled {
  cursor: default;
  opacity: 0.7;
}

.notice-chip.updated {
  color: var(--color-green);
  background: color-mix(in srgb, var(--color-green) 12%, transparent);
  cursor: help;
}

.notice-chip.failed {
  color: var(--color-red);
  background: color-mix(in srgb, var(--color-red) 12%, transparent);
  cursor: help;
}

.notice-chip.pinned {
  cursor: help;
}

.card-menu {
  position: relative;
  display: inline-flex;
}

.card-menu-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 3px 7px;
  border-radius: 4px;
  line-height: 1;
}

.card-menu-btn:hover {
  color: var(--color-text);
  background: rgba(127, 129, 147, 0.18);
}

.card-menu-items {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 195px;
  padding: 4px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  /* A floating layer must OCCLUDE what it covers. --color-darker-0 is a 10%
     tint meant for recessed wells, so it let the card read straight through
     the menu. --color-popup is the surface token for anything that floats. */
  background: var(--color-popup);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.card-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--color-text);
  font-size: 0.85em;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.card-menu-item:hover {
  background: rgba(127, 129, 147, 0.18);
}

/* trust system Layer 6: trust tier badge (display-only — never affects loading) */
.trust-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75em;
  padding: 2px 8px;
  border-radius: 4px;
  margin-left: 0;
  white-space: nowrap;
  cursor: help;
}

.trust-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.trust-badge.trust-official {
  color: var(--color-green);
  background: color-mix(in srgb, var(--color-green) 12%, transparent);
}

.trust-badge.trust-community {
  color: var(--color-green);
  background: color-mix(in srgb, var(--color-green) 12%, transparent);
}

.trust-badge.trust-unverified {
  color: var(--color-yellow);
  background: color-mix(in srgb, var(--color-yellow) 12%, transparent);
}

.trust-badge.trust-unaudited {
  color: var(--color-red);
  background: color-mix(in srgb, var(--color-red) 12%, transparent);
}

.plugin-status {
  flex-shrink: 0;
}

.status-badge {
  font-size: 0.8em;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-badge.installed {
  background: rgba(var(--green-rgb), 0.2);
  color: var(--color-green);
}

.status-badge.paid {
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
  font-weight: 700;
}

.status-badge.free {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.plugin-description {
  font-size: 0.9em;
  color: var(--color-text-muted);
  margin: 0 0 12px 0;
  line-height: 1.5;
}

.plugin-tools {
  margin-bottom: 12px;
  margin-top: auto;
}

.tools-label {
  font-size: 0.85em;
  color: var(--color-text-muted);
  margin-right: 8px;
}

.tools-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.tool-badge {
  font-size: 0.8em;
  padding: 3px 8px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 4px;
  color: var(--color-green);
}

.plugin-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  /* margin-bottom: 12px; */
  font-size: 0.85em;
  color: var(--color-text-muted);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.plugin-actions {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
  min-height: 40px; /* Keep space if empty */
}

/* Manual Install Section */
.manual-install-section {
  margin-bottom: 8px;
  padding: 20px;
  /* background: var(--color-ultra-light-navy); */
  border: 2px dashed var(--terminal-border-color);
  border-radius: 12px;
}

body.dark .manual-install-section {
  background: rgba(0, 0, 0, 10%);
  border-color: var(--terminal-border-color);
}

.manual-install-section h4 {
  margin: 0 0 8px 0;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.manual-install-section p {
  margin: 0 0 16px 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.upload-area {
  padding: 32px;
  border: 2px dashed var(--terminal-border-color);
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-muted);
}

.upload-area:hover {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
  color: var(--color-green);
}

.upload-area i {
  font-size: 2em;
  margin-bottom: 8px;
  display: block;
}

/* Collapsible Section */
.manual-install-section .section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  margin-bottom: 0;
}

.manual-install-section .section-header h4 {
  margin: 0;
}

.manual-install-section.collapsed {
  padding: 16px 20px;
}

.manual-install-section.collapsed .section-header {
  margin-bottom: 0;
}

.manual-install-section .section-content {
  margin-top: 16px;
}

.manual-install-section .section-content p {
  margin: 0 0 16px 0;
}

/* Already-published marker in the plugin picker */
.published-chip {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  letter-spacing: 0.4px;
  background: rgba(18, 224, 255, 0.12);
  color: var(--color-blue, #12e0ff);
  border: 1px solid rgba(18, 224, 255, 0.3);
}

/* Update-mode version banner */
.version-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: 8px;
  font-size: 13px;
  background: rgba(25, 239, 131, 0.08);
  border: 1px solid rgba(25, 239, 131, 0.28);
  color: var(--color-text, #e0e0e0);
}

.version-summary.blocked {
  background: rgba(255, 149, 0, 0.08);
  border-color: rgba(255, 149, 0, 0.32);
}

.version-summary i {
  color: var(--color-green, #19ef83);
}

.version-summary.blocked i {
  color: var(--status-amber-text);
}

/* Publish Section Styles */
.publish-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.publish-header {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.publish-header h3 {
  margin: 0 0 8px 0;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 10px;
}

.publish-header h3 i {
  color: var(--color-green);
}

.publish-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.publish-step {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
}

.publish-step .step-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.publish-step .step-header h4 {
  margin: 0;
  color: var(--color-text);
}

.step-badge {
  width: 28px;
  height: 28px;
  background: var(--color-green);
  color: var(--text-primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9em;
  flex-shrink: 0;
}

/* Plugin Select Grid */
.plugin-select-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.plugin-select-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-popup);
  border: 2px solid var(--terminal-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.plugin-select-card:hover {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}

.plugin-select-card.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
}

.plugin-select-icon {
  width: 40px;
  height: 40px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-green);
  flex-shrink: 0;
}

.plugin-select-icon :deep(svg) {
  width: 24px;
  height: 24px;
}

.plugin-select-info {
  flex: 1;
  min-width: 0;
}

.plugin-select-name {
  display: block;
  font-weight: 500;
  color: var(--color-text);
  font-size: 0.9em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plugin-select-version {
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.selected-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--color-green);
  font-size: 1.1em;
}

/* Publish Form */
.publish-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-row label {
  font-size: 0.9em;
  font-weight: 500;
  color: var(--color-text);
}

.form-row textarea {
  width: 100%;
  padding: 12px;
  border: 2px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.95em;
  resize: vertical;
  min-height: 80px;
  transition: border-color 0.2s ease;
}

.form-row textarea:focus {
  outline: none;
  border-color: var(--color-green);
}

.form-row textarea::placeholder {
  color: var(--color-text-muted);
}

.checkbox-row label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex-direction: row;
}

.checkbox-row input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--color-green);
}

/* Publish Actions */
.publish-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.publish-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 12px 16px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 8px;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.publish-note i {
  color: var(--color-green);
}

/* Empty state small variant */
.empty-state.small {
  padding: 24px 16px;
}

.empty-state.small i {
  font-size: 2em;
  margin-bottom: 12px;
}

.empty-state.small p {
  margin: 0 0 12px 0;
  font-size: 0.9em;
}

/* Revenue Info Styles */
.revenue-info {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.revenue-main {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-green);
}

.revenue-main i {
  font-size: 14px;
  flex-shrink: 0;
}

.revenue-comparison {
  font-size: 10px;
  color: var(--color-green);
  opacity: 0.7;
  line-height: 1.4;
  padding-left: 22px;
}

/* Stripe Connect Warning Styles */
.stripe-warning {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 16px;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stripe-warning > i {
  font-size: 20px;
  color: var(--color-yellow);
}

.stripe-warning p {
  font-size: 13px;
  color: var(--color-text);
  margin: 0;
}

.setup-stripe-btn {
  padding: 10px 16px;
  background: var(--color-yellow);
  border: 1px solid var(--color-yellow);
  color: var(--on-fill-warning);
  font-weight: 600;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.setup-stripe-btn:hover {
  background: rgba(245, 158, 11, 0.9);
  transform: translateY(-1px);
}

.setup-stripe-btn i {
  color: var(--color-darker-3);
}
</style>
