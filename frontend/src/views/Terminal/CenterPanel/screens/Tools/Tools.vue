<!-- Tools.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="ToolsPanel"
    :activeRightPanel="activeRightPanel"
    screenId="ToolsScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      allAvailableTools,
      activeTab,
      selectedTool,
    }"
    :panelProps="panelProps"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <!-- <TerminalHeader 
        title="My Tools" 
        subtitle="Browse and select available tools." 
      /> -->

      <div class="tools-panel">
        <!-- Sticky Header Container -->
        <div class="sticky-header">
          <!-- Tool Tabs and Layout Toggle -->
          <BaseTabControls
            :tabs="tabs"
            :active-tab="activeTab"
            :current-layout="currentLayout"
            :show-grid-toggle="true"
            :show-table-toggle="false"
            @set-layout="setLayout"
            @select-tab="selectTab"
          />

          <!-- Search Bar for Card View -->
          <div class="card-view-search-bar">
            <input type="text" class="search-input" placeholder="Search tools..." :value="searchQuery" @input="handleSearch($event.target.value)" />
            <Tooltip :text="allCategoriesCollapsed ? 'Expand all categories' : 'Collapse all categories'" width="auto">
              <button class="collapse-all-button" :class="{ active: allCategoriesCollapsed }" @click="toggleCollapseAll">
                <i :class="allCategoriesCollapsed ? 'fas fa-expand' : 'fas fa-compress'"></i>
              </button>
            </Tooltip>
            <Tooltip :text="hideEmptyCategories ? 'Show empty categories' : 'Hide empty categories'" width="auto">
              <button class="hide-empty-button" :class="{ active: hideEmptyCategories }" @click="toggleHideEmptyCategories">
                <i :class="hideEmptyCategories ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
              </button>
            </Tooltip>
          </div>
        </div>

        <!-- Main Content (Sidebar moved to LeftPanel) -->
        <div class="tools-content">
          <main class="tools-main-content fade-in">
            <!-- Category Cards View -->
            <div class="category-cards-container">
              <!-- Empty State - Only show for custom tab when no custom tools exist -->
              <div v-if="activeTab === 'custom' && Object.keys(toolsByCategory).length === 0" class="empty-state-container">
                <div class="empty-state">
                  <i class="fas fa-wrench"></i>
                  <p>No custom tools found</p>
                  <div class="empty-state-buttons">
                    <button class="create-button" @click="handlePanelAction('navigate', 'ToolForgeScreen')">
                      <i class="fas fa-plus"></i> Create Tool
                    </button>
                    <button class="marketplace-button" @click="selectTab('marketplace')"><i class="fas fa-store"></i> View Marketplace</button>
                  </div>
                </div>
              </div>

              <div v-else class="category-cards-grid">
                <article
                  v-for="(tools, categoryName, index) in toolsByCategory"
                  :key="categoryName"
                  class="category-card"
                  :class="{
                    'drag-over': dragOverCategory === categoryName,
                    'full-width': tools.length >= 2,
                  }"
                  role="listitem"
                  :aria-label="`${categoryName} Category`"
                  @dragover.prevent="handleDragOver(categoryName)"
                  @dragleave="handleDragLeave"
                  @drop="handleDrop($event, categoryName)"
                >
                  <div class="category-header" @click="toggleCategoryCollapse(categoryName)">
                    <div class="category-title">
                      <span class="category-icon">{{ getCategoryInfo(categoryName).icon }}</span>
                      {{ getCategoryInfo(categoryName).displayName }}
                    </div>
                    <div class="category-header-right">
                      <div class="category-count">{{ tools.length }} tools</div>
                      <button class="collapse-toggle" :class="{ collapsed: isCategoryCollapsed(categoryName) }">
                        <i class="fas fa-chevron-down"></i>
                      </button>
                    </div>
                  </div>
                  <div class="category-content" v-show="!isCategoryCollapsed(categoryName)">
                    <!-- Marketplace Tools Grid -->
                    <div v-if="activeTab === 'marketplace'" class="tools-grid">
                      <div
                        v-for="(item, index) in tools"
                        :key="item.id"
                        class="tool-card"
                        :class="{
                          selected: selectedTool?.id === item.id,
                          'last-odd': tools.length % 2 === 1 && index === tools.length - 1,
                        }"
                        @click="selectTool(item)"
                      >
                        <div class="marketplace-card-content">
                          <!-- Row 1: Avatar + Title/Publisher/Description -->
                          <div class="marketplace-header">
                            <div class="marketplace-avatar-container">
                              <div v-if="item.preview_image || item.image_url" class="marketplace-avatar">
                                <img :src="item.preview_image || item.image_url" :alt="item.title || item.name" />
                              </div>
                              <div v-else class="marketplace-avatar-placeholder">
                                <i class="fas fa-wrench"></i>
                              </div>
                            </div>

                            <div class="marketplace-info">
                              <div class="marketplace-title-row">
                                <h3 class="marketplace-name">{{ item.title || item.name }}</h3>
                                <span v-if="item.price > 0" class="item-price">${{ item.price.toFixed(2) }}</span>
                                <span v-else class="item-price free">FREE</span>
                              </div>

                              <div class="item-publisher">
                                <i class="fas fa-user"></i>
                                {{ item.publisher_pseudonym || item.publisher_name || item.author_name || 'Anonymous' }}
                              </div>

                              <p class="marketplace-description">
                                {{ item.tagline || item.description || 'No description available' }}
                              </p>
                            </div>
                          </div>

                          <!-- Row 2: Ratings and Downloads -->
                          <div class="marketplace-meta">
                            <div class="meta-item">
                              <i class="fas fa-star"></i>
                              <span>{{ item.rating ? item.rating.toFixed(1) : '0.0' }}</span>
                              <span class="meta-count">({{ item.rating_count || 0 }})</span>
                            </div>
                            <div class="meta-item">
                              <i class="fas fa-download"></i>
                              <span>{{ item.downloads || 0 }}</span>
                            </div>
                            <div v-if="item.category" class="meta-item category">
                              <i class="fas fa-tag"></i>
                              <span>{{ item.category }}</span>
                            </div>
                          </div>

                          <!-- Row 3: Install Button -->
                          <button class="install-button" @click.stop="handleInstallTool(item)">
                            <i class="fas fa-download"></i>
                            {{ item.price > 0 ? 'Purchase' : 'Install' }}
                          </button>
                        </div>
                      </div>
                    </div>
                    <!-- Regular Tools Grid -->
                    <div v-else class="tools-grid">
                      <div
                        v-for="(tool, index) in tools"
                        :key="tool.id"
                        class="tool-card"
                        :class="{
                          selected: selectedTool?.id === tool.id,
                          dragging: draggedTool?.id === tool.id,
                          'last-odd': tools.length % 2 === 1 && index === tools.length - 1,
                        }"
                        draggable="true"
                        @click="selectTool(tool)"
                        @dragstart="handleDragStart($event, tool)"
                        @dragend="handleDragEnd"
                      >
                        <div class="tool-header">
                          <div class="tool-icon-name">
                            <div class="tool-icon-wrapper">
                              <SvgIcon v-if="tool.icon" :name="tool.icon" class="tool-icon" />
                              <div v-else class="tool-icon-placeholder">
                                {{ (tool.title || tool.type || 'T').charAt(0).toUpperCase() }}
                              </div>
                            </div>
                            <span class="tool-name">{{ tool.title || tool.type }}</span>
                          </div>
                          <div class="tool-badges">
                            <span v-if="tool.isPlugin" class="tool-plugin-badge">PLUGIN</span>
                            <span v-if="tool.requiresPro" class="tool-pro-badge">PRO</span>
                            <span v-if="tool.source && !tool.isPlugin" class="tool-source" :class="(tool.source || '').toLowerCase()">{{
                              tool.source
                            }}</span>
                          </div>
                        </div>

                        <div class="tool-description">
                          {{ tool.description || 'No description available' }}
                        </div>

                        <div v-if="tool.type" class="tool-type">Type: {{ tool.type }}</div>
                      </div>
                    </div>
                    <div v-if="tools.length === 0" class="empty-category-drop-zone">Drop tool here to recategorize</div>
                  </div>
                </article>
              </div>
            </div>
          </main>
        </div>
      </div>
    </template>
  </BaseScreen>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="ToolsScreen" @close="onTutorialClose" />
  <SimpleModal ref="simpleModalRef" />
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, computed, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import BaseScreen from '../../BaseScreen.vue';
import BaseCardGrid from '../../../_components/BaseCardGrid/BaseCardGrid.vue';
import BaseTabControls from '../../../_components/BaseTabControls.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useToolsTutorial } from './useToolsTutorial.js';
// NOTE: Static toolLibrary import removed - now using centralized Vuex store (tools/fetchWorkflowTools)

