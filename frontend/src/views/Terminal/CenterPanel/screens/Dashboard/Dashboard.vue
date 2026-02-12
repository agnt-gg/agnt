<template>
  <BaseScreen
    ref="baseScreenRef"
    activeRightPanel="DashboardPanel"
    :panelProps="{
      missionId: selectedMissionId,
      showChart: true,
    }"
    screenId="DashboardScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => handleScreenChange(screenName)"
    @base-mounted="initializeScreen"
  >
    <!-- Default slot content: Main content for the Dashboard -->
    <template #default>
      <div class="dashboard-content">
        <div class="dashboard-inner-content">
          <!-- Loading skeleton while critical data loads -->
          <template v-if="!dataReady">
            <div class="dashboard-loading">
              <div class="skeleton-block" style="height: 120px; width: 100%; border-radius: 8px;"></div>
              <div class="skeleton-block" style="height: 36px; width: 100%; border-radius: 6px;"></div>
              <div class="dashboard-grid">
                <div class="grid-row top-row">
                  <div class="skeleton-block" style="height: 250px; border-radius: 8px;"></div>
                  <div class="skeleton-block" style="height: 250px; border-radius: 8px;"></div>
                  <div class="skeleton-block" style="height: 250px; border-radius: 8px;"></div>
                </div>
                <div class="grid-row middle-row">
                  <div class="skeleton-block" style="height: 200px; border-radius: 8px;"></div>
                  <div class="skeleton-block" style="height: 200px; border-radius: 8px;"></div>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
          <!-- <TerminalHeader title="AGNT BIRDS-EYE TERMINAL" subtitle="Time: 17:04 CDT | Mode: LIVE | License: ACTIVE | Uptime: 3d 14h 22m" /> -->

          <!-- Cumulative Credits Usage Chart - Full Width -->
          <CumulativeCreditsChart class="fade-in" />

          <!-- Global Pulse Ribbon -->
          <GlobalPulseRibbon
            class="fade-in"
            :agntScoreData="agntScoreData"
            :goalsData="goalsData"
            :agentsData="agentsData"
            :workflowsData="workflowsData"
            :toolsData="toolsData"
            :runsData="runsData"
            :integrationsData="integrationsData"
            :statusData="statusData"
          />

          <!-- Main Dashboard Grid -->
          <div class="dashboard-grid fade-in" style="animation-delay: 0.05s;">
            <!-- Top Row -->
            <div class="grid-row top-row fade-in-stagger">
              <GoalsMap :goalsData="goalsMapData" @navigate="handleScreenChange" />
              <AgentsSwarm :agentsData="agentsSwarmData" @navigate="handleScreenChange" />
              <WorkflowPipelines :pipelineData="pipelineData" @navigate="handleScreenChange" />
            </div>

            <!-- Middle Row -->
            <div class="grid-row middle-row fade-in-stagger">
              <ToolsInventory :toolsData="toolsInventoryData" />
              <RunsQueue :runsData="runsQueueData" />
            </div>

            <!-- Bottom Row -->
            <!-- <div class="grid-row bottom-row">
              <StatusIncidents :incidentsData="incidentsData" />
              <BaseDashboardCard title="CAPACITY & COST">
                <div class="capacity-metrics">
                  <p>CPU: 74% | GPU: 41% | RAM: 88%</p>
                  <p>Spend Today: $184 | MTD: $3,820</p>
                </div>
              </BaseDashboardCard>
            </div> -->
          </div>

          <!-- Mission Details Component -->
          <MissionDetails
            v-if="selectedMissionId && selectedMission"
            :mission="selectedMission"
            @close="selectedMissionId = null"
            @log-message="handleLogMessage"
            ref="missionDetailsRef"
          />

          <!-- <div ref="scrollAnchorRef" class="scroll-anchor"></div> -->
          </template>
        </div>
      </div>
    </template>
  </BaseScreen>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="dashboard" @close="onTutorialClose" />
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, computed, inject } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import StatsCards from './components/StatsCards.vue';
import ChartCard from './components/ChartCard.vue';
import MissionDetails from './components/MissionDetails.vue';
import AgentActivity from './components/AgentActivity.vue';
import GlobalPulseRibbon from './components/GlobalPulseRibbon.vue';
import GoalsMap from './components/GoalsMap.vue';
import AgentsSwarm from './components/AgentsSwarm.vue';
import WorkflowPipelines from './components/WorkflowPipelines.vue';
import ToolsInventory from './components/ToolsInventory.vue';
import RunsQueue from './components/RunsQueue.vue';
import StatusIncidents from './components/StatusIncidents.vue';
import BaseDashboardCard from './components/BaseDashboardCard.vue';
import CumulativeCreditsChart from './components/CumulativeCreditsChart.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import { useDashboardTutorial } from './useDashboardTutorial.js';

