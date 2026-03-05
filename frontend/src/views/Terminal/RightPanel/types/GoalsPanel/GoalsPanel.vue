<template>
  <div class="goal-panel">
    <div v-if="selectedGoal" class="goal-details">
      <!-- Header: title + close -->
      <div class="goal-header">
        <div class="goal-header-left">
          <h2 class="goal-title">{{ selectedGoal.title || 'Untitled Goal' }}</h2>
          <div class="goal-status" :class="(selectedGoal.status || '').toLowerCase()">
            <i :class="getStatusIcon(selectedGoal.status)"></i>
            [{{ selectedGoal.status }}]
          </div>
        </div>
        <button class="close-btn" @click="closePanel" title="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Description -->
      <div v-if="selectedGoal.description" class="goal-description">
        {{ selectedGoal.description }}
      </div>

      <!-- Info rows -->
      <div class="goal-info">
        <div class="info-item">
          <span class="info-label">Created:</span>
          <span class="info-value">{{ formatDate(selectedGoal.created_at) }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Tasks:</span>
          <span class="info-value">{{ selectedGoal.completed_tasks || 0 }}/{{ selectedGoal.task_count || 0 }}</span>
        </div>
        <div v-if="selectedGoal.priority" class="info-item">
          <span class="info-label">Priority:</span>
          <span class="info-value">{{ selectedGoal.priority }}</span>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="goal-progress" v-if="goalProgress > 0 || selectedGoal.status === 'executing'">
        <h3>Progress</h3>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${goalProgress}%` }"></div>
          <span class="progress-text">{{ goalProgress }}%</span>
        </div>
      </div>

      <!-- Tasks list -->
      <div v-if="selectedGoal.tasks && selectedGoal.tasks.length > 0" class="goal-tasks">
        <h3>Tasks ({{ selectedGoal.tasks.length }})</h3>
        <div class="tasks-list">
          <div v-for="(task, index) in selectedGoal.tasks" :key="task.id" class="task-card" :class="(task.status || '').toLowerCase()">
            <div class="task-header">
              <div class="task-info">
                <span class="task-name">{{ task.title || 'Untitled Task' }}</span>
                <span class="task-index">Task {{ index + 1 }}</span>
              </div>
              <span :class="['task-status', (task.status || '').toLowerCase()]">
                <i :class="getStatusIcon(task.status)"></i>
                {{ task.status }}
              </span>
            </div>

            <div v-if="task.agent_name" class="task-agent"><i class="fas fa-robot"></i> {{ task.agent_name }}</div>

            <div v-if="task.description" class="task-desc">{{ task.description }}</div>

            <div class="task-timing">
              <span v-if="task.started_at">Started: {{ formatTime(task.started_at) }}</span>
              <span v-if="task.completed_at">Done: {{ formatTime(task.completed_at) }}</span>
            </div>

            <!-- Output -->
            <div v-if="task.output" class="task-output-section">
              <div class="output-header">
                <span class="output-label">Output</span>
                <button class="raw-toggle" @click="toggleRawView(task.id)" :title="isRawView(task.id) ? 'View Rendered' : 'View Raw'">
                  <i :class="isRawView(task.id) ? 'fas fa-eye' : 'fas fa-code'"></i>
                  {{ isRawView(task.id) ? 'Rendered' : 'Raw' }}
                </button>
              </div>
              <div v-if="isRawView(task.id)" class="output-raw">
                <pre class="io-data">{{ formatJSON(task.output) }}</pre>
              </div>
              <div v-else class="output-rendered" v-html="renderOutput(task.output)"></div>
            </div>

            <!-- Tool Executions -->
            <div v-if="getToolExecutions(task.output).length > 0" class="task-io-section tool-executions-section">
              <div class="io-toggle" @click="toggleNodeSection(task.id, 'tools')">
                <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'tools') }"></i>
                <span>Tool Executions ({{ getToolExecutions(task.output).length }})</span>
              </div>
              <div v-show="isNodeSectionExpanded(task.id, 'tools')" class="io-body">
                <div
                  v-for="(tool, tIdx) in getToolExecutions(task.output)"
                  :key="tIdx"
                  class="tool-exec-item"
                  :class="{ 'tool-error': toolHasError(tool) }"
                >
                  <div class="tool-exec-header" @click="toggleNodeSection(task.id, 'tool-' + tIdx)">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'tool-' + tIdx) }"></i>
                    <span class="tool-exec-name">{{ formatToolName(tool.name || tool.toolName || 'unknown') }}</span>
                    <span class="tool-exec-badge" :class="toolHasError(tool) ? 'badge-error' : 'badge-ok'">
                      {{ toolHasError(tool) ? 'error' : 'ok' }}
                    </span>
                  </div>
                  <div v-show="isNodeSectionExpanded(task.id, 'tool-' + tIdx)" class="tool-exec-details">
                    <div v-if="tool.arguments || tool.args || tool.input" class="tool-exec-block">
                      <div class="tool-exec-block-label">Input</div>
                      <pre class="io-data">{{ formatToolResponse(tool.arguments || tool.args || tool.input) }}</pre>
                    </div>
                    <div v-if="tool.response || tool.output || tool.result" class="tool-exec-block">
                      <div class="tool-exec-block-label">Output</div>
                      <pre class="io-data" :class="{ 'error-text': toolHasError(tool) }">{{ formatToolResponse(tool.response || tool.output || tool.result) }}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Error -->
            <div v-if="task.error" class="task-io-section error">
              <div class="io-toggle" @click="toggleNodeSection(task.id, 'error')">
                <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'error') }"></i>
                <span>Error</span>
              </div>
              <div v-show="isNodeSectionExpanded(task.id, 'error')" class="io-body">
                <pre class="io-data error-text">{{ task.error }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Evaluation -->
      <div v-if="selectedGoal.evaluation" class="goal-evaluation">
        <div class="output-header">
          <h3 style="margin: 0">Evaluation</h3>
          <button class="raw-toggle" @click="toggleRawView('eval')" :title="isRawView('eval') ? 'View Rendered' : 'View Raw'">
            <i :class="isRawView('eval') ? 'fas fa-eye' : 'fas fa-code'"></i>
            {{ isRawView('eval') ? 'Rendered' : 'Raw' }}
          </button>
        </div>
        <div v-if="isRawView('eval')" class="output-raw">
          <pre class="eval-log">{{ formatJSON(selectedGoal.evaluation) }}</pre>
        </div>
        <div v-else class="output-rendered" v-html="renderOutput(selectedGoal.evaluation)"></div>
      </div>

      <!-- AGI Loop: Iteration Timeline -->
      <div v-if="goalIterations.length > 0" class="goal-iterations">
        <h3><i class="fas fa-sync-alt"></i> Iterations ({{ goalIterations.length }})</h3>
        <div class="iteration-timeline">
          <div
            v-for="iter in goalIterations"
            :key="iter.iteration_number"
            class="iteration-item"
            :class="{ passed: iter.evaluation_passed, failed: !iter.evaluation_passed }"
          >
            <div class="iteration-header">
              <span class="iteration-number">#{{ iter.iteration_number }}</span>
              <span class="iteration-score" :class="iter.evaluation_passed ? 'score-pass' : 'score-fail'">
                {{ iter.evaluation_score ? Math.round(iter.evaluation_score) : 0 }}%
              </span>
              <span v-if="iter.git_commit_hash" class="iteration-hash" :title="iter.git_commit_hash">
                <i class="fas fa-code-branch"></i> {{ iter.git_commit_hash.substring(0, 7) }}
              </span>
            </div>
            <div class="iteration-meta">
              <span v-if="iter.duration_ms"><i class="fas fa-clock"></i> {{ (iter.duration_ms / 1000).toFixed(1) }}s</span>
              <span v-if="iter.replanned_tasks && iter.replanned_tasks.length">
                <i class="fas fa-redo"></i> {{ iter.replanned_tasks.length }} re-planned
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- AGI Loop: Live iteration indicator -->
      <div v-if="liveIteration" class="goal-live-iteration">
        <h3><i class="fas fa-cog fa-spin"></i> Live Iteration #{{ liveIteration.iteration }}</h3>
        <div class="live-phase">
          <span class="phase-badge" :class="liveIteration.phase">{{ formatPhase(liveIteration.phase) }}</span>
          <span v-if="liveIteration.score" class="live-score">{{ Math.round(liveIteration.score) }}%</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="goal-actions">
        <Tooltip text="Copy Details" width="auto">
          <button class="action-button edit" @click="copyGoalDetails">
            <i :class="showCopiedMessage ? 'fas fa-check' : 'fas fa-copy'"></i>
            {{ showCopiedMessage ? 'Copied!' : 'Copy Details' }}
          </button>
        </Tooltip>

        <!-- Standby actions -->
        <template v-if="canStartAutonomous">
          <button class="action-button start" @click="startAutonomous" :disabled="isStartingAutonomous">
            <i :class="isStartingAutonomous ? 'fas fa-spinner fa-spin' : 'fas fa-infinity'"></i>
            {{ isStartingAutonomous ? 'Starting...' : 'Start Autonomous' }}
          </button>
          <button class="action-button" @click="executeSinglePass"><i class="fas fa-play"></i> Execute Once</button>
        </template>

        <!-- Active actions -->
        <template v-else-if="selectedGoal.status === 'executing' || selectedGoal.status === 'paused'">
          <button v-if="selectedGoal.status === 'executing'" class="action-button stop" @click="pauseGoal"><i class="fas fa-pause"></i> Pause</button>
          <button v-if="selectedGoal.status === 'paused'" class="action-button start" @click="resumeGoal"><i class="fas fa-play"></i> Resume</button>
        </template>

        <!-- Done actions -->
        <template v-else-if="isGoalDone">
          <button class="action-button edit" @click="reviewOutputs"><i class="fas fa-file-alt"></i> Review Outputs</button>
          <button class="action-button" @click="evaluateGoal"><i class="fas fa-chart-bar"></i> Evaluate</button>
          <button class="action-button" @click="startAutonomous"><i class="fas fa-redo"></i> Retry</button>
        </template>
      </div>
    </div>

    <!-- No goal selected -->
    <div v-else class="no-goal-selected">
      <p>Select a goal to view details.</p>
      <BaseButton variant="primary" class="create-goal-button" @click="$emit('panel-action', 'create-goal')">
        <i class="fas fa-plus"></i>
        Create New Goal
      </BaseButton>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import showdown from 'showdown';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';

const mdConverter = new showdown.Converter({
  tables: true,
  strikethrough: true,
  literalMidWordUnderscores: true,
  simpleLineBreaks: true,
  ghCodeBlocks: true,
});

export default {
  name: 'GoalsPanel',
  components: {
    ResourcesSection,
    Tooltip,
    BaseButton,
  },
  props: {
    selectedGoalId: {
      type: String,
      default: null,
    },
    goals: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['panel-action'],
  setup(props, { emit, expose }) {
    const store = useStore();

    // Node section expansion state
    const expandedNodeSections = ref({});
    const rawViewTasks = ref({});
    const selectedGoal = ref(null);
    const showCopiedMessage = ref(false);
    const isStartingAutonomous = ref(false);

    const toggleRawView = (taskId) => {
      rawViewTasks.value[taskId] = !rawViewTasks.value[taskId];
    };

    const isRawView = (taskId) => {
      return rawViewTasks.value[taskId] || false;
    };

    const renderOutput = (data) => {
      if (!data) return '';

      // Guard against bad serialization like "[object Object]"
      if (typeof data === 'string' && data.includes('[object Object]')) {
        return '<p><em>Raw object data — use Raw view to inspect</em></p>';
      }

      // Parse if it's a JSON string
      let parsed = data;
      if (typeof parsed === 'string') {
        try {
          const trimmed = parsed.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            parsed = JSON.parse(trimmed);
          }
        } catch (e) {
          // Not JSON — treat as plain text/markdown
          return mdConverter.makeHtml(parsed);
        }
      }

      // If it's still a plain string after parsing attempt, render as markdown
      if (typeof parsed === 'string') {
        return mdConverter.makeHtml(parsed);
      }

      // Extract renderable text from structured output objects
      const extractText = (obj, depth = 0) => {
        if (depth > 5) return null;
        if (typeof obj === 'string') return obj;
        if (!obj || typeof obj !== 'object') return null;

        // Task output shape: { content, toolExecutions, files, timestamp }
        // Evaluation shape: { score, passed, summary, ... }
        for (const key of ['content', 'summary', 'text', 'message', 'result', 'report', 'output', 'description', 'body', 'response']) {
          if (obj[key] && typeof obj[key] === 'string') return obj[key];
          // Handle content as array of {type: "text", text: "..."} objects
          if (obj[key] && Array.isArray(obj[key])) {
            const texts = obj[key]
              .filter(item => item && typeof item === 'object' && item.text)
              .map(item => item.text);
            if (texts.length) return texts.join('\n\n');
          }
          // Recurse into nested objects
          if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            const nested = extractText(obj[key], depth + 1);
            if (nested) return nested;
          }
        }

        if (Array.isArray(obj)) {
          const items = obj.map((item) => extractText(item, depth + 1)).filter(Boolean);
          if (items.length) return items.join('\n\n');
        }

        return null;
      };

      const text = extractText(parsed);
      if (!text) {
        const json = JSON.stringify(parsed, null, 2);
        return `<pre><code>${json.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
      }

      return mdConverter.makeHtml(text);
    };

    const goalProgress = computed(() => {
      if (!selectedGoal.value) return 0;
      return store.getters['goals/getGoalProgress']?.(selectedGoal.value) || selectedGoal.value.progress || 0;
    });

    // AGI Loop computed
    const goalIterations = computed(() => {
      if (!selectedGoal.value) return [];
      return store.getters['goals/getIterations'](selectedGoal.value.id);
    });

    const liveIteration = computed(() => {
      if (!selectedGoal.value) return null;
      return store.getters['goals/getLiveIteration'](selectedGoal.value.id);
    });

    const canStartAutonomous = computed(() => {
      if (!selectedGoal.value) return false;
      const s = selectedGoal.value.status;
      return ['planning', 'queued', 'needs_review'].includes(s);
    });

    const isGoalDone = computed(() => {
      if (!selectedGoal.value) return false;
      return ['completed', 'validated', 'failed', 'error', 'stopped'].includes(selectedGoal.value.status);
    });

    // Fetch iterations when a goal is selected
    watch(selectedGoal, (goal) => {
      if (goal) {
        store.dispatch('goals/fetchIterations', goal.id);
      }
    });

    const startAutonomous = async () => {
      if (!selectedGoal.value) return;
      isStartingAutonomous.value = true;
      try {
        await store.dispatch('goals/executeGoalAutonomous', {
          goalId: selectedGoal.value.id,
          maxIterations: 50,
        });
        emit('panel-action', 'show-feedback', {
          type: 'success',
          message: '[AGI Loop] Autonomous execution started',
        });
      } catch (error) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: `[AGI Loop] Error: ${error.message}`,
        });
      } finally {
        isStartingAutonomous.value = false;
      }
    };

    const pauseGoal = async () => {
      if (!selectedGoal.value) return;
      await store.dispatch('goals/pauseGoal', selectedGoal.value.id);
    };

    const resumeGoal = async () => {
      if (!selectedGoal.value) return;
      await store.dispatch('goals/resumeGoal', selectedGoal.value.id);
    };

    const executeSinglePass = async () => {
      if (!selectedGoal.value) return;
      try {
        await store.dispatch('goals/executeGoal', selectedGoal.value.id);
        emit('panel-action', 'show-feedback', {
          type: 'success',
          message: '[Goals] Single-pass execution started',
        });
      } catch (error) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: `[Goals] Error: ${error.message}`,
        });
      }
    };

    const reviewOutputs = async () => {
      if (!selectedGoal.value) return;
      // Fetch full goal with tasks to show outputs
      await store.dispatch('goals/fetchGoalTasks', selectedGoal.value.id);
      const updated = store.getters['goals/getGoalById'](selectedGoal.value.id);
      if (updated) selectedGoal.value = updated;
      // Expand all output sections
      if (updated?.tasks) {
        updated.tasks.forEach((task) => {
          if (task.output) {
            expandedNodeSections.value[`${task.id}-output`] = true;
          }
        });
      }
    };

    const evaluateGoal = async () => {
      if (!selectedGoal.value) return;
      try {
        await store.dispatch('goals/evaluateGoal', {
          goalId: selectedGoal.value.id,
          evaluationType: 'automatic',
        });
        // Refresh to show evaluation
        const updated = store.getters['goals/getGoalById'](selectedGoal.value.id);
        if (updated) selectedGoal.value = updated;
        emit('panel-action', 'show-feedback', {
          type: 'success',
          message: '[Goals] Evaluation complete',
        });
      } catch (error) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: `[Goals] Evaluation error: ${error.message}`,
        });
      }
    };

    const formatPhase = (phase) => {
      const labels = {
        executing: 'Executing Tasks',
        evaluating: 'Evaluating Results',
        replanning: 'Re-planning Tasks',
        checkpointing: 'Git Checkpoint',
        completed: 'Iteration Done',
      };
      return labels[phase] || phase;
    };

    // Watch for selectedGoalId changes
    watch(
      () => props.selectedGoalId,
      (newId) => {
        if (!newId) {
          selectedGoal.value = null;
        } else {
          // If we have an ID, try to find the goal in the props or store
          const foundGoal = props.goals.find((g) => g.id === newId) || store.getters['goals/getGoalById'](newId);
          if (foundGoal) {
            selectedGoal.value = foundGoal;
          }
        }
      },
      { immediate: true },
    );

    // Method to update selected goal from parent
    const updateSelectedGoal = (goal) => {
      selectedGoal.value = goal;
    };

    // Expose method to parent component
    const handlePanelAction = (action, payload) => {
      if (action === 'update-goal-details') {
        updateSelectedGoal(payload);
      }
    };

    // Expose methods for external access
    expose({
      updateSelectedGoal,
      handlePanelAction,
    });

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

    // Status icon helper
    const getStatusIcon = (status) => {
      const icons = {
        planning: 'fas fa-lightbulb',
        queued: 'fas fa-clock',
        executing: 'fas fa-cog fa-spin',
        paused: 'fas fa-pause',
        needs_review: 'fas fa-exclamation-triangle',
        validated: 'fas fa-check-double',
        completed: 'fas fa-check',
        failed: 'fas fa-times',
        error: 'fas fa-times',
        stopped: 'fas fa-stop',
      };
      return icons[status] || 'fas fa-circle';
    };

    // Date formatting
    const formatDate = (dateString) => {
      if (!dateString) return '-';
      return new Date(dateString).toLocaleString();
    };

    const copyGoalDetails = () => {
      if (!selectedGoal.value) return;

      const goal = selectedGoal.value;
      const details = `
Goal Details:
ID: ${goal.id}
Title: ${goal.title || 'Untitled Goal'}
Status: ${goal.status}
Created At: ${formatDate(goal.created_at)}
Progress: ${goal.progress || 0}%
Tasks: ${goal.completed_tasks || 0}/${goal.task_count || 0}

Description:
${goal.description || 'No description'}

${
  goal.tasks && goal.tasks.length > 0
    ? `
Tasks:
${goal.tasks
  .map(
    (task, index) => `
  Task ${index + 1}: ${task.title || 'Untitled'}
  Status: ${task.status}
  Started: ${task.started_at ? formatDate(task.started_at) : '-'}
  Completed: ${task.completed_at ? formatDate(task.completed_at) : '-'}
`,
  )
  .join('')}
`
    : ''
}
      `.trim();

      navigator.clipboard.writeText(details).then(() => {
        // Show visual indicator
        showCopiedMessage.value = true;
        setTimeout(() => {
          showCopiedMessage.value = false;
        }, 2000);

        emit('panel-action', 'show-feedback', { type: 'success', message: 'Copied' });
      });
    };

    const closePanel = () => {
      selectedGoal.value = null;
      emit('panel-action', 'close-panel');
    };

    // Tool execution helpers
    const getToolExecutions = (output) => {
      if (!output) return [];
      let parsed = output;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (e) {
          return [];
        }
      }
      if (parsed && Array.isArray(parsed.toolExecutions)) return parsed.toolExecutions;
      return [];
    };

    const toolHasError = (tool) => {
      const resp = tool.response || tool.output || tool.result || '';
      const str = typeof resp === 'string' ? resp : JSON.stringify(resp);
      try {
        const parsed = JSON.parse(str);
        if (parsed && (parsed.error || parsed.status === 'error')) return true;
      } catch (e) {
        // not JSON
      }
      return false;
    };

    const formatToolName = (name) => {
      return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    const formatToolResponse = (data) => {
      if (!data) return '';
      if (typeof data === 'string') {
        try {
          return JSON.stringify(JSON.parse(data), null, 2);
        } catch (e) {
          return data;
        }
      }
      try {
        return JSON.stringify(data, null, 2);
      } catch (e) {
        return String(data);
      }
    };

    return {
      selectedGoal,
      showCopiedMessage,
      goalProgress,
      toggleNodeSection,
      isNodeSectionExpanded,
      toggleRawView,
      isRawView,
      renderOutput,
      formatTime,
      getDataSize,
      formatJSON,
      getStatusIcon,
      formatDate,
      copyGoalDetails,
      updateSelectedGoal,
      handlePanelAction,
      closePanel,
      // Tool execution helpers
      getToolExecutions,
      toolHasError,
      formatToolName,
      formatToolResponse,
      // AGI Loop
      goalIterations,
      liveIteration,
      canStartAutonomous,
      isGoalDone,
      isStartingAutonomous,
      startAutonomous,
      pauseGoal,
      resumeGoal,
      executeSinglePass,
      reviewOutputs,
      evaluateGoal,
      formatPhase,
    };
  },
};
</script>

