<!-- Tools.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    :activeRightPanel="activeRightPanel"
    screenId="ToolsScreen"
    :terminalLines="terminalLines"
    :leftPanelProps="{ allAvailableTools, selectedTool }"
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
<MobileCollection v-if="mobileView" view-id="tools" title="Tools" count-label="tools" :items="filteredTools" :search="searchQuery" :tabs="[]" active="" :selected-id="selectedTool?.id" create-label="Create tool" icon="fas fa-wrench" @update:search="handleSearch" @select="selectTool" @create="handlePanelAction('create')"><template #actions><button @click="baseScreenRef.openMobilePanel('left')">Stats</button></template></MobileCollection>
<MarketplaceShelf v-if="mobileView" asset-type="tool" variant="strip" @browse="emit('screen-change', 'MarketplaceScreen')" />

<div v-show="!mobileView" class="desktop-view-container">
        <!-- Title, count, search. Create lives in the right panel. -->
        <ScreenToolbar
          title="TOOLS"
          :count="filteredTools.length"
          countLabel="tools"
          searchPlaceholder="Search tools..."
          :searchQuery="searchQuery"
          :searchScope="shelfHasFocus ? 'Marketplace' : ''"
          :layoutOptions="[]"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :showSort="false"
          @update:searchQuery="handleSearch"
        />

        <!-- Main Content (Sidebar moved to LeftPanel) -->
        <div class="screen-content tools-content" @click="onContentClick">
          <main class="screen-main-content tools-main-content fade-in">
            <div class="category-cards-container">
              <!-- Nothing owned yet: the empty state IS the storefront. -->
              <MarketplaceShelf
                v-if="ownsNothing && !searchQuery && !filteredTools.length"
                asset-type="tool"
                variant="full"
                :query="searchQuery"
                create-label="Create Tool"
                @create="handlePanelAction('create')"
                @browse="handlePanelAction('navigate', 'MarketplaceScreen')"
                @installed="onShelfInstalled"
                @clear-search="handleSearch('')"
                @availability="(v) => (shelfAvailable = v)"
              />

              <!-- Owned, but nothing matched this search. -->
              <div v-else-if="filteredTools.length === 0" class="empty-state-container">
                <div class="empty-state">
                  <i class="fas fa-wrench"></i>
                  <p>No tools match &ldquo;{{ searchQuery }}&rdquo;</p>
                  <div class="empty-state-buttons">
                    <button class="create-button" @click="handleSearch('')"><i class="fas fa-undo"></i> Clear search</button>
                  </div>
                </div>
              </div>

              <!-- One flat grid: your tools, then plugin tools, then built-ins,
                   each A–Z. Search in the header is the only filter. -->
              <div v-else class="card-grid tools-grid" role="list" aria-label="Tools">
                <div
                  v-for="tool in filteredTools"
                  :key="tool.id"
                  class="tool-card"
                  :class="{
                    selected: selectedTool?.id === tool.id,
                    'tool-plugin': tool.isPlugin,
                    'tool-pro': !tool.isPlugin && tool.requiresPro,
                    'tool-custom': !tool.isPlugin && !tool.requiresPro && tool.source === 'custom',
                    'tool-system': !tool.isPlugin && !tool.requiresPro && tool.source === 'system',
                  }"
                  @click="selectTool(tool)"
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
                      <!-- Only your own tools are yours to share; system and plugin tools ship with AGNT. -->
                      <ShareButton v-if="tool.source === 'custom' && !tool.isPlugin" kind="tool" :id="tool.id" :name="tool.title || tool.type" />
                      <button
                        v-if="tool.authProvider"
                        class="tool-auth-badge"
                        :class="{ connected: isProviderConnected(tool.authProvider) }"
                        @click.stop="handleProviderToggle(tool.authProvider)"
                      >
                        {{ isProviderConnected(tool.authProvider) ? 'Connected' : 'Connect' }}
                      </button>
                    </div>
                  </div>

                  <div class="tool-description">
                    {{ tool.description || 'No description available' }}
                  </div>

                  <div v-if="tool.type" class="tool-type">Type: {{ tool.type }}</div>
                </div>
              </div>

              <!-- Second run: the user's own work leads, the shelf steps aside. -->
              <MarketplaceShelf
                v-if="!searchQuery"
                asset-type="tool"
                variant="strip"
                @browse="handlePanelAction('navigate', 'MarketplaceScreen')"
                @installed="onShelfInstalled"
              />
            </div>
          </main>
        </div>

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
import MobileCollection from '@/mobile/MobileCollection.vue';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import ShareButton from '@/views/_components/share/ShareButton.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import { useToolsTutorial } from './useToolsTutorial.js';
import { useProviderConnection } from '@/composables/useProviderConnection.js';
// NOTE: Static toolLibrary import removed - now using centralized Vuex store (tools/fetchWorkflowTools)

