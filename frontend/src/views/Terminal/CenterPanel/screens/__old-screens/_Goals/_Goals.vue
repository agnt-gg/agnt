<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="GoalsPanel"
    activeRightPanel="GoalsPanel"
    screenId="GoalsScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      goals: allGoals,
      activeTab,
      selectedGoal,
      currentFilter,
    }"
    :panelProps="{ selectedGoal }"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <!-- Goal Tabs -->
      <BaseTabControls
        :tabs="tabs"
        :active-tab="activeTab"
        :current-layout="currentLayout"
        :show-grid-toggle="true"
        :show-table-toggle="true"
        @select-tab="selectTab"
        @set-layout="setLayout"
      />

      <!-- Main Content -->
      <div class="goals-content">
        <main class="goals-main-content">
          <!-- Table View -->
          <BaseTable
            v-if="currentLayout === 'table'"
            :items="filteredGoals"
            :columns="tableColumns"
            :selected-id="selectedGoal?.id"
            :show-search="true"
            :show-sort-dropdown="false"
            :enable-column-sorting="true"
            :default-sort-column="'created_at'"
            :default-sort-direction="'desc'"
            search-placeholder="Search goals..."
            :search-keys="['title', 'description', 'status']"
            :no-results-text="'No goals found.'"
            :title-key="'title'"
            @row-click="handleGoalClick"
            @row-double-click="handleGoalDoubleClick"
            @search="handleSearch"
          >
            <template #status="{ item }">
              <div :class="['col-status', item.status.toLowerCase()]">
                <i :class="getStatusIcon(item.status)"></i>
                {{ item.status }}
              </div>
            </template>
            <template #title="{ item }">
              <div class="goal-title">
                {{ item.title || 'Untitled Goal' }}
              </div>
            </template>
            <template #progress="{ item }">
              <div class="progress-cell">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: `${getGoalProgress(item)}%` }"></div>
                </div>
                <span class="progress-text">{{ getGoalProgress(item) }}%</span>
              </div>
            </template>
            <template #tasks="{ item }">
              <div class="tasks-cell">
                {{ getGoalTasksProgress(item) }}
              </div>
            </template>
            <template #created_at="{ item }">
              {{ formatDate(item.created_at) }}
            </template>
          </BaseTable>

          <!-- Grid View -->
          <div v-else class="category-cards-container">
            <!-- Search Bar for Grid View -->
            <div class="card-view-search-bar">
              <input type="text" class="search-input" placeholder="Search goals..." :value="searchQuery" @input="handleSearch($event.target.value)" />
            </div>

            <div class="goals-grid">
              <div
                v-for="goal in filteredGoals"
                :key="goal.id"
                class="goal-card"
                :class="{
                  selected: selectedGoal?.id === goal.id,
                  [goal.status.toLowerCase()]: true,
                }"
                @click="handleGoalClick(goal)"
                @dblclick="handleGoalDoubleClick(goal)"
              >
                <!-- Goal Header -->
                <div class="goal-header">
                  <div class="goal-title-section">
                    <h3 class="goal-title">{{ goal.title || 'Untitled Goal' }}</h3>
                    <span class="goal-status" :class="goal.status.toLowerCase()">
                      <i :class="getStatusIcon(goal.status)"></i>
                      {{ goal.status }}
                    </span>
                  </div>
                  <div class="goal-actions">
                    <button v-if="goal.status === 'executing'" @click.stop="pauseGoal(goal)" class="action-btn pause-btn" title="Pause Goal">
                      <i class="fas fa-pause"></i>
                    </button>
                    <button v-else-if="goal.status === 'paused'" @click.stop="resumeGoal(goal)" class="action-btn resume-btn" title="Resume Goal">
                      <i class="fas fa-play"></i>
                    </button>
                    <button @click.stop="deleteGoal(goal)" class="action-btn delete-btn" title="Delete Goal">
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                </div>

                <!-- Goal Description -->
                <div class="goal-description">
                  {{ goal.description || 'No description available' }}
                </div>

                <!-- Progress Section -->
                <div class="goal-progress-section">
                  <div class="progress-info">
                    <span class="progress-label">Progress</span>
                    <span class="progress-percentage" :class="goal.status.toLowerCase()">{{ getGoalProgress(goal) }}%</span>
                  </div>
                  <div class="progress-bar">
                    <div class="progress-fill" :class="goal.status.toLowerCase()" :style="{ width: `${getGoalProgress(goal)}%` }"></div>
                  </div>
                  <div class="task-info">
                    <span class="task-count">{{ getGoalTasksProgress(goal) }}</span>
                    <span class="goal-date">{{ formatDate(goal.created_at) }}</span>
                  </div>
                </div>

                <!-- Current Tasks (for executing goals) -->
                <div v-if="goal.status === 'executing' && goal.currentTasks?.length" class="current-tasks">
                  <div class="current-tasks-label">Currently executing:</div>
                  <div class="current-task-list">
                    <div v-for="task in goal.currentTasks.slice(0, 2)" :key="task.id" class="current-task">
                      <i class="fas fa-spinner fa-spin"></i>
                      <span class="task-title">{{ task.title }}</span>
                      <span v-if="task.agent_name" class="task-agent" :title="`Assigned to ${task.agent_name}`">
                        <i class="fas fa-robot"></i>
                        {{ task.agent_name }}
                      </span>
                    </div>
                    <div v-if="goal.currentTasks.length > 2" class="more-tasks">+{{ goal.currentTasks.length - 2 }} more...</div>
                  </div>
                </div>

                <!-- Agent Assignments (show all tasks with agents) -->
                <div v-if="goal.tasks && goal.tasks.some((t) => t.agent_name)" class="agent-assignments">
                  <div class="agent-assignments-label">Agent Assignments:</div>
                  <div class="agent-assignment-list">
                    <div v-for="task in goal.tasks.filter((t) => t.agent_name).slice(0, 3)" :key="task.id" class="agent-assignment">
                      <i class="fas fa-robot"></i>
                      <span class="assignment-text">{{ task.agent_name }} → {{ task.title }}</span>
                      <span class="assignment-status" :class="task.status">{{ task.status }}</span>
                    </div>
                    <div v-if="goal.tasks.filter((t) => t.agent_name).length > 3" class="more-assignments">
                      +{{ goal.tasks.filter((t) => t.agent_name).length - 3 }} more assignments
                    </div>
                  </div>
                </div>

                <!-- Task Inputs/Outputs (show for completed/failed tasks) -->
                <div v-if="goal.tasks && goal.tasks.some((t) => t.output || t.error)" class="task-io-summary">
                  <div class="task-io-label">Task Results:</div>
                  <div class="task-io-list">
                    <button
                      v-for="task in goal.tasks.filter((t) => t.output || t.error).slice(0, 3)"
                      :key="task.id"
                      @click.stop="viewTaskDetails(task)"
                      class="task-io-button"
                      :class="{ 'has-error': task.error }"
                    >
                      <i :class="task.error ? 'fas fa-exclamation-triangle' : 'fas fa-file-alt'"></i>
                      {{ task.title }}
                      <span class="io-indicator">{{ task.error ? 'Error' : 'Output' }}</span>
                    </button>
                    <div v-if="goal.tasks.filter((t) => t.output || t.error).length > 3" class="more-task-io">
                      +{{ goal.tasks.filter((t) => t.output || t.error).length - 3 }} more results
                    </div>
                  </div>
                </div>

                <!-- Evaluation Results -->
                <div v-if="goal.evaluation" class="goal-evaluation">
                  <div class="evaluation-header">
                    <i class="fas fa-chart-line"></i>
                    <span>Evaluation Results</span>
                    <span class="eval-score" :class="goal.evaluation.passed ? 'passed' : 'failed'"> {{ goal.evaluation.overall_score }}% </span>
                  </div>
                  <div class="evaluation-scores">
                    <div class="score-item">
                      <span class="score-label">Completeness:</span>
                      <span class="score-value">{{ goal.evaluation.evaluation_data?.scores?.completeness || 0 }}%</span>
                    </div>
                    <div class="score-item">
                      <span class="score-label">Quality:</span>
                      <span class="score-value">{{ goal.evaluation.evaluation_data?.scores?.quality || 0 }}%</span>
                    </div>
                  </div>
                  <button @click.stop="viewEvaluationReport(goal)" class="view-report-btn">
                    <i class="fas fa-file-alt"></i>
                    View Full Report
                  </button>
                </div>

                <!-- Agent Activity (for goals with agent decisions) -->
                <div v-if="goal.agentDecisions && goal.agentDecisions.length > 0" class="agent-activity">
                  <div class="agent-activity-label">Recent Agent Activity:</div>
                  <div class="agent-decision-list">
                    <div
                      v-for="decision in goal.agentDecisions.slice(-3)"
                      :key="decision.id"
                      class="agent-decision"
                      :class="getDecisionClass(decision)"
                    >
                      <i :class="getDecisionIcon(decision)"></i>
                      <span class="decision-text">{{ decision.decision }}</span>
                      <span class="decision-time">{{ formatTime(decision.timestamp) }}</span>
                      <!-- Show retry info for tool retry decisions -->
                      <div v-if="isToolRetryDecision(decision)" class="retry-info">
                        <span v-if="decision.metadata?.attempts" class="retry-attempts"> Attempt {{ decision.metadata.attempts }} </span>
                        <span v-if="decision.metadata?.error" class="retry-error" :title="decision.metadata.error">
                          {{ truncateError(decision.metadata.error) }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Artifacts (for goals with stored outputs) -->
                <div v-if="goal.artifacts && goal.artifacts.length > 0" class="goal-artifacts">
                  <div class="artifacts-label">Task Outputs ({{ goal.artifacts.length }}):</div>
                  <div class="artifact-list">
                    <button
                      v-for="artifact in goal.artifacts.slice(0, 3)"
                      :key="artifact.key"
                      @click.stop="openArtifactModal(goal.id, artifact.key)"
                      class="artifact-button"
                    >
                      <i class="fas fa-file-alt"></i>
                      {{ artifact.key.replace('task_', '').replace('_tool_result', '') }}
                      <span class="artifact-size">({{ formatBytes(artifact.size) }})</span>
                    </button>
                    <div v-if="goal.artifacts.length > 3" class="more-artifacts">
                      <button @click.stop="showAllArtifacts(goal.id)" class="show-all-artifacts-btn">
                        +{{ goal.artifacts.length - 3 }} more outputs
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Empty State -->
              <div v-if="filteredGoals.length === 0" class="empty-state">
                <div class="empty-icon">
                  <i class="fas fa-bullseye"></i>
                </div>
                <h3>No Goals Found</h3>
                <p v-if="searchQuery">No goals match your search criteria. Try adjusting your search terms.</p>
                <p v-else-if="activeTab !== 'all'">No {{ activeTab }} goals found. Create a new goal to get started.</p>
                <p v-else>Create your first goal using the right panel.</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </template>
  </BaseScreen>

  <!-- Evaluation Report Modal -->
  <div v-if="showEvaluationModal" class="evaluation-modal-overlay" @click="closeEvaluationModal">
    <div class="evaluation-modal" @click.stop>
      <div class="evaluation-modal-header">
        <h3>Evaluation Report: {{ currentEvaluation?.goalTitle }}</h3>
        <button @click="closeEvaluationModal" class="modal-close-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="evaluation-modal-content">
        <div v-if="evaluationLoading" class="evaluation-loading">
          <i class="fas fa-spinner fa-spin"></i>
          Loading evaluation...
        </div>
        <div v-else-if="currentEvaluation" class="evaluation-content">
          <!-- Overall Scores -->
          <div class="scores-section">
            <div class="score-card overall">
              <div class="score-label">Overall Score</div>
              <div class="score-value large" :class="getScoreClass(currentEvaluation.overall_score)">{{ currentEvaluation.overall_score }}%</div>
              <div class="score-status" :class="currentEvaluation.passed ? 'passed' : 'failed'">
                <i :class="currentEvaluation.passed ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'"></i>
                {{ currentEvaluation.passed ? 'VALIDATED' : 'NEEDS REVIEW' }}
              </div>
            </div>
            <div class="score-card">
              <div class="score-label">Completeness</div>
              <div class="score-value" :class="getScoreClass(currentEvaluation.evaluation_data?.scores?.completeness)">
                {{ currentEvaluation.evaluation_data?.scores?.completeness || 0 }}%
              </div>
              <div class="score-description">All tasks completed</div>
            </div>
            <div class="score-card">
              <div class="score-label">Quality</div>
              <div class="score-value" :class="getScoreClass(currentEvaluation.evaluation_data?.scores?.quality)">
                {{ currentEvaluation.evaluation_data?.scores?.quality || 0 }}%
              </div>
              <div class="score-description">Criteria met</div>
            </div>
          </div>

          <!-- AI Feedback -->
          <div class="feedback-section">
            <h4><i class="fas fa-comment-alt"></i> AI Evaluation Feedback</h4>
            <div class="feedback-content">{{ currentEvaluation.feedback }}</div>
          </div>

          <!-- Task Evaluations -->
          <div v-if="currentEvaluation.taskEvaluations?.length" class="task-evaluations-section">
            <h4><i class="fas fa-tasks"></i> Task-by-Task Evaluation</h4>
            <div class="task-eval-list">
              <div v-for="(taskEval, index) in currentEvaluation.taskEvaluations" :key="taskEval.task_id" class="task-eval-card">
                <div class="task-eval-header">
                  <span class="task-number">Task {{ index + 1 }}</span>
                  <span class="task-title">{{ getTaskTitle(taskEval) }}</span>
                  <span class="task-score" :class="getScoreClass(taskEval.score)">{{ taskEval.score }}%</span>
                </div>
                <div class="task-eval-feedback">{{ taskEval.feedback }}</div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="evaluation-actions">
            <button v-if="currentEvaluation.passed" @click="saveAsGoldenStandard" class="golden-standard-btn">
              <i class="fas fa-star"></i>
              Save as Golden Standard
            </button>
            <button @click="closeEvaluationModal" class="close-report-btn">
              <i class="fas fa-times"></i>
              Close
            </button>
          </div>
        </div>
        <div v-else class="evaluation-error">Failed to load evaluation report</div>
      </div>
    </div>
  </div>

  <!-- Artifact Modal (outside BaseScreen to avoid template conflicts) -->
  <div v-if="showArtifactModal" class="artifact-modal-overlay" @click="closeArtifactModal">
    <div class="artifact-modal" @click.stop>
      <div class="artifact-modal-header">
        <h3>{{ currentArtifact?.filename || 'Artifact Preview' }}</h3>
        <div class="modal-header-actions">
          <button
            v-if="currentArtifact?.originalFilename && currentArtifact?.goalId"
            @click="downloadArtifact(currentArtifact.goalId, currentArtifact.originalFilename)"
            class="modal-download-btn"
            title="Download file"
          >
            <i class="fas fa-download"></i>
          </button>
          <button @click="closeArtifactModal" class="modal-close-btn">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
      <div class="artifact-modal-content">
        <div v-if="artifactLoading" class="artifact-loading">
          <i class="fas fa-spinner fa-spin"></i>
          Loading artifact...
        </div>
        <div v-else-if="currentArtifact" class="artifact-content">
          <div class="artifact-meta">
            <span class="artifact-size">{{ formatBytes(currentArtifact.size) }}</span>
            <span class="artifact-date">{{ formatDate(currentArtifact.created) }}</span>
            <span class="artifact-type">{{ getArtifactDisplayType(currentArtifact) }}</span>
          </div>
          <!-- Markdown Content -->
          <div
            v-if="getArtifactDisplayType(currentArtifact) === 'markdown'"
            class="artifact-markdown"
            v-html="renderMarkdown(formatArtifactContent(currentArtifact.content))"
          ></div>
          <!-- HTML Content -->
          <div
            v-else-if="getArtifactDisplayType(currentArtifact) === 'html'"
            class="artifact-html"
            v-html="formatArtifactContent(currentArtifact.content)"
          ></div>
          <!-- Text Content -->
          <pre v-else-if="getArtifactDisplayType(currentArtifact) === 'text'" class="artifact-text">{{
            formatArtifactContent(currentArtifact.content)
          }}</pre>
          <!-- JSON Content (default) -->
          <pre v-else class="artifact-json">{{ formatArtifactContent(currentArtifact.content) }}</pre>
        </div>
        <div v-else class="artifact-error">Failed to load artifact content</div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, computed, inject } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import BaseTable from '../../../_components/BaseTable.vue';
