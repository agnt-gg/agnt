<!-- Workflows.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="WorkflowsPanel"
    :activeRightPanel="activeRightPanel"
    screenId="WorkflowsScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      allWorkflows,
      workflowsFilteredByTab,
      activeTab,
      selectedWorkflowId,
    }"
    :panelProps="panelProps"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <!-- <TerminalHeader 
        title="My Workflows" 
        subtitle="Browse, monitor, and control your active workflows." 
      /> -->

      <div class="workflows-panel">
        <!-- Sticky Header Container -->
        <div class="sticky-header">
          <!-- Workflow Tabs -->
          <BaseTabControls
            :tabs="tabs"
            :active-tab="activeTab"
            :current-layout="currentLayout"
            :show-grid-toggle="true"
            @select-tab="selectTab"
            @set-layout="setLayout"
          />

          <!-- Search Bar for Card View -->
          <div class="card-view-search-bar">
            <input
              type="text"
              class="search-input"
              placeholder="Search workflows..."
              :value="searchQuery"
              @input="handleSearch($event.target.value)"
            />
            <Tooltip :text="allCategoriesCollapsed ? 'Expand all categories' : 'Collapse all categories'" width="auto">
            <button
              class="collapse-all-button"
              :class="{ active: allCategoriesCollapsed }"
              @click="toggleCollapseAll"
            >
              <i :class="allCategoriesCollapsed ? 'fas fa-expand' : 'fas fa-compress'"></i>
            </button>
            </Tooltip>
            <Tooltip :text="hideEmptyCategories ? 'Show empty categories' : 'Hide empty categories'" width="auto">
            <button
              class="hide-empty-button"
              :class="{ active: hideEmptyCategories }"
              @click="toggleHideEmptyCategories"
            >
              <i :class="hideEmptyCategories ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
            </button>
            </Tooltip>
          </div>
        </div>

        <!-- Main Content (Sidebar moved to LeftPanel) -->
        <div class="workflows-content">
          <main class="workflows-main-content fade-in">
            <!-- Workflows Table -->
            <BaseTable
              v-if="currentLayout === 'table'"
              :items="filteredWorkflows"
              :columns="tableColumns"
              :selected-id="selectedWorkflowId"
              :show-search="true"
              :show-sort-dropdown="false"
              :enable-column-sorting="true"
              search-placeholder="Search workflows..."
              :search-keys="['name', 'title', 'status', 'category']"
              :no-results-text="'No workflows found.'"
              :title-key="'name'"
              @row-click="handleWorkflowClick"
              @search="handleSearch"
            >
              <template #status="{ item }">
                <div :class="['col-status', item.status.toLowerCase()]">[{{ item.status }}]</div>
              </template>
              <template #name="{ item }">
                {{ item.name || item.title }}
              </template>
              <template #tools="{ item }">
                <div class="tools-icons">
                  <Tooltip
                    v-for="(tool, index) in getToolsWithNames(item)"
                    :key="`tool-icon-${index}`"
                    :text="tool.name"
                    width="auto"
                  >
                  <SvgIcon
                    :name="tool.icon"
                    class="tool-icon"
                  />
                  </Tooltip>
                </div>
              </template>
            </BaseTable>

            <!-- Category Cards View -->
            <div v-else-if="currentLayout === 'grid'" class="category-cards-container">
              <!-- Empty State - Only show for non-marketplace tabs when no workflows exist -->
              <div
                v-if="
                  activeTab !== 'marketplace' &&
                  (Object.keys(workflowsByCategory).length === 0 || Object.values(workflowsByCategory).every((arr) => arr.length === 0))
                "
                class="empty-state-container"
              >
                <div class="empty-state">
                  <i class="fas fa-cogs"></i>
                  <p>No workflows found</p>
                  <div class="empty-state-buttons">
                    <button class="create-button" @click="handlePanelAction('navigate', 'WorkflowForgeScreen')">
                      <i class="fas fa-plus"></i> Create Workflow
                    </button>
                    <button class="marketplace-button" @click="selectTab('marketplace')"><i class="fas fa-store"></i> View Marketplace</button>
                  </div>
                </div>
              </div>

              <div v-else class="category-cards-grid">
                <article
                  v-for="(workflows, categoryName, index) in workflowsByCategory"
                  :key="categoryName"
                  class="category-card"
                  :class="{
                    'drag-over': dragOverCategory === categoryName,
                    'full-width': workflows.length >= 2,
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
                        v-for="(workflow, index) in workflows"
                        :key="workflow.id"
                        class="workflow-card"
                        :class="{
                          selected: selectedWorkflowId === workflow.id,
                          dragging: draggedWorkflow?.id === workflow.id,
                          'last-odd': workflows.length % 2 === 1 && index === workflows.length - 1,
                        }"
                        draggable="true"
                        @click="handleWorkflowClick(workflow)"
                        @dblclick="handleWorkflowDoubleClick(workflow)"
                        @dragstart="handleDragStart($event, workflow)"
                        @dragend="handleDragEnd"
                      >
                        <!-- Marketplace Workflow Card -->
                        <template v-if="activeTab === 'marketplace'">
                          <div class="marketplace-card-content">
                            <!-- Row 1: Avatar + Title/Publisher/Description -->
                            <div class="marketplace-header">
                              <div class="marketplace-avatar-container">
                                <div v-if="workflow.preview_image" class="marketplace-avatar">
                                  <img :src="workflow.preview_image" :alt="workflow.title" />
                                </div>
                                <div v-else class="marketplace-avatar-placeholder">
                                  <i class="fas fa-project-diagram"></i>
                                </div>
                              </div>

                              <div class="marketplace-info">
                                <div class="marketplace-title-row">
                                  <h3 class="marketplace-name">{{ workflow.title }}</h3>
                                  <span v-if="workflow.price > 0" class="workflow-price">${{ workflow.price.toFixed(2) }}</span>
                                  <span v-else class="workflow-price free">FREE</span>
                                </div>

                                <div class="workflow-publisher">
                                  <i class="fas fa-user"></i>
                                  {{ workflow.publisher_pseudonym || workflow.publisher_name || 'Anonymous' }}
                                </div>

                                <p class="marketplace-description">
                                  {{ workflow.tagline || workflow.description || 'No description available' }}
                                </p>
                              </div>
                            </div>

                            <!-- Row 2: Ratings and Downloads -->
                            <div class="marketplace-meta">
                              <div class="meta-item">
                                <i class="fas fa-star"></i>
                                <span>{{ workflow.rating ? workflow.rating.toFixed(1) : '0.0' }}</span>
                                <span class="meta-count">({{ workflow.rating_count || 0 }})</span>
                              </div>
                              <div class="meta-item">
                                <i class="fas fa-download"></i>
                                <span>{{ workflow.downloads || 0 }}</span>
                              </div>
                              <div v-if="workflow.category" class="meta-item category">
                                <i class="fas fa-tag"></i>
                                <span>{{ workflow.category }}</span>
                              </div>
                            </div>

                            <!-- Row 3: Install Button -->
                            <button class="install-button" @click.stop="handleInstallWorkflow(workflow)">
                              <i class="fas fa-download"></i>
                              {{ workflow.price > 0 ? 'Purchase' : 'Install' }}
                            </button>
                          </div>
                        </template>

                        <!-- Regular Workflow Card -->
                        <template v-else>
                          <div class="workflow-header">
                            <div class="workflow-avatar-name">
                              <div class="workflow-avatar">
                                <div class="avatar-placeholder">
                                  {{ (workflow.name || workflow.title || 'W').charAt(0).toUpperCase() }}
                                </div>
                              </div>
                              <span class="workflow-name">{{ workflow.name || workflow.title }}</span>
                            </div>
                            <span class="workflow-status" :class="workflow.status.toLowerCase()">{{ workflow.status }}</span>
                          </div>

                          <div class="workflow-description" :class="{ 'no-tools': !hasToolsOrUptime(workflow) }">
                            {{ workflow.description || 'No description available' }}
                          </div>

                          <div v-if="hasToolsOrUptime(workflow)" class="workflow-tools">
                            <div v-if="getToolsWithNames(workflow).length > 0" class="tools-icons">
                              <Tooltip
                                v-for="(tool, index) in getToolsWithNames(workflow).slice(0, 4)"
                                :key="`tool-${index}`"
                                :text="tool.name"
                                width="auto"
                              >
                              <span
                                class="tool-icon-small"
                              >
                                <SvgIcon :name="tool.icon" />
                              </span>
                              </Tooltip>
                              <span v-if="getToolsWithNames(workflow).length > 4" class="tools-overflow">
                                +{{ getToolsWithNames(workflow).length - 4 }}
                              </span>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                    <div v-if="workflows.length === 0" class="empty-category-drop-zone">Drop workflow here to recategorize</div>
                  </div>
                </article>
              </div>
            </div>
          </main>
        </div>
      </div>
    </template>
  </BaseScreen>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="WorkflowsScreen" @close="onTutorialClose" />
  <SimpleModal ref="simpleModalRef" />
