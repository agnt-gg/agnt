<!-- Marketplace.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="MarketplacePanel"
    activeRightPanel="MarketplacePanel"
    screenId="MarketplaceScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      marketplaceWorkflows: filteredWorkflows,
      featuredWorkflows,
      filters,
      selectedWorkflow,
      activeTab,
    }"
    :panelProps="{ selectedWorkflow, activeTab }"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="marketplace-panel">
        <SimpleModal ref="simpleModal" />
        <!-- Sticky Header Container -->
        <div class="sticky-header">
          <BaseTabControls
            :tabs="tabs"
            :active-tab="activeTab"
            :current-layout="currentLayout"
            :show-grid-toggle="true"
            @select-tab="selectTab"
            @set-layout="setLayout"
          />

          <!-- Search and Controls Bar (hide for My Earnings tab) -->
          <div v-if="activeTab !== 'my-earnings'" class="controls-bar">
            <div class="search-wrapper">
              <input
                type="text"
                class="search-input"
                placeholder="Search marketplace..."
                :value="filters.search"
                @input="handleSearch($event.target.value)"
              />
            </div>
          </div>

          <!-- Category Filter Pills (hide for My Earnings tab) -->
          <div v-if="currentLayout === 'grid' && activeTab !== 'my-earnings'" class="category-pills">
            <button class="category-pill" :class="{ active: selectedCategory === 'all' }" @click="selectedCategory = 'all'">
              All ({{ categoryCounts.all || 0 }})
            </button>
            <button
              v-for="category in availableCategories"
              :key="category"
              class="category-pill"
              :class="{ active: selectedCategory === category }"
              @click="selectedCategory = category"
            >
              {{ category }} ({{ categoryCounts[category] || 0 }})
            </button>
          </div>

          <!-- Results Count (hide for My Earnings tab) -->
          <div v-if="currentLayout === 'grid' && activeTab !== 'my-earnings'" class="results-info">
            Showing {{ displayedWorkflows.length }} of {{ filteredWorkflows.length }} {{ currentAssetTypeLabel }}
          </div>
        </div>

        <!-- Main Content -->
        <div class="marketplace-content">
          <main class="marketplace-main-content">
            <!-- Earnings Dashboard (My Earnings Tab) -->
            <div v-if="activeTab === 'my-earnings'" class="earnings-dashboard">
              <div class="earnings-header">
                <h2 class="earnings-title">
                  <i class="fas fa-chart-line"></i>
                  My Earnings Dashboard
                </h2>
              </div>

              <!-- Earnings Summary Cards -->
              <div class="earnings-summary">
                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-dollar-sign"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">Total Revenue</div>
                    <div class="earnings-card-value">${{ myEarnings.totalEarnings?.toFixed(2) || '0.00' }}</div>
                    <div class="earnings-card-subtitle">Gross sales revenue</div>
                  </div>
                </div>

                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-hand-holding-usd"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">Your Earnings</div>
                    <div class="earnings-card-value">${{ myEarnings.totalNetEarnings?.toFixed(2) || '0.00' }}</div>
                    <div class="earnings-card-subtitle">After platform fees (0-15%)</div>
                  </div>
                </div>

                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-shopping-cart"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">Total Sales</div>
                    <div class="earnings-card-value">{{ myEarnings.totalSales || 0 }}</div>
                    <div class="earnings-card-subtitle">Completed purchases</div>
                  </div>
                </div>

                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-calendar-alt"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">This Month</div>
                    <div class="earnings-card-value">${{ myEarnings.thisMonthNetEarnings?.toFixed(2) || '0.00' }}</div>
                    <div class="earnings-card-subtitle">Net earnings</div>
                  </div>
                </div>
              </div>

              <!-- Earnings Breakdown -->
              <div class="earnings-breakdown">
                <h3 class="section-title">
                  <i class="fas fa-chart-pie"></i>
                  Revenue Breakdown
                </h3>
                <div class="breakdown-grid">
                  <div class="breakdown-item">
                    <div class="breakdown-label">Gross Revenue</div>
                    <div class="breakdown-value">${{ myEarnings.totalEarnings?.toFixed(2) || '0.00' }}</div>
                  </div>
                  <div class="breakdown-item fee">
                    <div class="breakdown-label">Platform Fee (15%)</div>
                    <div class="breakdown-value">-${{ myEarnings.totalPlatformFees?.toFixed(2) || '0.00' }}</div>
                  </div>
                  <div class="breakdown-item net">
                    <div class="breakdown-label">Your Net Earnings (85%)</div>
                    <div class="breakdown-value">${{ myEarnings.totalNetEarnings?.toFixed(2) || '0.00' }}</div>
                  </div>
                </div>
              </div>

              <!-- Sales Breakdown Table -->
              <div class="earnings-section">
                <h3 class="section-title">
                  <i class="fas fa-list"></i>
                  Sales Breakdown
                </h3>
                <BaseTable
                  v-if="myEarnings.itemBreakdown && myEarnings.itemBreakdown.length > 0"
                  :items="myEarnings.itemBreakdown"
                  :columns="earningsColumns"
                  :show-search="false"
                  :show-sort-dropdown="false"
                  :enable-column-sorting="true"
                  no-results-text="No sales yet"
                  :title-key="'title'"
                >
                  <template #title="{ item }">
                    {{ item.title }}
                  </template>
                  <template #sales="{ item }">
                    {{ item.sales }}
                  </template>
                  <template #revenue="{ item }"> ${{ item.revenue?.toFixed(2) }} </template>
                  <template #earnings="{ item }"> ${{ item.earnings?.toFixed(2) }} </template>
                </BaseTable>
                <div v-else class="no-earnings">
                  <i class="fas fa-chart-line"></i>
                  <p>No sales yet. Publish paid items to start earning!</p>
                </div>
              </div>
            </div>

            <!-- Table View -->
            <BaseTable
              v-else-if="currentLayout === 'table'"
              :items="filteredWorkflows"
              :columns="tableColumns"
              :selected-id="selectedWorkflow?.id"
              :show-search="false"
              :show-sort-dropdown="false"
              :enable-column-sorting="true"
              search-placeholder="Search marketplace..."
              :search-keys="['title', 'publisher_pseudonym', 'category', 'description']"
              :no-results-text="`No ${currentAssetTypeLabel} found in marketplace.`"
              :title-key="'title'"
              @row-click="handleWorkflowClick"
              @search="handleSearch"
            >
              <template #title="{ item }">
                {{ item.title }}
              </template>
              <template #publisher="{ item }">
                {{ item.publisher_pseudonym || 'Anonymous' }}
              </template>
              <template #price="{ item }">
                <span v-if="item.price > 0" class="price-badge paid">${{ item.price.toFixed(2) }}</span>
                <span v-else class="price-badge free">FREE</span>
              </template>
              <template #rating="{ item }">
                <div class="rating-display">
                  <i class="fas fa-star"></i>
                  {{ item.rating ? item.rating.toFixed(1) : '0.0' }}
                  <span class="rating-count">({{ item.rating_count || 0 }})</span>
                </div>
              </template>
              <template #downloads="{ item }">
                <div class="downloads-display">
                  <i class="fas fa-download"></i>
                  {{ item.downloads || 0 }}
                </div>
              </template>
              <template #actions="{ item }">
                <button class="table-install-button" @click.stop="handleInstallWorkflow(item)" :disabled="isInstalled(item) || isPurchased(item)">
                  <i class="fas fa-download"></i>
                  {{ isInstalled(item) ? 'Installed' : isPurchased(item) ? 'Purchased' : item.price > 0 ? 'Purchase' : 'Install' }}
                </button>
              </template>
            </BaseTable>

            <!-- Featured Section (only in grid view) -->
            <div v-else-if="currentLayout === 'grid' && activeTab === 'featured' && featuredWorkflows.length > 0" class="featured-section">
              <h2 class="section-title">
                <i class="fas fa-star"></i>
                Featured Workflows
              </h2>
              <div class="featured-grid">
                <div
                  v-for="workflow in featuredWorkflows"
                  :key="workflow.id"
                  class="featured-card"
                  :class="{ selected: selectedWorkflow?.id === workflow.id }"
                  @click="handleWorkflowClick(workflow)"
                >
                  <div class="featured-badge">
                    <i class="fas fa-star"></i>
                    Featured
                  </div>

                  <div class="workflow-content">
                    <!-- Row 1: Avatar + Title/Publisher/Description -->
                    <div class="workflow-header">
                      <div class="workflow-avatar-container">
                        <div v-if="workflow.preview_image" class="workflow-avatar">
                          <img :src="workflow.preview_image" :alt="workflow.title" />
                        </div>
                        <div v-else class="workflow-avatar-placeholder">
                          <i :class="getAssetIcon(workflow)"></i>
                        </div>
                      </div>

                      <div class="workflow-info">
                        <div class="workflow-title-row">
                          <h3 class="workflow-name">{{ workflow.title }}</h3>
                          <span v-if="workflow.price > 0" class="workflow-price">${{ workflow.price.toFixed(2) }}</span>
                          <span v-else class="workflow-price free">FREE</span>
                        </div>

                        <div class="workflow-publisher">
                          <i class="fas fa-user"></i>
                          {{ workflow.publisher_pseudonym || 'Anonymous' }}
                        </div>

                        <p class="workflow-description">
                          {{ workflow.description || 'No description available' }}
                        </p>
                      </div>
                    </div>

                    <!-- Row 2: Ratings and Downloads -->
                    <div class="workflow-meta">
                      <div class="meta-item asset-type">
                        <span class="workflow-type" :class="`type-${workflow.asset_type || 'workflow'}`">{{ getAssetTypeLabel(workflow) }}</span>
                      </div>
                      <div class="meta-item">
                        <i class="fas fa-star"></i>
                        <span>{{ workflow.rating ? workflow.rating.toFixed(1) : '0.0' }}</span>
                        <span class="meta-count">({{ workflow.rating_count || 0 }})</span>
                      </div>
                      <div class="meta-item">
                        <i class="fas fa-download"></i>
                        <span>{{ formatNumber(workflow.downloads || 0) }}</span>
                      </div>
                      <div v-if="workflow.category" class="meta-item category">
                        <i class="fas fa-tag"></i>
                        <span>{{ workflow.category }}</span>
                      </div>
                    </div>

                    <!-- Row 3: Install Button -->
                    <button
                      class="install-button"
                      @click.stop="handleInstallWorkflow(workflow)"
                      :disabled="isInstalled(workflow) || isPurchased(workflow)"
                    >
                      <i class="fas fa-download"></i>
                      {{
                        isInstalled(workflow)
                          ? 'Installed'
                          : isPurchased(workflow)
                          ? 'Purchased'
                          : workflow.price > 0
                          ? 'Purchase & Install'
                          : 'Install Now'
                      }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Category Cards View (only in grid view, hide for My Earnings) -->
            <div v-if="currentLayout === 'grid' && activeTab !== 'my-earnings'" class="category-cards-container">
              <div class="category-cards-grid">
                <article
                  v-for="(workflows, categoryName) in workflowsByCategory"
                  :key="categoryName"
                  class="category-card"
                  :class="{ 'full-width': workflows.length >= 2 }"
                  role="listitem"
                  :aria-label="`${categoryName} Category`"
                >
                  <div class="category-header" @click="toggleCategoryCollapse(categoryName)">
                    <div class="category-title">
                      <span class="category-icon">{{ getCategoryInfo(categoryName).icon }}</span>
                      {{ categoryName }}
                    </div>
                    <div class="category-header-right">
                      <div class="category-count">{{ workflows.length }} workflows</div>
                      <button class="collapse-toggle" :class="{ collapsed: isCategoryCollapsed(categoryName) }">
                        <i class="fas fa-chevron-down"></i>
                      </button>
                    </div>
                  </div>
                  <div class="category-content" v-show="!isCategoryCollapsed(categoryName)">
                    <div class="workflows-grid">
                      <div
                        v-for="workflow in workflows"
                        :key="workflow.id"
                        class="workflow-card"
                        :class="{
                          selected: selectedWorkflow?.id === workflow.id,
                          installed: isInstalled(workflow) || isPurchased(workflow),
                        }"
                        @click="handleWorkflowClick(workflow)"
                      >
                        <div class="workflow-content">
                          <!-- Row 1: Avatar + Title/Publisher/Description -->
                          <div class="workflow-header">
                            <div class="workflow-avatar-container">
                              <div v-if="workflow.preview_image" class="workflow-avatar">
                                <img :src="workflow.preview_image" :alt="workflow.title" />
                              </div>
                              <div v-else class="workflow-avatar-placeholder">
                                <i :class="getAssetIcon(workflow)"></i>
                              </div>
                            </div>

                            <div class="workflow-info">
                              <div class="workflow-title-row">
                                <h3 class="workflow-name">{{ workflow.title }}</h3>
                                <span v-if="workflow.price > 0" class="workflow-price">${{ workflow.price.toFixed(2) }}</span>
                                <span v-else class="workflow-price free">FREE</span>
                              </div>

                              <div class="workflow-publisher">
                                <i class="fas fa-user"></i>
                                {{ workflow.publisher_pseudonym || 'Anonymous' }}
                              </div>

                              <p class="workflow-description">
                                {{ workflow.tagline || workflow.description || 'No description available' }}
                              </p>
                            </div>
                          </div>

                          <!-- Row 2: Ratings and Downloads -->
                          <div class="workflow-meta">
                            <div class="meta-item asset-type">
                              <span class="workflow-type" :class="`type-${workflow.asset_type || 'workflow'}`">{{
                                getAssetTypeLabel(workflow)
                              }}</span>
                            </div>
                            <div class="meta-item">
                              <i class="fas fa-star"></i>
                              <span>{{ workflow.rating ? workflow.rating.toFixed(1) : '0.0' }}</span>
                              <span class="meta-count">({{ workflow.rating_count || 0 }})</span>
                            </div>
                            <div class="meta-item">
                              <i class="fas fa-download"></i>
                              <span>{{ formatNumber(workflow.downloads || 0) }}</span>
                            </div>
                          </div>

                          <!-- Row 3: Install Button -->
                          <button
                            class="install-button"
                            @click.stop="handleInstallWorkflow(workflow)"
                            data-sound="chaChingMoney"
                            :disabled="isInstalled(workflow) || isPurchased(workflow)"
                          >
                            <i class="fas fa-download"></i>
                            {{
                              isInstalled(workflow) ? 'Installed' : isPurchased(workflow) ? 'Purchased' : workflow.price > 0 ? 'Purchase' : 'Install'
                            }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </main>
        </div>
      </div>
    </template>
  </BaseScreen>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="MarketplaceScreen" @close="onTutorialClose" />
</template>

<script>
import { ref, computed, nextTick, inject, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import BaseTabControls from '../../../_components/BaseTabControls.vue';
import BaseTable from '../../../_components/BaseTable.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import { useMarketplaceTutorial } from './useMarketplaceTutorial.js';

export default {
  name: 'MarketplaceScreen',
  components: { BaseScreen, BaseTabControls, BaseTable, SimpleModal, PopupTutorial },
  emits: ['screen-change'],
  setup(props, { emit }) {
    // Initialize tutorial
    const { tutorialConfig, startTutorial, onTutorialClose, initializeMarketplaceTutorial } = useMarketplaceTutorial();
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const simpleModal = ref(null);
    const terminalLines = ref([]);
    const selectedWorkflow = ref(null);
    const activeTab = ref('all');
    const currentLayout = ref('grid');
    const hideEmptyCategories = ref(true);
    const collapsedCategories = ref(new Set());
    const selectedCategory = ref('all');

    // Define table columns
    const tableColumns = [
      { key: 'title', label: 'Name', width: '2fr' },
      { key: 'publisher', label: 'Publisher', width: '1.5fr' },
      { key: 'price', label: 'Price', width: '100px' },
      { key: 'rating', label: 'Rating', width: '120px' },
      { key: 'downloads', label: 'Downloads', width: '120px' },
      { key: 'actions', label: 'Actions', width: '140px' },
    ];

    // Define earnings table columns
    const earningsColumns = [
      { key: 'title', label: 'Item', width: '2fr' },
      { key: 'sales', label: 'Sales', width: '100px' },
      { key: 'revenue', label: 'Revenue', width: '120px' },
      { key: 'earnings', label: 'Your Earnings', width: '140px' },
    ];

    // Define tabs - NOW WITH ASSET TYPES
    const tabs = [
      { id: 'all', name: 'All', icon: 'fas fa-list' },
      { id: 'workflows', name: 'Workflows', icon: 'fas fa-project-diagram' },
      { id: 'agents', name: 'Agents', icon: 'fas fa-robot' },
      { id: 'tools', name: 'Tools', icon: 'fas fa-wrench' },
      { id: 'plugins', name: 'Plugins', icon: 'fas fa-puzzle-piece' },
      // { id: 'featured', name: 'Featured', icon: 'fas fa-star' },
      { id: 'my-installs', name: 'My Installs', icon: 'fas fa-box-open' },
      { id: 'my-listings', name: 'My Listings', icon: 'fas fa-user-circle' },
      { id: 'my-earnings', name: 'My Earnings', icon: 'fas fa-dollar-sign' },
      // { id: 'free', name: 'Free', icon: 'fas fa-gift' },
      // { id: 'paid', name: 'Paid', icon: 'fas fa-coins' },
    ];

    // Computed properties from store
    const marketplaceWorkflows = computed(() => store.getters['marketplace/filteredMarketplaceWorkflows'] || []);
    const marketplaceAgents = computed(() => store.getters['marketplace/filteredMarketplaceAgents'] || []);
    const marketplaceTools = computed(() => store.getters['marketplace/filteredMarketplaceTools'] || []);
    const marketplacePlugins = computed(() => store.getters['marketplace/filteredMarketplacePlugins'] || []);
    const marketplaceItems = computed(() => store.getters['marketplace/filteredMarketplaceItems'] || []);
    const myPublishedItems = computed(() => store.state.marketplace.myPublishedItems || []);
    const myInstalls = computed(() => store.state.marketplace.myInstalls || []);
    const myPurchases = computed(() => store.state.marketplace.myPurchases || []);
    const featuredWorkflows = computed(() => store.state.marketplace.featuredWorkflows || []);
    const filters = computed(() => store.state.marketplace.filters);
    const isLoading = computed(() => store.state.marketplace.isLoading);
    const myEarnings = computed(() => store.state.marketplace.myEarnings || {});

    // Watch for category changes and close right panel
    watch(selectedCategory, () => {
      selectedWorkflow.value = null;
    });

    // Watch for filter changes from left panel and close right panel
    watch(
      () => filters.value.priceRange,
      () => {
        selectedWorkflow.value = null;
      }
    );

    watch(
      () => filters.value.minRating,
      () => {
        selectedWorkflow.value = null;
      }
    );

    watch(
      () => filters.value.sortBy,
      () => {
        selectedWorkflow.value = null;
      }
    );

    // Filtered workflows based on active tab
    const filteredWorkflows = computed(() => {
      // Select the correct data source based on active tab
      let items;
      switch (activeTab.value) {
        case 'workflows':
          items = marketplaceWorkflows.value;
          break;
        case 'agents':
          items = marketplaceAgents.value;
          break;
        case 'tools':
          items = marketplaceTools.value;
          break;
        case 'plugins':
          items = marketplacePlugins.value;
          break;
        case 'featured':
          items = featuredWorkflows.value;
          break;
        case 'my-installs':
          // Show installed items - combine installs and purchases
          items = myInstalls.value;
          break;
        case 'my-listings':
          // Show ONLY published items (filter out unpublished/draft)
          items = myPublishedItems.value.filter((item) => item.status === 'published');
          break;
        case 'all':
          // Combine ALL asset types and remove duplicates by ID
          const allItems = [...marketplaceWorkflows.value, ...marketplaceAgents.value, ...marketplaceTools.value];
          const uniqueIds = new Set();
          items = allItems.filter((item) => {
            if (uniqueIds.has(item.id)) {
              return false;
            }
            uniqueIds.add(item.id);
            return true;
          });
          break;
        case 'free':
        case 'paid':
          // For free/paid, also combine all asset types and remove duplicates
          const combinedItems = [...marketplaceWorkflows.value, ...marketplaceAgents.value, ...marketplaceTools.value];
          const seenIds = new Set();
          items = combinedItems.filter((item) => {
            if (seenIds.has(item.id)) {
              return false;
            }
            seenIds.add(item.id);
            return true;
          });
          break;
        default:
          items = marketplaceWorkflows.value;
      }

      // Apply price filters from left panel OR from free/paid tabs
      const priceFilter = filters.value.priceRange || (activeTab.value === 'free' ? 'free' : activeTab.value === 'paid' ? 'paid' : 'all');

      if (priceFilter === 'free') {
        items = items.filter((w) => !w.price || w.price === 0);
      } else if (priceFilter === 'paid') {
        items = items.filter((w) => w.price && w.price > 0);
      }

      // Apply rating filter from left panel
      if (filters.value.minRating && filters.value.minRating > 0) {
        items = items.filter((w) => (w.rating || 0) >= filters.value.minRating);
      }

      // Apply search filter
      if (filters.value.search && filters.value.search.trim()) {
        const searchLower = filters.value.search.toLowerCase().trim();
        items = items.filter((w) => {
          const title = (w.title || '').toLowerCase();
          const description = (w.description || '').toLowerCase();
          const tagline = (w.tagline || '').toLowerCase();
          const category = (w.category || '').toLowerCase();
          const publisher = (w.publisher_name || '').toLowerCase();

          // Handle tags - can be array or comma-separated string
          let tagsString = '';
          if (Array.isArray(w.tags)) {
            tagsString = w.tags.join(' ').toLowerCase();
          } else if (typeof w.tags === 'string') {
            tagsString = w.tags.toLowerCase();
          }

          return (
            title.includes(searchLower) ||
            description.includes(searchLower) ||
            tagline.includes(searchLower) ||
            category.includes(searchLower) ||
            publisher.includes(searchLower) ||
            tagsString.includes(searchLower)
          );
        });
      }

      // Apply sorting from left panel
      const sortBy = filters.value.sortBy || 'popular';
      const sorted = [...items];

      switch (sortBy) {
        case 'recent':
          sorted.sort((a, b) => new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0));
          break;
        case 'rating':
          sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
          break;
        case 'downloads':
          sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
          break;
        case 'price-low':
          sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
          break;
        case 'price-high':
          sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
          break;
        case 'popular':
        default:
          sorted.sort((a, b) => {
            const aScore = (b.downloads || 0) * 0.7 + (b.rating || 0) * 0.3;
            const bScore = (a.downloads || 0) * 0.7 + (a.rating || 0) * 0.3;
            return bScore - aScore;
          });
      }

      return sorted;
    });

    // Get unique categories from workflows
    const availableCategories = computed(() => {
      const categories = new Set();
      filteredWorkflows.value.forEach((workflow) => {
        if (workflow.category) {
          categories.add(workflow.category);
        }
      });
      return Array.from(categories).sort();
    });

    // Category counts
    const categoryCounts = computed(() => {
      const counts = { all: filteredWorkflows.value.length };
      availableCategories.value.forEach((cat) => {
        counts[cat] = filteredWorkflows.value.filter((w) => w.category === cat).length;
      });
      return counts;
    });

    // Workflows filtered by selected category
    const displayedWorkflows = computed(() => {
      if (selectedCategory.value === 'all') {
        return filteredWorkflows.value;
      }
      return filteredWorkflows.value.filter((w) => w.category === selectedCategory.value);
    });

    // Dynamic label for current asset type
    const currentAssetTypeLabel = computed(() => {
      switch (activeTab.value) {
        case 'workflows':
          return 'workflows';
        case 'agents':
          return 'agents';
        case 'tools':
          return 'tools';
        case 'plugins':
          return 'plugins';
        case 'featured':
          return 'items';
        case 'free':
        case 'paid':
        case 'all':
        default:
          return 'items';
      }
    });

    // Group workflows by category
    const workflowsByCategory = computed(() => {
      const categories = {};
      const workflows = displayedWorkflows.value;

      workflows.forEach((workflow) => {
        const category = workflow.category || 'Uncategorized';
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(workflow);
      });

      // Sort categories alphabetically
      const sortedCategories = {};
      Object.keys(categories)
        .sort((a, b) => a.localeCompare(b))
        .forEach((key) => {
          if (hideEmptyCategories.value) {
            if (categories[key].length > 0) {
              sortedCategories[key] = categories[key];
            }
          } else {
            sortedCategories[key] = categories[key];
          }
        });

      return sortedCategories;
    });

    // Helper methods
    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();

    const addLine = (content, type = 'default') => {
      terminalLines.value.push({ content, type });
      nextTick(() => scrollToBottom());
    };

    const getCategoryInfo = (categoryName) => {
      const categoryIcons = {
        'Data Processing': '🔄',
        Integration: '🔗',
        'File Management': '📁',
        Communication: '📧',
        Analytics: '📊',
        System: '⚙️',
        Automation: '🤖',
        Productivity: '📈',
        Uncategorized: '📋',
      };

      return {
        name: categoryName,
        icon: categoryIcons[categoryName] || '🔧',
        count: workflowsByCategory.value[categoryName]?.length || 0,
      };
    };

    const formatNumber = (num) => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
      }
      return num.toString();
    };

    const getAssetIcon = (asset) => {
      // Determine asset type from asset_type field or infer from context
      const assetType = asset.asset_type || 'workflow';

      switch (assetType) {
        case 'agent':
          return 'fas fa-robot';
        case 'tool':
          return 'fas fa-wrench';
        case 'plugin':
          return 'fas fa-puzzle-piece';
        case 'workflow':
        default:
          return 'fas fa-project-diagram';
      }
    };

    const getAssetTypeLabel = (asset) => {
      const assetType = asset.asset_type || 'workflow';

      switch (assetType) {
        case 'agent':
          return 'Agent';
        case 'tool':
          return 'Tool';
        case 'plugin':
          return 'Plugin';
        case 'workflow':
        default:
          return 'Workflow';
      }
    };

    const isInstalled = (item) => {
      // Check both id and marketplace_item_id to handle different data structures
      return myInstalls.value.some((installed) => installed.id === item.id || installed.marketplace_item_id === item.id);
    };

    const isPurchased = (item) => {
      // Check both id and marketplace_item_id to handle different data structures
      return myPurchases.value.some((purchased) => purchased.id === item.id || purchased.marketplace_item_id === item.id);
    };

    const handleWorkflowClick = (workflow) => {
      playSound('typewriterKeyPress');
      // If clicking the same workflow, close it
      if (selectedWorkflow.value?.id === workflow.id) {
        selectedWorkflow.value = null;
        addLine(`Closed workflow details`, 'info');
      } else {
        selectedWorkflow.value = workflow;
        addLine(`Selected workflow: ${workflow.title}`, 'info');
      }
    };

    const handleSearch = (query) => {
      store.dispatch('marketplace/updateFilters', { search: query });
    };

    const selectTab = async (tabId) => {
      activeTab.value = tabId;
      selectedWorkflow.value = null;

      // Update filters based on tab
      const filterUpdates = { search: filters.value.search };

      // Handle asset type tabs
      switch (tabId) {
        case 'workflows':
          filterUpdates.assetType = 'workflow';
          addLine(`[Marketplace] Viewing workflows`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'agents':
          filterUpdates.assetType = 'agent';
          addLine(`[Marketplace] Viewing agents`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'tools':
          filterUpdates.assetType = 'tool';
          addLine(`[Marketplace] Viewing tools`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'plugins':
          filterUpdates.assetType = 'plugin';
          addLine(`[Marketplace] Viewing plugins`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'free':
          filterUpdates.priceRange = 'free';
          filterUpdates.assetType = 'all';
          addLine(`[Marketplace] Viewing free items`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          break;
        case 'paid':
          filterUpdates.priceRange = 'paid';
          filterUpdates.assetType = 'all';
          addLine(`[Marketplace] Viewing paid items`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          break;
        case 'my-installs':
          addLine(`[Marketplace] Viewing my installed items`, 'info');
          await store.dispatch('marketplace/fetchMyInstalls');
          break;
        case 'my-listings':
          addLine(`[Marketplace] Viewing my published items`, 'info');
          await store.dispatch('marketplace/fetchMyPublishedItems');
          break;
        case 'my-earnings':
          addLine(`[Marketplace] Viewing my earnings`, 'info');
          await store.dispatch('marketplace/fetchMyEarnings');
          break;
        case 'all':
          filterUpdates.priceRange = 'all';
          filterUpdates.assetType = 'all';
          addLine(`[Marketplace] Viewing all items`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        default:
          filterUpdates.priceRange = 'all';
          filterUpdates.assetType = 'all';
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
      }
    };

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    const toggleHideEmptyCategories = () => {
      hideEmptyCategories.value = !hideEmptyCategories.value;
      addLine(`[Marketplace] ${hideEmptyCategories.value ? 'Hiding' : 'Showing'} empty categories`, 'info');
    };

    const toggleCategoryCollapse = (categoryName) => {
      playSound('typewriterKeyPress');
      if (collapsedCategories.value.has(categoryName)) {
        collapsedCategories.value.delete(categoryName);
      } else {
        collapsedCategories.value.add(categoryName);
      }
    };

    const isCategoryCollapsed = (categoryName) => {
      return collapsedCategories.value.has(categoryName);
    };

    const allCategoriesCollapsed = computed(() => {
      const categoryNames = Object.keys(workflowsByCategory.value);
      return categoryNames.length > 0 && categoryNames.every((name) => collapsedCategories.value.has(name));
    });

    const toggleCollapseAll = () => {
      const categoryNames = Object.keys(workflowsByCategory.value);

      if (allCategoriesCollapsed.value) {
        categoryNames.forEach((name) => collapsedCategories.value.delete(name));
        addLine('[Marketplace] Expanded all categories', 'info');
      } else {
        categoryNames.forEach((name) => collapsedCategories.value.add(name));
        addLine('[Marketplace] Collapsed all categories', 'info');
      }
    };

    const handleInstallWorkflow = async (workflow) => {
      const assetType = workflow.asset_type || 'workflow';
      const assetTypeLabel = assetType.charAt(0).toUpperCase() + assetType.slice(1);

      try {
        // Check if this is a paid item
        if (workflow.price && workflow.price > 0) {
          // Check if user has already purchased
          const hasPurchased = await store.dispatch('marketplace/checkPurchaseStatus', workflow.id);

          if (!hasPurchased) {
            // Show purchase confirmation modal
            const confirmed = await simpleModal.value.showModal({
              title: 'Purchase Required',
              message: `"${workflow.title}" costs $${workflow.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
              confirmText: 'Purchase Now',
              cancelText: 'Cancel',
              showCancel: true,
              confirmClass: 'btn-primary',
            });

            if (confirmed) {
              addLine(`[Marketplace] Redirecting to checkout for "${workflow.title}"...`, 'info');
              // Redirect to Stripe checkout
              await store.dispatch('marketplace/purchaseItem', {
                itemId: workflow.id,
              });
              // Note: User will be redirected to Stripe, so code after this won't execute
            }
            return;
          }
        }

        // If free or already purchased, proceed with installation
        addLine(`[Marketplace] Installing "${workflow.title}"...`, 'info');

        let result = await store.dispatch('marketplace/installWorkflow', {
          workflowId: workflow.id,
          auto_update: false,
        });

        // Check if missing plugins need to be installed
        if (result && result.needsPlugins && result.missingPlugins?.length > 0) {
          const pluginList = result.missingPlugins.map((p) => `• ${p.displayName || p.name}`).join('\n');

          const confirmed = await simpleModal.value.showModal({
            title: 'Plugins Required',
            message: `This ${assetType} requires plugins that aren't installed:\n\n${pluginList}\n\nInstall them now?`,
            confirmText: 'Install Plugins',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (!confirmed) {
            addLine(`[Marketplace] Installation cancelled - missing required plugins`, 'warning');
            return;
          }

          // Install each missing plugin with progress feedback
          const totalPlugins = result.missingPlugins.length;
          const installedPlugins = [];

          for (let i = 0; i < result.missingPlugins.length; i++) {
            const plugin = result.missingPlugins[i];
            const pluginName = plugin.displayName || plugin.name;

            addLine(`[Marketplace] Installing plugin ${i + 1}/${totalPlugins}: ${pluginName}...`, 'info');

            try {
              // Skip refresh during batch install - we'll refresh once at the end
              await store.dispatch('marketplace/installPlugin', {
                pluginName: plugin.name,
                skipRefresh: true
              });
              installedPlugins.push(pluginName);
              addLine(`[Marketplace] ✓ ${pluginName} installed`, 'success');
            } catch (pluginError) {
              addLine(`[Marketplace] ✗ Failed to install ${pluginName}: ${pluginError.message}`, 'error');
              await simpleModal.value.showModal({
                title: '✗ Plugin Installation Failed',
                message: `Failed to install required plugin "${pluginName}":\n\n${pluginError.message}\n\nThe ${assetType} was not installed.`,
                confirmText: 'OK',
                showCancel: false,
                confirmClass: 'btn-danger',
              });
              return;
            }
          }

          // Refresh tools once after all plugins are installed
          addLine(`[Marketplace] Refreshing tools...`, 'info');
          await store.dispatch('tools/refreshAllTools');

          // Notify all components that plugins were installed (for ToolSidebar, etc.)
          window.dispatchEvent(new CustomEvent('plugin-installed', { detail: { count: installedPlugins.length } }));

          // Show summary of installed plugins
          const pluginSummary = installedPlugins.map((p) => `• ${p}`).join('\n');
          await simpleModal.value.showModal({
            title: '✓ Plugins Installed',
            message: `Successfully installed ${installedPlugins.length} plugin(s):\n\n${pluginSummary}\n\nNow installing the ${assetType}...`,
            confirmText: 'Continue',
            showCancel: false,
            confirmClass: 'btn-primary',
          });

          // Now save the asset
          addLine(`[Marketplace] Saving ${assetType}...`, 'info');
          await store.dispatch('marketplace/saveInstalledAsset', {
            assetType: result.assetType,
            assetData: result.assetData,
          });

          // Update result to have assetId for the success message
          result = { assetId: result.assetData?.id || result.assetId };
        }

        addLine(`✓ ${assetTypeLabel} installed successfully!`, 'success');
        addLine(`  New ${assetType} ID: ${result.assetId}`, 'info');
        addLine(`  You can now find it in your ${assetType}s list`, 'info');

        // Refresh myInstalls and myPurchases to update UI immediately
        await Promise.all([store.dispatch('marketplace/fetchMyInstalls'), store.dispatch('marketplace/fetchMyPurchases')]);

        // Trigger confetti animation
        triggerConfetti();

        // Show success modal
        await simpleModal.value.showModal({
          title: '✓ Installed Successfully',
          message: `"${workflow.title}" has been installed!\n\nNew ${assetType} ID: ${result.assetId}\n\nYou can now find it in your ${assetType}s list.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Install error:', error);

        if (error.code === 'PAYMENT_REQUIRED') {
          addLine(`✗ This ${assetType} costs $${workflow.price}. Payment required.`, 'error');
          const confirmed = await simpleModal.value.showModal({
            title: 'Payment Required',
            message: `This ${assetType} costs $${workflow.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
            confirmText: 'Purchase Now',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (confirmed) {
            await store.dispatch('marketplace/purchaseItem', {
              itemId: workflow.id,
            });
          }
        } else if (error.message.includes('already installed')) {
          addLine(`✗ You have already installed this ${assetType}.`, 'error');
          await simpleModal.value.showModal({
            title: '✗ Already Installed',
            message: `You have already installed this ${assetType}.`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-secondary',
          });
        } else if (error.message.includes('invalid payment setup')) {
          addLine(`✗ This item has invalid payment configuration.`, 'error');
          await simpleModal.value.showModal({
            title: '✗ Payment Setup Error',
            message: `This item cannot be purchased due to invalid payment configuration.\n\nThe publisher needs to fix their Stripe Connect setup.\n\nError: ${error.message}`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
        } else {
          addLine(`✗ Error installing ${assetType}: ${error.message}`, 'error');
          await simpleModal.value.showModal({
            title: '✗ Installation Error',
            message: `Failed to install ${assetType}:\n\n${error.message}`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
        }
      }
    };

    const handlePanelAction = async (action, payload) => {
      console.log('Marketplace panel action:', action, payload);

      switch (action) {
        case 'navigate':
          emit('screen-change', payload);
          break;
        case 'update-filters':
          await store.dispatch('marketplace/updateFilters', payload);
          // Trigger fetch after updating filters
          await store.dispatch('marketplace/fetchMarketplaceWorkflows');
          addLine(`[Marketplace] Filters updated`, 'info');
          break;
        case 'refresh-marketplace':
          await store.dispatch('marketplace/fetchMarketplaceWorkflows');
          await store.dispatch('marketplace/fetchFeaturedWorkflows');
          addLine(`[Marketplace] Refreshed marketplace data`, 'info');
          break;
        case 'install-workflow':
          await handleInstallWorkflow(payload);
          break;
        case 'close-workflow-details':
          selectedWorkflow.value = null;
          addLine(`[Marketplace] Closed workflow details`, 'info');
          break;
        case 'item-updated':
          // Refresh the marketplace items after edit
          if (activeTab.value === 'my-listings') {
            await store.dispatch('marketplace/fetchMyPublishedItems');
            addLine(`[Marketplace] Listing updated - refreshed my listings`, 'success');
          }
          break;
        case 'item-unpublished':
          // Refresh both marketplace and my listings after unpublish
          await Promise.all([store.dispatch('marketplace/fetchMyPublishedItems'), store.dispatch('marketplace/fetchMarketplaceItems')]);
          selectedWorkflow.value = null;
          addLine(`[Marketplace] Item unpublished - refreshed listings`, 'success');
          break;
        case 'item-deleted':
          // Refresh both marketplace and my listings after delete
          await Promise.all([store.dispatch('marketplace/fetchMyPublishedItems'), store.dispatch('marketplace/fetchMarketplaceItems')]);
          selectedWorkflow.value = null;
          addLine(`[Marketplace] Item deleted - refreshed listings`, 'success');
          break;
        case 'item-republished':
          // Refresh both marketplace and my listings after republish
          await Promise.all([store.dispatch('marketplace/fetchMyPublishedItems'), store.dispatch('marketplace/fetchMarketplaceItems')]);
          addLine(`[Marketplace] Item republished - refreshed listings`, 'success');
          break;
        default:
          console.warn('Unhandled panel action:', action);
      }
    };

    const handleUserInputSubmit = async (input) => {
      addLine(`> ${input}`, 'input');
      // Handle any commands if needed
    };

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

    const initializeScreen = () => {
      document.body.setAttribute('data-page', 'terminal-marketplace');
      terminalLines.value = [];
      addLine('Loading marketplace...', 'info');

      // Check for payment status in URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const paymentStatus = urlParams.get('payment');
      const itemId = urlParams.get('itemId');

      // Non-blocking: fetch all data in parallel, then handle payment redirects
      store.dispatch('marketplace/updateFilters', { assetType: 'all' }).then(() => {
        return Promise.all([
          store.dispatch('marketplace/fetchMarketplaceWorkflows'),
          store.dispatch('marketplace/fetchFeaturedWorkflows'),
          store.dispatch('marketplace/fetchMyInstalls'),
          store.dispatch('marketplace/fetchMyPurchases'),
        ]);
      }).then(async () => {
        const workflowCount = marketplaceWorkflows.value.length;
        const agentCount = marketplaceAgents.value.length;
        const toolCount = marketplaceTools.value.length;
        const totalCount = workflowCount + agentCount + toolCount;
        const featuredCount = featuredWorkflows.value.length;

        if (totalCount > 0) {
          addLine(`Found ${totalCount} items in marketplace`, 'success');
          if (workflowCount > 0) addLine(`  - ${workflowCount} workflows`, 'info');
          if (agentCount > 0) addLine(`  - ${agentCount} agents`, 'info');
          if (toolCount > 0) addLine(`  - ${toolCount} tools`, 'info');
        } else {
          addLine(`No items found in marketplace`, 'info');
        }

        if (featuredCount > 0) {
          addLine(`${featuredCount} featured items available`, 'success');
        }

        // Handle payment status from URL (needs data to be loaded first)
        if (paymentStatus === 'success' && itemId) {
          addLine(`✓ Payment successful! You can now install the item.`, 'success');

          const item = filteredWorkflows.value.find((w) => w.id === itemId);
          if (item) {
            const shouldInstall = await simpleModal.value.showModal({
              title: '✓ Payment Successful',
              message: `Your purchase of "${item.title}" was successful!\n\nWould you like to install it now?`,
              confirmText: 'Install Now',
              cancelText: 'Later',
              showCancel: true,
              confirmClass: 'btn-primary',
            });

            if (shouldInstall) {
              await handleInstallWorkflow(item);
            }
          }

          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (paymentStatus === 'cancelled') {
          addLine(`Payment was cancelled.`, 'info');
          await simpleModal.value.showModal({
            title: 'Payment Cancelled',
            message: 'Your payment was cancelled. You can try again anytime.',
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-secondary',
          });

          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }).catch((error) => {
        addLine(`Error loading marketplace: ${error.message}`, 'error');
      });

      // Show tutorial after a short delay
      setTimeout(() => {
        initializeMarketplaceTutorial();
      }, 2000);
    };

    onMounted(() => {
      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }
    });

    return {
      baseScreenRef,
      simpleModal,
      terminalLines,
      selectedWorkflow,
      activeTab,
      currentLayout,
      tabs,
      tableColumns,
      earningsColumns,
      marketplaceWorkflows,
      featuredWorkflows,
      filters,
      isLoading,
      myEarnings,
      filteredWorkflows,
      workflowsByCategory,
      hideEmptyCategories,
      collapsedCategories,
      allCategoriesCollapsed,
      selectedCategory,
      availableCategories,
      categoryCounts,
      displayedWorkflows,
      currentAssetTypeLabel,
      handleWorkflowClick,
      handleSearch,
      selectTab,
      setLayout,
      toggleHideEmptyCategories,
      toggleCategoryCollapse,
      isCategoryCollapsed,
      toggleCollapseAll,
      handleInstallWorkflow,
      handlePanelAction,
      handleUserInputSubmit,
      initializeScreen,
      getCategoryInfo,
      formatNumber,
      getAssetIcon,
      getAssetTypeLabel,
      isInstalled,
      isPurchased,
      triggerConfetti,
      tutorialConfig,
      startTutorial,
      onTutorialClose,
      emit,
    };
  },
};
</script>

<style scoped>
.marketplace-panel {
  position: relative;
  top: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  height: 100%;
}

.sticky-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: transparent;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  border-radius: 8px;
}

.sticky-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0.85;
  z-index: -1;
}

/* Controls Bar */
.controls-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-wrapper {
  flex: 1;
  min-width: 0;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-light-green);
  font-size: 0.9em;
}

.search-input:focus {
  outline: none;
  border-color: rgba(25, 239, 131, 0.5);
}

.controls-group {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.view-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  overflow: hidden;
}

body.dark .view-toggle {
  border-color: var(--terminal-border-color);
}

.view-btn {
  background: transparent;
  border: none;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--color-text);
  transition: all 0.2s ease;
  font-size: 0.9em;
}

.view-btn:hover {
  background: rgba(127, 129, 147, 0.1);
}

.view-btn.active {
  background: var(--color-green);
  color: var(--color-dark-navy);
}

.view-btn:not(:last-child) {
  border-right: 1px solid var(--color-light-navy);
}

body.dark .view-btn:not(:last-child) {
  border-right-color: var(--terminal-border-color);
}

/* Category Pills */
.category-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-light-navy);
}

body.dark .category-pills {
  border-bottom-color: var(--terminal-border-color);
}

.category-pill {
  background: var(--color-dull-white);
  border: 2px solid var(--color-light-navy);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text);
  white-space: nowrap;
}

body.dark .category-pill {
  background: rgba(0, 0, 0, 20%);
  border-color: var(--terminal-border-color);
}

.category-pill:hover {
  border-color: var(--color-green);
  background: rgba(25, 239, 131, 0.1);
  transform: translateY(-1px);
}

.category-pill.active {
  background: var(--color-green);
  border-color: var(--color-green) !important;
  /* color: var(--color-primary); */
  /* font-weight: 600; */
}

/* Results Info */
.results-info {
  font-size: 0.9em;
  color: var(--color-light-med-navy);
  padding: 8px 12px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 6px;
  border-left: 3px solid var(--color-green);
}

body.dark .results-info {
  background: rgba(25, 239, 131, 0.05);
}

.marketplace-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.marketplace-main-content {
  flex: 1;
  height: 100%;
  overflow-y: scroll !important;
  scrollbar-width: thin !important;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.marketplace-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.marketplace-main-content::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3) !important;
}

.marketplace-main-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.4) !important;
  border-radius: 4px;
}

.marketplace-main-content > * {
  width: 100%;
  max-width: 1048px;
  margin-right: -10px;
}

/* Featured Section */
.featured-section {
  width: 100%;
  margin-bottom: 32px;
}

.section-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 20px;
  padding-left: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title i {
  color: var(--color-yellow);
  font-size: 16px;
}

.featured-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
  margin-bottom: 16px;
}

.featured-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 2px solid var(--color-yellow);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.15);
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 160px;
  backdrop-filter: blur(4px);
}

.featured-card:hover {
  border-color: var(--color-yellow);
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.3);
}

.featured-card.selected {
  border-color: var(--color-yellow);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
}

.featured-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  background: var(--color-yellow);
  color: var(--color-darker-0);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.5);
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 1;
}

