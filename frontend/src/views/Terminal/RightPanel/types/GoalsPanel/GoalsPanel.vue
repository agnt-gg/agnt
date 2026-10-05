<template>
  <div ref="panelRoot" class="goal-panel">
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
        <Tooltip text="Close">
          <button class="close-btn" @click="closePanel">
            <i class="fas fa-times"></i>
          </button>
        </Tooltip>
      </div>

      <!-- Description: clamped to a few lines; long ones expand on demand. -->
      <div v-if="selectedGoal.description" class="goal-description" :class="{ 'is-clamped': descriptionIsLong && !descriptionExpanded }">
        <div class="goal-description-text">{{ selectedGoal.description }}</div>
        <button v-if="descriptionIsLong" type="button" class="goal-description-toggle" @click="descriptionExpanded = !descriptionExpanded">
          {{ descriptionExpanded ? 'Show less' : 'Show more' }}
          <i :class="descriptionExpanded ? 'fas fa-chevron-up' : 'fas fa-chevron-down'"></i>
        </button>
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

      <!-- REVIEW. Answers, in order: did it pass, what did it make, and for
           each check, where is the proof. Nothing here needs "Show the work". -->

      <!-- 1. The verdict. Misses are named here, not left to be found. -->
      <section v-if="checklist.items.length" class="goal-section">
        <div v-if="verdict.evaluated" class="review-verdict" :class="verdict.missed.length ? 'has-missed' : 'all-met'" role="status">
          <i :class="verdict.missed.length ? 'fas fa-exclamation-triangle' : 'fas fa-check-circle'" aria-hidden="true"></i>
          <div>
            <strong>{{ verdict.met }} of {{ verdict.total }} checks met</strong><span v-if="evaluationScore !== null" class="review-score" v-tooltip="'The evaluator\'s weighted score for completeness and quality'"> · evaluator score {{ evaluationScore }}%</span>
            <small v-if="verdict.missed.length">Not met: {{ verdict.missed.map((m) => m.text).join(' · ') }}</small>
            <small v-else>Every check has the evaluator's evidence below.</small>
          </div>
        </div>
        <div v-else class="review-verdict is-pending" role="status">
          <i class="far fa-clock" aria-hidden="true"></i>
          <div><strong>Not checked yet</strong><small>The evaluator checks each item when the work is evaluated.</small></div>
        </div>
      </section>

      <!-- 2. The deliverable: what the checklist asked for, readable right here. -->
      <section v-if="deliverables.length" class="goal-section goal-deliverable">
        <h3>Deliverable</h3>
        <div v-for="file in deliverables" :key="file" class="review-file">
          <i class="fas fa-file-alt" aria-hidden="true"></i>
          <div class="review-file-name"><strong>{{ baseName(file) }}</strong><small v-tooltip="file">{{ file }}</small></div>
          <button type="button" class="raw-toggle" @click="openFile(file)"><i class="fas fa-external-link-alt"></i> Open</button>
        </div>
        <details v-if="report.text" class="review-preview">
          <summary>Read it here</summary>
          <div class="output-rendered" v-html="renderMarkdown(report.text)"></div>
        </details>
        <p v-else-if="report.error" class="checklist-hint">Couldn't read the file: {{ report.error }}</p>
      </section>

      <!-- 3. Each check, with its proof: evidence, the task, the file, the section. -->
      <section v-if="checklist.items.length" class="goal-section goal-checklist">
        <h3>
          Checklist
          <span v-if="checklist.evaluated" class="checklist-count">{{ checklist.met }}/{{ checklist.items.length }} met</span>
        </h3>
        <ul>
          <li v-for="item in reviewItems" :key="item.id" :class="item.met === true ? 'is-met' : item.met === false ? 'is-missed' : 'is-open'">
            <i :class="item.met === true ? 'fas fa-check-circle' : item.met === false ? 'fas fa-times-circle' : 'far fa-circle'" :aria-label="item.met === true ? 'Met' : item.met === false ? 'Not met' : 'Not checked'"></i>
            <div class="check-body">
              <span class="check-text">{{ item.text }}</span>
              <span v-if="item.met === false" class="check-tag">Not met</span>
              <p v-if="item.evidence && item.evidence !== 'Not assessed'" class="check-evidence">{{ item.evidence }}</p>
              <div v-if="item.proof.tasks.length || item.proof.files.length || item.proof.section" class="check-proof">
                <button v-for="t in item.proof.tasks" :key="'t' + t.number" type="button" class="proof-chip" @click="showTask(t.number)">
                  <i class="fas fa-tasks" aria-hidden="true"></i> Task {{ t.number }} · {{ t.title }}
                </button>
                <button v-for="f in item.proof.files" :key="f" type="button" class="proof-chip" @click="openFile(f)">
                  <i class="fas fa-file-alt" aria-hidden="true"></i> {{ baseName(f) }}
                </button>
                <button v-if="item.proof.section" type="button" class="proof-chip" :class="{ active: openSections[item.id] }" :aria-expanded="openSections[item.id] ? 'true' : 'false'" @click="toggleExcerpt(item.id)">
                  <i class="fas fa-paragraph" aria-hidden="true"></i> {{ item.proof.section.heading }} in the report
                </button>
              </div>
              <div v-if="item.proof.section && openSections[item.id]" class="check-excerpt">
                <div class="check-excerpt-head">
                  <span>From {{ report.path ? baseName(report.path) : 'the report' }} · {{ item.proof.section.heading }}</span>
                  <button type="button" class="detail-close-btn" aria-label="Close excerpt" @click="toggleExcerpt(item.id)"><i class="fas fa-times"></i></button>
                </div>
                <div class="output-rendered" v-html="renderMarkdown(item.proof.section.body)"></div>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- 4. Everything else it wrote (scripts, scratch notes), out of the way. -->
      <details v-if="otherFiles.length" class="goal-section review-other">
        <summary>Other files it wrote · {{ otherFiles.length }}</summary>
        <button v-for="f in otherFiles" :key="f" type="button" class="proof-chip" v-tooltip="f" @click="openFile(f)"><i class="fas fa-file" aria-hidden="true"></i> {{ baseName(f) }}</button>
      </details>

      <!-- No checklist (older goals): fall back to the chat's artifact cards. -->
      <section v-if="!checklist.items.length && artifactSource.content" class="goal-section goal-results">
        <h3>What it made</h3>
        <ArtifactCards :content="artifactSource.content" :tool-calls="artifactSource.toolCalls" :message-id="'goal:' + selectedGoal.id" />
      </section>

      <!-- Sign-off: the reviewer accepts the result against the checklist. -->
      <div v-if="canSignOff" class="goal-signoff">
        <button type="button" class="action-button start" :disabled="isStartingAutonomous" @click="approveGoal">
          <i class="fas fa-check"></i> Accept & mark done
        </button>
        <button type="button" class="action-button" @click="showRejectModal = true"><i class="fas fa-comment-dots"></i> Request changes</button>
      </div>

      <!-- Everything else is detail: tasks, tool calls, raw evaluation, iterations. -->
      <details class="goal-work" :open="workOpen" @toggle="workOpen = $event.target.open">
        <summary>Show the work<span v-if="selectedGoal.tasks?.length"> · {{ selectedGoal.tasks.length }} task{{ selectedGoal.tasks.length === 1 ? '' : 's' }}</span></summary>
        <!-- Tasks list -->
        <div v-if="selectedGoal.tasks && selectedGoal.tasks.length > 0" class="goal-tasks">
          <h3>Tasks ({{ selectedGoal.tasks.length }})</h3>
          <div class="tasks-list">
            <div v-for="(task, index) in selectedGoal.tasks" :key="task.id" class="task-card" :class="(task.status || '').toLowerCase()" :data-review-task="index + 1">
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
              <div v-if="task.output" class="task-io-section">
                <div class="io-toggle" @click="toggleNodeSection(task.id, 'output')">
                  <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'output') }"></i>
                  <span>Output</span>
                  <Tooltip :text="isRawView(task.id) ? 'View Rendered' : 'View Raw'">
                    <button class="raw-toggle" @click.stop="toggleRawView(task.id)">
                      <i :class="isRawView(task.id) ? 'fas fa-eye' : 'fas fa-code'"></i>
                      {{ isRawView(task.id) ? 'Rendered' : 'Raw' }}
                    </button>
                  </Tooltip>
                </div>
                <div v-show="isNodeSectionExpanded(task.id, 'output')" class="io-body">
                  <div v-if="isRawView(task.id)" class="output-raw">
                    <BoundedJson :value="formatJSON(task.output)" filename="task-output.json" />
                  </div>
                  <div v-else class="output-rendered" v-html="renderOutput(task.output)"></div>
                </div>
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
                        <BoundedJson :value="formatToolResponse(tool.arguments || tool.args || tool.input)" filename="tool-input.json" />
                      </div>
                      <div v-if="tool.response || tool.output || tool.result" class="tool-exec-block">
                        <div class="tool-exec-block-label">Output</div>
                        <BoundedJson :value="formatToolResponse(tool.response || tool.output || tool.result)" :tone="toolHasError(tool) ? 'error' : 'neutral'" filename="tool-output.json" />
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
                  <BoundedJson :value="task.error" tone="error" filename="task-error.txt" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Evaluation -->
        <div v-if="selectedGoal.evaluation" class="goal-evaluation task-io-section">
          <div class="io-toggle" @click="toggleNodeSection('eval', 'output')">
            <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded('eval', 'output') }"></i>
            <span>Evaluation</span>
            <Tooltip :text="isRawView('eval') ? 'View Rendered' : 'View Raw'">
              <button class="raw-toggle" @click.stop="toggleRawView('eval')">
                <i :class="isRawView('eval') ? 'fas fa-eye' : 'fas fa-code'"></i>
                {{ isRawView('eval') ? 'Rendered' : 'Raw' }}
              </button>
            </Tooltip>
          </div>
          <div v-show="isNodeSectionExpanded('eval', 'output')" class="io-body">
            <div v-if="isRawView('eval')" class="output-raw">
              <BoundedJson :value="formatJSON(selectedGoal.evaluation)" filename="evaluation.json" />
            </div>
            <div v-else class="output-rendered" v-html="renderOutput(selectedGoal.evaluation)"></div>
          </div>
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

      </details>

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

        <!-- Needs review actions -->
        <template v-if="selectedGoal.status === 'needs_review'">
          <button class="action-button edit" @click="reviewOutputs"><i class="fas fa-file-alt"></i> Review Outputs</button>
          <template v-if="boardStage === 'plan'">
            <button class="action-button start" @click="approveGoal" :disabled="isStartingAutonomous"><i class="fas fa-check"></i> Approve plan & build</button>
            <button class="action-button" @click="showRejectModal = true"><i class="fas fa-comment-dots"></i> Send feedback & retry</button>
          </template>
          <button class="action-button" @click="startAutonomous" :disabled="isStartingAutonomous">
            <i :class="isStartingAutonomous ? 'fas fa-spinner fa-spin' : 'fas fa-redo'"></i>
            {{ isStartingAutonomous ? 'Starting...' : 'Retry' }}
          </button>
        </template>

        <!-- Standby actions (planning, queued) -->
        <template v-else-if="canStartAutonomous">
          <button class="action-button start" @click="startAutonomous" :disabled="isStartingAutonomous">
            <i :class="isStartingAutonomous ? 'fas fa-spinner fa-spin' : 'fas fa-infinity'"></i>
            {{ isStartingAutonomous ? 'Starting...' : boardStage === 'plan' ? 'Approve plan & build' : 'Start build' }}
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

    <!-- Nothing selected: the board beside this panel -->
    <ListSummaryPanel
      v-else
      caption="Goals"
      overview-title="The board"
      :stats="summaryStats"
      hint="Click a goal to inspect it here: tasks, evaluation, plan, schedule, history. Esc comes back."
      primary-label="New goal"
      @primary="$emit('panel-action', 'create-goal')"
    />


    <!-- Feedback Modal -->
    <Teleport to="body">
      <div v-if="showRejectModal" class="modal-overlay" @click.self="showRejectModal = false">
        <div class="modal-container">
          <div class="modal-header">
            <h3>Send Feedback</h3>
            <button class="modal-close-btn" @click="showRejectModal = false">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <p class="feedback-hint">Tell the agent what to fix. This feedback will be used in the next iteration.</p>
            <textarea
              ref="feedbackInputRef"
              v-model="rejectFeedback"
              class="feedback-input"
              placeholder="e.g. The output format is wrong, use JSON instead of CSV..."
              rows="4"
              @keydown.ctrl.enter="submitRejectFeedback"
              @keydown.escape="showRejectModal = false"
            ></textarea>
          </div>
          <div class="modal-footer">
            <span class="modal-hint">Ctrl+Enter to send</span>
            <div class="modal-actions">
              <button class="modal-btn modal-cancel" @click="showRejectModal = false">Cancel</button>
              <button class="modal-btn reject" @click="submitRejectFeedback" :disabled="!rejectFeedback.trim()">
                <i class="fas fa-paper-plane"></i> Send & Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import showdown from 'showdown';
