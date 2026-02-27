<!-- Agents.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="AgentsPanel"
    :activeRightPanel="activeRightPanel"
    screenId="AgentsScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      allAvailableAgents: agents,
      activeTab: agentTab,
      selectedAgent,
    }"
    :panelProps="panelProps"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default="{ terminalLines }">
      <div class="agents-panel" :class="{ 'has-details': selectedAgent, expanded: isDetailsExpanded }">
        <!-- Sticky Header Container -->
        <div class="sticky-header">
          <!-- <TerminalHeader title="My Agents" subtitle="List, browse, and manage your agents." /> -->
          <BaseTabControls
            :tabs="agentTabs"
            :active-tab="agentTab"
            :current-layout="currentLayout"
            @set-layout="setLayout"
            @select-tab="onAgentTabSelect"
          />

          <!-- Search Bar for Card View -->
          <div class="card-view-search-bar">
            <input type="text" class="search-input" placeholder="Search agents..." :value="searchQuery" @input="handleSearch($event.target.value)" />
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

        <!-- Main Content -->
        <div class="agents-content">
          <!-- Loading skeleton -->
          <div v-if="agents.length === 0 && !criticalDataReady" class="agents-loading" style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
            <div class="skeleton-block" style="height: 40px; width: 100%; border-radius: 6px;"></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="skeleton-block" style="height: 160px; border-radius: 8px;"></div>
              <div class="skeleton-block" style="height: 160px; border-radius: 8px;"></div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="skeleton-block" style="height: 160px; border-radius: 8px;"></div>
              <div class="skeleton-block" style="height: 160px; border-radius: 8px;"></div>
            </div>
          </div>

          <main v-else class="agents-main-content fade-in">
            <!-- Table View -->
            <AgentList
              v-if="currentLayout === 'table'"
              :items="filteredAgentsGrid"
              :columns="tableColumns"
              :selected-id="selectedAgent?.id"
              :current-layout="currentLayout"
              :format-uptime="formatUptime"
              @row-click="selectAgentGrid"
              @search="handleSearch"
            />

            <!-- Category Cards View -->
            <div v-else-if="currentLayout === 'grid'" class="category-cards-container">
              <!-- Empty State - Only show for non-marketplace tabs when no agents exist -->
              <div v-if="agentTab !== 'marketplace' && filteredAgentsGrid.length === 0" class="empty-state-container">
                <div class="empty-state">
                  <i class="fas fa-robot"></i>
                  <p>No agents found</p>
                  <div class="empty-state-buttons">
                    <button class="create-button" @click="handlePanelAction('navigate', 'AgentForgeScreen')">
                      <i class="fas fa-plus"></i> Create Agent
                    </button>
                    <button class="marketplace-button" @click="onAgentTabSelect('marketplace')"><i class="fas fa-store"></i> View Marketplace</button>
                  </div>
                </div>
              </div>

              <div v-else class="category-cards-grid">
                <article
                  v-for="(agents, categoryName, index) in agentsByCategory"
                  :key="categoryName"
                  class="category-card"
                  :class="{
                    'drag-over': dragOverCategory === categoryName,
                    'full-width': agents.length >= 2,
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
                      <div class="category-count">{{ agents.length }} agents</div>
                      <button class="collapse-toggle" :class="{ collapsed: isCategoryCollapsed(categoryName) }">
                        <i class="fas fa-chevron-down"></i>
                      </button>
                    </div>
                  </div>
                  <div class="category-content" v-show="!isCategoryCollapsed(categoryName)">
                    <!-- Marketplace Agents Grid -->
                    <div v-if="agentTab === 'marketplace'" class="agents-grid">
                      <div
                        v-for="(item, index) in agents"
                        :key="item.id"
                        class="agent-card"
                        :class="{
                          selected: selectedAgent?.id === item.id,
                          active: (item.status || '').toLowerCase() === 'active',
                          'last-odd': agents.length % 2 === 1 && index === agents.length - 1,
                        }"
                        @click="selectAgent(item)"
                      >
                        <div class="marketplace-card-content">
                          <!-- Row 1: Avatar + Title/Publisher/Description -->
                          <div class="marketplace-header">
                            <div class="marketplace-avatar-container">
                              <div v-if="item.preview_image || item.avatar" class="marketplace-avatar">
                                <img :src="item.preview_image || item.avatar" :alt="item.title || item.name" />
                              </div>
                              <div v-else class="marketplace-avatar-placeholder">
                                <i class="fas fa-robot"></i>
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
                                {{ item.publisher_pseudonym || item.publisher_name || 'Anonymous' }}
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
                          <button class="install-button" @click.stop="handleInstallAgent(item)">
                            <i class="fas fa-download"></i>
                            {{ item.price > 0 ? 'Purchase' : 'Install' }}
                          </button>
                        </div>
                      </div>
                    </div>
                    <!-- Regular Agents Grid -->
                    <div v-else class="agents-grid">
                      <div
                        v-for="(agent, index) in agents"
                        :key="agent.id"
                        class="agent-card"
                        :class="{
                          selected: selectedAgent?.id === agent.id,
                          active: (agent.status || '').toLowerCase() === 'active',
                          dragging: draggedAgent && draggedAgent.id === agent.id && draggedAgent === agent,
                          'last-odd': agents.length % 2 === 1 && index === agents.length - 1,
                        }"
                        draggable="true"
                        @click="selectAgent(agent)"
                        @dragstart="handleDragStart($event, agent)"
                        @dragend="handleDragEnd"
                      >
                        <div class="agent-header">
                          <div class="agent-avatar-name">
                            <div class="agent-avatar">
                              <img
                                v-if="agent.avatar"
                                :src="agent.avatar"
                                :alt="agent.name"
                                class="avatar-image"
                                @error="$event.target.style.display = 'none'"
                              />
                              <div v-else class="avatar-placeholder">
                                {{ (agent.name || 'A').charAt(0).toUpperCase() }}
                              </div>
                            </div>
                            <span class="agent-name">{{ agent.name }}</span>
                          </div>
                          <span class="agent-status" :class="(agent.status || 'inactive').toLowerCase()">{{ agent.status || 'INACTIVE' }}</span>
                        </div>

                        <div class="agent-description" :class="{ 'no-tools': !hasToolsOrUptime(agent) }">
                          {{ agent.description || 'No description available' }}
                        </div>

                        <div v-if="hasToolsOrUptime(agent)" class="agent-tools">
                          <div v-if="getAgentToolsWithIcons(agent).length > 0" class="tools-icons">
                            <Tooltip
                              v-for="(tool, index) in getAgentToolsWithIcons(agent).slice(0, 4)"
                              :key="`tool-${index}`"
                              :text="tool.name"
                              width="auto"
                            >
                              <span class="tool-icon-small">
                                <SvgIcon :name="tool.icon" />
                              </span>
                            </Tooltip>
                            <span v-if="(agent.assignedTools?.length || 0) > 4" class="tools-overflow">
                              +{{ (agent.assignedTools?.length || 0) - 4 }}
                            </span>
                          </div>
                          <span v-if="agent.uptime && agent.uptime > 0" class="uptime">{{ formatUptime(agent.uptime) }}</span>
                        </div>
                      </div>
                    </div>
                    <div v-if="agents.length === 0" class="empty-category-drop-zone">Drop agent here to recategorize</div>
                  </div>
                </article>
              </div>
            </div>
          </main>
        </div>

        <!-- Agent Details Tabs Section - Only show for non-marketplace tabs -->
        <AgentDetails
          v-if="selectedAgent && agentTab !== 'marketplace'"
          :selected-agent="selectedAgent"
          :save-status="saveStatus"
          :is-details-expanded="isDetailsExpanded"
          :format-uptime="formatUptime"
          :available-tools="availableTools"
          :available-workflows="availableWorkflows"
          :category-options="categoryOptions"
          @toggle-details-expanded="toggleDetailsExpanded"
          @close-details="closeDetails"
          @toggle-agent="toggleAgent"
          @save-configuration="saveConfiguration"
          @delete-agent="handlePanelAction('delete-agent', $event)"
          @add-terminal-line="addTerminalLine"
          @fetch-goals="handleFetchGoals"
          @create-goal="createGoal"
          @pause-goal="pauseGoal"
          @resume-goal="resumeGoal"
          @delete-goal="deleteGoal"
        />

        <SimpleModal ref="simpleModal" />
      </div>
    </template>
  </BaseScreen>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="AgentsScreen" @close="onTutorialClose" />
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, inject, computed, watch } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import BaseTabControls from '../../../_components/BaseTabControls.vue';
import SidebarCategories from '../../../_components/SidebarCategories.vue';
import AgentList from './components/AgentList.vue';
import AgentDetails from './components/AgentDetails/AgentDetails.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useAgentsTutorial } from './useAgentsTutorial.js';