</template>

<script>
import { ref, onMounted, onUnmounted, computed, nextTick, inject } from 'vue';
import { useStore } from 'vuex';
import { useCleanup } from '@/composables/useCleanup';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import BaseScreen from '../../BaseScreen.vue';
import BaseTable from '../../../_components/BaseTable.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import BaseTabControls from '../../../_components/BaseTabControls.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useWorkflowsTutorial } from './useWorkflowsTutorial.js';
export default {
  name: 'WorkflowsScreen',
  components: { BaseScreen, BaseTable, TerminalHeader, BaseTabControls, SvgIcon, PopupTutorial, SimpleModal, Tooltip },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const cleanup = useCleanup();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const simpleModalRef = ref(null);
    const terminalLines = ref([]);
    const selectedWorkflowId = ref(null);
    const activeTab = ref('all');
    const searchQuery = ref('');
    const currentLayout = ref('grid');
    const hideEmptyCategories = ref(true);
    let pollingInterval = null;

    const selectedCategory = ref(null);
    const selectedMainCategory = ref(null);

    // Drag and drop state
    const draggedWorkflow = ref(null);
    const dragOverCategory = ref(null);
    const collapsedCategories = ref(new Set());

    // Click handling state
    let clickTimer = null;

    // Define tabs
    const tabs = [
      { id: 'all', name: 'All', icon: 'fas fa-list' },
      { id: 'active', name: 'Active', icon: 'fas fa-play' },
      { id: 'completed', name: 'Completed', icon: 'fas fa-check' },
      { id: 'failed', name: 'Failed', icon: 'fas fa-times' },
      { id: 'marketplace', name: 'Marketplace', icon: 'fas fa-store' },
    ];

    // Marketplace state
    const marketplaceWorkflows = computed(() => store.getters['marketplace/filteredMarketplaceWorkflows'] || []);
    const marketplaceSearchQuery = ref('');

    document.body.setAttribute('data-page', 'terminal-workflows');

    // Tutorial setup
    const { tutorialConfig, startTutorial, onTutorialClose, initializeWorkflowsTutorial } = useWorkflowsTutorial();

    const mainWorkflowCategories = computed(() => {
      const categories = store.getters['workflows/workflowCategories'] || [];
      return categories
        .filter((cat) => {
          if (!cat) return false;
          // Include "Uncategorized" as a main category
          if (cat === 'Uncategorized') return true;
          // Include categories that don't have dots in their first part (main categories)
          return !cat.split(' ')[0].includes('.');
        })
        .map((cat) => {
          return {
            code: cat === 'Uncategorized' ? 'Uncategorized' : cat.split(' ')[0],
            label: cat,
          };
        });
    });

    const categories = computed(() => store.getters['workflows/workflowCategories']);

    // Define table columns
    const tableColumns = [
      { key: 'status', label: 'Status', width: '120px' },
      { key: 'name', label: 'Name', width: '1.5fr' },
      { key: 'tools', label: 'Tools', width: '2fr' },
    ];

    const allWorkflows = computed(() => store.getters['workflows/allWorkflows']);

    // Create a new computed property that is only filtered by the active tab
    const workflowsFilteredByTab = computed(() => {
      let workflows = allWorkflows.value;
      switch (activeTab.value) {
        case 'active':
          return workflows.filter((w) => w.status === 'running' || w.status === 'listening');
        case 'completed':
          return workflows.filter((w) => w.status === 'completed' || w.status === 'stopped');
        case 'failed':
          return workflows.filter((w) => w.status === 'error' || w.status === 'insufficient-credits');
        default: // 'all'
          return workflows;
      }
    });

    // Computed property for filtered workflows
    const filteredWorkflows = computed(() => {
      let workflows = workflowsFilteredByTab.value;

      // Filter by category
      if (selectedMainCategory.value) {
        if (selectedMainCategory.value === 'Uncategorized') {
          // Filter for workflows with empty, null, or undefined categories
          workflows = workflows.filter((item) => !item.category || item.category.trim() === '');
        } else {
          // Filter for workflows that start with the main category code
          workflows = workflows.filter((item) => item.category && item.category.startsWith(selectedMainCategory.value));
        }
      } else if (selectedCategory.value && selectedCategory.value !== 'All Workflows') {
        if (selectedCategory.value === 'Uncategorized') {
          // Filter for workflows with empty, null, or undefined categories
          workflows = workflows.filter((item) => !item.category || item.category.trim() === '');
        } else {
          // Filter for exact category match
          workflows = workflows.filter((item) => item.category === selectedCategory.value);
        }
      }

      return workflows;
    });

    // Add this computed property after the existing computed properties
    const categoriesWithCounts = computed(() => {
      const categories = store.getters['workflows/workflowCategories'] || [];
      const workflows = workflowsFilteredByTab.value;

      return categories.map((category) => {
        const count = workflows.filter((w) => w.category === category).length;
        return count > 0 ? `${category} (${count})` : category;
      });
    });

    // Group workflows by category for card view
    const workflowsByCategory = computed(() => {
      // If marketplace tab is selected, show marketplace workflows
      if (activeTab.value === 'marketplace') {
        const marketplaceItems = marketplaceWorkflows.value;
        // Group marketplace items under a single "Marketplace" category
        return { 'Marketplace Workflows': marketplaceItems };
      }

      // Use filteredWorkflows instead of workflowsFilteredByTab to respect category filtering from left panel
      let workflows = filteredWorkflows.value;

      // Apply search filtering for card view
      if (searchQuery.value && searchQuery.value.trim() !== '') {
        const query = searchQuery.value.toLowerCase().trim();
        workflows = workflows.filter((workflow) => {
          const searchableFields = [workflow.name || '', workflow.title || '', workflow.status || '', workflow.category || ''];
          return searchableFields.some((field) => field.toLowerCase().includes(query));
        });
      }

      const categories = {};

      // When a specific category is selected, only show that category and its children
      if (selectedCategory.value && selectedCategory.value !== 'All Workflows') {
        // Initialize only the selected category
        categories[selectedCategory.value] = [];

        // If it's a main category, also include its children
        if (selectedMainCategory.value && selectedMainCategory.value !== 'Uncategorized') {
          const allCategories = store.getters['workflows/workflowCategories'] || [];
          allCategories.forEach((category) => {
            if (category.startsWith(selectedMainCategory.value) && category !== selectedMainCategory.value) {
              categories[category] = [];
            }
          });
        }

        // Assign workflows to their categories (only the selected ones)
        workflows.forEach((workflow) => {
          const category = workflow.category || 'Uncategorized';
          // For the selected category, always add workflows regardless of whether the category exists in the predefined list
          if (category === selectedCategory.value) {
            categories[selectedCategory.value].push(workflow);
          } else if (categories.hasOwnProperty(category)) {
            categories[category].push(workflow);
          }
        });
      } else {
        // When "All Workflows" is selected, show all categories
        const allCategories = store.getters['workflows/workflowCategories'] || [];

        // Initialize all predefined categories with empty arrays
        allCategories.forEach((category) => {
          categories[category] = [];
        });

        // Always include 'Uncategorized' category
        if (!categories['Uncategorized']) {
          categories['Uncategorized'] = [];
        }

        // First pass: collect all unique categories from workflows to ensure we don't miss any
        workflows.forEach((workflow) => {
          const category = workflow.category || 'Uncategorized';
          if (!categories[category]) {
            categories[category] = [];
          }
        });

        // Second pass: assign workflows to their categories
        workflows.forEach((workflow) => {
          const category = workflow.category || 'Uncategorized';
          categories[category].push(workflow);
        });
      }

      // Sort categories alphabetically (A-Z) and return as sorted object
      const sortedCategories = {};
      Object.keys(categories)
        .sort((a, b) => a.localeCompare(b))
        .forEach((key) => {
          // When searching, only show categories that have workflows
          if (searchQuery.value && searchQuery.value.trim() !== '') {
            if (categories[key].length > 0) {
              sortedCategories[key] = categories[key];
            }
          } else if (hideEmptyCategories.value) {
            // When hiding empty categories, only show categories with workflows
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

    // Get category display name and icon
    const getCategoryInfo = (categoryName) => {
      const categoryIcons = {
        'Data Processing': '🔄',
        Integration: '🔗',
        'File Management': '📁',
        Communication: '📧',
        Analytics: '📊',
        System: '⚙️',
        Uncategorized: '📋',
      };

      return {
        name: categoryName,
        icon: categoryIcons[categoryName] || '🔧',
        count: workflowsByCategory.value[categoryName]?.length || 0,
      };
    };

    // Get workflow icon based on status
    const getWorkflowIcon = (workflow) => {
      const statusIcons = {
        running: '▶️',
        listening: '👂',
        completed: '✅',
        stopped: '⏹️',
        error: '❌',
        'insufficient-credits': '💳',
        queued: '⏳',
      };

      return statusIcons[workflow.status] || '🔧';
    };

    // --- Computed Property for Active Right Panel ---
    const activeRightPanel = computed(() => {
      // When on marketplace tab, use MarketplacePanel to show marketplace item details
      if (activeTab.value === 'marketplace') {
        return 'MarketplacePanel';
      }
      // Otherwise use WorkflowsPanel for regular workflow details
      return 'WorkflowsPanel';
    });

    // --- Computed Property for Panel Props ---
    const panelProps = computed(() => {
      // When on marketplace tab, pass selectedWorkflow for MarketplacePanel
      if (activeTab.value === 'marketplace') {
        // Find the selected workflow from marketplace workflows
        const selectedWorkflow = marketplaceWorkflows.value.find((w) => w.id === selectedWorkflowId.value);
        return {
          selectedWorkflow: selectedWorkflow || null,
          activeTab: 'marketplace',
        };
      }
      // For regular workflow tabs, pass selectedWorkflowId for WorkflowsPanel
      return { selectedWorkflowId: selectedWorkflowId.value };
    });

    // --- Methods ---
    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();
    const focusInput = () => baseScreenRef.value?.focusInput();
    const clearInput = () => baseScreenRef.value?.clearInput();
    const setInputDisabled = (disabled) => baseScreenRef.value?.setInputDisabled(disabled);

    const handleWorkflowClick = (workflow) => {
      playSound('typewriterKeyPress');
      selectedWorkflowId.value = workflow.id;
      addLine(`Selected workflow: ${workflow.id}`, 'info');
    };

    const handleWorkflowDoubleClick = (workflow) => {
      playSound('typewriterKeyPress');
      addLine(`Opening workflow ${workflow.id} in editor...`, 'info');
      // Wait 1 second before navigating to give user visual feedback
      setTimeout(() => {
        emit('screen-change', 'WorkflowForgeScreen', { workflowId: workflow.id });
      }, 100);
    };

    const handleSearch = (query) => {
      searchQuery.value = query;
    };

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    const toggleHideEmptyCategories = () => {
      hideEmptyCategories.value = !hideEmptyCategories.value;
      addLine(`[Workflows] ${hideEmptyCategories.value ? 'Hiding' : 'Showing'} empty categories`, 'info');
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
      const categoryNames = Object.keys(workflowsByCategory.value);
      return categoryNames.length > 0 && categoryNames.every((name) => collapsedCategories.value.has(name));
    });

    const toggleCollapseAll = () => {
      const categoryNames = Object.keys(workflowsByCategory.value);

      if (allCategoriesCollapsed.value) {
        // Expand all categories
        categoryNames.forEach((name) => {
          collapsedCategories.value.delete(name);
        });
        addLine('[Workflows] Expanded all categories', 'info');
      } else {
        // Collapse all categories
        categoryNames.forEach((name) => {
          collapsedCategories.value.add(name);
        });
        addLine('[Workflows] Collapsed all categories', 'info');
      }
    };

    const addLine = (content, type = 'default') => {
      terminalLines.value.push({ content, type });
      nextTick(() => scrollToBottom());
    };

    const onAllSelected = () => {
      selectedMainCategory.value = null;
      selectedCategory.value = null;
      selectedWorkflowId.value = null;
      addLine('[Workflows] Viewing all workflows (no category filter)', 'info');
    };

    const onCategorySelected = (payload) => {
      if (payload.isMainCategory) {
        selectedMainCategory.value = payload.mainCategory;
        selectedCategory.value = payload.category;
      } else {
        selectedMainCategory.value = null;
        selectedCategory.value = payload.category;
      }
      selectedWorkflowId.value = null;
      addLine(`[Workflows] Viewing ${payload.category}`, 'info');
    };

    const handleUserInputSubmit = async (input) => {
      addLine(`> ${input}`, 'input');
      clearInput();

      const command = input.toLowerCase().trim();
      const [action, ...args] = command.split(' ');

      switch (action) {
        case 'list':
          await listWorkflows();
          break;
        case 'info':
          if (args[0]) {
            await showWorkflowInfo(args[0]);
          } else {
            addLine('Please provide a workflow ID', 'error');
          }
          break;
        case 'run':
          if (args[0]) {
            await runWorkflow(args[0]);
          } else {
            addLine('Please provide a workflow ID', 'error');
          }
          break;
        case 'stop':
          if (args[0]) {
            await stopWorkflow(args[0]);
          } else {
            addLine('Please provide a workflow ID', 'error');
          }
          break;
        case 'install-workflow':
          // Handle marketplace item installation from the right panel
          await handleInstallWorkflow(payload);
          break;
        default:
          console.warn('Unhandled panel action in Workflows.vue:', action, payload);
      }
    };

    const handlePanelAction = async (action, payload) => {
      console.log('Workflow panel action:', action, payload);

      if (action === 'category-filter-changed') {
        // Handle category filter changes from the WorkflowsPanel
        selectedCategory.value = payload.selectedCategory;
        selectedMainCategory.value = payload.selectedMainCategory;
        selectedWorkflowId.value = null; // Clear workflow selection when category changes

        if (payload.type === 'all-selected') {
          addLine('[Workflows] Viewing all workflows (no category filter)', 'info');
        } else if (payload.type === 'category-selected') {
          const categoryName = payload.payload.category;
          addLine(`[Workflows] Viewing ${categoryName}`, 'info');
        }
      } else if (action === 'navigate') {
        emit('screen-change', payload);
      } else if (action === 'edit-workflow') {
        try {
          addLine(`Opening workflow ${payload} in editor...`, 'info');
          // Navigate to WorkflowForge screen and emit screen change with workflow ID
          emit('screen-change', 'WorkflowForgeScreen', { workflowId: payload });
        } catch (error) {
          addLine(`Error opening workflow editor: ${error.message}`, 'error');
        }
      } else if (action === 'start-workflow') {
        try {
          addLine(`Starting workflow ${payload}...`, 'info');
          const token = localStorage.getItem('token');
          if (!token) {
            throw new Error('No authentication token found');
          }

          const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${payload}/start`, {
            method: 'POST',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          addLine(`Workflow ${payload} started successfully.`, 'success');
          // Refresh workflows list
          store.dispatch('workflows/fetchWorkflows');
        } catch (error) {
          addLine(`Error starting workflow: ${error.message}`, 'error');
        }
      } else if (action === 'stop-workflow') {
        try {
          addLine(`Stopping workflow ${payload}...`, 'info');
          const token = localStorage.getItem('token');
          if (!token) {
            throw new Error('No authentication token found');
          }

          const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${payload}/stop`, {
            method: 'POST',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          addLine(`Workflow ${payload} stopped successfully.`, 'success');
          // Refresh workflows list
          store.dispatch('workflows/fetchWorkflows');
        } catch (error) {
          addLine(`Error stopping workflow: ${error.message}`, 'error');
        }
      } else if (action === 'update-workflow') {
        try {
          addLine(`Updating workflow ${payload.id}...`, 'info');
          await store.dispatch('workflows/updateWorkflow', payload);
          addLine(`Workflow category updated successfully.`, 'success');
        } catch (error) {
          addLine(`Error updating workflow: ${error.message}`, 'error');
        }
      } else if (action === 'delete-workflow') {
        try {
          addLine(`Deleting workflow ${payload}...`, 'info');
          await store.dispatch('workflows/deleteWorkflow', payload);
          addLine(`Workflow ${payload} deleted successfully.`, 'success');
          selectedWorkflowId.value = null; // Clear selection
        } catch (error) {
          addLine(`Error deleting workflow: ${error.message}`, 'error');
        }
      } else if (action === 'install-workflow') {
        // Handle marketplace item installation from the right panel
        await handleInstallWorkflow(payload);
      }
    };

    const selectTab = async (tabId) => {
      activeTab.value = tabId;
      selectedWorkflowId.value = null;
      addLine(`[Workflows] Viewing ${tabId} workflows`, 'info');

      // Fetch marketplace workflows when marketplace tab is selected
      if (tabId === 'marketplace') {
        try {
          addLine('[Marketplace] Loading marketplace workflows...', 'info');
          // Update filters to fetch workflows only, then fetch items
          await store.dispatch('marketplace/updateFilters', { assetType: 'workflow' });
          await store.dispatch('marketplace/fetchMarketplaceItems');
          const count = store.getters['marketplace/filteredMarketplaceWorkflows'].length;
          addLine(`[Marketplace] Found ${count} workflows in marketplace`, 'success');
        } catch (error) {
          addLine(`[Marketplace] Error loading marketplace: ${error.message}`, 'error');
        }
      }
    };

    const initializeScreen = () => {
      terminalLines.value = [];
      addLine('Loading workflows...', 'info');

      // Show cached data immediately if available
      const cachedWorkflows = store.getters['workflows/allWorkflows'];
      if (cachedWorkflows && cachedWorkflows.length > 0) {
        addLine(`Loaded ${cachedWorkflows.length} workflows from cache.`, 'success');
      }

      // Non-blocking background refresh
      store.dispatch('workflows/fetchWorkflows').then(() => {
        const workflows = store.getters['workflows/allWorkflows'];
        if (cachedWorkflows.length === 0) {
          if (workflows.length === 0) {
            addLine('No workflows found. Create a workflow in the Workflow Designer.', 'info');
          } else {
            addLine(`Found ${workflows.length} workflows.`, 'success');
          }
        }
      }).catch((error) => {
        addLine(`Error loading workflows: ${error.message}`, 'error');
      });

      // Set up visibility-aware polling
      const startPolling = () => {
        if (pollingInterval) return;
        pollingInterval = setInterval(() => {
          if (document.hidden) return;
          const activeWorkflows = store.getters['workflows/allWorkflows'].filter((w) => w.status === 'running' || w.status === 'listening');
          if (activeWorkflows.length > 0) {
            store.dispatch('workflows/fetchWorkflows');
          }
        }, 15000);
      };

      const stopPolling = () => {
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
      };

      const visibilityHandler = () => {
        if (document.hidden) {
          stopPolling();
        } else {
          startPolling();
        }
      };

      cleanup.addEventListener(document, 'visibilitychange', visibilityHandler);

      startPolling();

      // Show tutorial after a short delay
      cleanup.setTimeout(() => {
        initializeWorkflowsTutorial();
      }, 2000);
    };

    // Proper lifecycle hook at component scope
    onUnmounted(() => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    });

    // --- Workflow Operations ---
    const listWorkflows = async () => {
      try {
        await store.dispatch('workflows/fetchWorkflows');
        const workflows = store.getters['workflows/allWorkflows'];
        if (workflows.length === 0) {
          addLine('No workflows found.', 'info');
        } else {
          addLine('Available Workflows:', 'info');
          workflows.forEach((workflow) => {
            addLine(`${workflow.id} - ${workflow.name || workflow.title}`, 'data');
          });
        }
      } catch (error) {
        addLine(`Error fetching workflows: ${error.message}`, 'error');
      }
    };

    const showWorkflowInfo = async (workflowId) => {
      try {
        const workflow = store.getters['workflows/getWorkflowById'](workflowId);
        if (workflow) {
          addLine(`Workflow Details for ${workflow.id}:`, 'info');
          addLine(`Title: ${workflow.title}`, 'data');
          addLine(`Assigned To: ${workflow.assignedTo || 'Not assigned'}`, 'data');
          if (workflow.nodes?.length) {
            addLine('Tools:', 'data');
            workflow.nodes.forEach((node) => {
              addLine(`- ${node}`, 'data');
            });
          }
        } else {
          addLine(`Workflow ${workflowId} not found.`, 'error');
        }
      } catch (error) {
        addLine(`Error fetching workflow info: ${error.message}`, 'error');
      }
    };

    const runWorkflow = async (workflowId) => {
      try {
        addLine(`Starting workflow ${workflowId}...`, 'info');
        // TODO: Implement workflow execution through store
        addLine('Workflow started successfully.', 'success');
      } catch (error) {
        addLine(`Error starting workflow: ${error.message}`, 'error');
      }
    };

    const stopWorkflow = async (workflowId) => {
      try {
        addLine(`Stopping workflow ${workflowId}...`, 'info');
        // TODO: Implement workflow stopping through store
        addLine('Workflow stopped successfully.', 'success');
      } catch (error) {
        addLine(`Error stopping workflow: ${error.message}`, 'error');
      }
    };

    const getToolsDisplay = (workflow) => {
      if (workflow.nodes?.length) {
        return workflow.nodes.map((node) => node.data?.label || node.type || 'Unknown Tool').join(', ');
      } else if (workflow.steps?.length) {
        return workflow.steps.map((step) => step.toolId || 'Unknown Step').join(', ');
      }
      return 'No tools';
    };

    const getToolsWithNames = (workflow) => {
      const tools = [];
      const seenTools = new Set();

      if (workflow.nodes?.length) {
        workflow.nodes.forEach((node) => {
          const icon = node.data?.icon || node.icon || 'custom';
          const name = node.data?.label || node.type || 'Unknown Tool';
          const key = `${icon}-${name}`;

          if (!seenTools.has(key)) {
            seenTools.add(key);
            tools.push({ icon, name });
          }
        });
      }

      return tools.length > 0 ? tools : [{ icon: 'custom', name: 'No tools' }];
    };

    // Helper method to check if workflow has tools or uptime to show
    const hasToolsOrUptime = (workflow) => {
      const hasTools = getToolsWithNames(workflow).length > 0 && getToolsWithNames(workflow)[0].name !== 'No tools';
      const hasUptime = workflow.uptime && workflow.uptime > 0;
      return hasTools || hasUptime;
    };

    // --- Drag and Drop Methods ---
    const handleDragStart = (event, workflow) => {
      draggedWorkflow.value = workflow;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', workflow.id);

      // Add visual feedback
      event.target.style.opacity = '0.5';
      addLine(`[Drag] Started dragging workflow: ${workflow.name || workflow.title}`, 'info');
    };

    const handleDragEnd = (event) => {
      // Reset visual feedback
      event.target.style.opacity = '1';
      draggedWorkflow.value = null;
      dragOverCategory.value = null;
    };

    const handleDragOver = (categoryName) => {
      if (draggedWorkflow.value && draggedWorkflow.value.category !== categoryName) {
        dragOverCategory.value = categoryName;
      }
    };

    const handleDragLeave = () => {
      dragOverCategory.value = null;
    };

    const handleDrop = async (event, targetCategory) => {
      event.preventDefault();
      dragOverCategory.value = null;

      if (!draggedWorkflow.value) return;

      const workflow = draggedWorkflow.value;
      const originalCategory = workflow.category || 'Uncategorized';

      // Don't do anything if dropping on the same category
      if (originalCategory === targetCategory) {
        addLine(`[Drag] Workflow is already in ${targetCategory}`, 'info');
        return;
      }

      try {
        addLine(`[Drag] Moving workflow "${workflow.name || workflow.title}" from ${originalCategory} to ${targetCategory}...`, 'info');

        // Optimistic update: immediately update the workflow in the store for instant UI feedback
        const updatedWorkflow = {
          ...workflow,
          category: targetCategory === 'Uncategorized' ? '' : targetCategory,
        };

        // Update the workflow in the store immediately (optimistic update)
        store.commit('workflows/UPDATE_WORKFLOW', updatedWorkflow);

        // Then send the update to the server in the background
        try {
          await handlePanelAction('update-workflow', updatedWorkflow);
          addLine(`[Drag] Successfully moved workflow to ${targetCategory}`, 'success');
        } catch (error) {
          // If server update fails, revert the optimistic update
          store.commit('workflows/UPDATE_WORKFLOW', workflow);
          addLine(`[Drag] Error moving workflow: ${error.message}`, 'error');
          addLine(`[Drag] Reverted workflow back to ${originalCategory}`, 'info');
        }
      } catch (error) {
        addLine(`[Drag] Error moving workflow: ${error.message}`, 'error');
      } finally {
        draggedWorkflow.value = null;
      }
    };

    // --- Marketplace Methods using shared composable ---
    // Initialize the marketplace install composable with modal and terminal logging
    const { handleInstall: marketplaceInstall } = useMarketplaceInstall(simpleModalRef, (msg) => addLine(msg, 'info'));

    const handleInstallWorkflow = async (workflow) => {
      playSound('typewriterKeyPress');
      const result = await marketplaceInstall(workflow);
      if (result.success) {
        // Switch to "All" tab to show the newly installed workflow
        activeTab.value = 'all';
        await store.dispatch('workflows/fetchWorkflows');
      }
    };

    return {
      baseScreenRef,
      simpleModalRef,
      terminalLines,
      handleUserInputSubmit,
      handlePanelAction,
      emit,
      initializeScreen,
      tabs,
      activeTab,
      selectTab,
      filteredWorkflows,
      selectedWorkflowId,
      handleWorkflowClick,
      handleWorkflowDoubleClick,
      getToolsDisplay,
      tableColumns,
      handleSearch,
      searchQuery,
      categories,
      categoriesWithCounts,
      mainWorkflowCategories,
      selectedCategory,
      selectedMainCategory,
      onCategorySelected,
      onAllSelected,
      allWorkflows,
      workflowsFilteredByTab,
      getToolsWithNames,
      hasToolsOrUptime,
      currentLayout,
      setLayout,
      workflowsByCategory,
      getCategoryInfo,
      getWorkflowIcon,
      hideEmptyCategories,
      toggleHideEmptyCategories,
      toggleCategoryCollapse,
      isCategoryCollapsed,
      allCategoriesCollapsed,
      toggleCollapseAll,
      // Drag and drop
      draggedWorkflow,
      dragOverCategory,
      handleDragStart,
      handleDragEnd,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      // Tutorial
      tutorialConfig,
      startTutorial,
      onTutorialClose,
      // Marketplace
      marketplaceWorkflows,
      handleInstallWorkflow,
      // Dynamic panel switching
      activeRightPanel,
      panelProps,
    };
  },
};
</script>

<style scoped>
.workflows-panel {
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
.workflow-table {
  width: calc(100% - 2px);
  border: 1px solid rgba(var(--green-rgb), 0.4);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  /* margin-bottom: 16px; */
}

.table-header {
  display: grid;
  grid-template-columns: 1fr 1.5fr 2fr;
  background: rgba(var(--green-rgb), 0.1);
  padding: 10px 8px;
  font-weight: 400;
  color: var(--color-green);
  border-bottom: 1px solid rgba(var(--green-rgb), 0.4);
}

.table-body {
  /* Remove fixed height and scrolling from table body */
  /* max-height: calc(100vh - 350px); */
  /* overflow-y: auto; */
  scrollbar-width: thin;
  scrollbar-color: var(--color-green) transparent;
}

.table-body::-webkit-scrollbar {
  width: 6px;
}

.table-body::-webkit-scrollbar-track {
  background: rgba(var(--green-rgb), 0.05);
}

.table-body::-webkit-scrollbar-thumb {
  background-color: var(--color-green);
  border-radius: 3px;
}

.table-row {
  display: grid;
  grid-template-columns: 1fr 1.5fr 2fr;
  padding: 10px 8px;
  border-top: 1px solid rgba(var(--green-rgb), 0.2);
  cursor: pointer;
  transition: background-color 0.2s;
  color: var(--color-light-green);
}

.table-row:first-child {
  border-top: none;
}

.table-row.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-left: 3px solid var(--color-green);
  padding-left: 5px;
}

.table-row:not(.selected):hover {
  background: rgba(var(--green-rgb), 0.08);
}

[class^='col-'] {
  padding: 0 8px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.4);
  padding-bottom: 1px;
}

.tab-button:first-child {
  border-radius: 8px 0 0 0;
}

.tab-button {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.4);
  color: var(--color-light-green);
  padding: 8px 16px;
  cursor: pointer;
  border-radius: 0;
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

.col-status {
  font-weight: 500;
}

.col-status.running {
  color: var(--color-green);
}

.col-status.failed {
  color: var(--color-red);
}

.col-status.completed {
  color: var(--color-blue);
}

.col-status.queued {
  color: var(--color-yellow);
}

.feedback-line {
  color: var(--color-grey);
  font-style: italic;
  margin-top: 0.5rem;
}

/* Add styles to make BaseScreen's default slot children fill height */
:deep(.base-screen .left-panel .terminal-output) {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
}

.workflows-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.workflows-main-content {
  flex: 1;
  height: 100%;
  overflow-y: scroll !important;
  scrollbar-width: thin !important;
  display: flex;
  justify-content: center;
}

.workflows-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.workflows-main-content::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3) !important;
}