<style scoped>
/* Panel layout — matches WorkflowsPanel */
.goal-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: none;
}

/* Header */
.goal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--primary-rgb), 0.1);
  padding-bottom: 8px;
  gap: 8px;
}

.goal-header-left {
  flex: 1;
  min-width: 0;
}

.close-btn {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--color-red);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
  flex-shrink: 0;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.goal-title {
  color: var(--color-text);
  font-size: 1.1em;
  margin: 0 0 5px 0;
}

.goal-status {
  font-size: 0.9em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

.goal-status.executing,
.goal-status.running {
  color: var(--color-primary);
}
.goal-status.completed,
.goal-status.validated {
  color: var(--color-green);
}
.goal-status.failed,
.goal-status.error {
  color: var(--color-red);
}
.goal-status.paused,
.goal-status.needs_review {
  color: var(--color-yellow);
}
.goal-status.planning,
.goal-status.queued {
  color: var(--color-text-muted);
}

/* Description */
.goal-description {
  margin-bottom: 18px;
  line-height: 1.4;
  color: var(--color-white);
}

/* Info rows */
.goal-info {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-label {
  color: var(--color-grey);
}

.info-value {
  color: var(--color-text);
}

/* Progress */
.goal-progress {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 15px;
}

h3 {
  color: var(--color-grey);
  font-size: 0.9em;
  margin-bottom: 10px;
}

.progress-bar {
  height: 20px;
  background: rgba(var(--primary-rgb), 0.1);
  border-radius: 10px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.3s ease;
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--color-white);
  font-size: 0.8em;
}

/* Tasks list */
.goal-tasks {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 15px;
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 500px;
  overflow-y: auto;
}

.task-card {
  border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-green);
  border-radius: 6px;
  padding: 12px;
  transition: all 0.2s ease;
}