export default {
  name: 'AgentsScreen',
  components: {
    BaseScreen,
    TerminalHeader,
    BaseTabControls,
    SidebarCategories,
    AgentList,
    Tooltip,
    AgentDetails,
    SvgIcon,
    SimpleModal,
    PopupTutorial,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});

    // Initialize tutorial
    const { tutorialConfig, startTutorial, onTutorialClose, initializeAgentsTutorial } = useAgentsTutorial();
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const agents = ref([]);
    const criticalDataReady = computed(() => store.getters.criticalDataReady);
    const selectedAgent = ref(null);
    const searchQuery = ref('');
    const currentLayout = ref('grid');
    const selectedCategory = ref(null);
    const selectedMainCategory = ref(null);
    const isDetailsExpanded = ref(false);
    const saveStatus = ref(null);
    const hideEmptyCategories = ref(true);
    const collapsedCategories = ref(new Set());

    // Drag and drop state
    const draggedAgent = ref(null);
    const dragOverCategory = ref(null);

    // Watch agents array and clear drag state when it changes
    watch(agents, () => {
      draggedAgent.value = null;
      dragOverCategory.value = null;
    });

    // Define table columns
    const tableColumns = [
      { key: 'avatar', label: '', width: '60px' },
      { key: 'name', label: 'Name', width: '2fr' },
      { key: 'category', label: 'Category', width: '1fr' },
      { key: 'status', label: 'Status', width: '1fr' },
      { key: 'tools', label: 'Tools', width: '1fr' },
      { key: 'uptime', label: 'Uptime', width: '1fr' },
    ];

    const agentTabs = [
      { id: 'all', name: 'All Agents', icon: 'fas fa-users' },
      { id: 'active', name: 'Active Agents', icon: 'fas fa-play' },
      { id: 'inactive', name: 'Inactive Agents', icon: 'fas fa-stop' },
      { id: 'marketplace', name: 'Marketplace', icon: 'fas fa-store' },
    ];

    // Marketplace state
    const marketplaceAgents = computed(() => store.getters['marketplace/filteredMarketplaceAgents'] || []);
    const agentTab = ref('all');

    document.body.setAttribute('data-page', 'terminal-agents');

    async function onAgentTabSelect(tabId) {
      agentTab.value = tabId;

      // Clear selection when switching tabs to avoid showing stale details
      selectedAgent.value = null;

      // Fetch marketplace agents when marketplace tab is selected
      if (tabId === 'marketplace') {
        try {
          terminalLines.value.push('[Marketplace] Loading marketplace agents...');
          scrollToBottom();
          // Update filters to fetch agents only
          await store.dispatch('marketplace/updateFilters', { assetType: 'agent' });
          await store.dispatch('marketplace/fetchMarketplaceItems');
          const count = store.getters['marketplace/filteredMarketplaceAgents'].length;
          terminalLines.value.push(`[Marketplace] Found ${count} agents in marketplace`);
          scrollToBottom();
        } catch (error) {
          terminalLines.value.push(`[Marketplace] Error loading marketplace: ${error.message}`);
          scrollToBottom();
        }
      }
    }

    // Example agent categories (replace with real categories if available)
    const mainAgentCategories = [
      { code: 'Uncategorized', label: 'Uncategorized' },
      { code: '000', label: '000 - Foundations' },
      { code: '100', label: '100 - Business & Finance' },
      { code: '200', label: '200 - Content & Media' },
      { code: '300', label: '300 - Data & Analytics' },
      { code: '400', label: '400 - Development & DevOps' },
      { code: '500', label: '500 - Marketing & Sales' },
      { code: '600', label: '600 - Operations & Tools' },
    ];

    // Dummy categories for now (replace with real getter if available)
    const categories = computed(() => store.getters['agents/agentCategories']);

    // Filtered agents for grid/table view
    const filteredAgentsGrid = computed(() => {
      let items = agents.value;
      // Filter by tab
      if (agentTab.value === 'active') {
        items = items.filter((agent) => (agent.status || 'INACTIVE') === 'ACTIVE');
      } else if (agentTab.value === 'inactive') {
        items = items.filter((agent) => (agent.status || 'INACTIVE') === 'INACTIVE');
      } // 'all' shows all agents
      // Category filtering
      if (selectedMainCategory.value) {
        items = items.filter((item) => item.category && item.category.startsWith(selectedMainCategory.value));
      } else if (selectedCategory.value && selectedCategory.value !== 'All Agents') {
        items = items.filter((item) => item.category === selectedCategory.value);
      }
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        items = items.filter((item) =>
          [item.name, item.status || 'INACTIVE', item.category].some((val) => val && String(val).toLowerCase().includes(q))
        );
      }
      return items;
    });

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };
    const selectAgentGrid = (agent) => {
      selectAgent(agent);
    };
    const selectTab = (tabId) => {
      // If you want to support agent type tabs, add logic here
    };

    // --- BaseScreen Methods Access ---
    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();

    // --- Helper Methods ---
    const formatUptime = (uptime) => {
      if (!uptime) return '0m';
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    };

    const handleSearch = (query) => {
      searchQuery.value = query;
    };

    const selectAgent = (agent) => {
      // Play sound when selecting an agent
      if (playSound) {
        playSound('typewriterKeyPress');
      }

      // If clicking the same agent that's already selected, force a re-render
      // by briefly setting to null then back to the agent
      if (selectedAgent.value?.id === agent.id) {
        selectedAgent.value = null;
        nextTick(() => {
          selectedAgent.value = agent;
        });
      } else {
        selectedAgent.value = agent;
      }

      terminalLines.value = [`Selected agent: ${agent.name || agent.title}`];
      terminalLines.value.push(`Status: ${agent.status || 'INACTIVE'}`);
      terminalLines.value.push(`Tools: ${agent.assignedTools?.length || 0}`);
      scrollToBottom();
    };

    const refreshAgents = async (force = false) => {
      terminalLines.value = ['[Agents] Refreshing agent data...'];
      try {
        await store.dispatch('agents/fetchAgents', { force });
        agents.value = store.getters['agents/allAgents'];
        terminalLines.value.push('[Agents] Agent list updated.');
        // Clear drag state to prevent stale references
        draggedAgent.value = null;
        dragOverCategory.value = null;
      } catch (error) {
        terminalLines.value.push(`[Agents] Error refreshing agents: ${error.message}`);
        console.error('Error fetching agents:', error);
      }
      await nextTick();
      scrollToBottom();
    };

    // --- Panel Interaction ---
    const handlePanelAction = async (action, payload) => {
      console.log('Agents: Handling panel action:', action, payload);
      switch (action) {
        case 'clear-selection':
        case 'close-panel':
          selectedAgent.value = null;
          break;
        case 'refresh-agents':
          selectedAgent.value = null;
          await refreshAgents();
          break;
        case 'navigate':
          emit('screen-change', payload);
          break;
        case 'create-agent':
          try {
            const newAgentId = `agent-${Date.now()}`; // Generate a unique ID
            const agentData = {
              id: newAgentId,
              status: 'INACTIVE', // Set default status
              assignedTools: [],
              assignedWorkflows: [],
              ...payload,
            };
            await store.dispatch('agents/createAgent', agentData);
            // Clear selection before refreshing to prevent auto-selection
            selectedAgent.value = null;
            await refreshAgents(true);
            terminalLines.value.push(`[Agents] Successfully created agent ${payload.name}`);
          } catch (error) {
            terminalLines.value.push(`[Agents] Error creating agent: ${error.message}`);
            console.error('Error creating agent:', error);
          }
          await nextTick();
          scrollToBottom();
          break;
        case 'toggle-agent':
          if (payload && selectedAgent.value) {
            try {
              const action = (selectedAgent.value.status || 'INACTIVE') === 'ACTIVE' ? 'deactivateAgent' : 'activateAgent';
              await store.dispatch(`agents/${action}`, selectedAgent.value.id);
              await refreshAgents(true);
              // Update the selected agent after refresh
              const updatedAgent = store.getters['agents/getAgentById'](selectedAgent.value.id);
              if (updatedAgent) {
                selectedAgent.value = updatedAgent;
              }
              terminalLines.value.push(
                `[Agents] Successfully ${action === 'activateAgent' ? 'activated' : 'deactivated'} ${selectedAgent.value.name}`
              );
            } catch (error) {
              terminalLines.value.push(`[Agents] Error toggling agent: ${error.message}`);
              console.error('Error toggling agent:', error);
            }
          }
          await nextTick();
          scrollToBottom();
          break;
        case 'update-agent-details':
          terminalLines.value.push(`[Agents] Attempting to update details via panel...`);
          await nextTick();
          scrollToBottom();
          try {
            // Include avatar in the update
            await store.dispatch('agents/updateAgentDetails', {
              id: payload.id,
              name: payload.name,
              description: payload.description,
              avatar: payload.avatar, // Ensure avatar is included
            });
            await refreshAgents(); // Refresh list to show changes
            // Reselect agent to update panel display automatically via props
            const reselected = agents.value.find((a) => a.id === payload.id);
            if (reselected) {
              selectedAgent.value = reselected;
              terminalLines.value.push(`[Agents] Details updated successfully for ${reselected.name}.`);
            } else {
              selectedAgent.value = null; // Agent might have been deleted somehow
              terminalLines.value.push(`[Agents] Details updated, but agent ${payload.id} not found after refresh.`);
            }
          } catch (error) {
            terminalLines.value.push(`[Agents] Error updating agent from panel: ${error.message}`);
            console.error('Error updating agent details from panel:', error);
          }
          await nextTick();
          scrollToBottom();
          break;
        case 'show-feedback':
          if (payload?.type && payload?.message) {
            terminalLines.value.push(`[Panel Feedback - ${payload.type.toUpperCase()}]: ${payload.message}`);
            await nextTick();
            scrollToBottom();
          }
          break;
        case 'update-agent':
          try {
            terminalLines.value.push(`[Agents] Updating agent ${payload.name}...`);
            await store.dispatch('agents/updateAgent', payload);
            await refreshAgents(true);
            // Reselect agent to get fresh data
            const reselected = agents.value.find((a) => a.id === payload.id);
            if (reselected) {
              selectedAgent.value = reselected;
            }
            terminalLines.value.push(`[Agents] Agent updated successfully.`);
          } catch (error) {
            terminalLines.value.push(`[Agents] Error updating agent: ${error.message}`);
            console.error('Error updating agent:', error);
          }
          await nextTick();
          scrollToBottom();
          break;
        case 'delete-agent':
          try {
            const agentName = selectedAgent.value?.name || 'Agent';
            await store.dispatch('agents/deleteAgent', payload.id);

            await simpleModal.value?.showModal({
              title: 'Agent Deleted',
              message: `Agent '${agentName}' has been successfully deleted.`,
              confirmText: 'OK',
              showCancel: false,
            });

            if (selectedAgent.value && selectedAgent.value.id === payload.id) {
              selectedAgent.value = null;
            }
            await refreshAgents(true);
            terminalLines.value.push(`[Agents] Agent deleted successfully.`);
          } catch (error) {
            terminalLines.value.push(`[Agents] Error deleting agent: ${error.message}`);
            console.error('Error deleting agent:', error);
          }
          await nextTick();
          scrollToBottom();
          break;
        case 'category-filter-changed':
          // Handle category filter changes from the AgentsPanel
          selectedCategory.value = payload.selectedCategory;
          selectedMainCategory.value = payload.selectedMainCategory;
          selectedAgent.value = null; // Clear agent selection when category changes

          if (payload.type === 'all-selected') {
            terminalLines.value = ['[Agents] Viewing all agents (no category filter)'];
          } else if (payload.type === 'category-selected') {
            const categoryName = payload.payload.category;
            terminalLines.value = [`[Agents] Viewing ${categoryName}`];
          }
          scrollToBottom();
          break;
        case 'install-workflow':
          // Handle marketplace item installation from the right panel
          await handleInstallAgent(payload);
          break;
        default:
          console.warn('Unhandled panel action in Agents.vue:', action);
      }
    };

    // --- Initialization (Update) ---
    const initializeScreen = () => {
      selectedAgent.value = null;
      terminalLines.value = ['Welcome to the Agents Terminal!', '-----------------------------------', 'Initializing agent and goal data...'];

      // Check if we already have agents in the store (pre-fetched)
      const cachedAgents = store.getters['agents/allAgents'];
      if (cachedAgents && cachedAgents.length > 0) {
        agents.value = cachedAgents;
        terminalLines.value.push(`[Agents] Loaded ${cachedAgents.length} agents from cache.`);
      } else {
        terminalLines.value.push('[Agents] Loading agent and goal data...');
      }

      // Background refresh
      Promise.all([
        // Fetch agents, goals, and tools/workflows concurrently
        refreshAgents(),
        fetchToolsAndWorkflows(),
        fetchGoals(),
      ]).then(async () => {
        terminalLines.value.push('Data loaded.'); // Confirmation
        await nextTick();
        scrollToBottom();
      });

      // Show tutorial after a short delay
      setTimeout(() => {
        initializeAgentsTutorial();
      }, 2000);
    };

    const toggleAgent = async (agent) => {
      if (agent) {
        await handlePanelAction('toggle-agent', agent);
      }
    };

    // --- Computed Property for Active Right Panel ---
    const activeRightPanel = computed(() => {
      // When on marketplace tab, use MarketplacePanel to show marketplace item details
      if (agentTab.value === 'marketplace') {
        return 'MarketplacePanel';
      }
      // Otherwise use AgentsPanel for regular agent details
      return 'AgentsPanel';
    });

    // --- Computed Property for Panel Props ---
    const panelProps = computed(() => {
      // When on marketplace tab, pass selectedWorkflow for MarketplacePanel
      if (agentTab.value === 'marketplace') {
        return {
          selectedWorkflow: selectedAgent.value, // MarketplacePanel expects selectedWorkflow prop
          activeTab: 'marketplace',
        };
      }
      // For regular agent tabs, pass selectedAgent for AgentsPanel
      if (!selectedAgent.value) {
        return { selectedAgent: null };
      }
      return {
        selectedAgent: selectedAgent.value,
      };
    });

    const saveConfiguration = async (configPayload) => {
      if (!selectedAgent.value) return;

      terminalLines.value.push(`[Agents] Saving configuration for ${selectedAgent.value.name}...`);
      try {
        await store.dispatch('agents/updateAgent', {
          id: selectedAgent.value.id,
          name: configPayload.name,
          description: configPayload.description,
          category: configPayload.category,
          avatar: configPayload.avatar,
          provider: configPayload.provider,
          model: configPayload.model,
          assignedTools: configPayload.assignedTools || [],
          assignedWorkflows: configPayload.assignedWorkflows || [],
          config: {
            tickSpeed: configPayload.tickSpeed,
            tokenBudget: configPayload.tokenBudget,
            memoryLimit: configPayload.memoryLimit,
            autoRestart: configPayload.autoRestart,
            maxRetries: configPayload.maxRetries,
          },
        });

        terminalLines.value.push(`[Agents] Configuration saved successfully.`);
        await refreshAgents(true);
        // Reselect agent to get fresh data
        const reselected = agents.value.find((a) => a.id === selectedAgent.value.id);
        if (reselected) {
          selectedAgent.value = reselected;
        } else {
          selectedAgent.value = null;
        }
      } catch (error) {
        terminalLines.value.push(`[Agents] Error saving configuration: ${error.message}`);
        console.error('Error saving agent configuration:', error);
      }
      await nextTick();
      scrollToBottom();
    };

    // Category options for select
    const categoryOptions = computed(() =>
      (store.getters['agents/agentCategories'] || []).map((cat) => ({
        value: cat,
        label: cat,
      }))
    );

    const availableTools = ref([]);
    const availableWorkflows = ref([]);

    // Fetch tools and workflows (like AgentForge)
    const fetchToolsAndWorkflows = async (force = false) => {
      try {
        await Promise.all([store.dispatch('tools/fetchTools', { force }), store.dispatch('workflows/fetchWorkflows', { force })]);
        availableTools.value = store.getters['tools/allTools'] || [];
        availableWorkflows.value = store.getters['workflows/allWorkflows'] || [];
      } catch (e) {
        terminalLines.value.push(`[Agents] Error loading tools/workflows: ${e.message}`);
      }
    };

    // Event handlers for SidebarCategories component
    const onAllSelected = () => {
      selectedMainCategory.value = null;
      selectedCategory.value = null;
      selectedAgent.value = null;
      terminalLines.value = ['[Agents] Viewing all agents (no category filter)'];
      scrollToBottom();
    };

    const onCategorySelected = (payload) => {
      if (payload.isMainCategory) {
        selectedMainCategory.value = payload.mainCategory;
        selectedCategory.value = payload.category;
        selectedAgent.value = null;
        terminalLines.value = [`[Agents] Viewing ${payload.category} (All subcategories)`];
      } else {
        selectedMainCategory.value = null;
        selectedCategory.value = payload.category;
        selectedAgent.value = null;
        terminalLines.value = [`[Agents] Viewing ${payload.category}`];
      }
      scrollToBottom();
    };

    const toggleDetailsExpanded = () => {
      isDetailsExpanded.value = !isDetailsExpanded.value;
    };

    const closeDetails = () => {
      console.log('[Agents.vue] closeDetails called!');
      console.log('[Agents.vue] selectedAgent before:', selectedAgent.value);
      selectedAgent.value = null;
      isDetailsExpanded.value = false;
      console.log('[Agents.vue] selectedAgent after:', selectedAgent.value);
      terminalLines.value.push('[Agents] Agent details closed');
      scrollToBottom();
    };

    const addTerminalLine = (line) => {
      terminalLines.value.push(line);
      nextTick(scrollToBottom);
    };

    const handleFetchGoals = async (callback) => {
      await fetchGoals();
      if (typeof callback === 'function') {
        callback(goals.value);
      }
    };

    // Goals functionality
    const goalInput = ref('');
    const isCreatingGoal = ref(false);
    const goals = ref([]);
    const taskFilter = ref('all');
    const goalStatusSubscriptions = new Map(); // Track WebSocket subscriptions

    // Computed properties for goals
    const activeGoals = computed(() => {
      return goals.value.filter((goal) => ['planning', 'executing', 'paused'].includes(goal.status));
    });

    const recentGoals = computed(() => {
      return goals.value.filter((goal) => ['completed', 'failed', 'stopped'].includes(goal.status)).slice(0, 12); // Show last 12
    });

    const goalsWithTasks = computed(() => {
      const result = goals.value.filter((goal) => goal.tasks && goal.tasks.length > 0);
      console.log(`[Tasks Tab] Goals with tasks:`, result.length);
      result.forEach((goal) => {
        console.log(
          `[Tasks Tab] Goal "${goal.title}" has ${goal.tasks.length} tasks:`,
          goal.tasks.map((t) => `${t.title} (${t.status})`)
        );
      });
      return result;
    });

    // Goals methods
    const createGoal = async (goalText) => {
      if (!goalText || !goalText.trim()) return;

      isCreatingGoal.value = true;
      terminalLines.value.push(`[Goals] Creating goal: ${goalText.substring(0, 50)}...`);

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        console.log(`[Goals] Sending create request for goal: ${goalText}`);
        const response = await fetch(`${API_CONFIG.BASE_URL}/goals/create`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: goalText,
            priority: 'medium',
          }),
        });

        if (!response.ok) throw new Error('Failed to create goal');

        const data = await response.json();
        console.log(`[Goals] Goal creation response:`, data);

        // Add goal to local state
        const newGoal = {
          id: data.goal.goalId,
          title: data.goal.title,
          description: data.goal.description,
          status: 'planning',
          priority: 'medium',
          created_at: new Date().toISOString(),
          tasks: data.goal.tasks || [],
          task_count: data.goal.tasks?.length || 0,
          completed_tasks: 0,
        };

        console.log(`[Goals] Adding goal to local state:`, newGoal);
        goals.value.unshift(newGoal);

        terminalLines.value.push(`[Goals] Goal created: ${data.goal.title}`);
        terminalLines.value.push(`[Goals] Generated ${data.goal.tasks?.length || 0} tasks`);

        // Automatically execute the goal
        console.log(`[Goals] Auto-executing goal: ${data.goal.goalId}`);
        await executeGoal(data.goal.goalId);
      } catch (error) {
        console.error('Error creating goal:', error);
        terminalLines.value.push(`[Goals] Error creating goal: ${error.message}`);
      } finally {
        isCreatingGoal.value = false;
        scrollToBottom();
      }
    };

    const executeGoal = async (goalId) => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        console.log(`[Goals] Starting execution for goal ${goalId}...`);
        terminalLines.value.push(`[Goals] Starting execution for goal ${goalId}...`);

        const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/execute`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) throw new Error('Failed to execute goal');

        const data = await response.json();
        console.log(`[Goals] Goal execution response:`, data);

        // Update goal status
        const goal = goals.value.find((g) => g.id === goalId);
        if (goal) {
          console.log(`[Goals] Updating goal ${goalId} status from ${goal.status} to executing`);
          goal.status = 'executing';
        } else {
          console.warn(`[Goals] Goal ${goalId} not found in local state for status update`);
        }

        terminalLines.value.push(`[Goals] Goal execution started`);

        // Start monitoring progress
        console.log(`[Goals] Starting progress monitoring for goal ${goalId}`);
        monitorGoalProgress(goalId);
      } catch (error) {
        console.error('Error executing goal:', error);
        terminalLines.value.push(`[Goals] Error executing goal: ${error.message}`);
      }

      scrollToBottom();
    };

    const monitorGoalProgress = (goalId) => {
      console.log(`[Goals] Starting to monitor goal progress for ${goalId}`);

      // Poll for goal status updates more frequently
      const pollInterval = setInterval(async () => {
        try {
          const token = localStorage.getItem('token');
          if (!token) {
            console.log(`[Goals] No token found, stopping monitoring for ${goalId}`);
            clearInterval(pollInterval);
            return;
          }

          console.log(`[Goals] Polling status for goal ${goalId}...`);
          const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/status`, {
            credentials: 'include',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!response.ok) {
            console.error(`[Goals] Status request failed for ${goalId}:`, response.status);
            clearInterval(pollInterval);
            return;
          }

          const status = await response.json();
          console.log(`[Goals] Received status for ${goalId}:`, status);

          // Update goal in local state
          const goal = goals.value.find((g) => g.id === goalId);
          if (goal) {
            console.log(`[Goals] Updating goal ${goalId} - Current status: ${goal.status} -> New status: ${status.status}`);
            console.log(`[Goals] Progress: ${goal.progress || 0}% -> ${status.progress}%`);

            goal.status = status.status;
            goal.progress = status.progress;
            goal.currentTasks = status.currentTasks;

            // Update tasks if available
            if (status.tasks) {
              goal.completed_tasks = status.tasks.completed;
              goal.task_count = status.tasks.total;
              console.log(`[Goals] Task progress: ${status.tasks.completed}/${status.tasks.total} completed`);
            }

            // Update individual task details for Tasks tab
            if (status.allTasks) {
              goal.tasks = status.allTasks;
              console.log(`[Goals] Updated ${status.allTasks.length} individual task details`);

              // Log task status changes for debugging
              status.allTasks.forEach((task) => {
                const prevTask = goal.tasks?.find((t) => t.id === task.id);
                if (prevTask && prevTask.status !== task.status) {
                  console.log(`[Tasks] Task "${task.title}" status: ${prevTask.status} -> ${task.status} (${task.progress}%)`);
                  terminalLines.value.push(`[Tasks] ${task.title}: ${task.status} (${task.progress}%)`);
                }
              });
            }

            // Log current tasks
            if (status.currentTasks && status.currentTasks.length > 0) {
              console.log(`[Goals] Current tasks:`, status.currentTasks);
              terminalLines.value.push(`[Goals] Currently executing: ${status.currentTasks.map((t) => t.title).join(', ')}`);
            }
          } else {
            console.warn(`[Goals] Goal ${goalId} not found in local state`);
          }

          // Stop monitoring if goal is complete
          if (['completed', 'failed', 'stopped'].includes(status.status)) {
            console.log(`[Goals] Goal ${goalId} finished with status: ${status.status}`);
            clearInterval(pollInterval);
            goalStatusSubscriptions.delete(goalId);

            if (status.status === 'completed') {
              terminalLines.value.push(`[Goals] Goal ${goalId} completed successfully!`);
            } else {
              terminalLines.value.push(`[Goals] Goal ${goalId} ${status.status}`);
            }
            scrollToBottom();
          }
        } catch (error) {
          console.error(`[Goals] Error monitoring goal ${goalId} progress:`, error);
          clearInterval(pollInterval);
          goalStatusSubscriptions.delete(goalId);
        }
      }, 2000); // Poll every 2 seconds for faster updates

      // Store interval reference for cleanup
      goalStatusSubscriptions.set(goalId, pollInterval);
    };

    const pauseGoal = async (goal) => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goal.id}/pause`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) throw new Error('Failed to pause goal');

        goal.status = 'paused';
        terminalLines.value.push(`[Goals] Goal paused: ${goal.title}`);

        // Stop monitoring
        const interval = goalStatusSubscriptions.get(goal.id);
        if (interval) {
          clearInterval(interval);
          goalStatusSubscriptions.delete(goal.id);
        }
      } catch (error) {
        console.error('Error pausing goal:', error);
        terminalLines.value.push(`[Goals] Error pausing goal: ${error.message}`);
      }

      scrollToBottom();
    };

    const resumeGoal = async (goal) => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goal.id}/resume`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) throw new Error('Failed to resume goal');

        goal.status = 'executing';
        terminalLines.value.push(`[Goals] Goal resumed: ${goal.title}`);

        // Restart monitoring
        monitorGoalProgress(goal.id);
      } catch (error) {
        console.error('Error resuming goal:', error);
        terminalLines.value.push(`[Goals] Error resuming goal: ${error.message}`);
      }

      scrollToBottom();
    };

    const simpleModal = ref(null);

    const deleteGoal = async (goal) => {
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Goal?',
        message: `Are you sure you want to delete the goal "${goal.title}"? This will also delete all associated tasks.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goal.id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) throw new Error('Failed to delete goal');

        // Remove from local state
        const index = goals.value.findIndex((g) => g.id === goal.id);
        if (index !== -1) {
          goals.value.splice(index, 1);
        }

        // Stop monitoring
        const interval = goalStatusSubscriptions.get(goal.id);
        if (interval) {
          clearInterval(interval);
          goalStatusSubscriptions.delete(goal.id);
        }

        terminalLines.value.push(`[Goals] Goal deleted: ${goal.title}`);
      } catch (error) {
        console.error('Error deleting goal:', error);
        terminalLines.value.push(`[Goals] Error deleting goal: ${error.message}`);
      }

      scrollToBottom();
    };

    const viewGoalDetails = (goal) => {
      // Switch to tasks tab and filter by this goal
      terminalLines.value.push(`[Goals] Viewing details for: ${goal.title}`);
      scrollToBottom();
    };

    const refreshGoalTasks = async () => {
      terminalLines.value.push(`[Goals] Refreshing goals and tasks...`);
      await fetchGoals();
      terminalLines.value.push(`[Goals] Goals refreshed.`);
      scrollToBottom();
    };

    const fetchGoals = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/goals`, {
          headers: {
            Authorization: `Bearer ${store.getters['auth/token']}`,
          },
        });

        if (!response.ok) throw new Error('Failed to fetch goals');

        const data = await response.json();
        goals.value = data.goals || [];

        // Fetch detailed task data for each goal
        for (const goal of goals.value) {
          if (['executing', 'paused'].includes(goal.status)) {
            await fetchGoalTasks(goal.id);
            monitorGoalProgress(goal.id);
          }
        }
      } catch (error) {
        console.error('Error fetching goals:', error);
        terminalLines.value.push(`[Goals] Error fetching goals: ${error.message}`);
        scrollToBottom();
      }
    };

    const fetchGoalTasks = async (goalId) => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}`, {
          headers: {
            Authorization: `Bearer ${store.getters['auth/token']}`,
          },
        });

        if (!response.ok) return;

        const data = await response.json();
        const goal = goals.value.find((g) => g.id === goalId);
        if (goal && data.goal.tasks) {
          goal.tasks = data.goal.tasks;
        }
      } catch (error) {
        console.error('Error fetching goal tasks:', error);
      }
    };

    const formatTaskTime = (timestamp) => {
      if (!timestamp) return 'N/A';
      return new Date(timestamp).toLocaleString();
    };

    // Category cards functionality
    const agentsByCategory = computed(() => {
      // If marketplace tab is selected, show marketplace agents
      if (agentTab.value === 'marketplace') {
        const marketplaceItems = marketplaceAgents.value;
        return { 'Marketplace Agents': marketplaceItems };
      }

      // Use filteredAgentsGrid to respect tab and category filtering from left panel
      let agents = filteredAgentsGrid.value;

      // Apply search filtering for card view
      if (searchQuery.value && searchQuery.value.trim() !== '') {
        const query = searchQuery.value.toLowerCase().trim();
        agents = agents.filter((agent) => {
          const searchableFields = [agent.name || '', agent.description || '', agent.status || '', agent.category || ''];
          return searchableFields.some((field) => field.toLowerCase().includes(query));
        });
      }

      const categories = {};

      // When a specific category is selected, only show that category and its children
      if (selectedCategory.value && selectedCategory.value !== 'All Agents') {
        // Initialize only the selected category
        categories[selectedCategory.value] = [];

        // If it's a main category, also include its children
        if (selectedMainCategory.value && selectedMainCategory.value !== 'Uncategorized') {
          const allCategories = store.getters['agents/agentCategories'] || [];
          allCategories.forEach((category) => {
            if (category.startsWith(selectedMainCategory.value) && category !== selectedMainCategory.value) {
              categories[category] = [];
            }
          });
        }

        // Assign agents to their categories (only the selected ones)
        agents.forEach((agent) => {
          const category = agent.category || 'Uncategorized';
          // For the selected category, always add agents regardless of whether the category exists in the predefined list
          if (category === selectedCategory.value) {
            categories[selectedCategory.value].push(agent);
          } else if (categories.hasOwnProperty(category)) {
            categories[category].push(agent);
          }
        });
      } else {
        // When "All Agents" is selected, show all categories
        const allCategories = store.getters['agents/agentCategories'] || [];

        // Initialize all predefined categories with empty arrays
        allCategories.forEach((category) => {
          categories[category] = [];
        });

        // Always include 'Uncategorized' category
        if (!categories['Uncategorized']) {
          categories['Uncategorized'] = [];
        }

        // First pass: collect all unique categories from agents to ensure we don't miss any
        agents.forEach((agent) => {
          const category = agent.category || 'Uncategorized';
          if (!categories[category]) {
            categories[category] = [];
          }
        });

        // Second pass: assign agents to their categories
        agents.forEach((agent) => {
          const category = agent.category || 'Uncategorized';
          categories[category].push(agent);
        });
      }

      // Sort categories alphabetically (A-Z) and return as sorted object
      const sortedCategories = {};
      Object.keys(categories)
        .sort((a, b) => a.localeCompare(b))
        .forEach((key) => {
          // When searching, only show categories that have agents
          if (searchQuery.value && searchQuery.value.trim() !== '') {
            if (categories[key].length > 0) {
              sortedCategories[key] = categories[key];
            }
          } else if (hideEmptyCategories.value) {
            // When hiding empty categories, only show categories with agents
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
        'Data Science': '📊',
        Operations: '⚙️',
        Development: '💻',
        Uncategorized: '📋',
        '000 - Foundations': '🏗️',
        '100 - Business & Finance': '📊',
        '200 - Content & Media': '💻',
        '300 - Data & Analytics': '🎨',
        '400 - Development & DevOps': '💼',
        '500 - Marketing & Sales': '🤝',
        '600 - Operations & Tools': '📈',
      };

      return {
        name: categoryName,
        icon: categoryIcons[categoryName] || '🔧',
        count: agentsByCategory.value[categoryName]?.length || 0,
      };
    };

    const toggleHideEmptyCategories = () => {
      hideEmptyCategories.value = !hideEmptyCategories.value;
      terminalLines.value.push(`[Agents] ${hideEmptyCategories.value ? 'Hiding' : 'Showing'} empty categories`);
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
      const categoryNames = Object.keys(agentsByCategory.value);
      return categoryNames.length > 0 && categoryNames.every((name) => collapsedCategories.value.has(name));
    });

    const toggleCollapseAll = () => {
      const categoryNames = Object.keys(agentsByCategory.value);

      if (allCategoriesCollapsed.value) {
        // Expand all categories
        categoryNames.forEach((name) => {
          collapsedCategories.value.delete(name);
        });
        terminalLines.value.push('[Agents] Expanded all categories');
      } else {
        // Collapse all categories
        categoryNames.forEach((name) => {
          collapsedCategories.value.add(name);
        });
        terminalLines.value.push('[Agents] Collapsed all categories');
      }
      scrollToBottom();
    };

    // --- Drag and Drop Methods ---
    const handleDragStart = (event, agent) => {
      draggedAgent.value = agent;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', agent.id);

      // Add visual feedback
      event.target.style.opacity = '0.5';
      terminalLines.value.push(`[Drag] Started dragging agent: ${agent.name}`);
      scrollToBottom();
    };

    const handleDragEnd = (event) => {
      // Reset visual feedback
      event.target.style.opacity = '1';
      draggedAgent.value = null;
      dragOverCategory.value = null;
    };

    const handleDragOver = (categoryName) => {
      if (draggedAgent.value && draggedAgent.value.category !== categoryName) {
        dragOverCategory.value = categoryName;
      }
    };

    const handleDragLeave = () => {
      dragOverCategory.value = null;
    };

    const handleDrop = async (event, targetCategory) => {
      event.preventDefault();
      dragOverCategory.value = null;

      if (!draggedAgent.value) return;

      const agent = draggedAgent.value;
      const originalCategory = agent.category || 'Uncategorized';

      // Don't do anything if dropping on the same category
      if (originalCategory === targetCategory) {
        terminalLines.value.push(`[Drag] Agent is already in ${targetCategory}`);
        scrollToBottom();
        return;
      }

      try {
        terminalLines.value.push(`[Drag] Moving agent "${agent.name}" from ${originalCategory} to ${targetCategory}...`);
        scrollToBottom();

        // Optimistic update: immediately update the agent in the store for instant UI feedback
        const updatedAgent = {
          ...agent,
          category: targetCategory === 'Uncategorized' ? '' : targetCategory,
        };

        // Update the agent in the store immediately (optimistic update)
        store.commit('agents/UPDATE_AGENT', updatedAgent);

        // Then send the update to the server in the background
        try {
          await store.dispatch('agents/updateAgent', updatedAgent);
          terminalLines.value.push(`[Drag] Successfully moved agent to ${targetCategory}`);
          scrollToBottom();
        } catch (error) {
          // If server update fails, revert the optimistic update
          store.commit('agents/UPDATE_AGENT', agent);
          terminalLines.value.push(`[Drag] Error moving agent: ${error.message}`);
          terminalLines.value.push(`[Drag] Reverted agent back to ${originalCategory}`);
          scrollToBottom();
        }
      } catch (error) {
        terminalLines.value.push(`[Drag] Error moving agent: ${error.message}`);
        scrollToBottom();
      } finally {
        draggedAgent.value = null;
      }
    };

    // Helper method to check if agent has tools or uptime to show
    const hasToolsOrUptime = (agent) => {
      const hasTools = agent.assignedTools?.length > 0;
      const hasUptime = agent.uptime && agent.uptime > 0;
      return hasTools || hasUptime;
    };

    // Map tool IDs to appropriate icons based on tool type/category
    const getToolIcon = (toolId, tool) => {
      // If tool has an explicit icon, use it
      if (tool?.icon) return tool.icon;

      // Map common tool IDs to appropriate icons (using actual SVG file names)
      const toolIconMap = {
        // Web & Search tools
        web_search: 'web',
        web_scrape: 'web',
        web_scraper: 'web',

        // Code execution tools
        execute_javascript_code: 'javascript',
        execute_shell_command: 'code',
        javascript_execution: 'javascript',
        shell_command: 'code',

        // File operations
        file_operations: 'folder',
        file_system: 'folder',
        read_file: 'file',
        write_file: 'file',

        // AGNT tools
        agnt_agents: 'agent',
        agnt_workflows: 'flow-2',
        agnt_tools: 'settings',
        agnt_goals: 'check',
        agnt_auth: 'account',

        // Communication
        send_email: 'gmail',
        email: 'gmail',

        // Custom tools
        execute_custom_agnt_tool: 'custom',
        custom_tool: 'custom',

        // Python tools
        python: 'python',
        execute_python: 'python',

        // API tools
        api: 'api',
        api_call: 'api',

        // Database tools
        database: 'database',
        db: 'database',

        // Text processing
        text: 'text',
        document: 'document',

        // Image processing
        image: 'image',

        // Timer/scheduling
        timer: 'timer',
        schedule: 'clock',
      };

      // Check direct ID match first
      if (toolIconMap[toolId]) {
        return toolIconMap[toolId];
      }

      // Check for partial matches or categories (using actual SVG file names)
      if (toolId.includes('web') || toolId.includes('search')) return 'web';
      if (toolId.includes('javascript')) return 'javascript';
      if (toolId.includes('python')) return 'python';
      if (toolId.includes('code') || toolId.includes('shell') || toolId.includes('command') || toolId.includes('terminal')) return 'code';
      if (toolId.includes('file') || toolId.includes('folder')) return 'folder';
      if (toolId.includes('email') || toolId.includes('mail')) return 'gmail';
      if (toolId.includes('agnt')) return 'agent';
      if (toolId.includes('api')) return 'api';
      if (toolId.includes('database') || toolId.includes('db')) return 'database';
      if (toolId.includes('text') || toolId.includes('document')) return 'text';
      if (toolId.includes('image')) return 'image';
      if (toolId.includes('timer') || toolId.includes('schedule')) return 'timer';

      // Default fallback
      return 'custom';
    };

    // Handle marketplace agent installation using shared composable
    const { handleInstall: marketplaceInstall } = useMarketplaceInstall(simpleModal, (msg) => {
      terminalLines.value.push(msg);
      scrollToBottom();
    });

    const handleInstallAgent = async (item) => {
      playSound('typewriterKeyPress');
      const result = await marketplaceInstall(item);
      if (result.success) {
        // Refresh agents list
        await refreshAgents(true);
      }
    };

    // Get agent tools with icons for display
    const getAgentToolsWithIcons = (agent) => {
      const tools = [];
      const seenTools = new Set();

      if (agent.assignedTools?.length) {
        agent.assignedTools.forEach((toolId) => {
          // Try to find the tool in availableTools to get its details
          const tool = availableTools.value.find((t) => t.id === toolId || t.type === toolId);

          const icon = getToolIcon(toolId, tool);
          const name = tool?.title || tool?.name || toolId || 'Unknown Tool';
          const key = `${icon}-${name}`;

          if (!seenTools.has(key)) {
            seenTools.add(key);
            tools.push({ icon, name });
          }
        });
      }

      return tools; // Return empty array if no tools
    };

    // --- Lifecycle Hooks ---
    onMounted(() => {
      console.log('Agents Screen Mounted');
    });

    onUnmounted(() => {
      console.log('Agents Screen Unmounted');
      selectedAgent.value = null;

      // Clean up goal monitoring intervals
      goalStatusSubscriptions.forEach((interval) => {
        clearInterval(interval);
      });
      goalStatusSubscriptions.clear();
    });

    return {
      simpleModal,
      baseScreenRef,
      terminalLines,
      agents,
      criticalDataReady,
      selectedAgent,
      handlePanelAction,
      selectAgent,
      formatUptime,
      emit,
      initializeScreen,
      searchQuery,
      toggleAgent,
      panelProps,
      activeRightPanel,
      saveStatus,
      saveConfiguration,
      tableColumns,
      handleSearch,
      currentLayout,
      selectedCategory,
      selectedMainCategory,
      categories,
      setLayout,
      selectAgentGrid,
      selectTab,
      filteredAgentsGrid,
      categoryOptions,
      agentTabs,
      agentTab,
      onAgentTabSelect,
      availableTools,
      availableWorkflows,
      onAllSelected,
      onCategorySelected,
      mainAgentCategories,
      goalInput,
      isCreatingGoal,
      goals,
      taskFilter,
      goalStatusSubscriptions,
      createGoal,
      executeGoal,
      monitorGoalProgress,
      pauseGoal,
      resumeGoal,
      deleteGoal,
      viewGoalDetails,
      refreshGoalTasks,
      fetchGoals,
      fetchGoalTasks,
      isDetailsExpanded,
      toggleDetailsExpanded,
      closeDetails,
      addTerminalLine,
      handleFetchGoals,
      formatTaskTime,
      // Category cards functionality
      agentsByCategory,
      getCategoryInfo,
      hideEmptyCategories,
      toggleHideEmptyCategories,
      toggleCategoryCollapse,
      isCategoryCollapsed,
      allCategoriesCollapsed,
      toggleCollapseAll,
      getAgentToolsWithIcons,
      hasToolsOrUptime,
      getToolIcon,
      // Drag and drop
      draggedAgent,
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
      handleInstallAgent,
    };
  },
};
</script>

<style scoped>
/* Override BaseCardGrid's CSS Grid with Flexbox for better height control */
:deep(.card-container) {
  display: flex !important;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
  justify-content: flex-start;
  align-items: stretch;
  min-height: 0;
}

/* Ensure cards have equal widths in flexbox layout */
:deep(.card-item) {
  flex: 1 1 calc(33.333% - 8px); /* 3 columns with gap consideration */
  min-width: 250px;
  max-width: 350px;
}

/* Responsive adjustments for flexbox */
@media (max-width: 768px) {
  :deep(.card-item) {
    flex: 1 1 calc(50% - 6px); /* 2 columns on smaller screens */
    min-width: 220px;
  }
}

@media (max-width: 480px) {
  :deep(.card-item) {
    flex: 1 1 100%; /* 1 column on mobile */
    min-width: unset;
  }
}

@media (min-width: 1200px) {
  :deep(.card-item) {
    flex: 1 1 calc(25% - 9px); /* 4 columns on larger screens */
    min-width: 280px;
  }
}

:deep(.card-item) {
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--color-text);
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  position: relative;
  min-height: fit-content !important;
  overflow: hidden;
}
.terminal-line {
  line-height: 1.3;
  margin: 4px 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-grey);
}

.agents-panel {
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

.agents-panel.has-details .agents-content {
  flex: 0 1 auto;
  max-height: calc(100% - 60vh - 56px);
}

.agents-panel.has-details.expanded .agents-content {
  display: none;
}

.agents-panel.has-details.expanded .sticky-header {
  display: none;
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

.agents-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.agents-main-content {
  flex: 1;
  height: 100%;
  overflow-y: scroll !important;
  scrollbar-width: thin !important;
  display: flex;
  justify-content: center;
}

.agents-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.agents-main-content::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3) !important;
}

.agents-main-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.4) !important;
  border-radius: 4px;
}

.agents-main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.6) !important;
}

.agents-main-content > * {
  width: 100%;
  max-width: 1048px;
  margin-right: -10px;
}

/* Ensure BaseScreen's default slot children fill height */
:deep(.base-screen .left-panel .terminal-output) {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.agent-category {
  color: var(--color-grey);
  font-size: 0.92em;
  font-style: italic;
  margin-top: 2px;
}

.config-row.assign-tools-workflows-row {
  display: flex;
  flex-direction: row;
  gap: 16px;
  width: 100%;
}
.config-group.half-width {
  flex: 1 1 0;
  min-width: 0;
}

:deep(.card-content) {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
  padding-right: 4px;
  justify-content: flex-start;
  align-items: center;
  align-content: space-between;
}

.expand-button {
  background: none;
  border: none;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  padding: 8px 16px;
  border-radius: 4px;
}

.expand-button:hover {
  background: rgba(var(--green-rgb), 0.1);
}

.expand-button i {
  font-size: 0.9em;
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

.agents-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: calc(100% - 5px);
}

.agent-card {
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

.agent-card.last-odd {
  width: 100%;
}

.agent-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.agent-card.active {
  border-left: 3px solid var(--color-green);
}

.agent-card:not(.active) {
  color: var(--color-text-muted);
  border-left: 3px solid var(--color-text-muted);
}

.agent-card.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
}

.agent-avatar-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.agent-avatar {
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

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.avatar-placeholder {
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

.agent-name {
  font-weight: 600;
  flex: 1;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-md);
  min-width: 0;
}

.agent-status {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
  text-transform: uppercase;
  flex-shrink: 0;
}

.agent-status.active {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.agent-status.inactive {
  background: rgba(156, 163, 175, 0.2);
  color: var(--color-text-muted);
}

.agent-description {
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

.agent-description.no-tools {
  margin-bottom: 0;
}

.agent-tools {
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

.tools-count {
  color: var(--color-green);
  font-weight: 600;
}

.uptime {
  color: var(--color-text-muted);
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
.agent-card.dragging {
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

.agent-card[draggable='true'] {
  cursor: grab;
}

.agent-card[draggable='true']:active {
  cursor: grabbing;
}

/* Drag ghost image styling */
.agent-card:hover:not(.dragging) {
  cursor: grab;
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

/* Responsive: single column on smaller screens */
@media (max-width: 640px) {
  .agent-card {
    width: 100%;
  }

  .category-cards-grid {
    gap: 12px;
  }
}

/* Agent Details Backdrop */
/* .agent-details-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: transparent;
  z-index: 998;
  cursor: pointer;
} */

/* Agent Details Section - Relative positioning for proper scrolling */
:deep(.agent-details-section) {
  position: relative;
  width: calc(100% - 34px);
  margin: 0 16px;
  height: 100%;
  max-height: 100%;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.25);
  background: transparent;
  flex-shrink: 0;
}

:deep(.agent-details-section.expanded) {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  height: calc(100% - 2px);
  width: calc(100% - 34px);
  max-height: 100vh;
  border: 1px solid var(--terminal-border-color);
  /* border-radius: 0; */
  background: transparent;
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
</style>