// Define categories outside setup for clarity
const toolCategoryTabs = {
  all: { name: 'All', icon: 'fas fa-list', types: [] },
  system: { name: 'System', icon: 'fas fa-cogs', types: [] },
  custom: { name: 'Custom', icon: 'fas fa-user', types: [] },
};

export default {
  name: 'ToolsScreen',
  components: { BaseScreen, BaseCardGrid, BaseTabControls, TerminalHeader, SvgIcon, SimpleModal, PopupTutorial, Tooltip },
  emits: ['screen-change'],
  setup(props, { emit }) {
    // Initialize tutorial
    const { tutorialConfig, startTutorial, onTutorialClose, initializeToolsTutorial } = useToolsTutorial();

    const store = useStore();
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const selectedTool = ref(null);
    const activeTab = ref('all');
    const searchQuery = ref('');
    const selectedCategory = ref(null);
    const selectedMainCategory = ref(null);
    const openMainCategories = ref({});
    const currentLayout = ref('grid');
    const hideEmptyCategories = ref(true);
    const collapsedCategories = ref(new Set());

    // Drag and drop state
    const draggedTool = ref(null);
    const dragOverCategory = ref(null);

    const customTools = computed(() => store.getters['tools/customTools'] || []);
    const isLoading = computed(() => store.getters['tools/isLoading']);

    document.body.setAttribute('data-page', 'terminal-tools');

    // Inject playSound function
    const playSound = inject('playSound');

    // Define main tool categories based on actual tools
    const mainToolCategories = computed(() => {
      // Get unique categories from all available tools
      const categories = new Set();

      allAvailableTools.value.forEach((tool) => {
        if (tool.category) {
          categories.add(tool.category);
        }
      });

      // Convert to array and sort
      const sortedCategories = Array.from(categories).sort();

      // Map to the expected format with icons
      return sortedCategories.map((category) => ({
        code: category,
        label: category,
        icon: getCategoryIcon(category),
      }));
    });

    // Helper function to get category icons
    const getCategoryIcon = (categoryName) => {
      const categoryIcons = {
        triggers: 'fas fa-play',
        actions: 'fas fa-bolt',
        utilities: 'fas fa-wrench',
        widgets: 'fas fa-th-large',
        controls: 'fas fa-sliders-h',
        plugins: 'fas fa-puzzle-piece',
        custom: 'fas fa-user',
      };
      return categoryIcons[categoryName] || 'fas fa-tools';
    };

    // Convert system tools from Vuex store (workflowTools) to consistent format
    const systemTools = computed(() => {
      const toolLibrary = store.getters['tools/workflowTools'];
      if (!toolLibrary) return [];

      const tools = [];

      // Helper function to process tools from a category
      const processCategory = (categoryTools, categoryName) => {
        if (!categoryTools) return;
        categoryTools.forEach((tool) => {
          tools.push({
            ...tool,
            id: `system-${tool.type}`,
            source: tool.isPlugin ? 'plugin' : 'system',
            category: categoryName,
            // Preserve PRO flag for badge display (plugins are no longer automatically PRO)
            requiresPro: tool.requiresPro || false,
            isPlugin: tool.isPlugin || false,
            pluginName: tool.pluginName || null,
          });
        });
      };

      // Process all categories
      processCategory(toolLibrary.triggers, 'triggers');
      processCategory(toolLibrary.actions, 'actions');
      processCategory(toolLibrary.utilities, 'utilities');
      processCategory(toolLibrary.widgets, 'widgets');
      processCategory(toolLibrary.controls, 'controls');

      return tools;
    });

    // Combine all tools (system + custom)
    // Categories: triggers, actions, utilities, widgets, controls, plugins, custom
    const allAvailableTools = computed(() => {
      const storeTools = customTools.value.map((tool) => ({
        ...tool,
        title: tool.title || tool.name,
        source: tool.is_builtin ? 'system_builtin' : 'custom',
        category: 'custom',
        icon: tool.icon || 'custom',
      }));

      // Remap plugin tools to 'plugins' category, keep folder-based categories for system tools
      const remappedSystemTools = systemTools.value.map((tool) => ({
        ...tool,
        category: tool.isPlugin ? 'plugins' : tool.category,
      }));

      return [...remappedSystemTools, ...storeTools];
    });

    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();

    // Table Columns Definition
    const tableColumns = [
      { key: 'icon', label: '', width: '40px' },
      { key: 'title', label: 'Name', width: '1.5fr' },
      { key: 'description', label: 'Description', width: '4fr' },
    ];

    // --- Tabs ---
    const tabs = computed(() => {
      return [
        { id: 'all', name: 'All', icon: 'fas fa-list' },
        { id: 'system', name: 'System', icon: 'fas fa-cogs' },
        { id: 'custom', name: 'Custom', icon: 'fas fa-user' },
        { id: 'plugins', name: 'Plugins', icon: 'fas fa-puzzle-piece' },
        { id: 'marketplace', name: 'Marketplace', icon: 'fas fa-store' },
      ];
    });

    // Marketplace state
    const marketplaceTools = computed(() => store.getters['marketplace/filteredMarketplaceTools'] || []);

    // --- Filtered Tools ---
    const filteredTools = computed(() => {
      let tools = allAvailableTools.value;

      // Apply tab filtering first
      if (activeTab.value === 'system') {
        tools = tools.filter((tool) => tool.source === 'system');
      } else if (activeTab.value === 'custom') {
        tools = tools.filter((tool) => tool.source === 'custom');
      }
      // Note: 'all' tab shows all tools, no filtering needed

      // Apply category filtering from sidebar
      if (selectedMainCategory.value) {
        tools = tools.filter((tool) => tool.category === selectedMainCategory.value);
      } else if (selectedCategory.value && selectedCategory.value !== 'All Tools') {
        const mainCategory = mainToolCategories.find((m) => m.label === selectedCategory.value);
        if (mainCategory) {
          tools = tools.filter((tool) => tool.category === mainCategory.code);
        }
      }

      // Apply search filtering
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        tools = tools.filter(
          (tool) =>
            (tool.title && tool.title.toLowerCase().includes(query)) ||
            (tool.type && tool.type.toLowerCase().includes(query)) ||
            (tool.description && tool.description.toLowerCase().includes(query))
        );
      }

      return tools;
    });

    // Group tools by category for card view
    const toolsByCategory = computed(() => {
      // If marketplace tab is selected, show marketplace tools
      if (activeTab.value === 'marketplace') {
        const marketplaceItems = marketplaceTools.value;
        return { 'Marketplace Tools': marketplaceItems };
      }

      // Start with all available tools, not filteredTools, to ensure search works across all tools
      let tools = allAvailableTools.value;

      // Apply tab filtering first
      if (activeTab.value === 'system') {
        // System tools: non-plugin system tools only
        tools = tools.filter((tool) => tool.source === 'system' && !tool.isPlugin);
      } else if (activeTab.value === 'custom') {
        tools = tools.filter((tool) => tool.source === 'custom');
      } else if (activeTab.value === 'plugins') {
        // Plugin tools only
        tools = tools.filter((tool) => tool.isPlugin === true);
      }

      // Apply search filtering for card view
      if (searchQuery.value && searchQuery.value.trim() !== '') {
        const query = searchQuery.value.toLowerCase().trim();
        tools = tools.filter((tool) => {
          const searchableFields = [tool.title || '', tool.type || '', tool.description || '', tool.category || ''];
          return searchableFields.some((field) => field.toLowerCase().includes(query));
        });
      }

      const categories = {};

      // When a specific category is selected from sidebar, only show that category
      if (selectedCategory.value && selectedCategory.value !== 'All Tools') {
        // Initialize only the selected category
        categories[selectedCategory.value] = [];

        // Filter tools to only those in the selected category
        const filteredByCategory = tools.filter((tool) => tool.category === selectedCategory.value);
        categories[selectedCategory.value] = filteredByCategory;
      } else {
        // When "All Tools" is selected, show all categories
        // First pass: collect all unique categories from tools to ensure we don't miss any
        tools.forEach((tool) => {
          const category = tool.category || 'Uncategorized';
          if (!categories[category]) {
            categories[category] = [];
          }
        });

        // Second pass: assign tools to their categories
        tools.forEach((tool) => {
          const category = tool.category || 'Uncategorized';
          categories[category].push(tool);
        });
      }

      // Sort categories alphabetically (A-Z) and return as sorted object
      const sortedCategories = {};
      Object.keys(categories)
        .sort((a, b) => a.localeCompare(b))
        .forEach((key) => {
          // When searching, only show categories that have tools
          if (searchQuery.value && searchQuery.value.trim() !== '') {
            if (categories[key].length > 0) {
              sortedCategories[key] = categories[key];
            }
          } else if (hideEmptyCategories.value) {
            // When hiding empty categories, only show categories with tools
            if (categories[key].length > 0) {
              sortedCategories[key] = categories[key];
            }
          } else {
            // When not searching and not hiding empty categories, show all categories
            sortedCategories[key] = categories[key];
          }
        });

      return sortedCategories;
    });

    // --- Computed Property for Active Right Panel ---
    const activeRightPanel = computed(() => {
      // When on marketplace tab, use MarketplacePanel to show marketplace item details
      if (activeTab.value === 'marketplace') {
        return 'MarketplacePanel';
      }
      // Otherwise use ToolsPanel for regular tool details
      return 'ToolsPanel';
    });

    // --- Computed Property for Panel Props ---
    const panelProps = computed(() => {
      // When on marketplace tab, pass selectedWorkflow for MarketplacePanel
      if (activeTab.value === 'marketplace') {
        return {
          selectedWorkflow: selectedTool.value, // MarketplacePanel expects selectedWorkflow prop
          activeTab: 'marketplace',
        };
      }
      // For regular tool tabs, pass selectedTool for ToolsPanel
      return { selectedTool: selectedTool.value };
    });

    // --- Methods ---
    const selectTool = (tool) => {
      // Play sound when selecting a tool
      if (playSound) {
        playSound('typewriterKeyPress');
      }

      // If clicking the same tool that's already selected, force a re-render
      if (selectedTool.value?.id === tool.id) {
        selectedTool.value = null;
        nextTick(() => {
          selectedTool.value = tool;
        });
      } else {
        selectedTool.value = tool;
      }
    };

    const selectTab = async (tabId) => {
      activeTab.value = tabId;
      selectedTool.value = null; // Clear selection when switching tabs

      // Fetch marketplace tools when marketplace tab is selected
      if (tabId === 'marketplace') {
        try {
          terminalLines.value.push('[Marketplace] Loading marketplace tools...');
          scrollToBottom();
          // Update filters to fetch tools only
          await store.dispatch('marketplace/updateFilters', { assetType: 'tool' });
          await store.dispatch('marketplace/fetchMarketplaceItems');
          const count = store.getters['marketplace/filteredMarketplaceTools'].length;
          terminalLines.value.push(`[Marketplace] Found ${count} tools in marketplace`);
          scrollToBottom();
        } catch (error) {
          terminalLines.value.push(`[Marketplace] Error loading marketplace: ${error.message}`);
          scrollToBottom();
        }
      }
    };

    const handleSearch = (query) => {
      searchQuery.value = query;
    };

    const handlePanelAction = async (action, payload) => {
      console.log('ToolsPanel action:', action, payload);
      switch (action) {
        case 'close-panel':
          selectedTool.value = null;
          break;
        case 'category-filter-changed':
          // Handle category filter changes from the ToolsPanel
          selectedCategory.value = payload.selectedCategory;
          selectedMainCategory.value = payload.selectedMainCategory;
          selectedTool.value = null; // Clear tool selection when category changes

          if (payload.type === 'all-selected') {
            terminalLines.value = ['[Tools] Viewing all tools (no category filter)'];
          } else if (payload.type === 'category-selected') {
            const categoryName = payload.payload.category;
            terminalLines.value = [`[Tools] Viewing ${categoryName}`];
          }
          scrollToBottom();
          break;
        case 'navigate':
          emit('screen-change', payload);
          break;
        case 'install-workflow':
          // Handle marketplace item installation from the right panel
          await handleInstallTool(payload);
          break;
        default:
          console.warn('Unhandled panel action in Tools.vue:', action, payload);
      }
    };

    const initializeScreen = () => {
      selectedTool.value = null;
      activeTab.value = 'all';
      currentLayout.value = 'grid'; // Set to grid since table button is hidden

      // Check if we already have tools in the store
      const hasSystemTools = store.getters['tools/workflowTools'] && Object.keys(store.getters['tools/workflowTools']).length > 0;
      const hasCustomTools = store.getters['tools/customTools'] && store.getters['tools/customTools'].length > 0;

      if (hasSystemTools || hasCustomTools) {
        console.log('[Tools] Initializing from cache');
      }

      // Background refresh
      Promise.all([store.dispatch('tools/fetchTools'), store.dispatch('tools/fetchWorkflowTools')])
        .then(() => {
          console.log('[Tools] Loaded tools including workflow tools with plugins');
        })
        .catch((error) => {
          console.error('Error loading tools:', error);
        });

      nextTick();
    };

    // Watch for changes in allTools
    watch(
      allAvailableTools,
      (newTools) => {
        if (selectedTool.value && !newTools.find((t) => t.id === selectedTool.value.id)) {
          selectedTool.value = null;
        }
      },
      { deep: true }
    );

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    // Get category display name and icon
    const getCategoryInfo = (categoryName) => {
      const categoryIcons = {
        triggers: '🎯',
        actions: '⚡',
        utilities: '🔧',
        widgets: '🎨',
        controls: '🎛️',
        plugins: '🧩',
        custom: '👤',
      };

      const categoryDisplayNames = {
        triggers: 'Triggers',
        actions: 'Actions',
        utilities: 'Utilities',
        widgets: 'Widgets',
        controls: 'Controls',
        plugins: 'Plugins',
        custom: 'Custom',
      };

      return {
        name: categoryName,
        displayName: categoryDisplayNames[categoryName] || categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
        icon: categoryIcons[categoryName] || '🔧',
        count: toolsByCategory.value[categoryName]?.length || 0,
      };
    };

    const toggleHideEmptyCategories = () => {
      hideEmptyCategories.value = !hideEmptyCategories.value;
      terminalLines.value.push(`[Tools] ${hideEmptyCategories.value ? 'Hiding' : 'Showing'} empty categories`);
      scrollToBottom();
    };

    const toggleCategoryCollapse = (categoryName) => {
      // Play sound when toggling category collapse
      if (playSound) {
        playSound('typewriterKeyPress');
      }

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
      const categoryNames = Object.keys(toolsByCategory.value);
      return categoryNames.length > 0 && categoryNames.every((name) => collapsedCategories.value.has(name));
    });

    const toggleCollapseAll = () => {
      const categoryNames = Object.keys(toolsByCategory.value);

      if (allCategoriesCollapsed.value) {
        // Expand all categories
        categoryNames.forEach((name) => {
          collapsedCategories.value.delete(name);
        });
        terminalLines.value.push('[Tools] Expanded all categories');
      } else {
        // Collapse all categories
        categoryNames.forEach((name) => {
          collapsedCategories.value.add(name);
        });
        terminalLines.value.push('[Tools] Collapsed all categories');
      }
      scrollToBottom();
    };

    // --- Drag and Drop Methods ---
    const handleDragStart = (event, tool) => {
      draggedTool.value = tool;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tool.id);

      // Add visual feedback
      event.target.style.opacity = '0.5';
      terminalLines.value.push(`[Drag] Started dragging tool: ${tool.title || tool.type}`);
      scrollToBottom();
    };

    const handleDragEnd = (event) => {
      // Reset visual feedback
      event.target.style.opacity = '1';
      draggedTool.value = null;
      dragOverCategory.value = null;
    };

    const handleDragOver = (categoryName) => {
      if (draggedTool.value && draggedTool.value.category !== categoryName) {
        dragOverCategory.value = categoryName;
      }
    };

    const handleDragLeave = () => {
      dragOverCategory.value = null;
    };

    // Initialize marketplace install composable
    const simpleModalRef = ref(null);
    const { installMarketplaceItem, isInstalling } = useMarketplaceInstall(simpleModalRef);

    // Handle marketplace tool installation with proper feedback
    const handleInstallTool = async (item) => {
      playSound('typewriterKeyPress');
      terminalLines.value.push(`[Marketplace] Installing tool: ${item.name || item.title}...`);
      scrollToBottom();

      const result = await installMarketplaceItem(item, 'tool');

      if (result.success) {
        terminalLines.value.push(`[Marketplace] Successfully installed: ${item.name || item.title}`);
        // Refresh tools list
        await store.dispatch('tools/fetchTools');
      } else {
        terminalLines.value.push(`[Marketplace] ${result.error}`);
      }
      scrollToBottom();
    };

    const handleDrop = async (event, targetCategory) => {
      event.preventDefault();
      dragOverCategory.value = null;

      if (!draggedTool.value) return;

      const tool = draggedTool.value;
      const originalCategory = tool.category || 'Uncategorized';

      // Don't do anything if dropping on the same category
      if (originalCategory === targetCategory) {
        terminalLines.value.push(`[Drag] Tool is already in ${targetCategory}`);
        scrollToBottom();
        return;
      }

      try {
        terminalLines.value.push(`[Drag] Moving tool "${tool.title || tool.type}" from ${originalCategory} to ${targetCategory}...`);
        scrollToBottom();

        // For now, just show the message - actual implementation would update the tool's category
        terminalLines.value.push(`[Drag] Tool category update functionality not yet implemented`);
        scrollToBottom();
      } catch (error) {
        terminalLines.value.push(`[Drag] Error moving tool: ${error.message}`);
        scrollToBottom();
      } finally {
        draggedTool.value = null;
      }
    };

    onMounted(() => {
      initializeScreen();

      // Show tutorial after a short delay
      setTimeout(() => {
        initializeToolsTutorial();
      }, 2000);
    });

    onUnmounted(() => {
      selectedTool.value = null;
    });

    return {
      baseScreenRef,
      terminalLines,
      filteredTools,
      isLoading,
      selectedTool,
      tabs,
      activeTab,
      tableColumns,
      selectTab,
      selectTool,
      handleSearch,
      handlePanelAction,
      emit,
      initializeScreen,
      systemTools,
      customTools,
      allAvailableTools,
      scrollToBottom,
      selectedCategory,
      selectedMainCategory,
      currentLayout,
      setLayout,
      // Dynamic panel switching
      activeRightPanel,
      panelProps,
      // Search functionality
      searchQuery,
      // Category functionality
      toolsByCategory,
      getCategoryInfo,
      hideEmptyCategories,
      toggleHideEmptyCategories,
      toggleCategoryCollapse,
      isCategoryCollapsed,
      allCategoriesCollapsed,
      toggleCollapseAll,
      // Drag and drop
      draggedTool,
      dragOverCategory,
      handleDragStart,
      handleDragEnd,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      // Marketplace
      handleInstallTool,
      simpleModalRef,
      // Tutorial
      tutorialConfig,
      startTutorial,
      onTutorialClose,
    };
  },
};
</script>