.featured-badge i {
  font-size: 10px;
}

/* Workflow Avatar */
.workflow-avatar-container {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}

.workflow-avatar {
  width: 80px;
  height: 80px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid var(--terminal-border-color);
  transition: all 0.3s ease;
}

.workflow-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

/* .featured-card:hover .workflow-avatar img,
.workflow-card:hover .workflow-avatar img {
  transform: scale(1.05);
} */

/* .featured-card:hover .workflow-avatar,
.workflow-card:hover .workflow-avatar {
  border-right-color: rgba(25, 239, 131, 0.5);
  box-shadow: inset -2px 0 12px rgba(25, 239, 131, 0.2);
} */

.workflow-avatar-placeholder {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, rgba(25, 239, 131, 0.1), rgba(25, 239, 131, 0.05));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-green);
  font-size: 36px;
  opacity: 0.5;
  border-radius: 50%;
  border: 2px solid var(--terminal-border-color);
  transition: all 0.3s ease;
}

.featured-card:hover,
.workflow-card:hover {
  background: rgba(25, 239, 131, 0.08);
  border-color: rgba(25, 239, 131, 0.2);
  /* transform: translateY(-1px); */
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}
/* Workflow Content */
.workflow-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.workflow-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
}

.workflow-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-self: stretch;
}