// Define categories outside setup for clarity
const toolCategoryTabs = {
  all: { name: 'All', icon: 'fas fa-list', types: [] },
  system: { name: 'System', icon: 'fas fa-cogs', types: [] },
  custom: { name: 'Custom', icon: 'fas fa-user', types: [] },
};

export default {
  name: 'ToolsScreen',
  components: { BaseScreen, MobileCollection, TerminalHeader, SvgIcon, SimpleModal, PopupTutorial, Tooltip, ScreenToolbar, MarketplaceShelf, ShareButton },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const mobileView = inject('isMobile', ref(false));
    // Initialize tutorial
    const { tutorialConfig, startTutorial, onTutorialClose, initializeToolsTutorial } = useToolsTutorial();

    const store = useStore();
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const selectedTool = ref(null);
    const searchQuery = ref('');

    /* Shelf wiring. Reads the RAW custom-tool list, not the searched one. */
    const shelfAvailable = ref(false);
    const ownsNothing = computed(() => (store.getters['tools/customTools'] || []).length === 0);
    const shelfHasFocus = computed(() => ownsNothing.value && shelfAvailable.value && !filteredTools.value.length);
    const onShelfInstalled = () => store.dispatch('tools/fetchTools');


    const customTools = computed(() => store.getters['tools/customTools'] || []);
    const isLoading = computed(() => store.getters['tools/isLoading']);

    // Inject playSound function
    const playSound = inject('playSound');



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




    // --- The one list the screen shows ---
    // Your tools first, then plugin tools, then built-ins; A–Z within each.
    // Search is the only filter. Sorts a copy (the old version sorted the
    // computed source in place).
    const toolRank = (tool) => (tool.source === 'custom' ? 0 : tool.isPlugin ? 1 : 2);
    const filteredTools = computed(() => {
      const q = searchQuery.value.trim().toLowerCase();
      const all = allAvailableTools.value;
      const items = q
        ? all.filter((tool) => [tool.title, tool.type, tool.description].some((v) => v && String(v).toLowerCase().includes(q)))
        : [...all];
      return items.sort(
        (x, y) => toolRank(x) - toolRank(y) || (x.title || x.type || '').localeCompare(y.title || y.type || '', undefined, { sensitivity: 'base' }),
      );
    });


    const activeRightPanel = computed(() => 'ToolsPanel');
    const panelProps = computed(() => ({ selectedTool: selectedTool.value }));

    // --- Methods ---
    const onContentClick = (e) => {
      if (!e.target.closest('.tool-card, .wm-list-row, .m-collection')) {
        selectedTool.value = null;
      }
    };

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


    const handleSearch = (query) => {
      searchQuery.value = query;
    };

    const handlePanelAction = async (action, payload) => {
      console.log('ToolsPanel action:', action, payload);
      switch (action) {
        case 'close-panel':
          selectedTool.value = null;
          break;
        // Right panel: "+ New tool" opens the forge on a blank tool.
        case 'create':
          emit('screen-change', 'ToolForgeScreen');
          break;
        // Left panel: a row in "Your tools".
        case 'select-item': {
          const hit = allAvailableTools.value.find((t) => String(t.id) === String(payload?.id));
          if (hit) selectTool(hit);
          break;
        }
        case 'navigate':
          emit('screen-change', payload);
          break;
        case 'edit-tool':
          emit('screen-change', 'ToolForgeScreen', { toolId: payload });
          break;
        case 'delete-tool':
          selectedTool.value = null;
          break;
        default:
          console.warn('Unhandled panel action in Tools.vue:', action, payload);
      }
    };

    const initializeScreen = () => {
      selectedTool.value = null;

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
      { deep: true },
    );












    // Initialize marketplace install composable
    const simpleModalRef = ref(null);
    const { installMarketplaceItem, isInstalling } = useMarketplaceInstall(simpleModalRef);

    // Provider connection composable
    const { isProviderConnected, handleProviderToggle } = useProviderConnection(simpleModalRef);



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
      onShelfInstalled,
      mobileView,
      baseScreenRef,
      terminalLines,
      filteredTools,
      isLoading,
      selectedTool,
      onContentClick,
      selectTool,
      handleSearch,
      handlePanelAction,
      emit,
      initializeScreen,
      systemTools,
      customTools,
      allAvailableTools,
      scrollToBottom,
      // Dynamic panel switching
      activeRightPanel,
      panelProps,
      // Search functionality
      searchQuery,
      shelfAvailable,
      ownsNothing,
      shelfHasFocus,
      // Category functionality
      // Drag and drop
      // Marketplace
      simpleModalRef,
      // Provider connection
      isProviderConnected,
      handleProviderToggle,
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

/* ── Category tabs ── */
/* .wm-tabs / .wm-tab now live in _components/FilterTabs.vue. */

/* ── List View ── */
.wm-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  max-width: 1048px;
}