.task-card:hover {
  background: rgba(0, 0, 0, 0.1);
}

.task-card.executing,
.task-card.running {
  border-left-color: var(--color-blue);
}
.task-card.completed {
  border-left-color: var(--color-green);
}
.task-card.failed,
.task-card.error {
  border-left-color: var(--color-red);
}
.task-card.paused {
  border-left-color: var(--color-yellow);
}
.task-card.stopped {
  border-left-color: var(--color-text-muted);
}
.task-card.pending,
.task-card.queued {
  border-left-color: var(--color-grey);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  gap: 8px;
}

.task-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.task-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
}

.task-index {
  font-size: 0.8em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.task-status {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: 500;
  flex-shrink: 0;
}

.task-status.executing,
.task-status.running {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.task-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.task-status.failed,
.task-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.task-status.queued,
.task-status.pending {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.task-agent {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 0.85em;
  color: var(--color-blue);
}

.task-desc {
  color: var(--color-text-muted);
  font-size: 0.85em;
  line-height: 1.4;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--color-darker-0);
  border-radius: 4px;
  border-left: 2px solid rgba(var(--primary-rgb), 0.3);
}

.task-timing {
  display: flex;
  gap: 12px;
  font-size: 0.8em;
  color: var(--color-grey);
  flex-wrap: wrap;
  margin-bottom: 8px;
}

/* IO sections */
.task-io-section {
  margin-top: 8px;
  border: 1px solid rgba(var(--primary-rgb), 0.1);
  border-radius: 4px;
  overflow: hidden;
}

/* Rendered output section */
.task-output-section {
  margin-top: 8px;
  border: 1px solid rgba(var(--primary-rgb), 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.output-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(var(--primary-rgb), 0.05);
  font-size: 0.85em;
}

.output-label {
  font-weight: 600;
  color: var(--color-text);
}

.raw-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.2s;
}

.raw-toggle:hover {
  border-color: rgba(var(--primary-rgb), 0.5);
  color: var(--color-text);
}

.raw-toggle i {
  font-size: 0.8em;
}

.output-rendered {
  padding: 12px;
  color: var(--color-text);
  font-size: 0.9em;
  line-height: 1.6;
  overflow-y: auto;
  max-height: 400px;
  word-break: break-word;
}

.output-rendered :deep(h1),
.output-rendered :deep(h2),
.output-rendered :deep(h3),
.output-rendered :deep(h4) {
  color: var(--color-text);
  margin: 12px 0 6px 0;
}

.output-rendered :deep(h1) {
  font-size: 1.3em;
}
.output-rendered :deep(h2) {
  font-size: 1.15em;
}
.output-rendered :deep(h3) {
  font-size: 1.05em;
}

.output-rendered :deep(p) {
  margin: 6px 0;
}

.output-rendered :deep(ul),
.output-rendered :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}

.output-rendered :deep(li) {
  margin: 3px 0;
}

.output-rendered :deep(pre) {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  padding: 10px;
  overflow-x: auto;
  margin: 8px 0;
}

.output-rendered :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.output-rendered :deep(p code) {
  background: var(--color-darker-0);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--terminal-border-color);
}

