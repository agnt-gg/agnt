<!-- Workflows.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    :activeRightPanel="activeRightPanel"
    screenId="WorkflowsScreen"
    :terminalLines="terminalLines"
    :leftPanelProps="{ allWorkflows, selectedWorkflowId }"
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

      <div class="workflows-panel" @click="onContentClick">
<MobileCollection v-if="mobileView" view-id="workflows" title="Workflows" count-label="workflows" :items="filteredWorkflows" :search="searchQuery" :tabs="[]" active="" :selected-id="selectedWorkflowId" create-label="Create workflow" icon="fas fa-project-diagram" @update:search="handleSearch" @select="handleWorkflowClick" @create="handlePanelAction('create')"><template #actions><button @click="triggerWorkflowImport">Import</button><button :disabled="!selectedWorkflowId" @click="exportSelectedWorkflow">Export selected</button><button @click="baseScreenRef.openMobilePanel('left')">Stats</button></template></MobileCollection>
<input
              ref="workflowImportInput"
              type="file"
              accept="application/json,.json"
              style="display: none"
              @change="handleWorkflowImportFile"
            />
<div v-show="!mobileView" class="desktop-view-container">
        <!-- Title, count, search. Create, import and export live in the right panel. -->
        <ScreenToolbar
          title="WORKFLOWS"
          :count="filteredWorkflows.length"
          countLabel="workflows"
          searchPlaceholder="Search workflows..."
          :searchQuery="searchQuery"
          :searchScope="shelfHasFocus ? 'Marketplace' : ''"
          :layoutOptions="[]"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :showSort="false"
          @update:searchQuery="handleSearch"
        />

        <!-- Main Content (Sidebar moved to LeftPanel) -->
        <div class="screen-content workflows-content">
          <main class="screen-main-content workflows-main-content fade-in">

            <div class="category-cards-container">
              <!-- Nothing owned yet: the empty state IS the storefront. -->
              <MarketplaceShelf
                v-if="ownsNothing"
                asset-type="workflow"
                variant="full"
                :query="searchQuery"
                create-label="Create Workflow"
                @create="handlePanelAction('create')"
                @browse="handlePanelAction('navigate', 'MarketplaceScreen')"
                @installed="onShelfInstalled"
                @clear-search="handleSearch('')"
                @availability="(v) => (shelfAvailable = v)"
              />

              <!-- Owned, but nothing matched this search: their items are the
                   subject, so this stays a reset rather than a pitch. -->
              <div v-else-if="filteredWorkflows.length === 0" class="empty-state-container">
                <div class="empty-state">
                  <i class="fas fa-cogs"></i>
                  <p>No workflows match &ldquo;{{ searchQuery }}&rdquo;</p>
                  <div class="empty-state-buttons">
                    <button class="create-button" @click="handleSearch('')"><i class="fas fa-undo"></i> Clear search</button>
                  </div>
                </div>
              </div>

              <!-- One flat grid: listening/running first, then A–Z. Search in the
                   header is the only filter. Double-click opens the forge. -->
              <div v-else class="card-grid workflows-grid" role="list" aria-label="Workflows">
                <div
                  v-for="workflow in filteredWorkflows"
                  :key="workflow.id"
                  class="workflow-card"
                  :class="{ selected: selectedWorkflowId === workflow.id, [workflow.status?.toLowerCase()]: !!workflow.status }"
                  role="listitem"
                  @click="handleWorkflowClick(workflow)"
                  @dblclick="handleWorkflowDoubleClick(workflow)"
                >
                  <div class="workflow-header">
                    <div class="workflow-avatar-name">
                      <div class="workflow-avatar">
                        <div class="avatar-placeholder">
                          {{ (workflow.name || workflow.title || 'W').charAt(0).toUpperCase() }}
                        </div>
                      </div>
                      <span class="workflow-name">{{ workflow.name || workflow.title }}</span>
                    </div>
                    <div class="workflow-header-end">
                      <ShareButton class="workflow-share" kind="workflow" :id="workflow.id" :name="workflow.name || workflow.title" />
                      <span class="workflow-status" :class="workflow.status.toLowerCase()">{{ workflow.status }}</span>
                    </div>
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
                        <span class="tool-icon-small">
                          <SvgIcon :name="tool.icon" />
                        </span>
                      </Tooltip>
                      <span v-if="getToolsWithNames(workflow).length > 4" class="tools-overflow">
                        +{{ getToolsWithNames(workflow).length - 4 }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Second run: the user's own work leads, the shelf steps aside. -->
              <MarketplaceShelf
                v-if="!ownsNothing"
                asset-type="workflow"
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

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="WorkflowsScreen" @close="onTutorialClose" />
  <SimpleModal ref="simpleModalRef" />
</template>

<script>
import { ref, onMounted, onUnmounted, computed, nextTick, inject } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { useCleanup } from '@/composables/useCleanup';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import MobileCollection from '@/mobile/MobileCollection.vue';
import BaseScreen from '../../BaseScreen.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import ShareButton from '@/views/_components/share/ShareButton.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import { useWorkflowsTutorial } from './useWorkflowsTutorial.js';
export default {
  name: 'WorkflowsScreen',
  components: { BaseScreen, MobileCollection, TerminalHeader, SvgIcon, PopupTutorial, SimpleModal, Tooltip, ScreenToolbar, MarketplaceShelf, ShareButton },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const mobileView = inject('isMobile', ref(false));
    const store = useStore();
    const route = useRoute();
    const cleanup = useCleanup();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const simpleModalRef = ref(null);
    const terminalLines = ref([]);
    const selectedWorkflowId = ref(null);
    const searchQuery = ref('');

    /* Shelf wiring. `ownsNothing` reads the RAW list, not the tab/search
       filtered one: someone with 5 workflows searching "zzz" has an empty grid
       but is not an empty-state user. */
    const shelfAvailable = ref(false);
    const ownsNothing = computed(() => (store.getters['workflows/allWorkflows'] || []).length === 0);
    const shelfHasFocus = computed(() => ownsNothing.value && shelfAvailable.value);
    // fetchWorkflows takes { activeOnly } only — no force flag exists here.
    const onShelfInstalled = () => store.dispatch('workflows/fetchWorkflows');
    let pollingInterval = null;



    // Click handling state
    let clickTimer = null;



    // Tutorial setup
    const { tutorialConfig, startTutorial, onTutorialClose, initializeWorkflowsTutorial } = useWorkflowsTutorial();




    const allWorkflows = computed(() => store.getters['workflows/allWorkflows']);


    // The one list the screen shows: search-narrowed, listening/running first,
    // then A–Z. Sorts a copy — the old version sorted the store's array in
    // place inside a computed, and never applied the search box to the grid.
    const LIVE = new Set(['running', 'listening']);
    const filteredWorkflows = computed(() => {
      const q = searchQuery.value.trim().toLowerCase();
      const all = allWorkflows.value || [];
      const items = q
        ? all.filter((w) => [w.name, w.title, w.description, w.status, w.category].some((v) => v && String(v).toLowerCase().includes(q)))
        : [...all];
      return items.sort(
        (x, y) =>
          (LIVE.has(x.status) ? 0 : 1) - (LIVE.has(y.status) ? 0 : 1) ||
          (x.name || x.title || '').localeCompare(y.name || y.title || '', undefined, { sensitivity: 'base' }),
      );
    });

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

    const activeRightPanel = computed(() => 'WorkflowsPanel');
    const panelProps = computed(() => ({ selectedWorkflowId: selectedWorkflowId.value }));

    // --- Methods ---
    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();
    const focusInput = () => baseScreenRef.value?.focusInput();
    const clearInput = () => baseScreenRef.value?.clearInput();
    const setInputDisabled = (disabled) => baseScreenRef.value?.setInputDisabled(disabled);

    const onContentClick = (e) => {
      if (!e.target.closest('.workflow-card, .table-row, .screen-toolbar, .wm-tabs, .m-collection')) {
        selectedWorkflowId.value = null;
      }
    };

    const handleWorkflowClick = (workflow) => {
      playSound('typewriterKeyPress');
      selectedWorkflowId.value = workflow.id;
      if (mobileView.value) baseScreenRef.value?.openMobilePanel('right');
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

    // workflow import/export from the page toolbar
    const workflowImportInput = ref(null);
    const triggerWorkflowImport = () => {
      workflowImportInput.value?.click();
    };
    const handleWorkflowImportFile = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const envelope = JSON.parse(text);
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/import`, {
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
        addLine(`Imported workflow ${data.workflowId}`, 'info');
        if (Array.isArray(data.missingToolTypes) && data.missingToolTypes.length > 0) {
          addLine(`Missing or unknown tool types: ${data.missingToolTypes.join(', ')}`, 'warn');
        }
        await store.dispatch('workflows/fetchWorkflows', { force: true });
      } catch (e) {
        console.error('Workflow import failed:', e);
        addLine(`Workflow import error: ${e.message}`, 'error');
      } finally {
        if (workflowImportInput.value) workflowImportInput.value.value = '';
      }
    };
    const exportSelectedWorkflow = async () => {
      const id = selectedWorkflowId.value;
      if (!id) return;
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${id}/export`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        const envelope = await response.json();
        const name = envelope?.payload?.name || 'workflow';
        const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${String(name).replace(/\s+/g, '_')}.agnt-workflow.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLine(`Exported workflow "${name}"`, 'info');
      } catch (e) {
        console.error('Workflow export failed:', e);
        addLine(`Workflow export error: ${e.message}`, 'error');
      }
    };







    const addLine = (content, type = 'default') => {
      terminalLines.value.push({ content, type });
      nextTick(() => scrollToBottom());
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
        default:
          addLine(`Unknown command: ${action}. Try list, info, run or stop.`, 'error');
      }
    };

    const handlePanelAction = async (action, payload) => {
      console.log('Workflow panel action:', action, payload);

      // Right panel: "+ New workflow" opens the forge on a blank canvas, where
      // the quickstarts are; import/export act on the list.
      if (action === 'create') {
        emit('screen-change', 'WorkflowForgeScreen', { workflowId: null });
      } else if (action === 'import-workflow') {
        triggerWorkflowImport();
      } else if (action === 'export-workflow') {
        exportSelectedWorkflow();
      } else if (action === 'close-panel' || action === 'clear-selection') {
        selectedWorkflowId.value = null;
      } else if (action === 'select-item' || action === 'select-workflow') {
        const hit = (allWorkflows.value || []).find((w) => String(w.id) === String(payload?.id ?? payload));
        if (hit) handleWorkflowClick(hit);
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
      store
        .dispatch('workflows/fetchWorkflows')
        .then(() => {
          const workflows = store.getters['workflows/allWorkflows'];
          // ?select=workflow:ID (Jump palette, entity chips) selects it.
          const sel = typeof route.query?.select === 'string' ? route.query.select : '';
          if (sel.startsWith('workflow:')) {
            const hit = workflows.find((w) => String(w.id) === sel.slice(9));
            if (hit) handleWorkflowClick(hit);
          }
          if (cachedWorkflows.length === 0) {
            if (workflows.length === 0) {
              addLine('No workflows found. Create a workflow in the Workflow Designer.', 'info');
            } else {
              addLine(`Found ${workflows.length} workflows.`, 'success');
            }
          }
        })
        .catch((error) => {
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






    // --- Marketplace Methods using shared composable ---
    // Initialize the marketplace install composable with modal and terminal logging
    const { handleInstall: marketplaceInstall } = useMarketplaceInstall(simpleModalRef, (msg) => addLine(msg, 'info'));


    return {
      mobileView,
      baseScreenRef,
      simpleModalRef,
      terminalLines,
      handleUserInputSubmit,
      handlePanelAction,
      emit,
      initializeScreen,
      filteredWorkflows,
      selectedWorkflowId,
      onContentClick,
      handleWorkflowClick,
      handleWorkflowDoubleClick,
      //
      workflowImportInput,
      triggerWorkflowImport,
      handleWorkflowImportFile,
      exportSelectedWorkflow,
      getToolsDisplay,
      handleSearch,
      searchQuery,
      allWorkflows,
      shelfAvailable,
      ownsNothing,
      shelfHasFocus,
      onShelfInstalled,
      getToolsWithNames,
      hasToolsOrUptime,
      getWorkflowIcon,
      // Drag and drop
      // Tutorial
      tutorialConfig,
      startTutorial,
      onTutorialClose,
      // Marketplace
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
/* .wm-tabs / .wm-tab now live in _components/FilterTabs.vue. */
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

/* layout: .screen-content in styles/components/_screen-layout.css */

/* layout: .screen-main-content in styles/components/_screen-layout.css */

.workflows-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.workflows-main-content::-webkit-scrollbar-track {
  background: var(--color-darker-1) !important;
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

/* layout: .card-row in styles/components/_screen-layout.css */

.workflow-card {
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

.workflow-card.stopped {
  color: var(--color-text-muted);
}

.table-row.listening .col-status {
  color: var(--color-blue);
}

.table-row.active .col-status,
.table-row.running .col-status {
  color: var(--color-green);
}

.table-row.error .col-status,
.table-row.failed .col-status {
  color: var(--color-red);
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
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
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

.workflow-header-end {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.workflow-share {
  opacity: 0;
  transition: opacity 0.15s;
}
.workflow-card:hover .workflow-share,
.workflow-card.selected .workflow-share,
.workflow-share:focus-visible {
  opacity: 1;
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