<style scoped>
.tools-panel {
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
  /* padding-bottom: 16px; */
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  border-radius: 8px;
  /* overflow: hidden; */
}

.sticky-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* background: var(--color-darker-0); */
  opacity: 0.85;
  z-index: -1;
}

.tool-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.4);
  padding-bottom: 1px;
}

.tab-button {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.4);
  color: var(--color-light-green);
  padding: 8px 16px;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab-button i {
  font-size: 0.9em;
}

.tab-button:hover {
  background: rgba(var(--green-rgb), 0.1);
}

.tab-button.active {
  background: rgba(var(--green-rgb), 0.2);
  border-bottom: 1px solid var(--color-green);
  color: var(--color-green);
}

.terminal-line {
  line-height: 1.3;
  margin-bottom: 2px;
}

.text-bright-green {
  color: var(--color-green);
  text-shadow: 0 0 5px rgba(var(--green-rgb), 0.4);
}

.font-bold {
  font-weight: bold;
}

.text-xl {
  font-size: 1.25rem;
}

/* Ensure BaseScreen's default slot children fill height */
:deep(.base-screen .left-panel .terminal-output) {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tools-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.tools-main-content {
  flex: 1;
  height: 100%;
  overflow-y: scroll !important;
  scrollbar-width: thin !important;
  display: flex;
  justify-content: center;
}

.tools-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.tools-main-content::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3) !important;
}