import BaseTabControls from '../../../_components/BaseTabControls.vue';
import { API_CONFIG } from '@/tt.config.js';

export default {
  name: 'GoalsScreen',
  components: { BaseScreen, BaseTable, BaseTabControls },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const selectedGoal = ref(null);
    const activeTab = ref('all');
    const searchQuery = ref('');
    const currentLayout = ref('grid');
    const currentFilter = ref('all');

    // Modal state
    const showArtifactModal = ref(false);
    const currentArtifact = ref(null);
    const artifactLoading = ref(false);

    // Evaluation modal state
    const showEvaluationModal = ref(false);
    const currentEvaluation = ref(null);
    const evaluationLoading = ref(false);

    // Define tabs
    const tabs = [
      { id: 'all', name: 'All', icon: 'fas fa-list' },
      { id: 'executing', name: 'Executing', icon: 'fas fa-play' },
      { id: 'paused', name: 'Paused', icon: 'fas fa-pause' },
      { id: 'completed', name: 'Completed', icon: 'fas fa-check' },
      { id: 'failed', name: 'Failed', icon: 'fas fa-times' },
    ];

    // Define table columns
    const tableColumns = [
      { key: 'status', label: 'Status', width: '120px' },
      { key: 'title', label: 'Goal', width: '2fr' },
      { key: 'progress', label: 'Progress', width: '150px' },
      { key: 'tasks', label: 'Tasks', width: '120px' },
      { key: 'created_at', label: 'Created', width: '1fr' },
    ];

    // Computed properties
    const allGoals = computed(() => store.getters['goals/allGoals']);
    const activeGoals = computed(() => store.getters['goals/activeGoals']);
    const recentGoals = computed(() => store.getters['goals/recentGoals']);
    const goalsWithTasks = computed(() => store.getters['goals/goalsWithTasks']);
    const isCreatingGoal = computed(() => store.getters['goals/isCreatingGoal']);

    // Filtered goals based on active tab and search
    const filteredGoals = computed(() => {
      let goals = allGoals.value;

      // Filter by tab
      switch (activeTab.value) {
        case 'executing':
          goals = goals.filter((goal) => goal.status === 'executing');
          break;
        case 'paused':
          goals = goals.filter((goal) => goal.status === 'paused');
          break;
        case 'completed':
          goals = goals.filter((goal) => goal.status === 'completed' || goal.status === 'validated' || goal.status === 'needs_review');
          break;
        case 'failed':
          goals = goals.filter((goal) => goal.status === 'failed');
          break;
        default: // 'all'
          break;
      }

      // Apply search filtering
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        goals = goals.filter(
          (goal) =>
            (goal.title && goal.title.toLowerCase().includes(query)) ||
            (goal.description && goal.description.toLowerCase().includes(query)) ||
            (goal.status && goal.status.toLowerCase().includes(query))
        );
      }

      // Apply panel filter if different from tab
      if (currentFilter.value !== 'all' && currentFilter.value !== activeTab.value) {
        goals = goals.filter((goal) => goal.status === currentFilter.value);
      }

      return goals;
    });

    // --- Methods ---
    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();
    const focusInput = () => baseScreenRef.value?.focusInput();
    const clearInput = () => baseScreenRef.value?.clearInput();

    const addLine = (content, type = 'default') => {
      terminalLines.value.push({ content, type });
      nextTick(() => scrollToBottom());
    };

    const handleGoalClick = async (goal) => {
      playSound('typewriterKeyPress');
      addLine(`Selected goal: ${goal.title || 'Untitled Goal'}`, 'info');

      // Fetch FULL goal details with tasks (like Runs does)
      try {
        addLine(`Loading detailed goal data for ${goal.id}...`, 'info');
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goal.id}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const goalData = await response.json();
        console.log('Full goal data:', goalData);

        // Set the full goal data with tasks
        selectedGoal.value = {
          ...goal,
          ...goalData.goal,
          tasks: goalData.goal.tasks || [],
        };

        addLine(`Loaded ${goalData.goal.tasks?.length || 0} tasks for goal`, 'info');
      } catch (error) {
        console.error('[Goals] Error fetching goal details:', error);
        addLine(`Error loading goal details: ${error.message}`, 'error');
        // Fallback to basic goal data
        selectedGoal.value = goal;
      }
    };

    const handleGoalDoubleClick = (goal) => {
      // Could expand goal details or switch to tasks view
      if (activeTab.value !== 'tasks') {
        activeTab.value = 'tasks';
        addLine(`Viewing tasks for goal: ${goal.title}`, 'info');
      }
    };

    const handleSearch = (query) => {
      searchQuery.value = query;
    };

    const selectTab = (tabId) => {
      activeTab.value = tabId;
      currentFilter.value = tabId; // Sync the filter with the tab
      selectedGoal.value = null;
      addLine(`[Goals] Viewing ${tabId} goals`, 'info');
    };

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    // Status icon helper
    const getStatusIcon = (status) => {
      const icons = {
        planning: 'fas fa-lightbulb',
        executing: 'fas fa-play',
        paused: 'fas fa-pause',
        completed: 'fas fa-check',
        validated: 'fas fa-check-circle',
        needs_review: 'fas fa-exclamation-triangle',
        failed: 'fas fa-times',
        stopped: 'fas fa-stop',
      };
      return icons[status] || 'fas fa-question';
    };

    // Progress calculation
    const getGoalProgress = (goal) => {
      return store.getters['goals/getGoalProgress'](goal);
    };

    const getGoalTasksProgress = (goal) => {
      return store.getters['goals/getGoalTasksProgress'](goal);
    };

    // Date formatting
    const formatDate = (dateString) => {
      if (!dateString) return '-';
      return new Date(dateString).toLocaleString();
    };

    const pauseGoal = async (goal) => {
      try {
        addLine(`[Goals] Pausing goal: ${goal.title}`, 'info');
        await store.dispatch('goals/pauseGoal', goal.id);
        addLine(`[Goals] Goal paused successfully`, 'success');
      } catch (error) {
        addLine(`[Goals] Error pausing goal: ${error.message}`, 'error');
      }
    };

    const resumeGoal = async (goal) => {
      try {
        addLine(`[Goals] Resuming goal: ${goal.title}`, 'info');
        await store.dispatch('goals/resumeGoal', goal.id);
        addLine(`[Goals] Goal resumed successfully`, 'success');
      } catch (error) {
        addLine(`[Goals] Error resuming goal: ${error.message}`, 'error');
      }
    };

    const deleteGoal = async (goal) => {
      if (!confirm(`Are you sure you want to delete the goal "${goal.title}"? This will also delete all associated tasks.`)) {
        return;
      }

      try {
        addLine(`[Goals] Deleting goal: ${goal.title}`, 'info');
        await store.dispatch('goals/deleteGoal', goal.id);

        if (selectedGoal.value?.id === goal.id) {
          selectedGoal.value = null;
        }

        addLine(`[Goals] Goal deleted successfully`, 'success');
      } catch (error) {
        addLine(`[Goals] Error deleting goal: ${error.message}`, 'error');
      }
    };

    const refreshGoals = async () => {
      addLine('[Goals] Refreshing goals...', 'info');
      try {
        await store.dispatch('goals/fetchGoals');
        addLine(`[Goals] Found ${allGoals.value.length} goals.`, 'success');
      } catch (error) {
        addLine(`[Goals] Error refreshing goals: ${error.message}`, 'error');
      }
    };

    // Panel action handler
    const handlePanelAction = async (action, payload) => {
      console.log('Goals panel action:', action, payload);

      switch (action) {
        case 'filter-changed':
          currentFilter.value = payload.filter;
          activeTab.value = payload.filter; // Sync the tab with the filter
          selectedGoal.value = null;
          addLine(`[Goals] Filter changed: ${payload.filter}`, 'info');
          break;
        case 'refresh-goals':
          await refreshGoals();
          break;
        case 'create-goal':
          addLine(`[Goals] Create goal action received`, 'info');
          break;
        case 'use-template':
          addLine(`[Goals] Template loaded: ${payload.title}`, 'info');
          break;
        case 'navigate':
          emit('screen-change', payload);
          break;
        case 'show-feedback':
          if (payload && payload.message) {
            const type = payload.type || 'info';
            addLine(payload.message, type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
          }
          break;
        default:
          console.warn('Unhandled panel action in Goals.vue:', action);
      }
    };

    const handleUserInputSubmit = async (input) => {
      addLine(`> ${input}`, 'input');
      clearInput();

      const command = input.toLowerCase().trim();
      const [action, ...args] = command.split(' ');

      switch (action) {
        case 'create':
        case 'goal':
          const goalText = args.join(' ');
          if (goalText) {
            addLine(`[Goals] Creating goal: ${goalText}`, 'info');
            try {
              await store.dispatch('goals/createGoal', {
                text: goalText,
                priority: 'medium',
              });
              addLine(`[Goals] Goal created successfully`, 'success');
            } catch (error) {
              addLine(`[Goals] Error creating goal: ${error.message}`, 'error');
            }
          } else {
            addLine('Please provide a goal description', 'error');
          }
          break;
        case 'list':
          addLine('Current goals:', 'info');
          filteredGoals.value.forEach((goal) => {
            addLine(`${goal.id} - ${goal.title} (${goal.status})`, 'data');
          });
          break;
        case 'pause':
          if (args[0]) {
            const goal = allGoals.value.find((g) => g.id === args[0]);
            if (goal) {
              await pauseGoal(goal);
            } else {
              addLine(`Goal ${args[0]} not found.`, 'error');
            }
          } else {
            addLine('Please provide a goal ID', 'error');
          }
          break;
        case 'resume':
          if (args[0]) {
            const goal = allGoals.value.find((g) => g.id === args[0]);
            if (goal) {
              await resumeGoal(goal);
            } else {
              addLine(`Goal ${args[0]} not found.`, 'error');
            }
          } else {
            addLine('Please provide a goal ID', 'error');
          }
          break;
        case 'refresh':
          await refreshGoals();
          break;
        case 'clear':
          terminalLines.value = [];
          break;
        default:
          addLine('Unknown command. Available commands: create, list, pause, resume, refresh, clear', 'error');
      }
    };

    // Artifact viewing
    const viewArtifact = async (goalId, artifactKey) => {
      try {
        addLine(`[Goals] Fetching artifact: ${artifactKey}`, 'info');
        const artifact = await store.dispatch('goals/fetchGoalArtifact', { goalId, artifactKey });

        // Display artifact content in terminal
        addLine(`[Artifact] ${artifactKey}:`, 'success');

        if (typeof artifact.content === 'string') {
          // Try to parse as JSON for better display
          try {
            const parsed = JSON.parse(artifact.content);
            addLine(JSON.stringify(parsed, null, 2), 'data');
          } catch {
            addLine(artifact.content, 'data');
          }
        } else {
          addLine(JSON.stringify(artifact.content, null, 2), 'data');
        }

        addLine(`[Artifact] Size: ${formatBytes(artifact.size)}, Type: ${artifact.type}`, 'info');
      } catch (error) {
        addLine(`[Goals] Error fetching artifact: ${error.message}`, 'error');
      }
    };

    // Time formatting
    const formatTime = (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;

      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return date.toLocaleDateString();
    };

    // Bytes formatting
    const formatBytes = (bytes) => {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Modal methods
    const openArtifactModal = async (goalId, artifactKey) => {
      try {
        showArtifactModal.value = true;
        artifactLoading.value = true;
        currentArtifact.value = null;

        addLine(`[Goals] Opening artifact modal: ${artifactKey}`, 'info');

        // Check if this is a filesystem artifact (has filename property)
        const goal = allGoals.value.find((g) => g.id === goalId);
        const artifact = goal?.artifacts?.find((a) => a.key === artifactKey);

        if (artifact && artifact.isFileSystemArtifact && artifact.filename) {
          // This is a filesystem artifact, fetch its content directly
          console.log(`[Goals] Fetching filesystem artifact: ${artifact.filename}`);
          try {
            const fileData = await store.dispatch('goals/fetchGoalArtifactFileContent', {
              goalId,
              filename: artifact.filename,
            });
            currentArtifact.value = {
              ...fileData,
              originalFilename: artifact.filename,
              goalId: goalId,
            };
            artifactLoading.value = false;
            return;
          } catch (fileError) {
            console.warn(`[Goals] Failed to fetch filesystem artifact content:`, fileError);
          }
        }

        // Try to fetch from artifact files (search by key matching)
        try {
          const artifactFiles = await store.dispatch('goals/fetchGoalArtifactFiles', goalId);

          // Try multiple matching strategies
          let matchingFile = null;

          // Strategy 1: Exact filename match
          matchingFile = artifactFiles.files.find((f) => f.filename === artifactKey);

          // Strategy 2: Key contains filename parts
          if (!matchingFile) {
            matchingFile = artifactFiles.files.find((f) => f.filename.includes(artifactKey.replace('task_', '').replace('_tool_result', '')));
          }

          // Strategy 3: Filename contains key parts
          if (!matchingFile) {
            const keyParts = artifactKey.split('-');
            matchingFile = artifactFiles.files.find((f) => keyParts.some((part) => f.filename.includes(part)));
          }

          if (matchingFile) {
            console.log(`[Goals] Found matching file: ${matchingFile.filename} for key: ${artifactKey}`);
            const fileData = await store.dispatch('goals/fetchGoalArtifactFileContent', {
              goalId,
              filename: matchingFile.filename,
            });
            currentArtifact.value = {
              ...fileData,
              originalFilename: matchingFile.filename,
              goalId: goalId,
            };
          } else {
            console.log(`[Goals] No matching file found for key: ${artifactKey}, trying blackboard artifact`);
            // Fallback to blackboard artifact
            const artifact = await store.dispatch('goals/fetchGoalArtifact', { goalId, artifactKey });
            currentArtifact.value = {
              filename: artifactKey,
              content: artifact.content,
              size: artifact.size,
              created: artifact.timestamp,
              fileType: 'json',
              goalId: goalId,
            };
          }
        } catch (filesError) {
          console.warn(`[Goals] Error fetching artifact files:`, filesError);
          // Fallback to blackboard artifact
          try {
            const artifact = await store.dispatch('goals/fetchGoalArtifact', { goalId, artifactKey });
            currentArtifact.value = {
              filename: artifactKey,
              content: artifact.content,
              size: artifact.size,
              created: artifact.timestamp,
              fileType: 'json',
              goalId: goalId,
            };
          } catch (blackboardError) {
            throw new Error(`Failed to fetch artifact from both filesystem and blackboard: ${blackboardError.message}`);
          }
        }

        artifactLoading.value = false;
      } catch (error) {
        artifactLoading.value = false;
        addLine(`[Goals] Error opening artifact modal: ${error.message}`, 'error');
        showArtifactModal.value = false;
      }
    };

    const downloadArtifact = async (goalId, filename) => {
      try {
        addLine(`[Goals] Downloading artifact: ${filename}`, 'info');
        const result = await store.dispatch('goals/downloadGoalArtifactFile', { goalId, filename });
        addLine(`[Goals] Downloaded: ${result.filename}`, 'success');
      } catch (error) {
        addLine(`[Goals] Error downloading artifact: ${error.message}`, 'error');
      }
    };

    const closeArtifactModal = () => {
      showArtifactModal.value = false;
      currentArtifact.value = null;
      artifactLoading.value = false;
    };

    const showAllArtifacts = async (goalId) => {
      try {
        addLine(`[Goals] Fetching all artifacts for goal ${goalId}`, 'info');
        const artifactFiles = await store.dispatch('goals/fetchGoalArtifactFiles', goalId);

        addLine(`[Artifacts] Found ${artifactFiles.totalFiles} artifact files:`, 'success');
        artifactFiles.files.forEach((file) => {
          addLine(`  📄 ${file.filename} (${formatBytes(file.size)})`, 'data');
        });

        if (artifactFiles.summary) {
          addLine(`[Summary] Goal: ${artifactFiles.summary.goalTitle}`, 'info');
          addLine(`[Summary] Total artifacts: ${artifactFiles.summary.totalArtifacts}`, 'info');
        }
      } catch (error) {
        addLine(`[Goals] Error fetching artifact files: ${error.message}`, 'error');
      }
    };

    const formatArtifactContent = (content) => {
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);

          // Check if this is a file_operations tool result with actual file content
          if (parsed.tool === 'file_operations' && parsed.args && parsed.args.content) {
            return parsed.args.content; // Return the actual file content (e.g., markdown)
          }

          return JSON.stringify(parsed, null, 2);
        } catch {
          return content;
        }
      }
      return JSON.stringify(content, null, 2);
    };

    const getArtifactDisplayType = (artifact) => {
      if (!artifact || !artifact.content) return 'json';

      // Use the fileType property from the new content endpoint if available
      if (artifact.fileType) {
        return artifact.fileType;
      }

      try {
        const parsed = typeof artifact.content === 'string' ? JSON.parse(artifact.content) : artifact.content;

        // Check if this is a file_operations result with actual file content
        if (parsed.tool === 'file_operations' && parsed.args && parsed.args.content) {
          const filename = parsed.args.path || '';
          if (filename.endsWith('.md')) return 'markdown';
          if (filename.endsWith('.html')) return 'html';
          if (filename.endsWith('.txt')) return 'text';
          return 'text';
        }

        return 'json';
      } catch {
        return 'text';
      }
    };

    const renderMarkdown = (content) => {
      // Simple markdown rendering for display
      return content
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/\n/gim, '<br>');
    };

    // Helper methods for retry decision display
    const getDecisionClass = (decision) => {
      if (!decision.metadata?.type) return '';

      switch (decision.metadata.type) {
        case 'tool_retry_attempt':
          return 'retry-attempt';
        case 'tool_retry_success':
          return 'retry-success';
        case 'tool_permanent_failure':
          return 'retry-failure';
        default:
          return '';
      }
    };

    const getDecisionIcon = (decision) => {
      if (!decision.metadata?.type) return 'fas fa-robot';

      switch (decision.metadata.type) {
        case 'tool_retry_attempt':
          return 'fas fa-redo';
        case 'tool_retry_success':
          return 'fas fa-check-circle';
        case 'tool_permanent_failure':
          return 'fas fa-exclamation-triangle';
        case 'task_completed':
          return 'fas fa-check';
        case 'goal_completed':
          return 'fas fa-trophy';
        default:
          return 'fas fa-robot';
      }
    };

    const isToolRetryDecision = (decision) => {
      return decision.metadata?.type && ['tool_retry_attempt', 'tool_retry_success', 'tool_permanent_failure'].includes(decision.metadata.type);
    };

    const truncateError = (error) => {
      if (!error) return '';
      return error.length > 50 ? error.substring(0, 50) + '...' : error;
    };

    const viewTaskDetails = (task) => {
      addLine(`[Task] ${task.title}`, 'info');
      addLine(`Status: ${task.status}`, 'info');

      if (task.input) {
        addLine(`[Input]:`, 'success');
        addLine(JSON.stringify(task.input, null, 2), 'data');
      }

      if (task.output) {
        addLine(`[Output]:`, 'success');
        addLine(JSON.stringify(task.output, null, 2), 'data');
      }

      if (task.error) {
        addLine(`[Error]:`, 'error');
        addLine(task.error, 'error');
      }
    };

    // Evaluation modal methods
    const viewEvaluationReport = async (goal) => {
      try {
        showEvaluationModal.value = true;
        evaluationLoading.value = true;
        currentEvaluation.value = null;

        addLine(`[Goals] Loading evaluation report for: ${goal.title}`, 'info');

        // Fetch evaluation data
        const evaluation = await store.dispatch('goals/fetchGoalEvaluation', goal.id);

        if (!evaluation) {
          addLine(`[Goals] No evaluation found for this goal`, 'error');
          showEvaluationModal.value = false;
          return;
        }

        currentEvaluation.value = {
          ...evaluation,
          goalTitle: goal.title,
          goalId: goal.id,
        };

        evaluationLoading.value = false;
        addLine(`[Goals] Evaluation report loaded`, 'success');
      } catch (error) {
        evaluationLoading.value = false;
        addLine(`[Goals] Error loading evaluation: ${error.message}`, 'error');
        showEvaluationModal.value = false;
      }
    };

    const closeEvaluationModal = () => {
      showEvaluationModal.value = false;
      currentEvaluation.value = null;
      evaluationLoading.value = false;
    };

    const getScoreClass = (score) => {
      if (score >= 80) return 'high';
      if (score >= 60) return 'medium';
      return 'low';
    };

    const getTaskTitle = (taskEval) => {
      // Try to find the task title from the evaluation data
      if (taskEval.taskTitle) return taskEval.taskTitle;

      // Fallback to task ID or generic title
      const taskId = taskEval.task_id || taskEval.taskId;
      return taskId ? `Task ${taskId.substring(0, 8)}` : 'Unknown Task';
    };

    const saveAsGoldenStandard = async () => {
      if (!currentEvaluation.value) return;

      const category = prompt('Enter a category for this golden standard (e.g., "research", "content-creation", "data-analysis"):');
      if (!category) return;

      try {
        addLine(`[Goals] Saving as golden standard in category: ${category}`, 'info');

        await store.dispatch('goals/saveAsGoldenStandard', {
          goalId: currentEvaluation.value.goalId,
          category: category.trim(),
        });

        addLine(`[Goals] Goal saved as golden standard successfully!`, 'success');
        closeEvaluationModal();
      } catch (error) {
        addLine(`[Goals] Error saving golden standard: ${error.message}`, 'error');
      }
    };

    const initializeScreen = async () => {
      terminalLines.value = [];
      addLine('Welcome to Goals Management!', 'info');
      addLine('Create goals using the right panel.', 'info');
      addLine('Loading goals...', 'info');

      try {
        await refreshGoals();

        if (allGoals.value.length === 0) {
          addLine('No goals found. Create your first goal to get started!', 'info');
        } else {
          const activeCount = activeGoals.value.length;
          addLine(`Found ${allGoals.value.length} goals${activeCount > 0 ? ` (${activeCount} active)` : ''}.`, 'success');
        }
      } catch (error) {
        addLine(`Error loading goals: ${error.message}`, 'error');
      }
    };

    onMounted(() => {
      console.log('Goals Screen Mounted');
    });

    onUnmounted(() => {
      console.log('Goals Screen Unmounted');
      selectedGoal.value = null;
      // Clean up any subscriptions
      store.dispatch('goals/clearAllSubscriptions');
    });

    return {
      baseScreenRef,
      terminalLines,
      selectedGoal,
      activeTab,
      searchQuery,
      currentLayout,
      currentFilter,
      tabs,
      tableColumns,
      allGoals,
      activeGoals,
      recentGoals,
      goalsWithTasks,
      isCreatingGoal,
      filteredGoals,
      handleGoalClick,
      handleGoalDoubleClick,
      handleSearch,
      selectTab,
      setLayout,
      getStatusIcon,
      getGoalProgress,
      getGoalTasksProgress,
      formatDate,
      formatTime,
      formatBytes,
      pauseGoal,
      resumeGoal,
      deleteGoal,
      refreshGoals,
      handlePanelAction,
      handleUserInputSubmit,
      viewArtifact,
      initializeScreen,
      emit,
      // Modal state and methods
      showArtifactModal,
      currentArtifact,
      artifactLoading,
      openArtifactModal,
      closeArtifactModal,
      showAllArtifacts,
      formatArtifactContent,
      getArtifactDisplayType,
      renderMarkdown,
      downloadArtifact,
      // Retry decision display methods
      getDecisionClass,
      getDecisionIcon,
      isToolRetryDecision,
      truncateError,
      viewTaskDetails,
      // Evaluation modal state and methods
      showEvaluationModal,
      currentEvaluation,
      evaluationLoading,
      viewEvaluationReport,
      closeEvaluationModal,
      getScoreClass,
      getTaskTitle,
      saveAsGoldenStandard,
    };
  },
};
</script>