import DOMPurify from 'dompurify';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import BoundedJson from '@/components/common/BoundedJson.vue';
import ListSummaryPanel from '@/views/_components/one/ListSummaryPanel.vue';
import ArtifactCards from '@/views/_components/one/ArtifactCards.vue';
import { goalArtifactSource } from '@/views/Terminal/CenterPanel/screens/Goals/goalArtifacts.js';
import { reviewChecklist } from '@/views/Terminal/CenterPanel/screens/Goals/goalChecklist.js';
import { baseName, deliverablesFor, reportSections, proofFor, reviewVerdict } from '@/views/Terminal/CenterPanel/screens/Goals/goalReview.js';
import { getFile } from '@/services/fileSystemService.js';
import { openLocalPath } from '@/utils/openLocalFile.js';
import { getGoalStage } from '@/views/Terminal/CenterPanel/screens/Goals/goalBoard.js';

const mdConverter = new showdown.Converter({
  tables: true,
  strikethrough: true,
  literalMidWordUnderscores: true,
  simpleLineBreaks: true,
  ghCodeBlocks: true,
});

// showdown passes raw HTML straight through, and this panel renders agent/tool
// output — data the user never authored. Every markdown render in this file goes
// through here so a new call site cannot silently skip sanitization.
const renderMarkdown = (text) => DOMPurify.sanitize(mdConverter.makeHtml(text));