.tools-main-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.4) !important;
  border-radius: 4px;
}

.tools-main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.6) !important;
}

.tools-main-content > * {
  width: 100%;
  max-width: 1048px;
  margin-right: -10px;
}

.market-sidebar {
  width: 240px;
  padding: 8px;
  padding-left: 0;
  padding-right: 16px;
  background-color: transparent;
  border-right: 1px solid rgba(var(--green-rgb), 0.2);
  font-size: smaller;
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: calc(100% - 16px);
  z-index: 2;
  overflow: scroll;
  scrollbar-width: none;
}

.category-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: stretch;
  gap: 4px;
}

.category-section-title {
  margin-bottom: 2px;
  color: var(--color-grey);
  font-size: 0.9em;
  padding: 8px;
}

.category-item {
  padding: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  color: var(--color-light-green);
}

.category-item:hover {
  background-color: rgba(var(--green-rgb), 0.1);
}

.category-item.active {
  background-color: rgba(var(--green-rgb), 0.15);
  color: #ffffff !important;
}

.category-icon {
  margin-right: 8px;
}

.category-separator {
  display: block;
  border-top: 1.5px solid var(--color-green);
  margin: 8px 0 4px 0;
  height: 0;
  list-style: none;
}

.main-category {
  font-weight: bold;
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.07);
}