.workflows-main-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.4) !important;
  border-radius: 4px;
}

.workflows-main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.6) !important;
}

.workflows-main-content > * {
  width: 100%;
  max-width: 1048px;
  margin-right: -10px;
}

/* Ensure header stays at the top */
.header-container {
  flex-shrink: 0;
  margin-bottom: 8px; /* Add space below header */
}

/* Updated search bar styles */
.search-bar {
  /* margin: 16px 0; */
  width: calc(100% - 2px); /* Match table width */
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

.col-status {
  padding: 0;
}

/* Hide the auto-generated count for the all-items option - use deep selector */
/* :deep(.all-items .cat-count) {
  display: none !important;
} */

.tools-icons {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-icon {
  width: 24px;
  height: 24px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.tool-icon:hover {
  transform: scale(1.1);
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

.hide-empty-button {
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
  /* opacity: 0.7; */
}

.hide-empty-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  opacity: 1;
}

.hide-empty-button.active {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
  color: var(--color-green);
  opacity: 1;
}

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

.collapse-all-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  opacity: 1;
}

.collapse-all-button.active {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
  color: var(--color-green);
  opacity: 1;
}

.collapse-all-button i {
  font-size: 0.9em;
}

.hide-empty-button i {
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
  /* IF USING HALF WITDTH CATEGORIES */
  /* flex: 1 1 calc(50% - 9px);
  min-width: calc(50% - 9px); */
  flex: 1 1 100%;
  min-width: 100%;
  box-sizing: border-box;
  transition: all 0.3s ease;
}

.category-card.full-width {
  flex: 1 1 100%;
  min-width: 100%;
}

/* .category-card:hover {
  border-color: var(--terminal-border-color);
} */

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
  /* border-radius: 6px;
  background: rgba(var(--green-rgb), 0.1);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05); */
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

.workflows-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: calc(100% - 5px);
}

.workflow-card {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 12px;
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.01);
  border-left: 3px solid var(--color-primary);
  width: calc(50% - 4px);
  box-sizing: border-box;
  cursor: pointer;
  transition: all 0.2s ease;
}