export default {
  name: 'DashboardScreen',
  components: {
    BaseScreen,
    TerminalHeader,
    StatsCards,
    ChartCard,
    MissionDetails,
    AgentActivity,
    GlobalPulseRibbon,
    GoalsMap,
    AgentsSwarm,
    WorkflowPipelines,
    ToolsInventory,
    RunsQueue,
    StatusIncidents,
    BaseDashboardCard,
    CumulativeCreditsChart,
    PopupTutorial,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const baseScreenRef = ref(null);
    const selectedMissionId = ref(null);
    const terminalLines = ref([]);
    const missionDetailsRef = ref(null);
    const scrollAnchorRef = ref(null);

    // Add proper emit handling for screen change
    const handleScreenChange = (screenName) => {
      emit('screen-change', screenName);
    };

    // Add this computed property
    const selectedMission = computed(() => {
      if (!selectedMissionId.value) return null;
      return store.getters['missions/getMissionById'](selectedMissionId.value);
    });

    const playSound = inject('playSound');

    // Add click handler with sound
    const handleClickWithSound = (callback) => {
      return (...args) => {
        playSound('typewriterKeyPress');
        callback(...args);
      };
    };

    // Data readiness - show skeleton until critical data has arrived
    const dataReady = computed(() => {
      const hasAgents = store.getters['agents/allAgents']?.length > 0 || store.getters.criticalDataReady;
      return hasAgents;
    });

    // --- Computed properties for dashboard data ---
    const tokenActivity = computed(() => store.getters['userStats/tokenActivity']);
    const isLoading = computed(() => store.getters['userStats/isActivityLoading']);
    const performanceData = computed(() => ({
      missedTokens: store.getters['userStats/missedTokensYesterday'] || 0,
      roiPercentage: store.getters['userStats/roiPercentage'] || 0,
    }));

    // New Stats Cards Data (Placeholders)
    const activeAgentsData = computed(() => {
      // Placeholder: Replace with actual logic from store
      return { total: 5, busy: 3, idle: 2 };
    });

    const tokensEarnedThisSessionData = computed(() => {
      // Placeholder: Replace with actual logic from store
      return store.getters['userStats/sessionDeltaTokens'] || 12345; // Example getter
    });

    const territoryControlledData = computed(() => {
      // Placeholder: Replace with actual logic from store
      return '75%'; // Or a descriptive string like "High"
    });

    const missionSuccessRateData = computed(() => {
      // Placeholder: Replace with actual logic from store
      const recentMissions = store.getters['missions/recentMissions'] || []; // Example getter
      if (recentMissions.length === 0) return 0;
      const successfulMissions = recentMissions.filter((m) => m.status === 'completed').length;
      return Math.round((successfulMissions / recentMissions.length) * 100);
    });

    // --- New Dashboard Component Data ---
    const goalsData = computed(() => {
      const activeGoals = store.getters['goals/activeGoals'] || [];
      const completedGoals = store.getters['goals/completedGoals'] || [];
      return { active: activeGoals.length, done: completedGoals.length };
    });

    const agentsData = computed(() => {
      const allAgents = store.getters['agents/allAgents'] || [];
      const activeAgents = allAgents.filter((agent) => agent.status === 'ACTIVE');
      return { active: activeAgents.length, total: allAgents.length };
    });

    const workflowsData = computed(() => {
      const allWorkflows = store.getters['workflows/allWorkflows'] || [];
      const activeWorkflows = allWorkflows.filter((w) => w.status === 'running' || w.status === 'listening');
      const completedWorkflows = allWorkflows.filter((w) => w.status === 'completed' || w.status === 'stopped');
      const failedWorkflows = allWorkflows.filter((w) => w.status === 'error' || w.status === 'insufficient-credits');
      const queuedWorkflows = allWorkflows.filter((w) => w.status === 'queued');

      return {
        count: allWorkflows.length,
        active: activeWorkflows.length,
        completed: completedWorkflows.length,
        failed: failedWorkflows.length,
        queued: queuedWorkflows.length,
        inactive: allWorkflows.length - activeWorkflows.length,
        running: allWorkflows.filter((w) => w.status === 'running').length,
        listening: allWorkflows.filter((w) => w.status === 'listening').length,
      };
    });
    const toolsData = computed(() => {
      const allTools = store.getters['tools/allTools'] || [];
      return { count: allTools.length };
    });

    const runsData = computed(() => {
      const executions = store.getters['executionHistory/getExecutions'] || [];
      const activeWorkflows = store.getters['workflows/activeWorkflows'] || [];
      const executingGoals = store.getters['goals/activeGoals'] || [];

      // Count actual queued runs (active workflows + executing goals)
      const queued = activeWorkflows.length + executingGoals.length;

      // Count actual executions in the last 24 hours
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const dailyRuns = executions.filter((exec) => {
        if (!exec.startTime) return false;
        const startTime = new Date(exec.startTime);
        return startTime >= twentyFourHoursAgo;
      }).length;

      return {
        queued,
        daily: dailyRuns,
      };
    });

    const integrationsData = computed(() => {
      const connectionHealth = store.getters['appAuth/providerHealthDetails'] || [];
      return { count: connectionHealth.length };
    });

    const statusData = computed(() => {
      const healthStatus = store.getters['appAuth/connectionHealthStatus'] || 'unknown';
      const healthyCount = store.getters['appAuth/healthyConnectionsCount'] || 0;
      const totalCount = store.getters['appAuth/totalConnectionsCount'] || 0;
      const slaPercentage = totalCount > 0 ? Math.round((healthyCount / totalCount) * 100 * 0.01 * 100) / 100 : 99.5;

      return {
        health:
          healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'degraded' ? 'Degraded' : healthStatus === 'unhealthy' ? 'Critical' : 'Unknown',
        sla: slaPercentage,
        latency: Math.floor(Math.random() * 200) + 300, // Simulated latency 300-500ms
        cost: Math.floor(Math.random() * 100) + 50, // Simulated daily cost $50-150
      };
    });

    // --- $AGNT Score - Read directly from state (calculated ONCE after all data loads) ---
    const agntScoreData = computed(() => store.state.userStats.agntScore);

    const goalsMapData = computed(() => {
      const allGoals = store.getters['goals/allGoals'] || [];
      return allGoals.map((goal) => ({
        id: goal.id,
        title: goal.title || goal.name || `Goal ${goal.id}`,
        progress: store.getters['goals/getGoalProgress'](goal) || 0,
      }));
    });

    const agentsSwarmData = computed(() => {
      const allAgents = store.getters['agents/allAgents'] || [];
      return allAgents.map((agent) => {
        const isActive = agent.status === 'ACTIVE';
        const tasksCompleted = agent.tasksCompleted || 0;

        return {
          id: agent.id,
          role: agent.class || 'worker',
          name: agent.name,
          status: isActive ? 'active' : 'idle',
          statusIcon: isActive ? '🟢' : '🟡',
          statusText: isActive ? `${tasksCompleted} tasks` : 'idle',
          statusClass: isActive ? 'status-active' : 'status-idle',
        };
      });
    });

    const pipelineData = computed(() => {
      // Use ONLY the actual store getters that exist
      const allWorkflows = store.getters['workflows/allWorkflows'] || [];
      const activeWorkflows = store.getters['workflows/activeWorkflows'] || [];

      // Simple heat block generation - show EXACTLY what we have
      const generateHeatBlocks = (count, maxBlocks = 8) => {
        const blocks = [];
        const actualCount = Math.min(count, maxBlocks);

        // Show actual count as high heat
        for (let i = 0; i < actualCount; i++) {
          blocks.push({ char: '▓', class: 'heat-high' });
        }
        // Fill remaining with low heat
        for (let i = actualCount; i < maxBlocks; i++) {
          blocks.push({ char: '░', class: 'heat-low' });
        }
        return blocks;
      };

      // Count workflows by actual status
      const runningWorkflows = allWorkflows.filter((w) => w.status === 'running');
      const listeningWorkflows = allWorkflows.filter((w) => w.status === 'listening');
      const completedWorkflows = allWorkflows.filter((w) => w.status === 'completed' || w.status === 'stopped');
      const errorWorkflows = allWorkflows.filter((w) => w.status === 'error');
      const queuedWorkflows = allWorkflows.filter((w) => w.status === 'queued');

      const pipeline = [
        {
          name: 'Queue',
          heatBlocks: generateHeatBlocks(queuedWorkflows.length, 6),
        },
        {
          name: 'Exec',
          heatBlocks: generateHeatBlocks(runningWorkflows.length + listeningWorkflows.length, 8),
        },
        {
          name: 'Retry',
          heatBlocks: generateHeatBlocks(0, 4), // No retry data available
        },
        {
          name: 'Done',
          heatBlocks: generateHeatBlocks(completedWorkflows.length, 10),
        },
        {
          name: 'Fail',
          heatBlocks: generateHeatBlocks(errorWorkflows.length, 3),
        },
      ];

      return pipeline;
    });

    const toolsInventoryData = computed(() => {
      const allTools = store.getters['tools/allTools'] || [];

      // Group tools by category and create inventory structure
      const categoryMap = new Map();

      allTools.forEach((tool) => {
        const category = tool.category || 'Uncategorized';
        if (!categoryMap.has(category)) {
          categoryMap.set(category, []);
        }

        // Include the tool's icon for display
        categoryMap.get(category).push({
          name: tool.title || tool.name || tool.id,
          icon: tool.icon || null,
          status: 'healthy',
          statusIcon: '🟢',
          statusClass: 'status-healthy',
        });
      });

      // Convert to array format and limit to top categories
      const result = [];
      for (const [categoryName, tools] of categoryMap.entries()) {
        if (result.length >= 6) break; // Limit to 6 categories for display

        result.push({
          name: categoryName === 'custom' ? 'Custom' : categoryName.replace(/^\d+\s*-\s*/, ''), // Capitalize 'custom' and remove numbering prefix
          tools: tools.slice(0, 6), // Limit tools per category
        });
      }

      return result;
    });

    const runsQueueData = computed(() => {
      const executions = store.getters['executionHistory/getExecutions'] || [];
      const activeWorkflows = store.getters['workflows/activeWorkflows'] || [];
      const executingGoals = store.getters['goals/activeGoals'] || [];
      const allWorkflows = store.getters['workflows/allWorkflows'] || [];
      const allGoals = store.getters['goals/allGoals'] || [];

      const running = activeWorkflows.length + executingGoals.length;
      const queued = running; // Actual queued count

      // Count completed runs
      const completedWorkflows = allWorkflows.filter((w) => w.status === 'completed' || w.status === 'stopped').length;
      const completedGoals = allGoals.filter((g) => g.status === 'completed' || g.status === 'validated').length;
      const completed = completedWorkflows + completedGoals;

      // Count failed runs
      const failedWorkflows = allWorkflows.filter((w) => w.status === 'error' || w.status === 'insufficient-credits').length;
      const failedGoals = allGoals.filter((g) => g.status === 'failed').length;
      const failed = failedWorkflows + failedGoals;

      // Calculate real average latency from execution history (in seconds)
      const completedExecutions = executions.filter((exec) => exec.startTime && exec.endTime);
      let avgLatency = 0;
      if (completedExecutions.length > 0) {
        const latencies = completedExecutions.map((exec) => {
          const start = new Date(exec.startTime);
          const end = new Date(exec.endTime);
          return end - start; // milliseconds
        });
        const avgMs = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
        avgLatency = Math.round(avgMs / 1000); // Convert to seconds
      }

      // Count executions BY DURATION RANGES (non-overlapping buckets in seconds)
      const getExecutionsByDurationRange = (minSeconds, maxSeconds = null) => {
        return executions.filter((exec) => {
          if (!exec.startTime || !exec.endTime) return false;
          const start = new Date(exec.startTime);
          const end = new Date(exec.endTime);
          const durationMs = end - start;
          const durationSeconds = durationMs / 1000;

          // If maxSeconds is null, count everything >= minSeconds (for the last bucket)
          if (maxSeconds === null) {
            return durationSeconds >= minSeconds;
          }

          return durationSeconds >= minSeconds && durationSeconds < maxSeconds;
        }).length;
      };

      return {
        queued,
        running,
        completed,
        failed,
        latencyP95: avgLatency,
        throughput: {
          lessThanFive: getExecutionsByDurationRange(0, 5), // <5s
          fiveToFifteen: getExecutionsByDurationRange(5, 15), // 5-15s
          fifteenToThirty: getExecutionsByDurationRange(15, 30), // 15-30s
          thirtyToSixty: getExecutionsByDurationRange(30, 60), // 30-60s
          sixtyPlus: getExecutionsByDurationRange(60, null), // 60s+
        },
      };
    });

    const incidentsData = computed(() => {
      const connectionHealth = store.getters['appAuth/providerHealthDetails'] || [];
      const healthyCount = store.getters['appAuth/healthyConnectionsCount'] || 0;
      const totalCount = store.getters['appAuth/totalConnectionsCount'] || 0;

      // Generate incidents based on connection health
      const incidents = [];
      let openIncidents = 0;

      connectionHealth.forEach((provider, index) => {
        if (provider.status === 'unhealthy' || provider.status === 'error') {
          incidents.push({
            id: `INC-${Date.now().toString().slice(-3)}${index}`,
            description: `${provider.provider} connection issue`,
            status: 'open',
            statusIcon: '⚠',
            statusClass: 'status-open',
          });
          openIncidents++;
        } else if (provider.status === 'degraded' || provider.status === 'warning') {
          incidents.push({
            id: `INC-${Date.now().toString().slice(-3)}${index}`,
            description: `${provider.provider} performance degraded`,
            status: 'monitoring',
            statusIcon: '👁',
            statusClass: 'status-monitoring',
          });
        }
      });

      // Calculate real SLA based on actual connection health
      const slaBase = totalCount > 0 ? (healthyCount / totalCount) * 100 : 100;

      return {
        open: openIncidents,
        pastDay: incidents.length,
        incidents: incidents.slice(0, 5), // Show max 5 incidents
        slo: {
          api: slaBase,
          runs: slaBase,
          ux: slaBase,
        },
      };
    });

    // --- Input Handling ---
    const handleUserInputSubmit = (input) => {
      // console.log('Dashboard received input:', input);
    };

    // --- Log Message Handling ---
    const handleLogMessage = (message) => {
      terminalLines.value.push(message);
      baseScreenRef.value?.scrollToBottom();
    };

    // --- Panel Interaction / Detail View ---
    const handleMissionSelected = (missionId) => {
      selectedMissionId.value = missionId;
      // If selecting a mission (not deselecting), scroll to details after DOM update
      if (missionId !== null) {
        nextTick(() => {
          scrollAnchorRef.value?.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
          });
        });
      }
    };

    const handlePanelAction = async (action, payload) => {
      switch (action) {
        case 'log-message':
          terminalLines.value.push(payload);
          break;
        case 'boost-purchased':
          await store.dispatch('userStats/fetchStats');
          terminalLines.value.push(`Purchased ${payload.multiplier} boost for ${payload.duration}`);
          break;
        case 'mission-selected':
          handleMissionSelected(payload);
          break;
        case 'refresh-dashboard':
          await initializeScreen();
          break;
        case 'edit-workflow':
          // Navigate to WorkflowForge screen with the workflow ID
          emit('screen-change', 'WorkflowForgeScreen', { workflowId: payload });
          break;
        default:
          console.log('Unhandled panel action:', action, payload);
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const { tutorialConfig, startTutorial, onTutorialClose, initializeDashboardTutorial } = useDashboardTutorial();

    // --- Initialization ---
    const initializeScreen = () => {
      terminalLines.value.push('Initializing Dashboard...');
      terminalLines.value.push('Dashboard Ready.');
      baseScreenRef.value?.scrollToBottom();

      // Non-blocking: health check runs in background
      if (store.getters['appAuth/needsHealthCheck']) {
        store.dispatch('appAuth/checkConnectionHealthStream').catch((error) => {
          console.error('Error checking connection health:', error);
        });
      }
    };

    // Set up periodic refresh for real-time data
    onMounted(() => {
      document.body.setAttribute('data-page', 'terminal-dashboard');
      initializeScreen();

      // Wait a couple seconds before showing the tutorial
      setTimeout(() => {
        initializeDashboardTutorial();
      }, 2000); // 2 seconds delay
    });

    onUnmounted(() => {
      document.body.removeAttribute('data-page');
      selectedMissionId.value = null;
    });

    return {
      baseScreenRef,
      terminalLines,
      selectedMissionId,
      selectedMission,
      dataReady,
      tokenActivity,
      isLoading,
      performanceData,
      activeAgentsData,
      tokensEarnedThisSessionData,
      territoryControlledData,
      missionSuccessRateData,
      // New dashboard data
      goalsData,
      agentsData,
      workflowsData,
      toolsData,
      runsData,
      integrationsData,
      statusData,
      goalsMapData,
      agentsSwarmData,
      pipelineData,
      toolsInventoryData,
      runsQueueData,
      incidentsData,
      agntScoreData,
      initializeScreen,
      handlePanelAction,
      handleUserInputSubmit,
      handleScreenChange,
      missionDetailsRef,
      scrollAnchorRef,
      handleLogMessage,
      tutorialConfig,
      startTutorial,
      onTutorialClose,
    };
  },
};
</script>