.main-active {
  background: rgba(var(--green-rgb), 0.18) !important;
  color: #ffffff !important;
}

.all-tools {
  font-weight: bold;
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.13);
  border-radius: 4px;
  margin-bottom: 4px;
}

.accordion-arrow {
  display: inline-block;
  width: 18px;
  text-align: center;
  margin-right: 4px;
  cursor: pointer;
  color: var(--color-green);
}

.subcategory {
  padding-left: 24px;
  font-style: italic;
  color: var(--color-light-green);
}

.cat-count {
  color: var(--color-light-green);
  font-weight: normal;
  margin-left: 4px;
  font-size: 0.95em;
}

:deep(.card-item) {
  min-height: 138.5px;
  max-height: 138.5px;
}

/* Category Cards View Styles */
.category-cards-container {
  width: 100%;
  padding: 0;
}

.card-view-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-light-green);
  font-size: 0.9em;
}

.search-input:focus {
  outline: none;
  border-color: rgba(var(--green-rgb), 0.5);
}

.hide-empty-button,
.collapse-all-button {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-green);
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 44px;
}

.hide-empty-button:hover,
.collapse-all-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  opacity: 1;
}

.hide-empty-button.active,
.collapse-all-button.active {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
  color: var(--color-green);
  opacity: 1;
}