<style scoped>
.goals-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.goals-main-content {
  flex: 1;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}

/* Table Status Column */
.col-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.col-status.planning {
  color: var(--color-yellow);
}

.col-status.executing {
  color: var(--color-green);
}

.col-status.paused {
  color: var(--color-blue);
}

.col-status.completed {
  color: var(--color-blue);
}

.col-status.failed {
  color: var(--color-red);
}

.col-status.stopped {
  color: var(--color-grey);
}

.col-status.validated {
  color: var(--color-green);
}

.col-status.needs_review {
  color: var(--color-yellow);
}

.goal-title {
  font-weight: 500;
  color: var(--color-text);
}

.progress-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.85em;
  color: var(--color-text-muted);
  min-width: 35px;
}

.tasks-cell {
  color: var(--color-text-muted);
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
  margin-bottom: 8px;
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
  border-color: rgba(25, 239, 131, 0.5);
}

/* Grid View */
.goals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 16px;
  padding: 8px 0;
}

.goal-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.goal-card:hover {
  /* background: rgba(25, 239, 131, 0.08); */
  /* border-color: var(--color-pink); */
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.goal-card.selected {
  background: rgba(25, 239, 131, 0.15);
  border-color: var(--color-blue);
}

.goal-card.executing {
  border-left: 4px solid var(--color-blue);
}

.goal-card.completed {
  border-left: 4px solid var(--color-green);
}

.goal-card.failed {
  border-left: 4px solid var(--color-red);
}

.goal-card.paused {
  border-left: 4px solid var(--color-yellow);
}

.goal-card.stopped {
  border-left: 4px solid var(--color-text-muted);
}

.goal-card.validated {
  border-left: 4px solid var(--color-green);
}

.goal-card.needs_review {
  border-left: 4px solid var(--color-yellow);
}

.goal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  gap: 8px;
}

