<!-- Agents.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    :activeRightPanel="activeRightPanel"
    screenId="AgentsScreen"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      allAvailableAgents: agents,
      selectedAgent,
    }"
    :panelProps="panelProps"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default="{ terminalLines }">
      <div class="agents-panel" :class="{ 'has-details': !!selectedAgent, expanded: isDetailsExpanded }" @click="onContentClick">
<MobileCollection v-if="mobileView" v-show="!selectedAgent" view-id="agents" title="Agents" count-label="agents" :items="filteredAgentsGrid" :search="searchQuery" :tabs="[]" active="" :selected-id="selectedAgent?.id" create-label="Create agent" icon="fas fa-robot" @update:search="handleSearch" @select="selectMobileAgent" @create="openCreate()"><template #actions><button @click="triggerAgentImport">Import</button><button :disabled="!selectedAgent" @click="exportSelectedAgent">Export selected</button><button @click="baseScreenRef.openMobilePanel('left')">Stats</button></template><template #footer><MarketplaceShelf asset-type="agent" variant="strip" :dismissible="false" fallback-to-all @browse="listing => emit('screen-change', 'MarketplaceScreen', { listing })" @installed="onShelfInstalled" /></template></MobileCollection>

<input
              ref="agentImportInput"
              type="file"
              accept="application/json,.json"
              style="display: none"
              @change="handleAgentImportFile"
            />
<div v-show="!mobileView" class="desktop-view-container">
        <!-- Title, count, search. Create, import and export live in the right panel. -->
        <ScreenToolbar
          title="AGENTS"
          :count="filteredAgentsGrid.length"
          countLabel="agents"
          searchPlaceholder="Search agents..."
          :searchQuery="searchQuery"
          :searchScope="shelfHasFocus ? 'Marketplace' : ''"
          :layoutOptions="[]"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :showSort="false"
          @update:searchQuery="handleSearch"
        />

        <!-- Main Content -->
        <div class="screen-content agents-content">
          <!-- Loading skeleton -->
          <div
            v-if="agents.length === 0 && !criticalDataReady"
            class="agents-loading"
            style="padding: 16px; display: flex; flex-direction: column; gap: 12px"
          >
            <div class="skeleton-block" style="height: 40px; width: 100%; border-radius: 6px"></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
              <div class="skeleton-block" style="height: 160px; border-radius: 8px"></div>
              <div class="skeleton-block" style="height: 160px; border-radius: 8px"></div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
              <div class="skeleton-block" style="height: 160px; border-radius: 8px"></div>
              <div class="skeleton-block" style="height: 160px; border-radius: 8px"></div>
            </div>
          </div>

          <main v-else class="screen-main-content agents-main-content fade-in">

            <div class="category-cards-container">
              <!-- Nothing owned yet: the empty state IS the storefront. Create
                   stays first-class on top; real, type-scoped inventory sits
                   underneath. Degrades to Create alone if the catalogue is
                   unreachable — see MarketplaceShelf. -->
              <MarketplaceShelf
                v-if="ownsNothing"
                asset-type="agent"
                variant="full"
                :dismissible="false"
                :query="searchQuery"
                create-label="Create Agent"
                @create="openCreate()"
                @browse="listing => emit('screen-change', 'MarketplaceScreen', { listing })"
                @installed="onShelfInstalled"
                @clear-search="handleSearch('')"
                @availability="(v) => (shelfAvailable = v)"
              />

              <!-- Owned, but this search matched none of them. Their own items
                   are the subject here, so this stays a plain reset — not a
                   marketplace pitch. -->
              <div v-else-if="filteredAgentsGrid.length === 0" class="empty-state-container">
                <div class="empty-state">
                  <i class="fas fa-robot"></i>
                  <p>No agents match &ldquo;{{ searchQuery }}&rdquo;</p>
                  <div class="empty-state-buttons">
                    <button class="create-button" @click="handleSearch('')"><i class="fas fa-undo"></i> Clear search</button>
                  </div>
                </div>
              </div>

              <!-- One flat grid: no categories, no grouping, no tabs. Search in
                   the header is the only filter. -->
              <div v-else class="card-grid agents-grid" role="list" aria-label="Agents">
                  <div
                    v-for="agent in filteredAgentsGrid"
                    :key="agent.id"
                    class="agent-card"
                    :class="{
                      selected: selectedAgent?.id === agent.id,
                      active: (agent.status || '').toLowerCase() === 'active',
                    }"
                    @click="selectAgent(agent)"
                  >
                    <div class="agent-header">
                      <div class="agent-avatar-name">
                        <div
                          :class="['agent-avatar', (agent.status || 'inactive').toLowerCase() === 'active' ? 'status-active' : 'status-inactive']"
                        >
                          <img
                            :src="agentAvatarSrc(agent.avatar)"
                            :alt="agent.name"
                            class="avatar-image"
                            @error="onAvatarError"
                          />
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

              <!-- Owned agents lead; discovery remains visible below them. -->
              <MarketplaceShelf
                v-if="!ownsNothing"
                asset-type="agent"
                variant="strip" :dismissible="false" fallback-to-all
                @browse="listing => emit('screen-change', 'MarketplaceScreen', { listing })"
                @installed="onShelfInstalled"
              />
            </div>
          </main>
        </div>