export default {
  name: 'GoalsPanel',
  components: {
    Tooltip,
    BaseButton,
    BoundedJson,
    ListSummaryPanel,
    ArtifactCards,
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

    // Nothing-selected summary: the board beside this panel.
    const summaryStats = computed(() => {
      const all = store.getters['goals/allGoals'] || [];
      const by = (s) => all.filter((g) => g.status === s).length;
      return [
        { label: 'Goals', value: all.length },
        { label: 'Executing', value: by('executing'), live: by('executing') > 0 },
        { label: 'Planning', value: by('planning') + by('pending') },
        { label: 'Completed', value: by('completed') },
      ];
    });

    // Node section expansion state
    const expandedNodeSections = ref({});
    const rawViewTasks = ref({});
    const selectedGoal = ref(null);
    const showCopiedMessage = ref(false);
    const isStartingAutonomous = ref(false);
    const showRejectModal = ref(false);
    const rejectFeedback = ref('');
    const feedbackInputRef = ref(null);

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
          return renderMarkdown(parsed);
        }
      }

      // If it's still a plain string after parsing attempt, render as markdown
      if (typeof parsed === 'string') {
        return renderMarkdown(parsed);
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

      return renderMarkdown(text);
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

    const boardStage = computed(() => getGoalStage(selectedGoal.value || {}));

    const canStartAutonomous = computed(() => {
      if (!selectedGoal.value) return false;
      const s = selectedGoal.value.status;
      return ['planning', 'queued'].includes(s);
    });

    const isGoalDone = computed(() => {
      if (!selectedGoal.value) return false;
      return ['completed', 'validated', 'failed', 'error', 'stopped'].includes(selectedGoal.value.status);
    });

    // Review: what the goal made, and its checklist as the evaluator left it.
    //
    // `selectedGoal` is a snapshot taken when the goal was opened. The
    // evaluation is fetched AFTER that and the store saves it on a NEW goal
    // object, so reading the snapshot alone never saw it: the checklist stayed
    // unchecked ("Checked automatically when the work is evaluated") on goals
    // that had been evaluated. Read the evaluation from the live record.
    const liveGoal = computed(() => (selectedGoal.value ? store.getters['goals/getGoalById'](selectedGoal.value.id) : null));
    const evaluation = computed(() => liveGoal.value?.evaluation || selectedGoal.value?.evaluation || null);
    const reviewTasks = computed(() => (selectedGoal.value?.tasks?.length ? selectedGoal.value.tasks : liveGoal.value?.tasks) || []);
    const artifactSource = computed(() => goalArtifactSource(reviewTasks.value));
    const checklist = computed(() => reviewChecklist(selectedGoal.value ? { ...selectedGoal.value, evaluation: evaluation.value } : null));
    const verdict = computed(() => reviewVerdict(checklist.value));
    const evaluationScore = computed(() => {
      const score = Number(evaluation.value?.overall_score ?? evaluation.value?.evaluation_data?.scores?.overall);
      return Number.isFinite(score) ? Math.round(score) : null;
    });

    // The deliverable: the file(s) the checklist asks for. Its text is read so
    // each check can show the section of it that proves the check.
    const deliverables = computed(() => deliverablesFor(checklist.value.items, artifactSource.value.files));
    const otherFiles = computed(() => artifactSource.value.files.filter((f) => !deliverables.value.includes(f)));
    const report = ref({ path: '', text: '', error: '' });
    const READABLE = /\.(md|markdown|txt)$/i;
    watch(
      () => deliverables.value.find((f) => READABLE.test(f)) || '',
      async (path) => {
        report.value = { path, text: '', error: '' };
        if (!path) return;
        try {
          const file = await getFile(path);
          if (report.value.path === path) report.value = { path, text: String(file?.content || '').slice(0, 200_000), error: '' };
        } catch (error) {
          if (report.value.path === path) report.value = { path, text: '', error: error.message };
        }
      },
      { immediate: true },
    );
    const sections = computed(() => reportSections(report.value.text));
    // Unmet checks first: they are what a reviewer has to decide about.
    const rank = (item) => (item.met === false ? 0 : item.met === null ? 1 : 2);
    const reviewItems = computed(() =>
      checklist.value.items
        .map((item, order) => ({ ...item, order, proof: proofFor(item, { tasks: reviewTasks.value, files: artifactSource.value.files, sections: sections.value }) }))
        .sort((a, b) => rank(a) - rank(b) || a.order - b.order),
    );

    const openSections = ref({});
    const toggleExcerpt = (id) => {
      openSections.value = { ...openSections.value, [id]: !openSections.value[id] };
    };
    const openFile = (path) => openLocalPath(path);
    // "Task 2" in the evidence opens the work and lands on that task's output.
    const workOpen = ref(false);
    const panelRoot = ref(null);
    const showTask = async (number) => {
      const task = reviewTasks.value[number - 1];
      if (!task) return;
      workOpen.value = true;
      expandedNodeSections.value = { ...expandedNodeSections.value, [`${task.id}-output`]: true };
      await nextTick();
      // Scoped to this panel: another goal panel may be open on the canvas.
      panelRoot.value?.querySelector(`[data-review-task="${number}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    watch(() => selectedGoal.value?.id, () => {
      openSections.value = {};
      workOpen.value = false;
    });
    // Sign-off is for finished work awaiting a human: a result in review, or
    // one the loop completed but nobody has accepted yet.
    const canSignOff = computed(() => {
      const status = selectedGoal.value?.status;
      return (status === 'needs_review' && boardStage.value !== 'plan') || status === 'completed';
    });

    // The evaluation (with the checked checklist) is fetched when a finished
    // goal is opened. A goal never evaluated answers 404, which is not an error.
    watch(
      () => [selectedGoal.value?.id, selectedGoal.value?.status],
      ([id, status]) => {
        if (!id || !['needs_review', 'completed', 'validated'].includes(status)) return;
        store.dispatch('goals/fetchGoalEvaluation', id).catch((error) => console.warn('Goal evaluation unavailable:', error.message));
      },
      { immediate: true },
    );

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

    const approveGoal = async () => {
      if (!selectedGoal.value) return;
      try {
        const result = await store.dispatch('goals/reviewGoal', {
          goalId: selectedGoal.value.id,
          action: 'approve',
        });
        emit('panel-action', 'show-feedback', {
          type: 'success',
          message: result.message || (result.status === 'validated' ? 'Result accepted' : 'Plan approved; execution started'),
        });
      } catch (error) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: `Error approving goal: ${error.message}`,
        });
      }
    };

    const submitRejectFeedback = async () => {
      if (!selectedGoal.value || !rejectFeedback.value.trim()) return;
      try {
        await store.dispatch('goals/reviewGoal', {
          goalId: selectedGoal.value.id,
          action: 'reject',
          feedback: rejectFeedback.value.trim(),
        });
        showRejectModal.value = false;
        rejectFeedback.value = '';
        // Auto-start autonomous retry with the feedback
        isStartingAutonomous.value = true;
        await store.dispatch('goals/executeGoalAutonomous', {
          goalId: selectedGoal.value.id,
          maxIterations: 50,
        });
        emit('panel-action', 'show-feedback', {
          type: 'success',
          message: 'Feedback sent — agent is retrying',
        });
      } catch (error) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: `Error: ${error.message}`,
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

    // Description clamp. ~4 lines at panel width; anything past it expands.
    const DESCRIPTION_CLAMP_CHARS = 220;
    const descriptionExpanded = ref(false);
    const descriptionIsLong = computed(() => (selectedGoal.value?.description || '').length > DESCRIPTION_CLAMP_CHARS);
    watch(
      () => selectedGoal.value?.id,
      () => {
        descriptionExpanded.value = false;
      },
    );

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
      artifactSource,
      checklist,
      verdict,
      evaluationScore,
      deliverables,
      otherFiles,
      report,
      reviewItems,
      openSections,
      toggleExcerpt,
      openFile,
      showTask,
      workOpen,
      panelRoot,
      baseName,
      renderMarkdown,
      canSignOff,
      summaryStats,
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
      descriptionExpanded,
      descriptionIsLong,
      // Tool execution helpers
      getToolExecutions,
      toolHasError,
      formatToolName,
      formatToolResponse,
      // AGI Loop
      goalIterations,
      liveIteration,
      boardStage,
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
      approveGoal,
      showRejectModal,
      rejectFeedback,
      feedbackInputRef,
      submitRejectFeedback,
    };
  },
};
</script>

<style scoped>
/* ── Review-first layout: results, checklist, sign-off, then the work ── */
.goal-section {
  margin-top: 14px;
}
.goal-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
/* The right panel is narrow: one card per row reads better than two. */
.goal-results :deep(.artifact-cards) {
  grid-template-columns: minmax(0, 1fr);
  margin: 0;
}
.checklist-count {
  margin-left: auto;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-text);
}
.goal-checklist ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.goal-checklist li {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.4;
}
/* `> i`: the status icon only. A bare `i` also painted every chip and close
   icon inside a missed row red. */
.goal-checklist li > i {
  margin-top: 2px;
}
.goal-checklist li small {
  display: block;
  font-size: 11px;
  color: var(--color-text-muted);
}
.goal-checklist .is-met > i {
  color: var(--text-green);
}
.goal-checklist .is-missed > i {
  color: var(--color-red);
}
.goal-checklist .is-open > i {
  color: var(--color-text-muted);
}
/* ── Review: verdict, deliverable, proof per check. Built from this panel's
   own rules: .task-card's border, .raw-toggle's chip, .goal-status colours. */
.review-verdict {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.4;
}
.review-verdict > i { margin-top: 2px; font-size: 15px; }
.review-verdict small { display: block; margin-top: 3px; font-size: 11.5px; color: var(--color-text-muted); overflow-wrap: anywhere; }
.review-verdict.all-met { border-color: rgba(var(--green-rgb), 0.4); }
.review-verdict.all-met > i { color: var(--text-green); }
.review-verdict.has-missed { border-color: var(--color-yellow); }
.review-verdict.has-missed > i { color: var(--text-yellow); }
.review-verdict.is-pending > i { color: var(--color-text-muted); }
.review-score { color: var(--color-text-muted); font-weight: 400; }
.review-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
}
.review-file > i { color: var(--color-primary); }
.review-file-name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.review-file-name strong { font-size: 13px; overflow-wrap: anywhere; }
.review-file-name small { font-size: 10.5px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.review-preview { margin-top: 8px; border: 1px solid var(--terminal-border-color); border-radius: 6px; }
.review-preview > summary,
.review-other > summary { cursor: pointer; padding: 8px 12px; font-size: 12px; color: var(--color-text-muted); user-select: none; }
.review-preview > summary:hover,
.review-other > summary:hover { color: var(--color-text); }
.review-preview[open] > summary { border-bottom: 1px solid var(--terminal-border-color); }
.review-other > summary { padding-left: 0; }
.review-other[open] { display: flex; flex-wrap: wrap; gap: 6px; }
.review-other[open] > summary { width: 100%; }
.check-body { flex: 1; min-width: 0; }
.check-text { overflow-wrap: anywhere; }
.check-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--on-fill-danger);
  background: var(--color-red);
  vertical-align: 1px;
}
.check-evidence { margin: 4px 0 0; font-size: 12px; line-height: 1.45; color: var(--color-text); opacity: 0.78; overflow-wrap: anywhere; }
.goal-checklist .is-missed .check-evidence { opacity: 1; }
.goal-checklist li.is-missed {
  padding: 10px 10px 10px 8px;
  margin: 0 -10px 4px;
  border-radius: 6px;
  border-left: 3px solid var(--color-red);
  background: rgba(var(--red-rgb), 0.1);
}
.check-proof { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.proof-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  line-height: 1.6;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all 0.2s;
}
.proof-chip:hover,
.proof-chip.active { border-color: rgba(var(--primary-rgb), 0.5); color: var(--color-text); }
.proof-chip i { font-size: 0.85em; color: var(--color-primary); }
.check-excerpt {
  margin-top: 6px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
}
.check-excerpt .output-rendered { max-height: 320px; padding: 8px 12px; font-size: 12.5px; }
.check-excerpt .output-rendered :deep(> :first-child) { margin-top: 0; }
.check-excerpt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 11px;
  color: var(--color-text-muted);
}
.detail-close-btn { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 2px 4px; }
.detail-close-btn:hover { color: var(--color-text); }
.check-excerpt :deep(table),
.review-preview :deep(table) { border-collapse: collapse; display: block; overflow-x: auto; font-size: 0.9em; }
.check-excerpt :deep(th),
.check-excerpt :deep(td),
.review-preview :deep(th),
.review-preview :deep(td) { border: 1px solid var(--terminal-border-color); padding: 3px 6px; white-space: nowrap; }
.checklist-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
}
.goal-signoff {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.goal-work {
  margin-top: 16px;
  border-top: 1px solid var(--terminal-border-color);
  padding-top: 10px;
}
.goal-work > summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-muted);
  user-select: none;
}
.goal-work > summary:hover {
  color: var(--color-text);
}
.goal-work[open] > summary {
  margin-bottom: 10px;
}

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
  color: var(--text-green);
}
.goal-status.failed,
.goal-status.error {
  color: var(--color-red);
}
.goal-status.paused,
.goal-status.needs_review {
  color: var(--text-yellow);
}
.goal-status.planning,
.goal-status.queued {
  color: var(--color-text-muted);
}

/* Description */
.goal-description {
  margin-bottom: 18px;
  line-height: 1.45;
  font-size: 0.9em;
  color: var(--color-text-muted);
}
.goal-description-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.goal-description.is-clamped .goal-description-text {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.goal-description-toggle {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 0.85em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.goal-description-toggle:hover {
  text-decoration: underline;
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
  /* Centred over the WHOLE bar, so which backdrop it lands on depends on the
     percentage: the saturated fill above ~50%, the pale track below it.
     --text-primary was dark ink, unreadable on the fill.

     Light ink alone is not the answer either — at 38% it would sit on a
     near-white track and only a text-shadow would rescue it, which reads as a
     rendering artefact rather than a design. So the label carries its OWN
     scrim: a small dark chip that guarantees the same contrast at 1% and 99%.
     Text over an unpredictable backdrop needs a backdrop of its own. */
  color: var(--text-on-scrim);
  background: var(--scrim);
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.8em;
  line-height: 1.4;
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
  border-radius: 6px;
  padding: 12px;
  transition: all 0.2s ease;
}

.task-card:hover {
  background: var(--color-darker-0);
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
  color: var(--text-blue);
}

.task-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--text-green);
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
  color: var(--text-blue);
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

.io-toggle .raw-toggle {
  margin-left: auto;
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
  background: var(--color-darker-1);
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
  /* was --color-grey, which aliases --text-tertiary: a mid grey bright enough
     to read as a highlight on the dark canvas. --border-strong is the token
     for "a heavier edge" and inverts properly. */
  border-left: 3px solid var(--border-strong);
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
  color: var(--text-green);
}

.iteration-score.score-fail {
  background: rgba(255, 193, 7, 0.2);
  color: var(--text-yellow);
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
  color: var(--text-blue);
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
  color: var(--text-blue);
}
.phase-badge.evaluating {
  background: rgba(168, 85, 247, 0.2);
  color: var(--status-purple-text);
}
.phase-badge.replanning {
  background: rgba(255, 193, 7, 0.2);
  color: var(--text-yellow);
}
.phase-badge.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--text-green);
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
  color: var(--text-green);
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
  background: var(--color-darker-0);
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
  color: var(--text-green);
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

/* Feedback Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-container {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 500px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
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
  color: var(--color-text);
  font-size: 1em;
  font-weight: 600;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 0.9em;
  transition: color 0.2s;
}

.modal-close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 20px;
}

.feedback-hint {
  font-size: 0.85em;
  color: var(--color-text-muted);
  margin: 0 0 12px;
}

.feedback-input {
  width: 100%;
  padding: 12px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.95em;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
  transition: border-color 0.2s ease;
}

.feedback-input:focus {
  outline: none;
  border-color: rgba(var(--primary-rgb), 0.5);
}

.feedback-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--terminal-border-color);
}

.modal-hint {
  font-size: 0.8em;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.modal-actions {
  display: flex;
  gap: 8px;
}

.modal-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 0.9em;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
}

.modal-btn.modal-cancel {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}

.modal-btn.modal-cancel:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.modal-btn.reject {
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  color: var(--color-primary);
}

.modal-btn.reject:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.2);
  border-color: rgba(var(--primary-rgb), 0.5);
}

.modal-btn.reject:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