.table-row.listening .col-status {
  color: var(--color-blue);
}

.table-row.stopped .col-status {
  color: var(--color-text-muted);
}

/* IF USING FULL WIDTH LAST HANGING CHADS */
.workflow-card.last-odd {
  width: 100%;
}

.workflow-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.workflow-card.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
  /* box-shadow: 0 6px 20px rgba(var(--green-rgb), 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.06); */
}

.workflow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
  flex: 1;
}

.workflow-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* border-radius: 6px;
  background: rgba(var(--green-rgb), 0.1);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05); */
  font-size: 12px;
  flex-shrink: 0;
}

.workflow-name {
  font-weight: 600;
  flex: 1;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-md);
}

.workflow-status {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
  text-transform: uppercase;
  flex-shrink: 0;
}

.workflow-status.running {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.workflow-status.listening {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.workflow-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.workflow-status.stopped {
  background: rgba(156, 163, 175, 0.2);
  color: var(--color-text-muted);
}

.workflow-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.workflow-status.queued {
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
}

.workflow-avatar-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.workflow-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-green), rgba(var(--green-rgb), 0.7));
  border: 1px solid var(--terminal-border-color);
  display: none;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  margin-top: 3px;
}

.workflow-name {
  font-weight: 600;
  flex: 1;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-md);
  min-width: 0;
}