</div>
        <!-- Agent Details Tabs Section - Only show for non-marketplace tabs -->
        <AgentDetails
          v-if="selectedAgent"
          :selected-agent="selectedAgent"
          :save-status="saveStatus"
          :is-details-expanded="isDetailsExpanded"
          :format-uptime="formatUptime"
          :available-tools="availableTools"
          :available-workflows="availableWorkflows"
          :available-skills="availableSkills"
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
        <AgentCreateModal
          :open="createOpen"
          :initial-template="createTemplate"
          :tools="availableTools"
          :skills="availableSkills"
          @close="createOpen = false"
          @created="onAgentCreated"
        />
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, inject, computed, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { API_CONFIG } from '@/tt.config.js';
import { authHeaders } from '@/utils/apiFetch.js';
import MobileCollection from '@/mobile/MobileCollection.vue';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import AgentDetails from './components/AgentDetails/AgentDetails.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import AgentCreateModal from './components/AgentCreateModal.vue';
import { agentAvatarSrc, onAvatarError } from '@/utils/agentAvatar.js';

export default {
  name: 'AgentsScreen',
  components: { BaseScreen, MobileCollection, TerminalHeader, Tooltip, ScreenToolbar, MarketplaceShelf, AgentDetails, SvgIcon, SimpleModal, AgentCreateModal },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const mobileView = inject('isMobile', ref(false));
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const playSound = inject('playSound', () => {});

    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const agents = ref([]);
    // A startup fetch may finish after this screen's deduplicated refresh returns.
    watch(() => store.getters['agents/allAgents'], (loaded) => { agents.value = loaded; });
    const criticalDataReady = computed(() => store.getters.criticalDataReady);
    const selectedAgent = ref(null);
    const searchQuery = ref('');

    /* Shelf wiring.
       `ownsNothing` deliberately reads the RAW list, not the filtered one: a
       user with 5 agents who searches "zzz" has an empty grid but is not an
       empty-state user, and answering their search with a storefront would be
       a non-sequitur. */
    const shelfAvailable = ref(false);
    const ownsNothing = computed(() => agents.value.length === 0);
    // Only claim the search box while the shelf is the thing it can actually drive.
    const shelfHasFocus = computed(() => ownsNothing.value && shelfAvailable.value);
    const onShelfInstalled = async () => {
      await store.dispatch('agents/fetchAgents', { force: true });
      await loadAgents(true);
    };
    const isDetailsExpanded = ref(false);
    const saveStatus = ref(null);


    // The one list the screen shows: every agent, narrowed only by search,
    // A–Z. Sorts a copy — sorting the store's array in place inside a computed
    // mutated shared state on every render.
    const filteredAgentsGrid = computed(() => {
      const q = searchQuery.value.trim().toLowerCase();
      const items = q
        ? agents.value.filter((agent) =>
            [agent.name, agent.description, agent.status, agent.category].some((v) => v && String(v).toLowerCase().includes(q)),
          )
        : [...agents.value];
      return items.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    });

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

    // agent import/export from the page toolbar
    const agentImportInput = ref(null);
    const triggerAgentImport = () => {
      agentImportInput.value?.click();
    };
    const handleAgentImportFile = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const envelope = JSON.parse(text);
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/import`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ envelope }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        const data = await response.json();
        terminalLines.value.push(`[Agents] Imported agent ${data.agentId}`);
        if (Array.isArray(data.missingRefs) && data.missingRefs.length > 0) {
          terminalLines.value.push(`[Agents] Missing references: ${data.missingRefs.join(', ')}`);
        }
        await store.dispatch('agents/fetchAgents', { force: true });
      } catch (e) {
        console.error('Agent import failed:', e);
        terminalLines.value.push(`[Agents] Import error: ${e.message}`);
      } finally {
        if (agentImportInput.value) agentImportInput.value.value = '';
      }
    };
    const exportSelectedAgent = async () => {
      const agent = selectedAgent.value;
      if (!agent) return;
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/${agent.id}/export`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        const envelope = await response.json();
        const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(agent.name || 'agent').replace(/\s+/g, '_')}.agnt-agent.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        terminalLines.value.push(`[Agents] Exported "${agent.name}"`);
      } catch (e) {
        console.error('Agent export failed:', e);
        terminalLines.value.push(`[Agents] Export error: ${e.message}`);
      }
    };

    const onContentClick = (e) => {
      if (!e.target.closest('.agent-card, .table-row, .screen-toolbar, .wm-tabs, .agent-details-section, .m-collection')) {
        selectedAgent.value = null;
      }
    };

    const selectMobileAgent = (agent) => selectAgent(agent);
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
                `[Agents] Successfully ${action === 'activateAgent' ? 'activated' : 'deactivated'} ${selectedAgent.value.name}`,
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
        // Right panel: "+ New agent", a quickstart template, import/export.
        case 'create':
          openCreate();
          break;
        case 'quickstart':
          openCreate(payload?.id || null);
          break;
        case 'import-agent':
          triggerAgentImport();
          break;
        case 'export-agent':
          exportSelectedAgent();
          break;
        // Left panel: a row in "Recently active".
        case 'select-item': {
          const agent = agents.value.find((a) => String(a.id) === String(payload?.id));
          if (agent) selectAgent(agent);
          break;
        }
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
        applySelectIntent();
      });
      applyNewIntent();
    };

    // ?select=agent:ID (Jump palette "Open", entity chips, EntityInspector
    // "Open in Agents") selects that agent so the right panel shows it.
    const applySelectIntent = () => {
      const sel = typeof route.query?.select === 'string' ? route.query.select : '';
      if (!sel.startsWith('agent:')) return;
      const id = sel.slice(6);
      const agent = (store.getters['agents/allAgents'] || []).find((a) => String(a.id) === id);
      if (agent) selectAgent(agent);
    };

    const toggleAgent = async (agent) => {
      if (agent) {
        await handlePanelAction('toggle-agent', agent);
      }
    };

    const activeRightPanel = computed(() => 'AgentsPanel');
    const panelProps = computed(() => ({ selectedAgent: selectedAgent.value }));

    // --- New agent (a modal on this screen; Agent Forge is gone) ---
    const createOpen = ref(false);
    const createTemplate = ref(null);
    const openCreate = (templateId = null) => {
      createTemplate.value = templateId;
      createOpen.value = true;
    };
    const onAgentCreated = async (created) => {
      createOpen.value = false;
      await refreshAgents(true);
      const agent = created?.id && agents.value.find((a) => String(a.id) === String(created.id));
      if (agent) selectAgent(agent);
      terminalLines.value.push(`[Agents] Created ${created?.name || 'agent'}`);
    };

    // ?new=1 (Jump palette "New agent", Dashboard, old /agent-forge links)
    // opens the modal. Watched as well as read on mount because this screen is
    // kept alive. The route is global, so only /agents counts, and the intent
    // is consumed (removed from the URL) so the next request is a real change.
    const applyNewIntent = () => {
      if (route.path !== '/agents' || route.query?.new !== '1') return;
      openCreate(typeof route.query.template === 'string' ? route.query.template : null);
      const { new: _consumed, template: _template, ...rest } = route.query;
      router.replace({ path: route.path, query: rest });
    };
    watch(
      () => [route.path, route.query?.new, route.query?.select],
      () => {
        if (route.path !== '/agents') return;
        applyNewIntent();
        applySelectIntent();
      },
    );

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
          status: selectedAgent.value.status,
          systemPrompt: configPayload.systemPrompt || '',
          toolAccessMode: configPayload.toolAccessMode || 'restricted',
          assignedTools: configPayload.assignedTools || [],
          assignedWorkflows: configPayload.assignedWorkflows || [],
          assignedSkills: configPayload.assignedSkills || [],
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
      })),
    );

    const availableTools = ref([]);
    const availableWorkflows = ref([]);
    const availableSkills = computed(() => store.getters['skills/allSkills'] || []);

    // Tools, workflows and skills: the options the details panel and the
    // new-agent modal offer.
    const fetchToolsAndWorkflows = async (force = false) => {
      try {
        await Promise.all([
          store.dispatch('tools/fetchTools', { force }),
          store.dispatch('workflows/fetchWorkflows', { force }),
          store.dispatch('skills/fetchSkills'),
        ]);
        availableTools.value = store.getters['tools/allTools'] || [];
        availableWorkflows.value = store.getters['workflows/allWorkflows'] || [];
      } catch (e) {
        terminalLines.value.push(`[Agents] Error loading tools/workflows: ${e.message}`);
      }
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
          goal.tasks.map((t) => `${t.title} (${t.status})`),
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
          headers: authHeaders(),
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
          headers: authHeaders(),
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
      agentAvatarSrc,
      onAvatarError,
      mobileView,
      simpleModal,
      baseScreenRef,
      terminalLines,
      agents,
      criticalDataReady,
      selectedAgent,
      handlePanelAction,
      shelfAvailable,
      ownsNothing,
      shelfHasFocus,
      onShelfInstalled,
      onContentClick,
      selectAgent, selectMobileAgent,
      formatUptime,
      emit,
      initializeScreen,
      searchQuery,
      toggleAgent,
      panelProps,
      activeRightPanel,
      saveStatus,
      saveConfiguration,
      handleSearch,
      //
      agentImportInput,
      triggerAgentImport,
      handleAgentImportFile,
      exportSelectedAgent,
      filteredAgentsGrid,
      createOpen,
      createTemplate,
      openCreate,
      onAgentCreated,
      categoryOptions,
      availableTools,
      availableWorkflows,
      availableSkills,
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
      getAgentToolsWithIcons,
      hasToolsOrUptime,
      getToolIcon,
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

.agents-panel.has-details.expanded :deep(.wm-header),
.agents-panel.has-details.expanded .wm-tabs {
  display: none;
}

/* toolbar slot buttons — match ScreenToolbar's .wm-btn styling.
   ScreenToolbar's scoped styles don't apply to slot content rendered from
   here, so we duplicate the style. */
.wm-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: none;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: 0.5px;
}
.wm-btn:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--terminal-border-color);
}
.wm-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Category tabs ── */
/* .wm-tabs / .wm-tab now live in _components/FilterTabs.vue. The
   `.agents-panel.has-details.expanded .wm-tabs` override above still applies:
   a child component's root element carries this file's scope id too. */