.hide-empty-button i,
.collapse-all-button i {
  font-size: 0.9em;
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

.category-card.full-width {
  flex: 1 1 100%;
  min-width: 100%;
}

@media (max-width: 1024px) {
  .category-card {
    width: 100%;
  }
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
  background: rgba(var(--green-rgb), 0.05);
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
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-icon {
  font-size: 18px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  display: none;
}

.category-count {
  display: inline;
  padding: 6px 10px;
  border-radius: 9px;
  background: var(--color-darker-0);
  font-weight: 700;
  font-size: 12px;
  color: var(--color-secondary);
  border: 1px solid var(--terminal-border-color);
  opacity: 0.5;
}

.tools-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: calc(100% - 5px);
}

.tool-card {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 12px;
  border-radius: 16px;
  border-left: 3px solid var(--color-primary);
  width: calc(50% - 4px);
  box-sizing: border-box;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tool-card.last-odd {
  width: 100%;
}

.tool-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.tool-card.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
}

.tool-icon-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.tool-icon-wrapper {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--terminal-border-color);
}

.tool-icon {
  width: 18px;
  height: 18px;
  color: var(--color-green);
}

.tool-icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-green), rgba(var(--green-rgb), 0.7));
  color: var(--color-darker-0);
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
}

.tool-name {
  font-weight: 600;
  flex: 1;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-md);
  min-width: 0;
}

