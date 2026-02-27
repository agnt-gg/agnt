<template>
  <div class="runs-screen-root">
  <SimpleModal ref="simpleModal" />
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="RunsPanel"
    activeRightPanel="RunsPanel"
    screenId="RunsScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      executions: filteredExecutions,
      selectedExecutionId,
      currentFilter,
    }"
    :panelProps="{
      selectedExecutionId,
      executions: allExecutions,
    }"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="runs-panel">
        <!-- Sticky Header Container -->
        <div class="sticky-header">
          <!-- Execution Tabs -->
          <BaseTabControls
            :tabs="tabs"
            :active-tab="activeTab"
            :current-layout="currentLayout"
            :show-grid-toggle="true"
            :show-table-toggle="true"
            @select-tab="selectTab"
            @set-layout="setLayout"
          />

          <!-- Search Bar for Card View -->
          <div v-if="currentLayout === 'grid'" class="card-view-search-bar">
            <input
              type="text"
              class="search-input"
              placeholder="Search executions..."
              :value="searchQuery"
              @input="handleSearch($event.target.value)"
            />
            <div class="type-filter-bar">
              <button
                v-for="filter in typeFilters"
                :key="filter.id"
                :class="['type-filter-btn', { active: executionTypeFilter === filter.id }]"
                @click="selectTypeFilter(filter.id)"
              >
                <i :class="filter.icon"></i>
                {{ filter.name }}
              </button>
            </div>
          </div>
        </div>

        <!-- Main Content -->
        <div class="runs-content">
          <main class="runs-main-content">
            <!-- Table View -->
            <div v-if="currentLayout === 'table'" class="table-view-container">
              <!-- Search Bar and Type Filter Row for Table View -->
              <div class="table-view-search-bar">
                <div class="search-wrapper">
                  <input
                    type="text"
                    class="search-input"
                    placeholder="Search executions..."
                    :value="searchQuery"
                    @input="handleSearch($event.target.value)"
                  />
                </div>
                <div class="type-filter-bar">
                  <button
                    v-for="filter in typeFilters"
                    :key="filter.id"
                    :class="['type-filter-btn', { active: executionTypeFilter === filter.id }]"
                    @click="selectTypeFilter(filter.id)"
                  >
                    <i :class="filter.icon"></i>
                    {{ filter.name }}
                  </button>
                </div>
              </div>

              <BaseTable
                :items="filteredExecutions"
                :columns="tableColumns"
                :selected-id="selectedExecutionId"
                :show-search="false"
                :show-sort-dropdown="false"
                :enable-column-sorting="true"
                :default-sort-column="'startTime'"
                :default-sort-direction="'desc'"
                :no-results-text="'No executions found.'"
                :title-key="'workflowName'"
                @row-click="handleExecutionClick"
                @row-double-click="handleExecutionDoubleClick"
              >
                <template #status="{ item }">
                  <div :class="['col-status', item.status.toLowerCase()]">
                    <i :class="getStatusIcon(item.status)"></i>
                    {{ item.status }}
                  </div>
                </template>
                <template #executionType="{ item }">
                  <span
                    class="execution-type-badge"
                    :class="isAgentExecution(item) ? 'agent-badge' : isGoalExecution(item) ? 'goal-badge' : 'workflow-badge'"
                  >
                    <i :class="getExecutionTypeIcon(item)"></i>
                    {{ getExecutionTypeLabel(item) }}
                  </span>
                </template>
                <template #workflowName="{ item }">
                  <span class="workflow-name">{{ item.workflowName || 'Unnamed Workflow' }}</span>
                </template>
                <template #startTime="{ item }">
                  {{ formatDate(item.startTime) }}
                </template>
                <template #endTime="{ item }">
                  {{ item.endTime ? formatDate(item.endTime) : '-' }}
                </template>
                <template #duration="{ item }">
                  {{ calculateDuration(item) }}
                </template>
              </BaseTable>
            </div>

            <!-- Grid View -->
            <div v-else class="executions-grid-container">
              <div class="executions-grid">
                <div
                  v-for="execution in filteredExecutions"
                  :key="execution.id"
                  class="execution-card"
                  :class="{
                    selected: selectedExecutionId === execution.id,
                    [execution.status.toLowerCase()]: true,
                  }"
                  @click="handleExecutionClick(execution)"
                  @dblclick="handleExecutionDoubleClick(execution)"
                >
                  <!-- Execution Header -->
                  <div class="execution-header">
                    <div class="execution-title-section">
                      <h3 class="execution-title">{{ execution.workflowName || 'Unnamed Workflow' }}</h3>
                      <div class="status-badges">
                        <span class="execution-status" :class="execution.status.toLowerCase()">
                          <i :class="getStatusIcon(execution.status)"></i>
                          {{ execution.status }}
                        </span>
                        <span
                          class="execution-type-badge"
                          :class="isAgentExecution(execution) ? 'agent-badge' : isGoalExecution(execution) ? 'goal-badge' : 'workflow-badge'"
                        >
                          <i :class="getExecutionTypeIcon(execution)"></i>
                          {{ getExecutionTypeLabel(execution) }}
                        </span>
                      </div>
                    </div>
                    <div class="execution-actions">
                      <Tooltip v-if="execution.status === 'running' || execution.status === 'started'" text="Stop Execution" width="auto">
                        <button
                          @click.stop="stopExecution(execution)"
                          class="action-btn stop-btn"
                        >
                          <i class="fas fa-stop"></i>
                        </button>
                      </Tooltip>
                      <!-- <button @click.stop="deleteExecution(execution)" class="action-btn delete-btn" title="Delete Execution">
                        <i class="fas fa-trash"></i>
                      </button> -->
                    </div>
                  </div>

                  <!-- Execution Info -->
                  <div class="execution-info">
                    <div class="info-row">
                      <span class="info-label">Started:</span>
                      <span class="info-value">{{ formatDate(execution.startTime) }}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Duration:</span>
                      <span class="info-value">{{ calculateDuration(execution) }}</span>
                    </div>
                    <div v-if="execution.creditsUsed" class="info-row">
                      <span class="info-label">Credits:</span>
                      <span class="info-value">{{ execution.creditsUsed }}</span>
                    </div>
                  </div>

                  <!-- Node Count (if available) -->
                  <div v-if="execution.nodeExecutions && execution.nodeExecutions.length > 0" class="node-count">
                    <i class="fas fa-project-diagram"></i>
                    {{ execution.nodeExecutions.length }} node{{ execution.nodeExecutions.length !== 1 ? 's' : '' }}
                  </div>
                </div>

                <!-- Empty State -->
                <div v-if="filteredExecutions.length === 0" class="empty-state">
                  <div class="empty-icon">
                    <i class="fas fa-history"></i>
                  </div>
                  <h3>No Executions Found</h3>
                  <p v-if="searchQuery">No executions match your search criteria.</p>
                  <p v-else-if="activeTab !== 'all'">No {{ activeTab }} executions found.</p>
                  <p v-else>Run some workflows to see execution history.</p>
                </div>
              </div>

              <!-- Load More Buttons -->
              <div v-if="hasMoreExecutions" class="load-more-container">
                <button @click="loadMoreExecutions" class="load-more-btn">
                  <i class="fas fa-chevron-down"></i>
                  Next 108
                </button>
                <button @click="loadAllExecutions" class="load-all-btn">
                  <i class="fas fa-list"></i>
                  Load All ({{ remainingExecutionsCount }} remaining)
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </template>
  </BaseScreen>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="runs" @close="onTutorialClose" />
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, computed, nextTick, inject } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { useCleanup } from '@/composables/useCleanup';
import BaseScreen from '../../BaseScreen.vue';
import BaseTable from '../../../_components/BaseTable.vue';
import BaseTabControls from '../../../_components/BaseTabControls.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import { useRunsTutorial } from './useRunsTutorial.js';
import { API_CONFIG } from '@/tt.config.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'RunsScreen',
  components: { BaseScreen, BaseTable, BaseTabControls, SimpleModal, PopupTutorial, Tooltip },
  emits: ['screen-change', 'panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const cleanup = useCleanup();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const selectedExecutionId = ref(null);
    const selectedExecution = ref(null);
    const activeTab = ref('all');
    const searchQuery = ref('');
    const currentLayout = ref('grid');
    const currentFilter = ref('all');
    const selectedWorkflow = ref('');
    const executionTypeFilter = ref('all'); // 'all', 'goals', 'workflows'
    const displayLimit = ref(108); // Initial limit of 108 runs
    const initialDisplayLimit = 108;
    let pollingInterval = null;

    // Define tabs (status-based)
    const tabs = [
      { id: 'all', name: 'All', icon: 'fas fa-list' },
      { id: 'running', name: 'Running', icon: 'fas fa-play' },
      { id: 'completed', name: 'Completed', icon: 'fas fa-check' },
      { id: 'failed', name: 'Failed', icon: 'fas fa-times' },
      { id: 'stopped', name: 'Stopped', icon: 'fas fa-stop' },
    ];

    // Define type filter buttons
    const typeFilters = [
      { id: 'all', name: 'All Types', icon: 'fas fa-list' },
      { id: 'agents', name: 'Agents', icon: 'fas fa-robot' },
      { id: 'goals', name: 'Goals', icon: 'fas fa-bullseye' },
      { id: 'workflows', name: 'Workflows', icon: 'fas fa-project-diagram' },
    ];

    // Define table columns
    const tableColumns = [
      { key: 'status', label: 'Status', width: '120px' },
      { key: 'workflowName', label: 'Run', width: '2fr' },
      { key: 'executionType', label: 'Type', width: '100px' },
      { key: 'startTime', label: 'Started', width: '1.5fr' },
      { key: 'duration', label: 'Duration', width: '1fr' },
    ];

    const allExecutions = computed(() => store.getters['executionHistory/getExecutions']);

    // Filtered executions based on active tab, search, and panel filters (before display limit)
    const filteredExecutionsBeforeLimit = computed(() => {
      let executions = allExecutions.value.map((execution) => {
        // Calculate duration in milliseconds for sorting
        let durationMs = 0;
        if (execution.startTime) {
          const start = new Date(execution.startTime);
          const end = execution.endTime ? new Date(execution.endTime) : new Date();
          durationMs = end - start;
        }

        return {
          ...execution,
          executionType: isAgentExecution(execution) ? 'Agent' : isGoalExecution(execution) ? 'Goal' : 'Workflow',
          duration: durationMs, // Add numeric duration for sorting
        };
      });

      // Filter by execution type (agents, goals, workflows)
      switch (executionTypeFilter.value) {
        case 'agents':
          executions = executions.filter((e) => isAgentExecution(e));
          break;
        case 'goals':
          executions = executions.filter((e) => isGoalExecution(e));
          break;
        case 'workflows':
          executions = executions.filter((e) => !isGoalExecution(e) && !isAgentExecution(e));
          break;
        default: // 'all'
          break;
      }

      // Filter by status tab
      switch (activeTab.value) {
        case 'running':
          executions = executions.filter((e) => e.status === 'running' || e.status === 'started');
          break;
        case 'completed':
          executions = executions.filter((e) => e.status === 'completed' || e.status === 'validated' || e.status === 'needs_review');
          break;
        case 'failed':
          executions = executions.filter((e) => e.status === 'failed' || e.status === 'error');
          break;
        case 'stopped':
          executions = executions.filter((e) => e.status === 'stopped');
          break;
        default: // 'all'
          break;
      }

      // Filter by panel filter (if different from tab)
      if (currentFilter.value !== 'all' && currentFilter.value !== activeTab.value) {
        if (currentFilter.value === 'running') {
          executions = executions.filter((e) => e.status === 'running' || e.status === 'started');
        } else {
          executions = executions.filter((e) => e.status === currentFilter.value);
        }
      }

      // Filter by workflow
      if (selectedWorkflow.value) {
        executions = executions.filter((e) => e.workflowName === selectedWorkflow.value);
      }

      // Apply search filtering
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        executions = executions.filter(
          (execution) =>
            (execution.workflowName && execution.workflowName.toLowerCase().includes(query)) ||
            (execution.status && execution.status.toLowerCase().includes(query)) ||
            (execution.id && execution.id.toLowerCase().includes(query))
        );
      }

      // Sort by startTime descending (most recent first) for consistent display
      return executions.sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
        return bTime - aTime; // Descending order (newest first)
      });
    });

    // Apply display limit to filtered executions
    const filteredExecutions = computed(() => {
      return filteredExecutionsBeforeLimit.value.slice(0, displayLimit.value);
    });

    // Check if there are more executions to load
    const hasMoreExecutions = computed(() => {
      return filteredExecutionsBeforeLimit.value.length > displayLimit.value;
    });

    // Count of remaining executions
    const remainingExecutionsCount = computed(() => {
      return Math.max(0, filteredExecutionsBeforeLimit.value.length - displayLimit.value);
    });

    // Load more executions
    const loadMoreExecutions = () => {
      const increment = 108;
      displayLimit.value += increment;
      addLine(
        `[Runs] Loaded ${increment} more executions (showing ${Math.min(displayLimit.value, filteredExecutionsBeforeLimit.value.length)} of ${
          filteredExecutionsBeforeLimit.value.length
        })`,
        'info'
      );
    };

    // Load all executions
    const loadAllExecutions = () => {
      const totalCount = filteredExecutionsBeforeLimit.value.length;
      displayLimit.value = totalCount;
      addLine(`[Runs] Loaded all ${totalCount} executions`, 'info');
    };

    // Reset display limit when filters change
    const resetDisplayLimit = () => {
      displayLimit.value = initialDisplayLimit;
    };

    // --- Methods ---
    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();
    const focusInput = () => baseScreenRef.value?.focusInput();
    const clearInput = () => baseScreenRef.value?.clearInput();
    const setInputDisabled = (disabled) => baseScreenRef.value?.setInputDisabled(disabled);

    const addLine = (content, type = 'default') => {
      terminalLines.value.push({ content, type });
      nextTick(() => scrollToBottom());
    };

    const handleExecutionClick = async (execution) => {
      playSound('typewriterKeyPress');
      selectedExecutionId.value = execution.id;
      addLine(`Selected execution: ${execution.id} (${execution.workflowName || 'Unnamed'})`, 'info');

      // Load details lazily using store action
      await viewExecutionDetails(execution);
    };

    // Double-click to view details
    const handleExecutionDoubleClick = (execution) => {
      viewExecutionDetails(execution);
    };

    // Node section expansion state
    const expandedNodeSections = ref({});

    const toggleNodeSection = (nodeId, section) => {
      const key = `${nodeId}-${section}`;
      if (!expandedNodeSections.value[key]) {
        expandedNodeSections.value[key] = true;
      } else {
        expandedNodeSections.value[key] = !expandedNodeSections.value[key];
      }
    };

    const isNodeSectionExpanded = (nodeId, section) => {
      const key = `${nodeId}-${section}`;
      return expandedNodeSections.value[key] || false;
    };

    // Helper methods for enhanced details
    const getNodeType = (nodeExecution) => {
      // First check if this is a synthetic node with a log name
      if (nodeExecution._synthetic && nodeExecution._logName) {
        return nodeExecution._logName;
      }

      // Then try to get the actual node name/type from the execution data
      if (nodeExecution.name) {
        return nodeExecution.name;
      }
      if (nodeExecution.type) {
        return nodeExecution.type;
      }
      if (nodeExecution.tool_name) {
        return nodeExecution.tool_name;
      }
      if (nodeExecution.node_type) {
        return nodeExecution.node_type;
      }
      if (nodeExecution.label) {
        return nodeExecution.label;
      }
      if (nodeExecution.title) {
        return nodeExecution.title;
      }

      // Try to extract from input/output data
      if (nodeExecution.input) {
        if (nodeExecution.input.tool_name) {
          return nodeExecution.input.tool_name;
        }
        if (nodeExecution.input.type) {
          return nodeExecution.input.type;
        }
        if (nodeExecution.input.name) {
          return nodeExecution.input.name;
        }
        if (nodeExecution.input.label) {
          return nodeExecution.input.label;
        }
      }

      if (nodeExecution.output) {
        if (nodeExecution.output.tool_name) {
          return nodeExecution.output.tool_name;
        }
        if (nodeExecution.output.type) {
          return nodeExecution.output.type;
        }
        if (nodeExecution.output.name) {
          return nodeExecution.output.name;
        }
      }

      // Try to extract name from execution log if available
      if (selectedExecution.value && selectedExecution.value.log && nodeExecution.node_id) {
        const log = selectedExecution.value.log;
        // Look for patterns like "node: uuid (Node Name)" in the log
        const nodeIdShort = nodeExecution.node_id.substring(0, 8);
        const patterns = [
          new RegExp(`${nodeExecution.node_id}\\s*\\(([^)]+)\\)`, 'i'),
          new RegExp(`${nodeIdShort}[^(]*\\(([^)]+)\\)`, 'i'),
          new RegExp(`node:\\s*${nodeExecution.node_id}[^(]*\\(([^)]+)\\)`, 'i'),
          new RegExp(`Executing node:\\s*${nodeExecution.node_id}[^(]*\\(([^)]+)\\)`, 'i'),
        ];

        for (const pattern of patterns) {
          const match = log.match(pattern);
          if (match && match[1]) {
            return match[1].trim();
          }
        }
      }

      // If no name/type found, try to extract from node_id
      if (nodeExecution.node_id) {
        // Check if it's a UUID format and try to find a meaningful name
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(nodeExecution.node_id)) {
          return 'Workflow Node';
        } else {
          // For non-UUID node_ids, use the first part
          const parts = nodeExecution.node_id.split('-');
          return parts[0] || 'Node';
        }
      }

      return 'Unknown Node';
    };

    const formatTime = (timestamp) => {
      if (!timestamp) return '-';
      return new Date(timestamp).toLocaleTimeString();
    };

    const getDataSize = (data) => {
      if (!data) return '0 bytes';
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      const bytes = new Blob([str]).size;
      if (bytes < 1024) return `${bytes} bytes`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatJSON = (data) => {
      if (!data) return '';
      if (typeof data === 'string') return data;
      try {
        return JSON.stringify(data, null, 2);
      } catch (e) {
        return String(data);
      }
    };

    // Deduplicate node executions and add missing nodes from execution log
    const getUniqueNodeExecutions = (nodeExecutions) => {
      if (!nodeExecutions || !Array.isArray(nodeExecutions)) {
        nodeExecutions = [];
      }

      // First, extract nodes from execution log that might be missing from nodeExecutions
      const logNodes = [];
      if (selectedExecution.value && selectedExecution.value.log) {
        const log = selectedExecution.value.log;
        const executingNodePattern = /Executing node:\s*([a-f0-9-]{36})\s*\(([^)]+)\)/gi;
        let match;

        while ((match = executingNodePattern.exec(log)) !== null) {
          const [, nodeId, nodeName] = match;
          const nodeIdShort = nodeId.substring(0, 8);

          // Check if this node is already in nodeExecutions
          const existsInExecutions = nodeExecutions.some((ne) => ne.node_id && ne.node_id.substring(0, 8) === nodeIdShort);

          if (!existsInExecutions) {
            // Create a synthetic node execution entry
            logNodes.push({
              id: `synthetic-${nodeId}`,
              node_id: nodeId,
              status: 'completed', // Assume completed since it's in the log
              start_time: null,
              end_time: null,
              credits_used: 0,
              input: null,
              output: null,
              error: null,
              _synthetic: true, // Mark as synthetic
              _logName: nodeName, // Store the name from log
            });
          }
        }
      }

      // Combine real executions with synthetic ones
      const allExecutions = [...nodeExecutions, ...logNodes];
      const nodeMap = new Map();

      allExecutions.forEach((nodeExecution) => {
        const nodeIdShort = nodeExecution.node_id ? nodeExecution.node_id.substring(0, 8) : 'unknown';

        // If we haven't seen this node ID before, add it
        if (!nodeMap.has(nodeIdShort)) {
          nodeMap.set(nodeIdShort, nodeExecution);
        } else {
          // If we have seen this node ID, keep the one with the better name
          const existing = nodeMap.get(nodeIdShort);
          const existingName = getNodeType(existing);
          const currentName = getNodeType(nodeExecution);

          // Prefer real executions over synthetic ones
          if (existing._synthetic && !nodeExecution._synthetic) {
            nodeMap.set(nodeIdShort, nodeExecution);
            return;
          } else if (!existing._synthetic && nodeExecution._synthetic) {
            return; // Keep the real execution
          }

          // Prefer executions with longer, more descriptive names
          // Also prefer executions that are not just the short node ID
          const existingIsGeneric = existingName === 'Workflow Node' || existingName === nodeIdShort || existingName.length <= 8;
          const currentIsGeneric = currentName === 'Workflow Node' || currentName === nodeIdShort || currentName.length <= 8;

          if (currentIsGeneric && !existingIsGeneric) {
            // Keep existing (it's better)
            return;
          } else if (!currentIsGeneric && existingIsGeneric) {
            // Replace with current (it's better)
            nodeMap.set(nodeIdShort, nodeExecution);
          } else if (currentName.length > existingName.length) {
            // Replace with current (longer name is usually better)
            nodeMap.set(nodeIdShort, nodeExecution);
          }
          // Otherwise keep existing
        }
      });

      // Return the deduplicated executions in their original order (real first, then synthetic)
      const uniqueNodeIds = new Set();
      return allExecutions.filter((nodeExecution) => {
        const nodeIdShort = nodeExecution.node_id ? nodeExecution.node_id.substring(0, 8) : 'unknown';
        if (uniqueNodeIds.has(nodeIdShort)) {
          return false;
        }
        // Only include if this is the selected execution for this node ID
        const selectedExecution = nodeMap.get(nodeIdShort);
        if (selectedExecution === nodeExecution) {
          uniqueNodeIds.add(nodeIdShort);
          return true;
        }
        return false;
      });
    };

    const handleSearch = (query) => {
      searchQuery.value = query;
    };

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    const selectTab = (tabId) => {
      activeTab.value = tabId;
      currentFilter.value = tabId; // Sync the filter with the tab
      selectedExecutionId.value = null;
      selectedExecution.value = null;
      resetDisplayLimit(); // Reset limit when changing tabs
      const typeLabel = executionTypeFilter.value === 'all' ? '' : ` ${executionTypeFilter.value}`;
      addLine(`[Runs] Viewing ${tabId}${typeLabel} executions`, 'info');
    };

    const selectTypeFilter = (typeId) => {
      executionTypeFilter.value = typeId;
      selectedExecutionId.value = null;
      selectedExecution.value = null;
      resetDisplayLimit(); // Reset limit when changing type filter
      const statusLabel = activeTab.value === 'all' ? '' : ` ${activeTab.value}`;
      addLine(`[Runs] Viewing ${typeId}${statusLabel} executions`, 'info');
    };

    // Helper to determine if execution is a goal
    const isGoalExecution = (execution) => {
      return execution.isGoalExecution || execution.type === 'goal' || execution.id?.startsWith('goal-');
    };

    // Helper to determine if execution is an agent/orchestrator execution
    const isAgentExecution = (execution) => {
      return execution.isAgentExecution || execution.type === 'agent' || execution.id?.startsWith('agent-');
    };

    // Helper to get execution type icon
    const getExecutionTypeIcon = (execution) => {
      if (isAgentExecution(execution)) return 'fas fa-robot';
      if (isGoalExecution(execution)) return 'fas fa-bullseye';
      return 'fas fa-project-diagram';
    };

    // Helper to get execution type label
    const getExecutionTypeLabel = (execution) => {
      if (isAgentExecution(execution)) return 'Agent';
      if (isGoalExecution(execution)) return 'Goal';
      return 'Workflow';
    };

    // Status icon helper
    const getStatusIcon = (status) => {
      const icons = {
        running: 'fas fa-play',
        started: 'fas fa-play',
        executing: 'fas fa-play',
        completed: 'fas fa-check',
        validated: 'fas fa-check-circle',
        needs_review: 'fas fa-exclamation-triangle',
        failed: 'fas fa-times',
        error: 'fas fa-times',
        stopped: 'fas fa-stop',
        queued: 'fas fa-clock',
        planning: 'fas fa-lightbulb',
        paused: 'fas fa-pause',
      };
      return icons[status] || 'fas fa-question';
    };

    // Date formatting
    const formatDate = (dateString) => {
      if (!dateString) return '-';
      return new Date(dateString).toLocaleString();
    };

    // Duration calculation
    const calculateDuration = (execution) => {
      if (!execution.startTime) return '-';

      const start = new Date(execution.startTime);
      const end = execution.endTime ? new Date(execution.endTime) : new Date();
      const duration = end - start;

      if (duration < 1000) return '< 1s';
      if (duration < 60000) return `${Math.floor(duration / 1000)}s`;
      if (duration < 3600000) return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;

      const hours = Math.floor(duration / 3600000);
      const minutes = Math.floor((duration % 3600000) / 60000);
      return `${hours}h ${minutes}m`;
    };

    const calculateNodeDuration = (nodeExecution) => {
      if (!nodeExecution.start_time) return '-';

      const start = new Date(nodeExecution.start_time);
      const end = nodeExecution.end_time ? new Date(nodeExecution.end_time) : new Date();
      const duration = end - start;

      if (duration < 1000) return '< 1s';
      if (duration < 60000) return `${Math.floor(duration / 1000)}s`;

      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    };

    // Execution actions
    const stopExecution = async (execution) => {
      try {
        addLine(`Stopping execution ${execution.id}...`, 'info');
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/executions/${execution.id}/stop`, {
          method: 'POST',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        addLine(`Execution ${execution.id} stopped successfully.`, 'success');
        await refreshExecutions();
      } catch (error) {
        addLine(`Error stopping execution: ${error.message}`, 'error');
      }
    };

    const simpleModal = ref(null);

    const deleteExecution = async (execution) => {
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Execution?',
        message: `Are you sure you want to delete execution ${execution.id}?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      try {
        addLine(`Deleting execution ${execution.id}...`, 'info');
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/executions/${execution.id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        addLine(`Execution ${execution.id} deleted successfully.`, 'success');
        if (selectedExecutionId.value === execution.id) {
          selectedExecutionId.value = null;
          selectedExecution.value = null;
        }
        await refreshExecutions();
      } catch (error) {
        addLine(`Error deleting execution: ${error.message}`, 'error');
      }
    };

    const viewExecutionDetails = async (execution) => {
      try {
        addLine(`Loading detailed execution data for ${execution.id}...`, 'info');

        // Use the store action to fetch details (with caching)
        const detailedData = await store.dispatch('executionHistory/fetchExecutionDetails', execution.id);

        if (detailedData) {
          selectedExecution.value = detailedData;
          addLine(`Loaded details for ${detailedData.workflowName || 'execution'}`, 'info');

          // Update the right panel with detailed data
          baseScreenRef.value?.triggerPanelMethod('updateSelectedExecution', detailedData);
        } else {
          // Fallback to summary data
          selectedExecution.value = execution;
          baseScreenRef.value?.triggerPanelMethod('updateSelectedExecution', execution);
        }
      } catch (error) {
        console.error('Error fetching execution details:', error);
        addLine(`Error loading execution details: ${error.message}`, 'error');
        // Fallback to basic execution data if API call fails
        selectedExecution.value = execution;
        baseScreenRef.value?.triggerPanelMethod('updateSelectedExecution', execution);
      }
    };

    const copyExecutionDetails = () => {
      if (!selectedExecution.value) return;

      const execution = selectedExecution.value;
      const details = `
Execution Details:
ID: ${execution.id}
Workflow: ${execution.workflowName || 'Unnamed Workflow'}
Status: ${execution.status}
Start Time: ${formatDate(execution.startTime)}
End Time: ${execution.endTime ? formatDate(execution.endTime) : 'Still running'}
Duration: ${calculateDuration(execution)}
Credits Used: ${execution.creditsUsed || 0}

${
  execution.nodeExecutions && execution.nodeExecutions.length > 0
    ? `
Node Executions:
${execution.nodeExecutions
  .map(
    (node) => `
  Node ID: ${node.node_id}
  Status: ${node.status}
  Duration: ${calculateNodeDuration(node)}
  Credits: ${node.credits_used || 0}
`
  )
  .join('')}
`
    : ''
}

${
  execution.log
    ? `
Execution Log:
${execution.log}
`
    : ''
}
      `.trim();

      navigator.clipboard.writeText(details).then(() => {
        addLine('Execution details copied to clipboard', 'success');
      });
    };

    // Panel action handler
    const handlePanelAction = async (action, payload) => {
      console.log('Runs panel action:', action, payload);

      switch (action) {
        case 'category-filter-changed':
          // Handle the new SidebarCategories event structure
          if (payload.type === 'all-selected') {
            currentFilter.value = 'all';
            activeTab.value = 'all'; // Sync the tab with the category
            selectedWorkflow.value = '';
            addLine('[Runs] Showing all executions', 'info');
          } else if (payload.type === 'category-selected') {
            // Map the selected category to our filter system
            const category = payload.selectedCategory;
            if (category) {
              // Extract the status from the category (e.g., "Running" -> "running")
              const status = category.toLowerCase();
              currentFilter.value = status;
              activeTab.value = status; // Sync the tab with the category
              selectedWorkflow.value = '';
              addLine(`[Runs] Filter changed: ${status}`, 'info');
            }
          }
          selectedExecutionId.value = null;
          selectedExecution.value = null;
          break;
        case 'filter-changed':
          // Keep backward compatibility for old filter events
          currentFilter.value = payload.filter;
          activeTab.value = payload.filter; // Sync the tab with the filter
          selectedWorkflow.value = payload.workflow;
          selectedExecutionId.value = null;
          selectedExecution.value = null;
          addLine(`[Runs] Filter changed: ${payload.filter}${payload.workflow ? ` (${payload.workflow})` : ''}`, 'info');
          break;
        case 'refresh-executions':
          await refreshExecutions();
          break;
        case 'clear-completed':
          await clearCompletedExecutions();
          break;
        case 'navigate':
          emit('screen-change', payload);
          break;
        case 'edit-workflow':
          console.log('Runs: Handling edit workflow:', payload);
          emit('screen-change', 'WorkflowForgeScreen', { workflowId: payload });
          break;
        case 'update-execution-details':
          // This action is handled by the right panel directly
          break;
        case 'show-feedback':
          // Handle feedback messages from panels
          if (payload && payload.message) {
            const type = payload.type || 'info';
            addLine(payload.message, type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
          }
          break;
        default:
          console.warn('Unhandled panel action in Runs.vue:', action);
      }
    };

    const refreshExecutions = async () => {
      addLine('[Runs] Refreshing executions...', 'info');
      try {
        await store.dispatch('executionHistory/fetchExecutions', { forceRefresh: true });
        const executions = store.getters['executionHistory/getExecutions'];
        addLine(`[Runs] Found ${executions.length} executions.`, 'success');
      } catch (error) {
        addLine(`[Runs] Error refreshing executions: ${error.message}`, 'error');
      }
    };

    const clearCompletedExecutions = async () => {
      const confirmed = await simpleModal.value?.showModal({
        title: 'Clear Completed Executions?',
        message: 'Are you sure you want to clear all completed executions? This action cannot be undone.',
        confirmText: 'Clear All',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      try {
        addLine('[Runs] Clearing completed executions...', 'info');
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/executions/clear-completed`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        addLine('[Runs] Completed executions cleared successfully.', 'success');
        await refreshExecutions();
      } catch (error) {
        addLine(`[Runs] Error clearing completed executions: ${error.message}`, 'error');
      }
    };

    const handleUserInputSubmit = async (input) => {
      addLine(`> ${input}`, 'input');
      clearInput();

      const command = input.toLowerCase().trim();
      const [action, ...args] = command.split(' ');

      switch (action) {
        case 'list':
          addLine('Current executions:', 'info');
          filteredExecutions.value.forEach((exec) => {
            addLine(`${exec.id} - ${exec.workflowName || 'Unnamed'} (${exec.status})`, 'data');
          });
          break;
        case 'stop':
          if (args[0]) {
            const execution = allExecutions.value.find((e) => e.id === args[0]);
            if (execution) {
              await stopExecution(execution);
            } else {
              addLine(`Execution ${args[0]} not found.`, 'error');
            }
          } else {
            addLine('Please provide an execution ID', 'error');
          }
          break;
        case 'refresh':
          await refreshExecutions();
          break;
        case 'clear':
          await clearCompletedExecutions();
          break;
        default:
          addLine('Unknown command. Available commands: list, stop <id>, refresh, clear', 'error');
      }
    };

    const { tutorialConfig, startTutorial, onTutorialClose, initializeRunsTutorial } = useRunsTutorial();

    const initializeScreen = () => {
      terminalLines.value = [];
      addLine('Loading execution history...', 'info');

      document.body.setAttribute('data-page', 'terminal-runs');

      // Show cached data immediately if available
      const cachedExecutions = store.getters['executionHistory/getExecutions'];
      if (cachedExecutions && cachedExecutions.length > 0) {
        const runningCount = cachedExecutions.filter((e) => e.status === 'running' || e.status === 'started').length;
        addLine(`Loaded ${cachedExecutions.length} executions from cache${runningCount > 0 ? ` (${runningCount} running)` : ''}.`, 'success');
      }

      // Non-blocking background refresh
      refreshExecutions().then(() => {
        const executions = store.getters['executionHistory/getExecutions'];
        if (!cachedExecutions || cachedExecutions.length === 0) {
          if (executions.length === 0) {
            addLine('No executions found. Run some workflows to see execution history.', 'info');
          } else {
            const runningCount = executions.filter((e) => e.status === 'running' || e.status === 'started').length;
            addLine(`Found ${executions.length} executions${runningCount > 0 ? ` (${runningCount} running)` : ''}.`, 'success');
          }
        }
      }).catch((error) => {
        addLine(`Error loading executions: ${error.message}`, 'error');
      });

      // Set up polling for running executions
      const startPolling = () => {
        if (pollingInterval) return;
        pollingInterval = setInterval(() => {
          if (document.hidden) return;
          const runningExecutions = store.getters['executionHistory/getExecutions'].filter((e) => e.status === 'running' || e.status === 'started');
          if (runningExecutions.length > 0) {
            store.dispatch('executionHistory/fetchExecutions');
          }
        }, 10000); // Poll every 10 seconds
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
        initializeRunsTutorial();
      }, 2000);
    };

    onUnmounted(() => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    });

    return {
      simpleModal,
      baseScreenRef,
      terminalLines,
      handleUserInputSubmit,
      handlePanelAction,
      emit,
      initializeScreen,
      tabs,
      typeFilters,
      activeTab,
      executionTypeFilter,
      selectTab,
      selectTypeFilter,
      filteredExecutions,
      hasMoreExecutions,
      remainingExecutionsCount,
      loadMoreExecutions,
      loadAllExecutions,
      selectedExecutionId,
      selectedExecution,
      handleExecutionClick,
      handleExecutionDoubleClick,
      tableColumns,
      handleSearch,
      searchQuery,
      allExecutions,
      currentLayout,
      setLayout,
      currentFilter,
      getStatusIcon,
      formatDate,
      calculateDuration,
      calculateNodeDuration,
      stopExecution,
      deleteExecution,
      viewExecutionDetails,
      copyExecutionDetails,
      toggleNodeSection,
      isNodeSectionExpanded,
      getNodeType,
      formatTime,
      getDataSize,
      formatJSON,
      getUniqueNodeExecutions,
      isGoalExecution,
      isAgentExecution,
      getExecutionTypeIcon,
      getExecutionTypeLabel,
      tutorialConfig,
      startTutorial,
      onTutorialClose,
    };
  },
};
</script>

<style scoped>
.runs-screen-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.runs-panel {
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

.runs-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.runs-main-content {
  flex: 1;
  height: 100%;
  overflow-y: scroll !important;
  scrollbar-width: thin !important;
  display: flex;
  justify-content: center;
}

.runs-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.runs-main-content::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3) !important;
}

.runs-main-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.4) !important;
  border-radius: 4px;
}

.runs-main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.6) !important;
}

.runs-main-content > * {
  width: 100%;
  max-width: 1048px;
  margin-right: -10px;
}

.col-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.col-status.running,
.col-status.started,
.col-status.executing {
  color: var(--color-green);
}

.col-status.completed {
  color: var(--color-blue);
}

.col-status.validated {
  color: var(--color-green);
}

.col-status.needs_review {
  color: var(--color-yellow);
}

.col-status.failed,
.col-status.error {
  color: var(--color-red);
}

.col-status.stopped {
  color: var(--color-grey);
}

.col-status.queued {
  color: var(--color-yellow);
}

.workflow-name {
  font-weight: 500;
  color: var(--color-text);
}

/* Execution Details Modal */
.execution-details-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.modal-header h3 {
  margin: 0;
  color: var(--color-green);
  font-size: 1.2em;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-light-green);
  font-size: 1.2em;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.detail-section {
  margin-bottom: 24px;
}

.detail-section h4 {
  color: var(--color-green);
  margin: 0 0 12px 0;
  font-size: 1.1em;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
  padding-bottom: 4px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-item label {
  color: var(--color-grey);
  font-size: 0.9em;
  font-weight: 600;
}

.detail-item span {
  color: var(--color-text);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.9em;
  font-weight: 500;
}

.status-badge.running,
.status-badge.started {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.status-badge.completed {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.status-badge.failed,
.status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.status-badge.stopped {
  background: rgba(156, 163, 175, 0.2);
  color: var(--color-grey);
}

.node-executions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.node-execution {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 12px;
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.node-id {
  font-weight: 600;
  color: var(--color-text);
}

.node-status {
  padding: 2px 6px;
  border-radius: 8px;
  font-size: 0.8em;
  font-weight: 500;
}

.node-status.running,
.node-status.started {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.node-status.completed {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-text-muted);
}

.node-status.failed,
.node-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.node-details {
  display: flex;
  gap: 16px;
  font-size: 0.9em;
  color: var(--color-grey);
}

.execution-log {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 12px;
  font-size: 0.9em;
  color: var(--color-text);
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--terminal-border-color);
}

.copy-btn,
.close-modal-btn {
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.copy-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
}

.copy-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
}

.close-modal-btn {
  background: rgba(156, 163, 175, 0.1);
  border: 1px solid rgba(156, 163, 175, 0.3);
  color: var(--color-grey);
}

.close-modal-btn:hover {
  background: rgba(156, 163, 175, 0.2);
  border-color: rgba(156, 163, 175, 0.5);
}

.copy-btn i {
  margin-right: 6px;
}

/* Enhanced Execution Chain Styles */
.execution-chain {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 600px;
  overflow-y: auto;
  padding: 8px 0;
}

.chain-node {
  display: flex;
  gap: 16px;
  position: relative;
}

.chain-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(var(--green-rgb), 0.2);
  border: 2px solid var(--color-green);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9em;
  color: var(--color-text);
  z-index: 2;
}

.step-connector {
  width: 2px;
  height: 40px;
  background: linear-gradient(to bottom, var(--color-green), rgba(var(--green-rgb), 0.3));
  margin-top: 8px;
  z-index: 1;
}

.node-card {
  flex: 1;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

.node-card:hover {
  background: rgba(0, 0, 0, 0.3);
  border-color: rgba(var(--green-rgb), 0.3);
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 12px;
}

.node-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.node-id {
  font-weight: 600;
  color: var(--color-text);
  font-size: 1em;
}

.node-type {
  font-size: 0.85em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.node-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
  flex-shrink: 0;
}

.node-status.running,
.node-status.started {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.node-status.completed {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.node-status.failed,
.node-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.node-timing {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  font-size: 0.9em;
  color: var(--color-grey);
  flex-wrap: wrap;
}

.node-timing span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.node-io-section {
  margin-top: 12px;
  border: 1px solid rgba(var(--green-rgb), 0.1);
  border-radius: 6px;
  overflow: hidden;
}

.node-io-section.error-section {
  border-color: rgba(239, 68, 68, 0.3);
}

.io-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(var(--green-rgb), 0.05);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.error-section .io-header {
  background: rgba(239, 68, 68, 0.1);
}

.io-header:hover {
  background: rgba(var(--green-rgb), 0.1);
}

.error-section .io-header:hover {
  background: rgba(239, 68, 68, 0.15);
}

.io-header i {
  font-size: 0.8em;
  color: var(--color-primary);
  transition: transform 0.2s ease;
}

.error-section .io-header i {
  color: var(--color-red);
}

.io-header i.rotated {
  transform: rotate(90deg);
}

.io-header span:first-of-type {
  font-weight: 600;
  color: var(--color-text);
}

.error-section .io-header span:first-of-type {
  color: var(--color-red);
}

.io-size {
  font-size: 0.8em;
  color: var(--color-grey);
  margin-left: auto;
}

.io-content {
  padding: 0;
  border-top: 1px solid rgba(var(--green-rgb), 0.1);
}

.error-section .io-content {
  border-top-color: rgba(239, 68, 68, 0.2);
}

.io-data,
.error-data {
  background: var(--color-darker-2);
  padding: 12px;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--font-family-mono);
  line-height: 1.4;
  border: none;
  width: 100%;
  border-radius: 0;
}

.error-data {
  color: var(--color-red);
  background: rgba(239, 68, 68, 0.05);
}

.io-data::-webkit-scrollbar,
.error-data::-webkit-scrollbar {
  width: 4px;
}

.io-data::-webkit-scrollbar-track,
.error-data::-webkit-scrollbar-track {
  background: var(--color-darker-0);
}

.io-data::-webkit-scrollbar-thumb {
  background: rgba(var(--green-rgb), 0.3);
  border-radius: 2px;
}

.error-data::-webkit-scrollbar-thumb {
  background: rgba(239, 68, 68, 0.3);
  border-radius: 2px;
}

/* Grid View Styles */
.executions-grid-container {
  width: 100%;
  padding: 0;
}

.card-view-search-bar,
.table-view-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.table-view-search-bar {
  padding: 0 0 8px 0;
  border-bottom: 1px solid var(--terminal-border-color);
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
  border-color: rgba(var(--green-rgb), 0.5);
}

.table-view-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.executions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  width: calc(100% - 5px);
}

.execution-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.execution-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
  /* transform: translateY(-1px); */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.execution-card.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-blue);
}

.execution-card.running,
.execution-card.started,
.execution-card.executing {
  border-left: 3px solid var(--color-blue);
}

.execution-card.completed {
  border-left: 3px solid var(--color-green);
}

.execution-card.validated {
  border-left: 3px solid var(--color-green);
}

.execution-card.needs_review {
  border-left: 3px solid var(--color-yellow);
}

.execution-card.failed,
.execution-card.error {
  border-left: 3px solid var(--color-red);
}

.execution-card.stopped {
  border-left: 3px solid var(--color-text-muted);
}

.execution-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  gap: 8px;
}

.execution-title-section {
  flex: 1;
  min-width: 0;
}

.execution-card .execution-title {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 4px 0;
  line-height: 1.2;
}

.execution-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px 2px;
  border-radius: 8px;
  font-size: 0.7em;
  font-weight: 500;
  text-transform: uppercase;
}

.execution-status.running,
.execution-status.started,
.execution-status.executing {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.execution-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.execution-status.validated {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.execution-status.needs_review {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.execution-status.failed,
.execution-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.execution-status.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.execution-status.queued {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.execution-actions {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.action-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 0.75em;
}

.stop-btn {
  background: rgba(156, 163, 175, 0.2);
  color: var(--color-grey);
}

.stop-btn:hover {
  background: rgba(156, 163, 175, 0.3);
}

.delete-btn {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.3);
}

.execution-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75em;
}

.info-label {
  color: var(--color-text-muted);
  font-weight: 500;
}

.info-value {
  color: var(--color-text);
}

.node-count {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 6px;
  font-size: 0.75em;
  color: var(--color-green);
  width: fit-content;
}

.node-count i {
  font-size: 0.9em;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: var(--color-text-muted);
  grid-column: 1 / -1;
}

.empty-icon {
  font-size: 3em;
  color: rgba(127, 129, 147, 0.3);
  margin-bottom: 16px;
}

.empty-state h3 {
  color: var(--color-text);
  margin: 0 0 12px 0;
  font-size: 1.2em;
}

.empty-state p {
  margin: 0;
  line-height: 1.5;
  max-width: 400px;
}

/* Execution Type Badge Styles */
.workflow-name-container {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.execution-type-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 8px 3px;
  border-radius: 8px;
  font-size: 0.7em;
  font-weight: 500;
  text-transform: uppercase;
  flex-shrink: 0;
  background: rgba(127, 129, 147, 0.15);
  color: var(--color-text-muted);
  /* height: 20px; */
  line-height: 1;
}

.execution-type-badge i {
  font-size: 1em;
}

.execution-type-badge.agent-badge {
  background: rgba(147, 51, 234, 0.15);
  color: rgb(167, 139, 250);
}

.execution-type-badge.goal-badge {
  background: rgba(239, 68, 68, 0.15);
  color: rgb(248, 113, 113);
}

.execution-type-badge.workflow-badge {
  background: rgba(59, 130, 246, 0.15);
  color: rgb(96, 165, 250);
}

.status-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Load More Buttons */
.load-more-container {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 16px 0;
  margin-top: 8px;
}

.load-more-btn,
.load-all-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.load-more-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
}

.load-more-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
  transform: translateY(-1px);
}

.load-all-btn {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: var(--color-blue);
}

.load-all-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
  transform: translateY(-1px);
}

.load-more-btn i,
.load-all-btn i {
  font-size: 0.9em;
}

/* Type Filter Bar */
.type-filter-bar {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.type-filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text-muted);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.type-filter-btn:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.3);
  color: var(--color-text);
}

.type-filter-btn.active {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
  color: var(--color-green);
}

.type-filter-btn i {
  font-size: 0.9em;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .card-view-search-bar,
  .table-view-search-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .type-filter-bar {
    width: 100%;
    justify-content: space-between;
  }

  .type-filter-btn {
    flex: 1;
    justify-content: center;
    padding: 6px 8px;
    font-size: 0.8em;
  }

  .execution-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .execution-actions {
    align-self: flex-end;
  }

  .chain-node {
    gap: 12px;
  }

  .node-card {
    padding: 12px;
  }

  .node-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .node-timing {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