.text-bright-green {
  color: var(--text-green);
  text-shadow: 0 0 5px rgba(var(--green-rgb), 0.4);
}

.font-bold {
  font-weight: bold;
}

.text-xl {
  font-size: 1.25rem;
}

/* layout: .screen-content in styles/components/_screen-layout.css */

/* layout: .screen-main-content in styles/components/_screen-layout.css */

.agents-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.agents-main-content::-webkit-scrollbar-track {
  background: var(--color-darker-1) !important;
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
  color: var(--text-green);
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
  color: var(--text-info);
  border: 1px solid var(--terminal-border-color);
  opacity: 0.5;
}

/* layout: .card-row in styles/components/_screen-layout.css */

.agent-card {
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

.agent-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.agent-card:not(.active) {
  color: var(--color-text-muted);
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
  padding: 2px;
  border: 3px solid var(--color-text-muted);
}

.agent-avatar.status-active {
  border-color: var(--color-green);
}

.agent-avatar.status-inactive {
  border-color: var(--color-text-muted);
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
  color: var(--text-green);
  text-transform: uppercase;
  flex-shrink: 0;
}

.agent-status.active {
  background: rgba(34, 197, 94, 0.2);
  color: var(--text-green);
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
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  /* Never grow: a grid row stretches the card to its tallest neighbour, and a
     growing clamp box shows the lines past the clamp. .agent-tools pins to
     the bottom with margin-top: auto. */
  flex: 0 1 auto;
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
  color: var(--text-green);
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
  color: var(--text-green);
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

/* Responsive: single column on smaller screens */
@media (max-width: 640px) {
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
  color: var(--text-green);
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
  color: var(--text-green);
}

.meta-item.category i {
  color: var(--color-text-muted);
}

.meta-item .fa-star {
  color: var(--text-yellow);
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
  color: var(--text-yellow);
  flex-shrink: 0;
}

.item-price.free {
  background: rgba(34, 197, 94, 0.2);
  color: var(--text-green);
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
  color: var(--text-green);
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
</style>