.workflow-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.workflow-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
  line-height: 1.3;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre-wrap;
}

.workflow-description {
  font-size: 11.5px;
  color: var(--color-text-muted);
  line-height: 1.45;
  margin: 0;
  display: -webkit-box;
  /* -webkit-line-clamp: 2; */
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.workflow-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text);
}

.meta-item i {
  font-size: 11px;
  color: var(--color-green);
}

.meta-item.category i {
  color: var(--color-text-muted);
}

.meta-item .fa-star {
  color: var(--color-yellow);
}

.meta-count {
  opacity: 0.6;
  font-size: 11px;
}

/* Category Cards */
.category-cards-container {
  width: 100%;
  padding: 0;
}

.category-cards-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  width: 100%;
}

.category-card {
  padding: 0;
  flex: 1 1 100%;
  min-width: 100%;
  box-sizing: border-box;
  transition: all 0.3s ease;
}

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  width: calc(100% - 5px);
}

.category-header:hover {
  background: rgba(25, 239, 131, 0.05);
  border-radius: 6px;
  padding: 4px 6px;
  margin: -4px -6px 14px -6px;
}

.category-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.collapse-toggle {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-green);
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
}

.collapse-toggle:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.5);
}

.collapse-toggle.collapsed i {
  transform: rotate(-90deg);
}