.goal-title-section {
  flex: 1;
  min-width: 0;
}

.goal-card .goal-title {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 4px 0;
  line-height: 1.2;
}

.goal-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: 500;
  text-transform: uppercase;
}

.goal-status.planning {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.goal-status.executing {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.goal-status.paused {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.goal-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.goal-status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.goal-status.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.goal-status.validated {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.goal-status.needs_review {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.goal-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.action-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 0.8em;
}

.pause-btn {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.pause-btn:hover {
  background: rgba(255, 193, 7, 0.3);
}

.resume-btn {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.resume-btn:hover {
  background: rgba(34, 197, 94, 0.3);
}

.delete-btn {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.3);
}

.goal-description {
  color: var(--color-text-muted);
  font-size: 0.8em;
  line-height: 1.3;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  display: none;
}

/* .goal-progress-section {
  margin-bottom: 12px;
} */

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-label {
  color: var(--color-text-muted);
  font-size: 0.85em;
  font-weight: 500;
}

.progress-percentage {
  font-size: 0.9em;
  font-weight: 600;
}

.progress-percentage.executing {
  color: var(--color-blue);
}

.progress-percentage.completed {
  color: var(--color-green);
}

.progress-percentage.failed {
  color: var(--color-red);
}

.progress-percentage.paused {
  color: var(--color-yellow);
}

.progress-percentage.stopped {
  color: var(--color-text-muted);
}

.progress-percentage.planning {
  color: var(--color-yellow);
}

.goal-progress-section .progress-bar {
  height: 4px;
  margin-bottom: 6px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 2px;
}

.progress-fill.executing {
  background: var(--color-blue);
}

.progress-fill.completed {
  background: var(--color-green);
}

.progress-fill.failed {
  background: var(--color-red);
}

.progress-fill.paused {
  background: var(--color-yellow);
}

.progress-fill.stopped {
  background: var(--color-text-muted);
}

.progress-fill.planning {
  background: var(--color-yellow);
}

.progress-fill.validated {
  background: var(--color-green);
}

.progress-fill.needs_review {
  background: var(--color-yellow);
}

.progress-percentage.validated {
  color: var(--color-green);
}

.progress-percentage.needs_review {
  color: var(--color-yellow);
}

.task-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.task-count {
  font-weight: 500;
}

.goal-date {
  opacity: 0.7;
}

.current-tasks {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
}

.current-tasks-label {
  color: var(--color-green);
  font-size: 0.8em;
  font-weight: 600;
  margin-bottom: 6px;
}

.current-task-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.current-task {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 0.8em;
  padding: 2px 0;
}

.current-task i {
  color: var(--color-green);
  font-size: 0.7em;
}

.task-title {
  flex: 1;
  min-width: 0;
}

.task-agent {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: rgba(59, 130, 246, 0.15);
  border-radius: 8px;
  color: var(--color-blue);
  font-size: 0.85em;
  font-weight: 500;
  flex-shrink: 0;
}

.task-agent i {
  font-size: 0.8em;
}

.more-tasks {
  color: var(--color-text-muted);
  font-size: 0.75em;
  font-style: italic;
  margin-left: 12px;
}

/* Agent Assignments Styles */
.agent-assignments {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
}

.agent-assignments-label {
  color: var(--color-blue);
  font-size: 0.8em;
  font-weight: 600;
  margin-bottom: 6px;
}

.agent-assignment-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-assignment {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 6px;
  font-size: 0.75em;
  transition: all 0.2s ease;
}

.agent-assignment:hover {
  background: rgba(59, 130, 246, 0.15);
}

.agent-assignment i {
  color: var(--color-blue);
  font-size: 0.8em;
  flex-shrink: 0;
}

.assignment-text {
  flex: 1;
  min-width: 0;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignment-status {
  padding: 2px 6px;
  border-radius: 8px;
  font-size: 0.85em;
  font-weight: 500;
  text-transform: uppercase;
  flex-shrink: 0;
}

.assignment-status.pending {
  background: rgba(156, 163, 175, 0.2);
  color: var(--color-grey);
}

.assignment-status.assigned {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.assignment-status.running {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.assignment-status.completed {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.assignment-status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.more-assignments {
  color: var(--color-text-muted);
  font-size: 0.7em;
  font-style: italic;
  margin-left: 12px;
  margin-top: 2px;
}

/* Agent Activity Styles */
.agent-activity {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
}

.agent-activity-label {
  color: var(--color-blue);
  font-size: 0.8em;
  font-weight: 600;
  margin-bottom: 6px;
}

.agent-decision-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-decision {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 0.75em;
  padding: 2px 0;
}

.agent-decision i {
  color: var(--color-blue);
  font-size: 0.7em;
}

.decision-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.decision-time {
  color: var(--color-text-muted);
  opacity: 0.7;
  font-size: 0.9em;
  flex-shrink: 0;
}

/* Retry Decision Styles */
.agent-decision.retry-attempt {
  background: rgba(255, 193, 7, 0.1);
  border-radius: 4px;
  padding: 4px 6px;
  margin: 2px 0;
}

.agent-decision.retry-attempt i {
  color: var(--color-yellow);
}

.agent-decision.retry-success {
  background: rgba(34, 197, 94, 0.1);
  border-radius: 4px;
  padding: 4px 6px;
  margin: 2px 0;
}

.agent-decision.retry-success i {
  color: var(--color-green);
}

.agent-decision.retry-failure {
  background: rgba(239, 68, 68, 0.1);
  border-radius: 4px;
  padding: 4px 6px;
  margin: 2px 0;
}

.agent-decision.retry-failure i {
  color: var(--color-red);
}

.retry-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  font-size: 0.7em;
  width: 100%;
}

.retry-attempts {
  color: var(--color-blue);
  font-weight: 500;
  background: rgba(59, 130, 246, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  align-self: flex-start;
}

.retry-error {
  color: var(--color-red);
  background: rgba(239, 68, 68, 0.1);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  cursor: help;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retry-error:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Artifacts Styles */
.goal-artifacts {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
}

.artifacts-label {
  color: var(--color-yellow);
  font-size: 0.8em;
  font-weight: 600;
  margin-bottom: 6px;
}

.artifact-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.artifact-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 6px;
  color: var(--color-yellow);
  font-size: 0.75em;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.artifact-button:hover {
  background: rgba(255, 193, 7, 0.2);
  border-color: rgba(255, 193, 7, 0.5);
  transform: translateX(2px);
}

.artifact-button i {
  font-size: 0.8em;
  flex-shrink: 0;
}

.artifact-size {
  color: var(--color-text-muted);
  opacity: 0.7;
  font-size: 0.9em;
  margin-left: auto;
}

.more-artifacts {
  color: var(--color-text-muted);
  font-size: 0.7em;
  font-style: italic;
  margin-left: 12px;
  margin-top: 2px;
}

/* Task I/O Summary Styles */
.task-io-summary {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
}

.task-io-label {
  color: var(--color-green);
  font-size: 0.8em;
  font-weight: 600;
  margin-bottom: 6px;
}

.task-io-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-io-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.75em;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.task-io-button:hover {
  background: rgba(25, 239, 131, 0.2);
  border-color: rgba(25, 239, 131, 0.5);
  transform: translateX(2px);
}

.task-io-button.has-error {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-red);
}

.task-io-button.has-error:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.task-io-button i {
  font-size: 0.8em;
  flex-shrink: 0;
}

.io-indicator {
  color: var(--color-text-muted);
  opacity: 0.7;
  font-size: 0.9em;
  margin-left: auto;
  text-transform: uppercase;
  font-weight: 500;
}

.task-io-button.has-error .io-indicator {
  color: var(--color-red);
  opacity: 1;
}

.more-task-io {
  color: var(--color-text-muted);
  font-size: 0.7em;
  font-style: italic;
  margin-left: 12px;
  margin-top: 2px;
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

/* Responsive Design */
@media (max-width: 768px) {
  .goals-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .goal-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .goal-actions {
    align-self: flex-end;
  }
}

@media (max-width: 480px) {
  .goal-card {
    padding: 16px;
  }

  .progress-cell {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .progress-text {
    align-self: flex-end;
  }
}

/* Artifact Modal Styles */
.artifact-modal-overlay {
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
  backdrop-filter: blur(4px);
}

.artifact-modal {
  background: var(--terminal-bg-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  width: 90vw;
  max-width: 800px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.artifact-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.artifact-modal-header h3 {
  color: var(--color-text);
  margin: 0;
  font-size: 1.2em;
  font-weight: 600;
}

.modal-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.modal-download-btn {
  background: rgba(25, 239, 131, 0.2);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-download-btn:hover {
  background: rgba(25, 239, 131, 0.3);
  border-color: rgba(25, 239, 131, 0.5);
  transform: translateY(-1px);
}

.modal-close-btn {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: var(--color-red);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close-btn:hover {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
}

.artifact-modal-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.artifact-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--color-text-muted);
  gap: 12px;
}

.artifact-loading i {
  color: var(--color-green);
}

.artifact-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.artifact-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  font-size: 0.9em;
  color: var(--color-text-muted);
}

.artifact-size {
  color: var(--color-yellow);
  font-weight: 500;
}

.artifact-date {
  opacity: 0.7;
}

.artifact-json {
  flex: 1;
  margin: 0;
  padding: 20px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--color-light-green);
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
  line-height: 1.4;
  overflow: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.artifact-markdown {
  flex: 1;
  margin: 0;
  padding: 20px;
  background: rgba(0, 0, 0, 0.1);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 0.9em;
  line-height: 1.6;
  overflow: auto;
}

.artifact-markdown h1 {
  color: var(--color-green);
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 16px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid rgba(25, 239, 131, 0.3);
}

.artifact-markdown h2 {
  color: var(--color-blue);
  font-size: 1.4em;
  font-weight: 600;
  margin: 24px 0 12px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(59, 130, 246, 0.3);
}

.artifact-markdown h3 {
  color: var(--color-yellow);
  font-size: 1.2em;
  font-weight: 600;
  margin: 20px 0 10px 0;
}

.artifact-markdown strong {
  color: var(--color-green);
  font-weight: 600;
}

.artifact-markdown em {
  color: var(--color-blue);
  font-style: italic;
}

.artifact-markdown br {
  margin-bottom: 8px;
}

.artifact-text {
  flex: 1;
  margin: 0;
  padding: 20px;
  background: var(--color-darker-0);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 0.9em;
  line-height: 1.5;
  overflow: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.artifact-html {
  flex: 1;
  margin: 0;
  padding: 20px;
  background: rgba(0, 0, 0, 0.1);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 0.9em;
  line-height: 1.5;
  overflow: auto;
}

.artifact-type {
  background: rgba(25, 239, 131, 0.2);
  color: var(--color-green);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: 500;
  text-transform: uppercase;
}

.artifact-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--color-red);
  font-style: italic;
}

.show-all-artifacts-btn {
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 6px;
  color: var(--color-yellow);
  font-size: 0.7em;
  padding: 2px 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.show-all-artifacts-btn:hover {
  background: rgba(255, 193, 7, 0.2);
  border-color: rgba(255, 193, 7, 0.5);
}

/* Goal Evaluation Styles */
.goal-evaluation {
  margin-top: 12px;
  padding: 12px;
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 6px;
}

.evaluation-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--color-blue);
  font-size: 0.85em;
}

.evaluation-header i {
  font-size: 0.9em;
}

.eval-score {
  margin-left: auto;
  font-size: 1.1em;
  font-weight: 700;
}

.eval-score.passed {
  color: var(--color-green);
}

.eval-score.failed {
  color: var(--color-yellow);
}

.evaluation-scores {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.score-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75em;
  color: var(--color-text-muted);
}

.score-label {
  font-weight: 500;
}

.score-value {
  font-weight: 600;
  color: var(--color-text);
}

.view-report-btn {
  width: 100%;
  padding: 6px 12px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 6px;
  color: var(--color-blue);
  font-size: 0.75em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.view-report-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
}

.view-report-btn i {
  font-size: 0.9em;
}

/* Evaluation Modal Styles */
.evaluation-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  backdrop-filter: blur(6px);
}

.evaluation-modal {
  background: var(--terminal-bg-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  width: 90vw;
  max-width: 900px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.6);
}

.evaluation-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
}

.evaluation-modal-header h3 {
  color: var(--color-text);
  margin: 0;
  font-size: 1.3em;
  font-weight: 600;
}

.evaluation-modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.evaluation-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: var(--color-text-muted);
  gap: 12px;
  font-size: 1.1em;
}

.evaluation-loading i {
  color: var(--color-blue);
  font-size: 1.5em;
}

.evaluation-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.scores-section {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 16px;
}

.score-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  transition: all 0.2s ease;
}

.score-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.score-card.overall {
  border-color: var(--color-blue);
  border-width: 2px;
}

.score-label {
  font-size: 0.9em;
  color: var(--color-text-muted);
  font-weight: 600;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.score-value {
  font-size: 2em;
  font-weight: 700;
  margin-bottom: 8px;
}

.score-value.large {
  font-size: 3em;
}

.score-value.high {
  color: var(--color-green);
}

.score-value.medium {
  color: var(--color-yellow);
}

.score-value.low {
  color: var(--color-red);
}

.score-description {
  font-size: 0.8em;
  color: var(--color-text-muted);
  opacity: 0.8;
}

.score-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.score-status.passed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.score-status.failed {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.feedback-section {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 20px;
}

.feedback-section h4 {
  color: var(--color-green);
  margin: 0 0 16px 0;
  font-size: 1.1em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.feedback-section h4 i {
  color: var(--color-blue);
}

.feedback-content {
  color: var(--color-text);
  line-height: 1.6;
  font-size: 0.95em;
  white-space: pre-wrap;
}

.task-evaluations-section {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 20px;
}

.task-evaluations-section h4 {
  color: var(--color-green);
  margin: 0 0 16px 0;
  font-size: 1.1em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-evaluations-section h4 i {
  color: var(--color-yellow);
}

.task-eval-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-eval-card {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 12px;
  transition: all 0.2s ease;
}

.task-eval-card:hover {
  background: rgba(0, 0, 0, 0.3);
  border-color: rgba(59, 130, 246, 0.3);
}

.task-eval-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.task-number {
  padding: 4px 8px;
  background: rgba(59, 130, 246, 0.2);
  border-radius: 6px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-blue);
  flex-shrink: 0;
}

.task-eval-header .task-title {
  flex: 1;
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.9em;
}

.task-score {
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 0.85em;
  font-weight: 700;
  flex-shrink: 0;
}

.task-score.high {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.task-score.medium {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.task-score.low {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.task-eval-feedback {
  color: var(--color-text-muted);
  font-size: 0.85em;
  line-height: 1.5;
  padding-left: 8px;
  border-left: 2px solid rgba(59, 130, 246, 0.3);
}

.evaluation-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--terminal-border-color);
}

.golden-standard-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, rgba(255, 193, 7, 0.2), rgba(255, 193, 7, 0.1));
  border: 1px solid rgba(255, 193, 7, 0.4);
  border-radius: 8px;
  color: var(--color-yellow);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.golden-standard-btn:hover {
  background: linear-gradient(135deg, rgba(255, 193, 7, 0.3), rgba(255, 193, 7, 0.2));
  border-color: rgba(255, 193, 7, 0.6);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 193, 7, 0.2);
}

.golden-standard-btn i {
  font-size: 1.1em;
}

.close-report-btn {
  padding: 10px 20px;
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.close-report-btn:hover {
  background: rgba(127, 129, 147, 0.2);
  border-color: rgba(127, 129, 147, 0.4);
}

.evaluation-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: var(--color-red);
  font-style: italic;
  font-size: 1.1em;
}

/* Modal Responsive Design */
@media (max-width: 768px) {
  .artifact-modal {
    width: 95vw;
    max-height: 85vh;
  }

  .artifact-modal-header {
    padding: 16px;
  }

  .artifact-json {
    padding: 16px;
    font-size: 0.8em;
  }

  .evaluation-modal {
    width: 95vw;
    max-height: 90vh;
  }

  .scores-section {
    grid-template-columns: 1fr;
  }

  .evaluation-actions {
    flex-direction: column;
  }

  .golden-standard-btn,
  .close-report-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
