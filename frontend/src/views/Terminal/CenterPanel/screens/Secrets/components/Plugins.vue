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
      <div class="controls-group">
        <BaseSelect
          v-model="statusFilter"
          :options="[
            { value: 'all', label: 'All' },
            { value: 'installed', label: 'Installed' },
            { value: 'available', label: 'Available' },
          ]"
        />
        <BaseButton variant="primary" class="refresh-btn" @click="manualRefresh" :disabled="isLoading">
          <i class="fas fa-sync" :class="{ 'fa-spin': isLoading }"></i> Refresh
        </BaseButton>
      </div>
    </div>

    <!-- Tabs - Only for PRO -->
    <div v-if="isPro" class="tabs">
      <button class="tab" :class="{ active: activeTab === 'installed' }" @click="activeTab = 'installed'">
        <i class="fas fa-check-circle"></i> Installed ({{ installedPlugins.length }})
      </button>
      <button class="tab" :class="{ active: activeTab === 'marketplace' }" @click="activeTab = 'marketplace'">
        <i class="fas fa-store"></i> Marketplace ({{ marketplacePlugins.length }})
      </button>
      <button class="tab" :class="{ active: activeTab === 'builder' }" @click="activeTab = 'builder'">
        <i class="fas fa-magic"></i> Build Plugin
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
        <p>Upgrade to PRO to unlock</p>
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
            </div>
            <div class="plugin-status">
              <span class="status-badge installed"><i class="fas fa-check"></i> Installed</span>
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
            </div>
            <div class="plugin-info">
              <h3 class="plugin-name">{{ getDisplayName(plugin) }}</h3>
              <span class="plugin-version">v{{ plugin.version }}</span>
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
                <span class="plugin-select-version">v{{ plugin.version }}</span>
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
            <h4>Plugin Details</h4>
          </div>
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

        <!-- Publish Button -->
        <div v-if="publishSelectedPlugin" class="publish-step">
          <div class="step-header">
            <span class="step-badge">3</span>
            <h4>Publish</h4>
          </div>
          <div class="publish-actions">
            <p class="publish-note">
              <i class="fas fa-info-circle"></i>
              Your plugin will be reviewed before appearing in the marketplace.
            </p>
            <BaseButton variant="primary" @click="publishPlugin" :disabled="isPublishing">
              <i class="fas" :class="isPublishing ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'"></i>
              {{ isPublishing ? 'Publishing...' : 'Publish to Marketplace' }}
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
import PluginBuilder from './PluginBuilder.vue';
import { API_CONFIG } from '@/tt.config.js';
import { useLicense } from '@/composables/useLicense';

export default {
  name: 'Plugins',
  components: {
    BaseInput,
    BaseSelect,
    BaseButton,
    SvgIcon,
    SimpleModal,
    PluginBuilder,
  },
  emits: ['show-alert'],
  setup(props, { emit }) {
    const store = useStore();
    const modalRef = ref(null);
    const searchQuery = ref('');
    const statusFilter = ref('all');
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
    const publishForm = ref({
      displayName: '',
      description: '',
      category: 'utility',
      tags: '',
      isFree: true,
      price: '',
    });

    // Shared state from store
    const activeTab = computed({
      get: () => store.getters['secrets/activeTab'],
      set: (val) => store.dispatch('secrets/setActiveTab', val),
    });

    const selectedPlugin = computed(() => store.getters['secrets/selectedPlugin']);

    // Stripe Connect status from store
    const stripeConnected = computed(() => store.getters['userAuth/stripeConnected'] || false);

    // Watch for refresh trigger from SecretsPanel
    watch(
      () => store.getters['secrets/refreshTrigger'],
      () => {
        refreshPlugins();
      }
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
      if (statusFilter.value === 'installed') {
        plugins = plugins.filter((p) => isPluginInstalled(p.name));
      } else if (statusFilter.value === 'available') {
        plugins = plugins.filter((p) => !isPluginInstalled(p.name));
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
          console.log('[Plugins] Setting installed plugins:', sanitized.map(p => p.name));
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
              })
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

    async function refreshPlugins(showFeedback = false) {
      // Always show loading when explicitly refreshing
      isLoading.value = true;

      try {
        // Run fetches in background
        await Promise.all([
          fetchInstalledPlugins(),
          fetchMarketplacePlugins(),
          store.dispatch('marketplace/fetchMyPurchases'),
          store.dispatch('marketplace/fetchMyInstalls'),
        ]);

        // Show success feedback if manually triggered
        if (showFeedback) {
          emit('show-alert', 'Success', 'Plugins refreshed successfully!');
        }
      } finally {
        isLoading.value = false;
      }
    }

    // Wrapper for manual refresh with feedback
    function manualRefresh() {
      refreshPlugins(true);
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
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: plugin.name, version: plugin.version || 'latest' }),
        });
        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${plugin.name}" installed successfully!`);
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
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/${plugin.name}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${plugin.name}" uninstalled successfully!`);
          await refreshPlugins();
          await store.dispatch('tools/refreshAllTools');
          // If uninstalled plugin was selected, deselect it
          if (selectedPlugin.value?.name === plugin.name) {
            store.dispatch('secrets/selectPlugin', null);
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
      store.dispatch('secrets/selectPlugin', { ...plugin, _isInstalled: isInstalled });
    }

    function deselectPlugin() {
      store.dispatch('secrets/selectPlugin', null);
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

        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/install-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      await refreshPlugins();
      await store.dispatch('tools/refreshAllTools');
      activeTab.value = 'installed';
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
      playSound('typewriterKeyPress');
      publishSelectedPlugin.value = plugin;
      // Pre-fill form with plugin data
      publishForm.value.displayName = getDisplayName(plugin);
      publishForm.value.description = plugin.description || '';
      publishForm.value.category = 'utility';
      publishForm.value.tags = '';
      publishForm.value.isFree = true;
      publishForm.value.price = '';
    }

    async function publishPlugin() {
      if (!publishSelectedPlugin.value) {
        emit('show-alert', 'Error', 'Please select a plugin to publish');
        return;
      }

      if (!publishForm.value.displayName || !publishForm.value.description) {
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

        // Publish to marketplace API (using /publish endpoint like other assets)
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

        // Reset form
        publishSelectedPlugin.value = null;
        publishForm.value = {
          displayName: '',
          description: '',
          category: 'utility',
          tags: '',
          isFree: true,
          price: '',
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
        await store.dispatch('tools/refreshAllTools');
        console.log('[Plugins] Refresh complete, installed plugins:', installedPlugins.value.map(p => p.name));
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
      statusFilter,
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
      isPluginInstalled,
      getDisplayName,
      formatSize,
      refreshPlugins,
      manualRefresh,
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
  color: #fff;
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

.controls-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.controls-group :deep(.form-field) {
  width: auto !important;
  min-width: fit-content !important;
}

.controls-group :deep(.custom-select) {
  width: 100% !important;
  min-width: 100px !important;
}

.controls-group :deep(.selected) {
  white-space: nowrap;
  padding-right: 28px;
  width: 100% !important;
  display: flex;
  justify-content: space-between;
  gap: 0;
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
  border: 2px solid var(--color-light-navy);
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
  background: var(--color-ultra-light-navy);
  border: 2px dashed var(--color-light-navy);
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
  color: var(--color-navy);
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
  background: var(--color-popup);
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
  color: var(--color-darker-3);
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