.collapse-toggle i {
  font-size: 10px;
  transition: transform 0.2s ease;
}

.category-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 16px;
  color: var(--color-text-muted);
  opacity: 0.95;
}

.category-icon {
  font-size: 18px;
  width: 24px;
  height: 24px;
  display: none;
}

.category-count {
  padding: 6px 10px;
  border-radius: 9px;
  background: var(--color-darker-0);
  font-weight: 700;
  font-size: 12px;
  color: var(--color-secondary);
  border: 1px solid var(--terminal-border-color);
  opacity: 0.5;
}

.workflows-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 8px;
  width: calc(100% - 5px);
}

.workflow-card {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-green);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  box-sizing: border-box;
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 150px;
  backdrop-filter: blur(4px);
}

.workflow-card.last-odd {
  grid-column: 1 / -1;
}

.workflow-card:hover {
  /* border-color: rgba(25, 239, 131, 0.4); */
  /* transform: translateY(-2px); */
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.workflow-card.selected {
  background: rgba(25, 239, 131, 0.15);
  border-color: var(--color-green);
  /* box-shadow: 0 6px 20px rgba(25, 239, 131, 0.2); */
}

.workflow-card.installed {
  border-color: #a89a3f1c;
  border-left-color: var(--color-yellow);
}

.workflow-card.selected.installed {
  border-color: var(--color-green);
}

.workflow-card.installed .workflow-avatar-placeholder {
  background: linear-gradient(135deg, rgb(226 239 25 / 10%), rgb(239 214 25 / 5%));
  color: var(--color-yellow);
  opacity: 1;
  border: 2px solid #ffd70008;
}

.workflow-type {
  padding: 4px 10px 3px;
  border-radius: 16px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 1.4;
}

/* Asset Type Color Variants */
.workflow-type.type-workflow {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.workflow-type.type-agent {
  background: rgba(236, 72, 153, 0.2);
  color: var(--color-pink);
}

.workflow-type.type-tool {
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
}

.workflow-type.type-plugin {
  background: rgba(139, 92, 246, 0.2);
  color: #a78bfa;
}

.workflow-price {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-yellow);
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 1.4;
  letter-spacing: 0.3px;
}
.workflow-price.free {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.workflow-publisher {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.workflow-publisher i {
  font-size: 10px;
  opacity: 0.7;
}

.install-button {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  color: var(--color-green);
  border: 1px solid var(--color-green);
  font-weight: 700;
  font-size: 11px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-top: auto;
}

.install-button:hover {
  background: var(--color-green);
  color: var(--color-navy);
  transform: translateY(-1px);
}

.install-button:active {
  transform: translateY(0);
}

.install-button i {
  font-size: 12px;
}

.install-button:disabled,
.table-install-button:disabled {
  background: transparent;
  color: var(--color-yellow);
  border-color: var(--color-yellow);
}

/* Table View Styles */
.price-badge {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  display: inline-block;
}

.price-badge.paid {
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
}

.price-badge.free {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.rating-display {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text);
}

.rating-display i {
  color: var(--color-yellow);
  font-size: 11px;
}

.rating-count {
  opacity: 0.6;
  font-size: 10px;
  margin-left: 2px;
}

.downloads-display {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text);
}

.downloads-display i {
  color: var(--color-green);
  font-size: 11px;
}

.table-install-button {
  padding: 6px 12px;
  background: var(--color-green);
  color: var(--color-navy);
  font-weight: 600;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  white-space: nowrap;
}

.table-install-button:hover {
  background: rgba(25, 239, 131, 0.9);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(25, 239, 131, 0.3);
}

.table-install-button:active {
  transform: translateY(0);
}

.table-install-button i {
  font-size: 10px;
}

/* Earnings Dashboard Styles */
.earnings-dashboard {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.earnings-header {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.earnings-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.earnings-title i {
  color: var(--color-green);
  font-size: 22px;
}

.earnings-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.earnings-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all 0.2s ease;
}

.earnings-card:hover {
  border-color: rgba(25, 239, 131, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.earnings-card-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(25, 239, 131, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.earnings-card-icon i {
  font-size: 20px;
  color: var(--color-green);
}

.earnings-card-content {
  flex: 1;
  min-width: 0;
}

.earnings-card-label {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.earnings-card-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
}

.earnings-card-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
  opacity: 0.7;
}

/* Earnings Breakdown */
.earnings-breakdown {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
}

.earnings-breakdown .section-title {
  margin-bottom: 16px;
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.breakdown-item {
  padding: 16px;
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.breakdown-item.fee {
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.2);
}

.breakdown-item.net {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.3);
}

.breakdown-label {
  font-size: 12px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.breakdown-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
}

.breakdown-item.fee .breakdown-value {
  color: #ef4444;
}

.breakdown-item.net .breakdown-value {
  color: var(--color-green);
}

.earnings-section {
  display: flex;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

:deep(.earnings-section .table-row:last-child) {
  border-bottom: none;
}

.earnings-section .section-title {
  margin-bottom: 16px;
}

.no-earnings {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--color-text-muted);
  gap: 16px;
  text-align: center;
  width: 100%;
}

.no-earnings i {
  font-size: 48px;
  opacity: 0.3;
}

.no-earnings p {
  font-size: 14px;
  opacity: 0.7;
  margin: 0;
}

/* Responsive */
@media (max-width: 640px) {
  .workflow-card {
    width: 100%;
  }

  .category-cards-grid {
    gap: 12px;
  }

  .earnings-summary {
    grid-template-columns: 1fr;
  }
}
</style>