.output-rendered :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 0.9em;
}

.output-rendered :deep(th),
.output-rendered :deep(td) {
  border: 1px solid var(--terminal-border-color);
  padding: 6px 10px;
  text-align: left;
}

.output-rendered :deep(th) {
  background: var(--color-darker-0);
  font-weight: 600;
}

.output-rendered :deep(blockquote) {
  border-left: 3px solid rgba(var(--primary-rgb), 0.4);
  margin: 8px 0;
  padding: 4px 12px;
  color: var(--color-text-muted);
}

.output-rendered :deep(a) {
  color: var(--color-primary);
}

.output-rendered :deep(hr) {
  border: none;
  border-top: 1px solid var(--terminal-border-color);
  margin: 12px 0;
}

.output-raw {
  max-height: 400px;
  overflow-y: auto;
}

.task-io-section.error {
  border-color: rgba(239, 68, 68, 0.3);
}

.io-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(var(--primary-rgb), 0.05);
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
  font-size: 0.85em;
}

.task-io-section.error .io-toggle {
  background: rgba(239, 68, 68, 0.08);
}

.io-toggle:hover {
  background: rgba(var(--primary-rgb), 0.1);
}

.io-toggle i {
  font-size: 0.75em;
  color: var(--color-primary);
  transition: transform 0.2s ease;
}