<style scoped>
/* Dashboard loading skeleton */
.dashboard-loading {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

/* Add dashboard-specific styles here */
.dashboard-content {
  width: 100%;
  flex: 1;
  overflow-y: auto;
  box-sizing: border-box;
  position: relative;
  overflow-x: hidden;
  scrollbar-width: thin;
}

/* New style for the inner padded container */
.dashboard-inner-content {
  display: flex;
  flex-direction: column;
  /* padding: 16px; */
  /* padding-right: 8px; */
  height: calc(100% - 2px);
  box-sizing: border-box;
  gap: 16px;
}

/* Remove margin from the last child */
.dashboard-inner-content > :last-child {
  margin-bottom: 0;
}

.terminal-line {
  line-height: 1.3;
  margin-bottom: 18px;
}

.log-line {
  opacity: 0.8;
  font-size: 0.9em;
}

.text-bright-green {
  color: var(--color-green);
  text-shadow: 0 0 5px rgba(25, 239, 131, 0.4);
}
.font-bold {
  font-weight: bold;
}
.text-xl {
  font-size: 1.25rem;
}

/* Remove margin from the last child */
.dashboard-inner-content > :last-child {
  margin-bottom: 0;
}

/* Activity and Missions Row */
.activity-missions-row {
  display: flex;
  flex-direction: row;
  gap: 16px;
  /* margin: 16px 0 0; */
  width: 100%;
  position: relative;
  overflow: visible !important;
}

/* Common clickable element styles */
.clickable {
  cursor: pointer;
  transition: all 0.2s ease;
}

.clickable:hover {
  filter: brightness(1.2);
}

.clickable:active {
  transform: scale(0.98);
}

/* Add style for the scroll anchor */
.scroll-anchor {
  height: 0px;
  width: 100%;
  pointer-events: none;
}

/* Dashboard Grid Layout */
.dashboard-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

.grid-row {
  display: grid;
  gap: 16px;
}

.top-row {
  grid-template-columns: 1fr 1fr 1fr;
  flex: 1;
  max-height: 326px;
}

.middle-row {
  grid-template-columns: 1fr 1fr;
}

.bottom-row {
  grid-template-columns: 1fr 1fr;
}

.capacity-metrics {
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
}

.capacity-metrics p {
  margin: 4px 0;
  color: var(--color-text);
  font-size: 0.9em;
}

/* Responsive adjustments */
@media (max-width: 1200px) {
  .top-row {
    grid-template-columns: 1fr 1fr;
  }

  .top-row > :nth-child(3) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 768px) {
  .top-row,
  .middle-row,
  .bottom-row {
    grid-template-columns: 1fr;
  }

  .dashboard-inner-content {
    padding: 12px;
    gap: 12px;
  }

  .grid-row {
    gap: 12px;
    min-height: 180px;
  }
}
</style>

<style>
body[data-page='terminal-dashboard'] .scrollable-content {
  padding: 0;
}
</style>