.tool-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.tool-pro-badge {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 215, 0, 0.15);
  color: var(--color-yellow);
  border: 1px solid rgba(255, 215, 0, 0.4);
  text-transform: uppercase;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.3);
  flex-shrink: 0;
}

.tool-plugin-badge {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(138, 43, 226, 0.15);
  color: var(--color-violet);
  border: 1px solid rgba(138, 43, 226, 0.4);
  text-transform: uppercase;
  box-shadow: 0 0 8px rgba(138, 43, 226, 0.3);
  flex-shrink: 0;
}

.tool-source {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
  text-transform: uppercase;
  flex-shrink: 0;
}

.tool-source.custom {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.tool-source.system {
  background: rgba(156, 163, 175, 0.2);
  color: var(--color-secondary);
}

.tool-description {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  /* -webkit-line-clamp: 2; */
  -webkit-box-orient: vertical;
  flex: 1;
}

.tool-type {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: auto;
}

.empty-category-drop-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
  border: 2px dashed var(--terminal-border-color);
  border-radius: 10px;
  color: var(--color-text-muted);
  font-size: 13px;
  opacity: 0.7;
  margin-top: 8px;
  transition: all 0.2s ease;
}

/* Drag and Drop Styles */
.tool-card.dragging {
  opacity: 0.5;
  transform: rotate(2deg);
  cursor: grabbing;
  z-index: 1000;
}