.workflow-description {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  flex: 1;
}

.workflow-description.no-tools {
  margin-bottom: 0;
}

.workflow-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: auto;
}

.tools-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.tool-icon-small {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 100%;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.tool-icon-small:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.4);
  transform: scale(1.1);
}

.tool-icon-small :deep(svg) {
  width: 10px;
  height: 10px;
  color: var(--color-green);
}

.tools-overflow {
  font-size: 10px;
  color: var(--color-text-muted);
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.1);
  border-radius: 3px;
  padding: 2px 4px;
  margin-left: 2px;
  flex-shrink: 0;
}

/* Responsive: single column on smaller screens */
@media (max-width: 640px) {
  .workflow-card {
    width: 100%;
  }

  .category-cards-grid {
    gap: 12px;
  }
}

/* Drag and Drop Styles */
.workflow-card.dragging {
  opacity: 0.5;
  transform: rotate(2deg);
  cursor: grabbing;
  z-index: 1000;
}

.category-card.drag-over {
  border-color: var(--color-green);
  background: linear-gradient(180deg, rgba(var(--green-rgb), 0.08), rgba(var(--green-rgb), 0.04));
  /* box-shadow: 0 12px 32px rgba(var(--green-rgb), 0.3), inset 0 0 0 2px rgba(var(--green-rgb), 0.4); */
  transform: scaleY(1.02);
}