.io-toggle i.rotated {
  transform: rotate(90deg);
}

.io-size {
  font-size: 0.8em;
  color: var(--color-grey);
  margin-left: auto;
}

.io-body {
  border-top: 1px solid rgba(var(--primary-rgb), 0.1);
}

.io-data {
  background: var(--color-darker-0);
  padding: 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  max-height: 250px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--font-family-mono);
  line-height: 1.4;
}

.io-data.error-text {
  color: var(--color-red);
  background: rgba(239, 68, 68, 0.05);
}

/* Evaluation */
.goal-evaluation {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 15px;
}

.eval-log {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  padding: 10px;
  font-size: 0.85em;
  color: var(--color-text);
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Iterations */
.goal-iterations {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 15px;
}

.iteration-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.iteration-item {
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-grey);
}

.iteration-item.passed {
  border-left-color: var(--color-green);
  background: rgba(34, 197, 94, 0.05);
}

.iteration-item.failed {
  border-left-color: var(--color-yellow);
  background: rgba(255, 193, 7, 0.05);
}

.iteration-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.iteration-number {
  font-weight: 700;
  font-size: 0.9em;
  color: var(--color-text);
}

.iteration-score {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.8em;
  font-weight: 600;
}

.iteration-score.score-pass {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.iteration-score.score-fail {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.iteration-hash {
  font-size: 0.75em;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  margin-left: auto;
}

.iteration-meta {
  display: flex;
  gap: 12px;
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.iteration-meta i {
  margin-right: 4px;
}

/* Live iteration */
.goal-live-iteration {
  margin-top: 15px;
  border-top: 1px dashed rgba(59, 130, 246, 0.3);
  padding-top: 15px;
  background: rgba(59, 130, 246, 0.05);
  border-radius: 4px;
  padding: 12px;
}

.goal-live-iteration h3 {
  color: var(--color-blue);
}

.live-phase {
  display: flex;
  align-items: center;
  gap: 12px;
}

.phase-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
}

.phase-badge.executing {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}
.phase-badge.evaluating {
  background: rgba(168, 85, 247, 0.2);
  color: #a855f7;
}
.phase-badge.replanning {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}
.phase-badge.checkpointing,
.phase-badge.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.live-score {
  font-weight: 700;
  font-size: 1.1em;
  color: var(--color-text);
}

/* Actions — matches WorkflowsPanel */
.goal-actions {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  background: transparent;
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  color: var(--color-text);
  padding: 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.action-button:hover {
  background: rgba(var(--primary-rgb), 0.1);
  border-color: var(--color-primary);
}

.action-button.edit {
  border-color: rgba(var(--primary-rgb), 0.5);
  color: var(--color-primary);
}

.action-button.edit:hover {
  background: rgba(var(--primary-rgb), 0.15);
  border-color: var(--color-primary);
}

.action-button.start {
  border-color: rgba(34, 197, 94, 0.3);
  color: var(--color-green);
}

.action-button.start:hover {
  background: rgba(34, 197, 94, 0.1);
  border-color: var(--color-green);
}

.action-button.stop {
  border-color: rgba(255, 99, 71, 0.3);
  color: tomato;
}

.action-button.stop:hover {
  background: rgba(255, 99, 71, 0.1);
  border-color: tomato;
}

.action-button.delete {
  border-color: rgba(255, 99, 71, 0.3);
  color: tomato;
}

.action-button.delete:hover {
  background: rgba(255, 99, 71, 0.1);
  border-color: tomato;
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* No goal selected */
.no-goal-selected {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.no-goal-selected p {
  font-style: italic;
  margin: 0;
  padding: 0;
  margin-bottom: 16px;
}

.create-goal-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* Tool Executions */
.tool-executions-section {
  border-color: rgba(var(--primary-rgb), 0.15);
}

.tool-exec-item {
  border-left: 3px solid var(--color-green);
  margin: 6px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.tool-exec-item.tool-error {
  border-left-color: var(--color-red);
}

.tool-exec-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 0.85em;
  user-select: none;
  transition: background 0.2s;
}

.tool-exec-header:hover {
  background: rgba(var(--primary-rgb), 0.08);
}

.tool-exec-header i {
  font-size: 0.75em;
  color: var(--color-primary);
  transition: transform 0.2s ease;
}

.tool-exec-header i.rotated {
  transform: rotate(90deg);
}

.tool-exec-name {
  color: var(--color-text);
  font-weight: 500;
}

.tool-exec-badge {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 0.8em;
  font-weight: 600;
}

.tool-exec-badge.badge-ok {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.tool-exec-badge.badge-error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.tool-exec-details {
  border-top: 1px solid rgba(var(--primary-rgb), 0.1);
}

.tool-exec-block {
  border-top: 1px solid rgba(var(--primary-rgb), 0.05);
}

.tool-exec-block:first-child {
  border-top: none;
}

.tool-exec-block-label {
  padding: 4px 10px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