.category-card.drag-over {
  border-color: var(--color-green);
  background: linear-gradient(180deg, rgba(var(--green-rgb), 0.08), rgba(var(--green-rgb), 0.04));
  transform: scaleY(1.02);
}

.category-card.drag-over .empty-category-drop-zone {
  border-color: var(--color-green);
  background: transparent;
  opacity: 1;
}

.tool-card[draggable='true'] {
  cursor: grab;
}

.tool-card[draggable='true']:active {
  cursor: grabbing;
}

/* Drag ghost image styling */
.tool-card:hover:not(.dragging) {
  cursor: grab;
}

/* Responsive: single column on smaller screens */
@media (max-width: 640px) {
  .tool-card {
    width: 100%;
  }

  .category-cards-grid {
    gap: 12px;
  }
}

/* Marketplace Grid Styles */
.marketplace-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: calc(100% - 5px);
}

.marketplace-card {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 12px;
  border-radius: 16px;
  border-left: 3px solid var(--color-primary);
  width: calc(50% - 4px);
  box-sizing: border-box;
  cursor: pointer;
  transition: all 0.2s ease;
}

.marketplace-card.last-odd {
  width: 100%;
}

.marketplace-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.marketplace-card.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
}

.marketplace-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.marketplace-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--terminal-border-color);
}

.marketplace-avatar .avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.marketplace-avatar .avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-green), rgba(var(--green-rgb), 0.7));
  color: var(--color-darker-0);
  font-weight: 700;
  font-size: 14px;
  text-transform: uppercase;
}

.marketplace-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.marketplace-name {
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-md);
}

.marketplace-author {
  font-size: 11px;
  color: var(--color-text-muted);
}

.marketplace-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.price-badge {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 215, 0, 0.15);
  color: var(--color-yellow);
  border: 1px solid rgba(255, 215, 0, 0.4);
}

.free-badge {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
  text-transform: uppercase;
}

.marketplace-description {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 10px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  flex: 1;
}

.marketplace-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

.marketplace-stats {
  display: flex;
  gap: 12px;
}

.marketplace-stats .stat {
  font-size: 11px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.marketplace-stats .stat i {
  font-size: 10px;
  color: var(--color-green);
}

.install-btn {
  background: var(--color-primary);
  color: var(--color-white);
  border: none;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 4px;
}

.install-btn:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
}

.install-btn i {
  font-size: 10px;
}

@media (max-width: 640px) {
  .marketplace-card {
    width: 100%;
  }
}

/* ==================== MARKETPLACE STYLES (matching Workflows.vue) ==================== */

/* Marketplace Card Content */
.marketplace-card-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.marketplace-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
}

.marketplace-avatar-container {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.marketplace-avatar {
  width: 60px;
  height: 60px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid var(--terminal-border-color);
  transition: all 0.3s ease;
}

.marketplace-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.marketplace-avatar-placeholder {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.1), rgba(var(--green-rgb), 0.05));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-green);
  font-size: 24px;
  opacity: 0.5;
  border-radius: 50%;
  border: 2px solid var(--terminal-border-color);
  transition: all 0.3s ease;
}

.marketplace-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.marketplace-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.marketplace-name {
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

.marketplace-description {
  font-size: 11.5px;
  color: var(--color-text-muted);
  line-height: 1.45;
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.marketplace-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 0;
  border-top: 1px solid var(--terminal-border-color);
  border-bottom: 1px solid var(--terminal-border-color);
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

.item-price {
  padding: 4px 10px 2px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
  flex-shrink: 0;
}

.item-price.free {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.item-publisher {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  opacity: 0.8;
}

.item-publisher i {
  font-size: 10px;
  opacity: 0.6;
}

.install-button {
  width: 100%;
  padding: 10px 16px;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
  border: 1px solid transparent;
  font-weight: 700;
  font-size: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: auto;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.install-button:hover {
  background: var(--color-green);
  color: var(--color-navy);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
  transform: translateY(-1px);
}

.install-button:active {
  transform: translateY(0);
  box-shadow: none;
}

.install-button i {
  font-size: 14px;
}

/* Empty State Styles */
.empty-state-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  width: 100%;
}

.empty-state {
  text-align: center;
  color: var(--color-text-muted);
}

.empty-state i {
  font-size: 3em;
  margin-bottom: 8px;
  display: block;
  opacity: 0.5;
}

.empty-state p {
  margin: 0 0 16px 0;
  font-size: 1.1em;
}

.empty-state-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
}

.create-button {
  background: var(--color-primary);
  color: var(--color-white);
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.95em;
  transition: all 0.2s ease;
  font-weight: 600;
}

.create-button:hover {
  background: var(--color-primary-hover);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.create-button i {
  font-size: 0.9em;
}

.marketplace-button {
  background: var(--color-darker-0);
  color: var(--color-green);
  border: 1px solid var(--terminal-border-color);
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.95em;
  transition: all 0.2s ease;
  font-weight: 600;
}

.marketplace-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.marketplace-button i {
  font-size: 0.9em;
}
</style>