.empty-category-drop-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
  border: 2px dashed var(--terminal-border-color);
  border-radius: 10px;
  /* background: rgba(var(--green-rgb), 0.05); */
  color: var(--color-text-muted);
  font-size: 13px;
  opacity: 0.7;
  margin-top: 8px;
  transition: all 0.2s ease;
}

.category-card.drag-over .empty-category-drop-zone {
  border-color: var(--terminal-border-color);
  background: transparent;
  opacity: 1;
}

.workflow-card[draggable='true'] {
  cursor: grab;
}

.workflow-card[draggable='true']:active {
  cursor: grabbing;
}

/* Drag ghost image styling */
.workflow-card:hover:not(.dragging) {
  cursor: grab;
}

/* ==================== MARKETPLACE STYLES ==================== */

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
  align-self: stretch;
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
  flex: 1;
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

.workflow-price {
  padding: 4px 10px 2px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
  flex-shrink: 0;
}

.workflow-price.free {
  background: rgba(34, 197, 94, 0.2) !important;
  color: var(--color-green) !important;
}

.workflow-publisher {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  opacity: 0.8;
}

.workflow-publisher i {
  font-size: 10px;
  opacity: 0.6;
}

.workflow-description.marketplace {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 10px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  /* -webkit-line-clamp: 2; */
  min-height: 34px;
}

.marketplace-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--terminal-border-color);
  border-bottom: 1px solid var(--terminal-border-color);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.stat-item i {
  font-size: 10px;
  color: var(--color-green);
}

.stat-item .fa-star {
  color: var(--color-yellow);
}

.stat-count {
  opacity: 0.6;
  font-size: 10px;
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
  /* margin-right: 6px; */
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