.wm-list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: all 0.15s;
  cursor: pointer;
}

.wm-list-row:hover {
  background: rgba(var(--green-rgb), 0.06);
  border-color: rgba(var(--green-rgb), 0.2);
}

.wm-list-row.selected {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.25);
}

.wm-list-icon {
  font-size: 14px;
  color: var(--color-text-muted);
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.wm-list-svg {
  width: 18px;
  height: 18px;
}

.wm-list-name {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--color-text);
  font-weight: 600;
  white-space: nowrap;
  min-width: 140px;
}

.wm-list-desc {
  flex: 1;
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.wm-list-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.wm-badge {
  font-size: 8px;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border-radius: 3px;
}

.wm-badge-builtin {
  background: rgba(100, 100, 200, 0.1);
  color: var(--color-text-muted);
}

.wm-badge-plugin {
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
}

.wm-badge-pro {
  background: rgba(var(--pink-rgb), 0.1);
  color: var(--color-pink);
}

.wm-list-type {
  font-size: 9px;
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
  flex-shrink: 0;
  min-width: 50px;
  text-align: right;
}

.wm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  gap: 8px;
}

.wm-empty-icon {
  font-size: 32px;
  color: var(--color-text-muted);
  opacity: 0.3;
}

.wm-empty-text {
  font-size: 12px;
  color: var(--color-text-muted);
  letter-spacing: 2px;
  text-transform: uppercase;
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

/* layout: .screen-content in styles/components/_screen-layout.css */

/* layout: .screen-main-content in styles/components/_screen-layout.css */

.tools-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.tools-main-content::-webkit-scrollbar-track {
  background: var(--color-darker-1) !important;
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
  /* PRD-013: theme-aware — hardcoded white was invisible on the light theme's
     white background behind the translucent green highlight. */
  color: var(--color-text) !important;
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
  color: var(--color-text) !important;
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

/* layout: .card-row in styles/components/_screen-layout.css */

.tool-card {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 12px;
  border-radius: 16px;
  /* A .card-grid cell: the grid sizes the card. Any width here is a
     fraction of the cell, not of the row. */
  min-width: 0;
  box-sizing: border-box;
  cursor: pointer;
  transition: all 0.2s ease;
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

.tool-auth-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px 2px;
  border-radius: 12px;
  border: none;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  cursor: pointer;
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-red);
  border: 1px solid rgba(239, 68, 68, 0.4);
  transition: filter 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
}

.tool-auth-badge:hover {
  filter: brightness(1.2);
}

.tool-auth-badge.connected {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-green);
  border-color: rgba(34, 197, 94, 0.4);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.3);
}

.tool-description {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  /* Never grow: see .agent-description in Agents.vue. */
  flex: 0 1 auto;
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
  color: var(--on-fill-accent);
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
  background: var(--color-darker-1);
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
  color: var(--text-primary);
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
  margin-bottom: 0;
  display: block;
  opacity: 0.5;
}

.empty-state p {
  margin: 12px 0 16px 0;
  font-size: 1.1em;
}

.empty-state-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
}

.create-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: transparent;
  border: 1px dashed var(--color-duller-navy);
  padding: 10px 20px;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.95em;
  transition: all 0.2s ease;
}

.create-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.create-button i {
  font-size: 0.8em;
}

.marketplace-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: transparent;
  border: 1px dashed var(--color-duller-navy);
  padding: 10px 20px;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.95em;
  transition: all 0.2s ease;
}

.marketplace-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.marketplace-button i {
  font-size: 0.8em;
}
</style>
