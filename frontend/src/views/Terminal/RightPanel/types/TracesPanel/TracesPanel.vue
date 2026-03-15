<template>
  <div class="ui-panel traces-panel">
    <!-- Selected Execution Details -->
    <div v-if="selectedExecution" class="panel-section selected-execution-section">
      <div class="selected-execution-header">
        <h2>Execution Details</h2>
        <div class="header-actions">
          <Tooltip text="Copy Details" width="auto">
            <button @click="copyExecutionDetails" class="copy-btn">
              <i v-if="!showCopiedMessage" class="fas fa-copy"></i>
              <span v-if="showCopiedMessage">Copied!</span>
            </button>
          </Tooltip>
          <Tooltip text="Close Panel" width="auto">
            <button @click="closePanel" class="close-btn">
              <i class="fas fa-times"></i>
            </button>
          </Tooltip>
        </div>
      </div>

      <div class="selected-execution-content">
        <div class="detail-section">
          <h4>Basic Information</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <label>Run:</label>
              <span>{{ selectedExecution.workflowName || 'Unnamed Workflow' }}</span>
            </div>
            <div class="detail-item">
              <label>Status:</label>
              <span :class="['status-badge', selectedExecution.status.toLowerCase()]">
                <i :class="getStatusIcon(selectedExecution.status)"></i>
                {{ selectedExecution.status }}
              </span>
            </div>
            <div class="detail-item">
              <label>Start Time:</label>
              <span>{{ formatDate(selectedExecution.startTime) }}</span>
            </div>
            <div class="detail-item">
              <label>End Time:</label>
              <span>{{ selectedExecution.endTime ? formatDate(selectedExecution.endTime) : 'Still running' }}</span>
            </div>
            <div class="detail-item">
              <label>Duration:</label>
              <span>{{ calculateDuration(selectedExecution) }}</span>
            </div>
            <div class="detail-item">
              <label>Compute:</label>
              <span>{{ selectedExecution.creditsUsed || 0 }}s</span>
            </div>
            <div v-if="selectedExecution.totalTokens" class="detail-item">
              <label>Tokens:</label>
              <span>{{ (selectedExecution.inputTokens || 0).toLocaleString() }} in / {{ (selectedExecution.outputTokens || 0).toLocaleString() }} out ({{ (selectedExecution.totalTokens || 0).toLocaleString() }} total)</span>
            </div>
            <div v-if="selectedExecution.estimatedCost" class="detail-item">
              <label>Est. Cost:</label>
              <span>${{ selectedExecution.estimatedCost.toFixed(4) }}</span>
            </div>
          </div>
        </div>

        <!-- Workflow Actions (only for workflow-type runs) -->
        <div v-if="!selectedExecution.isGoalExecution && selectedExecution.workflowId" class="detail-section workflow-actions-section">
          <h4>Workflow Actions</h4>
          <div class="workflow-actions">
            <button @click="handleEditWorkflow" class="action-button edit">
              <i class="fas fa-edit"></i>
              Edit Workflow
            </button>
          </div>
        </div>

        <!-- Agent Execution: Show Agent Info and Tool Calls -->
        <div v-if="selectedExecution.isAgentExecution" class="detail-section agent-details-section">
          <h4>Agent Information</h4>
          <div class="detail-grid">
            <div v-if="selectedExecution.provider" class="detail-item">
              <label>Provider:</label>
              <span>{{ selectedExecution.provider }}</span>
            </div>
            <div v-if="selectedExecution.model" class="detail-item">
              <label>Model:</label>
              <span>{{ selectedExecution.model }}</span>
            </div>
          </div>

          <!-- Initial Prompt -->
          <div v-if="selectedExecution.initialPrompt" class="agent-prompt-section node-io-section">
            <div class="io-header" @click="toggleNodeSection('agent-prompt', 'input')">
              <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded('agent-prompt', 'input') }"></i>
              <span>Initial Prompt</span>
              <button class="raw-toggle" @click.stop="toggleRawView('agent-prompt')">
                <i :class="isRawView('agent-prompt') ? 'fas fa-eye' : 'fas fa-code'"></i>
                {{ isRawView('agent-prompt') ? 'Rendered' : 'Raw' }}
              </button>
            </div>
            <div v-if="isNodeSectionExpanded('agent-prompt', 'input')" class="io-content">
              <div v-if="isRawView('agent-prompt')" class="output-raw">
                <pre class="io-data">{{ selectedExecution.initialPrompt }}</pre>
              </div>
              <div v-else class="output-rendered" v-html="renderOutput(selectedExecution.initialPrompt)"></div>
            </div>
          </div>

          <!-- Final Response -->
          <div v-if="selectedExecution.finalResponse" class="agent-response-section node-io-section">
            <div class="io-header" @click="toggleNodeSection('agent-response', 'output')">
              <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded('agent-response', 'output') }"></i>
              <span>Final Response</span>
              <button class="raw-toggle" @click.stop="toggleRawView('agent-response')">
                <i :class="isRawView('agent-response') ? 'fas fa-eye' : 'fas fa-code'"></i>
                {{ isRawView('agent-response') ? 'Rendered' : 'Raw' }}
              </button>
            </div>
            <div v-if="isNodeSectionExpanded('agent-response', 'output')" class="io-content">
              <div v-if="isRawView('agent-response')" class="output-raw">
                <pre class="io-data">{{ typeof selectedExecution.finalResponse === 'object' ? JSON.stringify(selectedExecution.finalResponse, null, 2) : selectedExecution.finalResponse }}</pre>
              </div>
              <div v-else class="output-rendered" v-html="renderOutput(selectedExecution.finalResponse)"></div>
            </div>
          </div>
        </div>

        <!-- Agent Execution: Show Tool Executions -->
        <div
          v-if="selectedExecution.isAgentExecution && selectedExecution.nodeExecutions && selectedExecution.nodeExecutions.length > 0"
          class="detail-section"
        >
          <h4>Tool Executions ({{ selectedExecution.nodeExecutions.length }})</h4>
          <div class="execution-chain">
            <div v-for="(toolExec, index) in selectedExecution.nodeExecutions" :key="toolExec.id" class="chain-node">
              <div class="chain-step">
                <div class="step-number">{{ index + 1 }}</div>
                <div class="step-connector" v-if="index < selectedExecution.nodeExecutions.length - 1"></div>
              </div>

              <div class="node-card tool-exec-card" :class="{ 'has-error': toolExec.error }">
                <div class="node-header">
                  <div class="node-info">
                    <span class="node-id">
                      <i class="fas fa-wrench"></i>
                      {{ toolExec.name }}
                    </span>
                    <span class="node-type">{{ toolExec.node_id?.substring(0, 8) || 'tool' }}</span>
                  </div>
                  <span :class="['node-status', (toolExec.status || 'completed').toLowerCase()]">
                    <i :class="getStatusIcon(toolExec.status || 'completed')"></i>
                    {{ toolExec.status || 'completed' }}
                  </span>
                </div>

                <div class="node-timing">
                  <span v-if="toolExec.start_time">Started: {{ formatTime(toolExec.start_time) }}</span>
                  <span v-if="toolExec.end_time">Ended: {{ formatTime(toolExec.end_time) }}</span>
                  <span v-if="toolExec.credits_used">Compute: {{ toolExec.credits_used }}s</span>
                </div>

                <!-- Input Section -->
                <div v-if="toolExec.input" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(toolExec.id, 'input')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(toolExec.id, 'input') }"></i>
                    <span>Input</span>
                    <span class="io-size">({{ getDataSize(toolExec.input) }})</span>
                    <button class="raw-toggle" @click.stop="toggleRawView(toolExec.id + '-input')">
                      <i :class="isRawView(toolExec.id + '-input') ? 'fas fa-eye' : 'fas fa-code'"></i>
                      {{ isRawView(toolExec.id + '-input') ? 'Rendered' : 'Raw' }}
                    </button>
                  </div>
                  <div v-if="isNodeSectionExpanded(toolExec.id, 'input')" class="io-content">
                    <div v-if="isRawView(toolExec.id + '-input')" class="output-raw">
                      <pre class="io-data">{{ formatJSON(toolExec.input) }}</pre>
                    </div>
                    <div v-else class="output-rendered" v-html="renderOutput(toolExec.input)"></div>
                  </div>
                </div>

                <!-- Output Section -->
                <div v-if="toolExec.output" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(toolExec.id, 'output')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(toolExec.id, 'output') }"></i>
                    <span>Output</span>
                    <span class="io-size">({{ getDataSize(toolExec.output) }})</span>
                    <button class="raw-toggle" @click.stop="toggleRawView(toolExec.id + '-output')">
                      <i :class="isRawView(toolExec.id + '-output') ? 'fas fa-eye' : 'fas fa-code'"></i>
                      {{ isRawView(toolExec.id + '-output') ? 'Rendered' : 'Raw' }}
                    </button>
                  </div>
                  <div v-if="isNodeSectionExpanded(toolExec.id, 'output')" class="io-content">
                    <div v-if="isRawView(toolExec.id + '-output')" class="output-raw">
                      <pre class="io-data">{{ formatJSON(toolExec.output) }}</pre>
                    </div>
                    <div v-else class="output-rendered" v-html="renderOutput(toolExec.output)"></div>
                  </div>
                </div>

                <!-- Error Section -->
                <div v-if="toolExec.error" class="node-io-section error-section">
                  <div class="io-header" @click="toggleNodeSection(toolExec.id, 'error')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(toolExec.id, 'error') }"></i>
                    <span>Error</span>
                  </div>
                  <div v-if="isNodeSectionExpanded(toolExec.id, 'error')" class="io-content">
                    <pre class="error-data">{{ toolExec.error }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Goal Execution: Show Tasks -->
        <div v-else-if="selectedExecution.isGoalExecution && selectedExecution.nodeExecutions" class="detail-section">
          <h4>Tasks ({{ selectedExecution.nodeExecutions.length }})</h4>
          <div class="execution-chain">
            <div v-for="(task, index) in selectedExecution.nodeExecutions" :key="task.id" class="chain-node">
              <div class="node-card task-card" :class="task.status.toLowerCase()">
                <div class="node-header">
                  <div class="node-info">
                    <span class="node-id">{{ task.title || 'Untitled Task' }}</span>
                    <span class="node-type">Task {{ index + 1 }}</span>
                  </div>
                  <span :class="['node-status', task.status.toLowerCase()]">
                    <i :class="getStatusIcon(task.status)"></i>
                    {{ task.status }}
                  </span>
                </div>

                <!-- Agent Assignment -->
                <div v-if="task.agent_name" class="task-agent-info">
                  <i class="fas fa-robot"></i>
                  <span class="agent-label">Agent:</span>
                  <span class="agent-name">{{ task.agent_name }}</span>
                </div>

                <!-- Task Description -->
                <div v-if="task.description" class="task-description">
                  {{ task.description }}
                </div>

                <!-- Task Timing -->
                <div class="node-timing">
                  <span v-if="task.started_at">Started: {{ formatTime(task.started_at) }}</span>
                  <span v-if="task.completed_at">Completed: {{ formatTime(task.completed_at) }}</span>
                  <span v-if="task.progress !== undefined">Progress: {{ task.progress }}%</span>
                </div>

                <!-- Input Section -->
                <div v-if="task.input" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(task.id, 'input')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'input') }"></i>
                    <span>Input</span>
                    <span class="io-size">({{ getDataSize(task.input) }})</span>
                    <button class="raw-toggle" @click.stop="toggleRawView(task.id + '-input')">
                      <i :class="isRawView(task.id + '-input') ? 'fas fa-eye' : 'fas fa-code'"></i>
                      {{ isRawView(task.id + '-input') ? 'Rendered' : 'Raw' }}
                    </button>
                  </div>
                  <div v-if="isNodeSectionExpanded(task.id, 'input')" class="io-content">
                    <div v-if="isRawView(task.id + '-input')" class="output-raw">
                      <pre class="io-data">{{ formatJSON(task.input) }}</pre>
                    </div>
                    <div v-else class="output-rendered" v-html="renderOutput(task.input)"></div>
                  </div>
                </div>

                <!-- Output Section -->
                <div v-if="task.output" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(task.id, 'output')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'output') }"></i>
                    <span>Output</span>
                    <span class="io-size">({{ getDataSize(task.output) }})</span>
                    <button class="raw-toggle" @click.stop="toggleRawView(task.id)">
                      <i :class="isRawView(task.id) ? 'fas fa-eye' : 'fas fa-code'"></i>
                      {{ isRawView(task.id) ? 'Rendered' : 'Raw' }}
                    </button>
                  </div>
                  <div v-if="isNodeSectionExpanded(task.id, 'output')" class="io-content">
                    <div v-if="isRawView(task.id)" class="output-raw">
                      <pre class="io-data">{{ formatJSON(task.output) }}</pre>
                    </div>
                    <div v-else class="output-rendered" v-html="renderOutput(task.output)"></div>
                  </div>
                </div>

                <!-- Tool Executions -->
                <div v-if="getExecutedTools(task).length > 0" class="node-io-section tool-executions-section">
                  <div class="io-header" @click="toggleNodeSection(task.id, 'tools')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'tools') }"></i>
                    <span>Tool Executions ({{ getExecutedTools(task).length }})</span>
                  </div>
                  <div v-if="isNodeSectionExpanded(task.id, 'tools')" class="io-content">
                    <div
                      v-for="(toolExecItem, tIdx) in getExecutedTools(task)"
                      :key="tIdx"
                      class="tool-exec-detail-item"
                      :class="{ 'tool-error': toolHasError(toolExecItem) }"
                    >
                      <div class="tool-exec-detail-header" @click="toggleNodeSection(task.id, 'tool-' + tIdx)">
                        <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'tool-' + tIdx) }"></i>
                        <span class="tool-exec-detail-name">{{ formatToolName(toolExecItem.name || toolExecItem.toolName || 'unknown') }}</span>
                        <span class="tool-exec-detail-badge" :class="toolHasError(toolExecItem) ? 'badge-error' : 'badge-ok'">
                          {{ toolHasError(toolExecItem) ? 'error' : 'ok' }}
                        </span>
                      </div>
                      <div v-if="isNodeSectionExpanded(task.id, 'tool-' + tIdx)" class="tool-exec-detail-body">
                        <div v-if="toolExecItem.arguments || toolExecItem.args || toolExecItem.input" class="tool-exec-detail-block">
                          <div class="tool-exec-detail-block-label">Input</div>
                          <pre class="io-data">{{ formatToolResponse(toolExecItem.arguments || toolExecItem.args || toolExecItem.input) }}</pre>
                        </div>
                        <div v-if="toolExecItem.response || toolExecItem.output || toolExecItem.result" class="tool-exec-detail-block">
                          <div class="tool-exec-detail-block-label">Output</div>
                          <pre class="io-data" :class="{ 'error-data': toolHasError(toolExecItem) }">{{ formatToolResponse(toolExecItem.response || toolExecItem.output || toolExecItem.result) }}</pre>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Error Section -->
                <div v-if="task.error" class="node-io-section error-section">
                  <div class="io-header" @click="toggleNodeSection(task.id, 'error')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'error') }"></i>
                    <span>Error</span>
                  </div>
                  <div v-if="isNodeSectionExpanded(task.id, 'error')" class="io-content">
                    <pre class="error-data">{{ task.error }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Workflow Execution: Show Nodes -->
        <div v-else-if="selectedExecution.nodeExecutions && selectedExecution.nodeExecutions.length > 0" class="detail-section">
          <h4>Execution Chain ({{ uniqueNodeExecutions.length }} nodes)</h4>
          <div class="execution-chain">
            <div
              v-for="(nodeExecution, index) in uniqueNodeExecutions"
              :key="nodeExecution.id"
              class="chain-node"
            >
              <div class="chain-step">
                <div class="step-number">{{ index + 1 }}</div>
                <div class="step-connector" v-if="index < selectedExecution.nodeExecutions.length - 1"></div>
              </div>

              <div class="node-card" :class="{ 'has-error': nodeExecution.error }">
                <div class="node-header">
                  <div class="node-info">
                    <span class="node-id">{{ getNodeType(nodeExecution) }}</span>
                    <span class="node-type">{{ nodeExecution.node_id.substring(0, 8) }}</span>
                  </div>
                  <span :class="['node-status', nodeExecution.status.toLowerCase()]">
                    <i :class="getStatusIcon(nodeExecution.status)"></i>
                    {{ nodeExecution.status }}
                  </span>
                </div>

                <div class="node-timing">
                  <span>Duration: {{ calculateNodeDuration(nodeExecution) }}</span>
                  <span>Compute: {{ nodeExecution.credits_used || 0 }}s</span>
                  <span v-if="nodeExecution.start_time">Started: {{ formatTime(nodeExecution.start_time) }}</span>
                </div>

                <!-- Input Section -->
                <div v-if="nodeExecution.input" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(nodeExecution.id, 'input')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(nodeExecution.id, 'input') }"></i>
                    <span>Input</span>
                    <span class="io-size">({{ getDataSize(nodeExecution.input) }})</span>
                    <button class="raw-toggle" @click.stop="toggleRawView(nodeExecution.id + '-input')">
                      <i :class="isRawView(nodeExecution.id + '-input') ? 'fas fa-eye' : 'fas fa-code'"></i>
                      {{ isRawView(nodeExecution.id + '-input') ? 'Rendered' : 'Raw' }}
                    </button>
                  </div>
                  <div v-if="isNodeSectionExpanded(nodeExecution.id, 'input')" class="io-content">
                    <div v-if="isRawView(nodeExecution.id + '-input')" class="output-raw">
                      <pre class="io-data">{{ formatJSON(nodeExecution.input) }}</pre>
                    </div>
                    <div v-else class="output-rendered" v-html="renderOutput(nodeExecution.input)"></div>
                  </div>
                </div>

                <!-- Output Section -->
                <div v-if="nodeExecution.output" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(nodeExecution.id, 'output')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(nodeExecution.id, 'output') }"></i>
                    <span>Output</span>
                    <span class="io-size">({{ getDataSize(nodeExecution.output) }})</span>
                    <button class="raw-toggle" @click.stop="toggleRawView(nodeExecution.id + '-output')">
                      <i :class="isRawView(nodeExecution.id + '-output') ? 'fas fa-eye' : 'fas fa-code'"></i>
                      {{ isRawView(nodeExecution.id + '-output') ? 'Rendered' : 'Raw' }}
                    </button>
                  </div>
                  <div v-if="isNodeSectionExpanded(nodeExecution.id, 'output')" class="io-content">
                    <div v-if="isRawView(nodeExecution.id + '-output')" class="output-raw">
                      <pre class="io-data">{{ formatJSON(nodeExecution.output) }}</pre>
                    </div>
                    <div v-else class="output-rendered" v-html="renderOutput(nodeExecution.output)"></div>
                  </div>
                </div>

                <!-- Error Section -->
                <div v-if="nodeExecution.error" class="node-io-section error-section">
                  <div class="io-header" @click="toggleNodeSection(nodeExecution.id, 'error')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(nodeExecution.id, 'error') }"></i>
                    <span>Error</span>
                  </div>
                  <div v-if="isNodeSectionExpanded(nodeExecution.id, 'error')" class="io-content">
                    <pre class="error-data">{{ nodeExecution.error }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="selectedExecution.log" class="detail-section">
          <h4>Execution Log</h4>
          <pre class="execution-log">{{ filteredExecutionLog }}</pre>
        </div>

        <!-- Linked Insights -->
        <div class="detail-section insights-section">
          <h4>
            <i class="fas fa-lightbulb"></i>
            Insights
            <span v-if="linkedInsights.length > 0" class="insight-count">{{ linkedInsights.length }}</span>
          </h4>
          <div v-if="linkedInsights.length > 0" class="linked-insights-list">
            <div
              v-for="insight in linkedInsights"
              :key="insight.id"
              class="linked-insight-item"
              @click="navigateToInsight(insight)"
            >
              <div class="linked-insight-header">
                <i :class="insightCategoryIcon(insight.category)"></i>
                <span class="linked-insight-title">{{ insight.title }}</span>
              </div>
              <div class="linked-insight-meta">
                <span class="insight-status-badge" :class="insight.status">{{ insight.status }}</span>
                <span class="insight-confidence">{{ Math.round(insight.confidence * 100) }}%</span>
                <span class="insight-category-label">{{ formatInsightCategory(insight.category) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="no-insights">
            <span>No insights generated from this trace</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Default content when no execution selected -->
    <div v-else class="default-content">
      <!-- Goal Creation Section -->
      <div class="panel-section goal-input-section">
        <h4 class="section-title">
          <i class="fas fa-plus"></i>
          Create New Multi Agent Goal
        </h4>
        <div class="goal-input-container">
          <textarea
            ref="goalInputRef"
            v-model="goalInput"
            class="goal-input"
            placeholder="Describe what you want to accomplish... (e.g., 'Research renewable energy trends and create a summary report')"
            rows="3"
            @keydown.ctrl.enter="createGoal"
            @keydown.escape="clearGoalInput"
            :disabled="isCreatingGoal"
          ></textarea>
          <button class="create-goal-button" :class="{ loading: isCreatingGoal }" @click="createGoal" :disabled="!goalInput.trim() || isCreatingGoal">
            <i v-if="isCreatingGoal" class="fas fa-spinner fa-spin"></i>
            <i v-else class="fas fa-plus"></i>
            {{ isCreatingGoal ? 'Creating...' : 'Create Goal' }}
          </button>
        </div>
        <div class="input-hint">
          <i class="fas fa-info-circle"></i>
          Press Ctrl+Enter to create, or Escape to clear
        </div>
      </div>

      <!-- Recent Runs -->
      <div class="panel-section recent-runs-section">
        <h4 class="section-title">
          <i class="fas fa-history"></i>
          Recent Runs
        </h4>
        <div class="recent-runs-list">
          <div v-for="execution in recentExecutionsList" :key="execution.id" class="recent-run-item" @click="selectExecution(execution)">
            <div class="run-info">
              <div class="run-name">{{ execution.workflowName || execution.name || 'Untitled Run' }}</div>
              <div class="run-meta">
                <span class="run-status" :class="execution.status.toLowerCase()">
                  <i :class="getStatusIcon(execution.status)"></i>
                  {{ execution.status }}
                </span>
                <span class="run-duration">{{ formatDuration(execution.duration) }}</span>
              </div>
            </div>
            <div class="run-date">{{ formatRelativeDate(execution.startTime || execution.created_at) }}</div>
          </div>

          <div v-if="recentExecutionsList.length === 0" class="no-runs">
            <i class="fas fa-play"></i>
            <span>No runs yet</span>
          </div>
        </div>
      </div>

      <!-- Placeholder message -->
      <div class="panel-section placeholder-section">
        <p>Select an execution to view details.</p>
      </div>
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

const mdConverter = new showdown.Converter({
  tables: true,
  strikethrough: true,
  literalMidWordUnderscores: true,
  simpleLineBreaks: true,
  ghCodeBlocks: true,
});

export default {
  name: 'TracesPanel',
  components: {
    ResourcesSection,
    Tooltip,
  },
  props: {
    selectedExecutionId: {
      type: String,
      default: null,
    },
    executions: {
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
    const selectedExecution = ref(null);
    const showCopiedMessage = ref(false);

    // Goal creation state
    const goalInput = ref('');
    const goalInputRef = ref(null);
    const isCreatingGoal = computed(() => store.getters['goals/isCreatingGoal']);

    // Watch for selectedExecutionId changes
    watch(
      () => props.selectedExecutionId,
      (newId) => {
        if (!newId) {
          selectedExecution.value = null;
        }
      }
    );

    // Method to update selected execution from parent
    const updateSelectedExecution = (execution) => {
      selectedExecution.value = execution;
    };

    // Expose method to parent component
    const handlePanelAction = (action, payload) => {
      if (action === 'update-execution-details') {
        updateSelectedExecution(payload);
      }
    };

    // Expose methods for external access
    expose({
      updateSelectedExecution,
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

    // Pre-parse log once into a node-id→name map when selectedExecution changes.
    // This replaces per-node regex calls with a single O(1) Map lookup.
    const logNodeNameMap = computed(() => {
      const map = new Map();
      if (!selectedExecution.value || !selectedExecution.value.log) return map;
      const log = selectedExecution.value.log;
      const pattern = /Executing node:\s*([a-f0-9-]{36})\s*\(([^)]+)\)/gi;
      let match;
      while ((match = pattern.exec(log)) !== null) {
        const nodeId = match[1];
        const nodeName = match[2].trim();
        map.set(nodeId, nodeName);
        map.set(nodeId.substring(0, 8), nodeName);
      }
      return map;
    });

    // Helper methods for enhanced details
    const getNodeType = (nodeExecution) => {
      if (nodeExecution._synthetic && nodeExecution._logName) {
        return nodeExecution._logName;
      }

      if (nodeExecution.name) return nodeExecution.name;
      if (nodeExecution.type) return nodeExecution.type;
      if (nodeExecution.tool_name) return nodeExecution.tool_name;
      if (nodeExecution.node_type) return nodeExecution.node_type;
      if (nodeExecution.label) return nodeExecution.label;
      if (nodeExecution.title) return nodeExecution.title;

      if (nodeExecution.input) {
        if (nodeExecution.input.tool_name) return nodeExecution.input.tool_name;
        if (nodeExecution.input.type) return nodeExecution.input.type;
        if (nodeExecution.input.name) return nodeExecution.input.name;
        if (nodeExecution.input.label) return nodeExecution.input.label;
      }

      if (nodeExecution.output) {
        if (nodeExecution.output.tool_name) return nodeExecution.output.tool_name;
        if (nodeExecution.output.type) return nodeExecution.output.type;
        if (nodeExecution.output.name) return nodeExecution.output.name;
      }

      // O(1) map lookup instead of regex per node
      if (nodeExecution.node_id) {
        const fromLog = logNodeNameMap.value.get(nodeExecution.node_id)
          || logNodeNameMap.value.get(nodeExecution.node_id.substring(0, 8));
        if (fromLog) return fromLog;

        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(nodeExecution.node_id)) {
          return 'Workflow Node';
        }
        const parts = nodeExecution.node_id.split('-');
        return parts[0] || 'Node';
      }

      return 'Unknown Node';
    };

    const formatTime = (timestamp) => {
      if (!timestamp) return '-';
      return new Date(timestamp).toLocaleTimeString();
    };

    const getDataSize = (data) => {
      if (!data) return '0 bytes';
      // Use string length as a fast approximation instead of creating a Blob
      const len = typeof data === 'string' ? data.length : JSON.stringify(data).length;
      if (len < 1024) return `${len} bytes`;
      if (len < 1024 * 1024) return `${(len / 1024).toFixed(1)} KB`;
      return `${(len / (1024 * 1024)).toFixed(1)} MB`;
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

    // Helper function to determine if a node is a label node.
    // Checks direct properties only — avoids expensive JSON.stringify on input/output.
    const isLabelNode = (nodeExecution) => {
      const nodeType = getNodeType(nodeExecution).toLowerCase();
      if (nodeType.includes('label')) return true;

      if (nodeExecution.type && nodeExecution.type.toLowerCase().includes('label')) return true;
      if (nodeExecution.node_type && nodeExecution.node_type.toLowerCase().includes('label')) return true;
      if (nodeExecution.name && nodeExecution.name.toLowerCase().includes('label')) return true;

      // Check direct properties on input/output (no JSON.stringify)
      if (nodeExecution.input) {
        if (nodeExecution.input.type && nodeExecution.input.type.toLowerCase().includes('label')) return true;
        if (nodeExecution.input.node_type && nodeExecution.input.node_type.toLowerCase().includes('label')) return true;
      }

      if (nodeExecution.output) {
        if (nodeExecution.output.type && nodeExecution.output.type.toLowerCase().includes('label')) return true;
        if (nodeExecution.output.node_type && nodeExecution.output.node_type.toLowerCase().includes('label')) return true;
        if (nodeExecution.output.message && nodeExecution.output.message.toLowerCase().includes('label node')) return true;
      }

      if (nodeExecution._synthetic && nodeExecution._logName && nodeExecution._logName.toLowerCase().includes('label')) return true;
      if (nodeExecution.error && typeof nodeExecution.error === 'string' && nodeExecution.error.toLowerCase().includes('label')) return true;

      return false;
    };

    // Cached computed: filtered execution log (removes label node references)
    const filteredExecutionLog = computed(() => {
      if (!selectedExecution.value || !selectedExecution.value.log) return '';

      const log = selectedExecution.value.log;
      const nodeExecutions = selectedExecution.value.nodeExecutions || [];

      const labelNodeIds = new Set();
      nodeExecutions.forEach((ne) => {
        if (isLabelNode(ne)) {
          labelNodeIds.add(ne.node_id);
          if (ne.node_id) labelNodeIds.add(ne.node_id.substring(0, 8));
        }
      });

      // Also extract label nodes from log
      for (const [nodeId, name] of logNodeNameMap.value.entries()) {
        if (name.toLowerCase().includes('label')) {
          labelNodeIds.add(nodeId);
        }
      }

      if (labelNodeIds.size === 0) return log;

      return log.split('\n').filter((line) => {
        for (const id of labelNodeIds) {
          if (line.includes(id)) return false;
        }
        return true;
      }).join('\n');
    });

    // Legacy method wrapper for template compatibility
    const getFilteredExecutionLog = () => filteredExecutionLog.value;

    // Deduplicate node executions and add missing nodes from execution log
    const _getUniqueNodeExecutions = (nodeExecutions) => {
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

          // Skip label nodes from log extraction
          if (nodeName.toLowerCase().includes('label')) {
            continue;
          }

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
      // Filter out label nodes
      const uniqueNodeIds = new Set();
      return allExecutions.filter((nodeExecution) => {
        // Skip label nodes
        if (isLabelNode(nodeExecution)) {
          return false;
        }

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

    // Cached computed: unique node executions (avoids recalculating on every render)
    const uniqueNodeExecutions = computed(() => {
      if (!selectedExecution.value || !selectedExecution.value.nodeExecutions) return [];
      return _getUniqueNodeExecutions(selectedExecution.value.nodeExecutions);
    });

    // Legacy method wrapper for template compatibility
    const getUniqueNodeExecutions = (nodeExecutions) => {
      if (selectedExecution.value && nodeExecutions === selectedExecution.value.nodeExecutions) {
        return uniqueNodeExecutions.value;
      }
      return _getUniqueNodeExecutions(nodeExecutions);
    };

    // Status icon helper
    const getStatusIcon = (status) => {
      const icons = {
        running: 'fas fa-play',
        started: 'fas fa-play',
        completed: 'fas fa-check',
        failed: 'fas fa-times',
        error: 'fas fa-times',
        stopped: 'fas fa-stop',
        queued: 'fas fa-clock',
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

    // Recent executions (last 5)
    const recentExecutionsList = computed(() => {
      return [...props.executions]
        .sort((a, b) => {
          const dateA = new Date(a.startTime || a.created_at || 0);
          const dateB = new Date(b.startTime || b.created_at || 0);
          return dateB - dateA;
        })
        .slice(0, 5);
    });

    // Helper methods for Recent Runs and Quick Actions
    const selectExecution = (execution) => {
      emit('panel-action', 'execution-selected', execution);
    };

    const refreshRuns = () => {
      emit('panel-action', 'refresh-runs');
    };

    const exportRuns = () => {
      const runsData = props.executions;
      const dataStr = JSON.stringify(runsData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `runs-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      emit('panel-action', 'show-feedback', {
        type: 'success',
        message: '[Runs] Runs exported successfully.',
      });
    };

    const formatDuration = (duration) => {
      if (!duration) return 'N/A';
      if (typeof duration === 'number') {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
      return duration;
    };

    const formatRelativeDate = (dateString) => {
      if (!dateString) return 'Unknown';

      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString();
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
Compute: ${execution.creditsUsed || 0}s

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
  Compute: ${node.credits_used || 0}s
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
        // Show visual indicator
        showCopiedMessage.value = true;
        setTimeout(() => {
          showCopiedMessage.value = false;
        }, 2000);

        emit('panel-action', 'show-feedback', { type: 'success', message: 'Copied' });
      });
    };

    // Helper to extract executed tools from task output
    const getExecutedTools = (task) => {
      if (!task || !task.output) return [];

      // Check if toolExecutions is directly in output
      if (task.output.toolExecutions && Array.isArray(task.output.toolExecutions)) {
        return task.output.toolExecutions;
      }

      // Check if output is a string that needs parsing
      if (typeof task.output === 'string') {
        try {
          const parsed = JSON.parse(task.output);
          if (parsed.toolExecutions && Array.isArray(parsed.toolExecutions)) {
            return parsed.toolExecutions;
          }
        } catch (e) {
          // Not valid JSON, continue
        }
      }

      return [];
    };

    // Goal creation methods
    const createGoal = async () => {
      if (!goalInput.value.trim()) return;

      const goalText = goalInput.value.trim();
      emit('panel-action', 'show-feedback', {
        type: 'info',
        message: `[Goals] Creating goal: ${goalText.substring(0, 50)}...`,
      });

      try {
        await store.dispatch('goals/createGoal', {
          text: goalText,
          priority: 'medium',
        });

        goalInput.value = '';

        // Refresh executions to show the new goal immediately
        emit('panel-action', 'refresh-executions');

        emit('panel-action', 'show-feedback', {
          type: 'success',
          message: '[Goals] Goal created successfully',
        });
      } catch (error) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: `[Goals] Error creating goal: ${error.message}`,
        });
      }
    };

    const clearGoalInput = () => {
      goalInput.value = '';
      goalInputRef.value?.blur();
    };

    // Rendered/Raw toggle
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

      let parsed = data;
      if (typeof parsed === 'string') {
        try {
          const trimmed = parsed.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            parsed = JSON.parse(trimmed);
          }
        } catch (e) {
          return mdConverter.makeHtml(parsed);
        }
      }

      if (typeof parsed === 'string') {
        return mdConverter.makeHtml(parsed);
      }

      const extractText = (obj, depth = 0) => {
        if (depth > 5) return null;
        if (typeof obj === 'string') return obj;
        if (!obj || typeof obj !== 'object') return null;

        for (const key of ['content', 'summary', 'text', 'message', 'result', 'report', 'output', 'description', 'body', 'response']) {
          if (obj[key] && typeof obj[key] === 'string') return obj[key];
          // Handle arrays of {type: "text", text: "..."} objects
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

    // Tool execution helpers
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

    // ═══ Linked Insights ═══
    const linkedInsights = ref([]);

    const fetchLinkedInsights = async (execution) => {
      if (!execution) { linkedInsights.value = []; return; }
      // Determine source type based on execution type
      let sourceType = 'workflow';
      if (execution.isAgentExecution) sourceType = 'agent_chat';
      else if (execution.isGoalExecution) sourceType = 'goal';
      try {
        const insights = await store.dispatch('insights/fetchSourceInsights', {
          sourceType,
          sourceId: execution.id,
        });
        linkedInsights.value = insights || [];
      } catch {
        linkedInsights.value = [];
      }
    };

    // Watch for execution changes to fetch insights
    watch(selectedExecution, (exec) => { fetchLinkedInsights(exec); });

    const insightCategoryIcon = (c) => ({
      pattern: 'fas fa-thumbs-up',
      antipattern: 'fas fa-thumbs-down',
      prompt_refinement: 'fas fa-pen',
      skill_recommendation: 'fas fa-puzzle-piece',
      memory: 'fas fa-brain',
      bottleneck: 'fas fa-tachometer-alt',
      parameter_tune: 'fas fa-sliders-h',
      tool_preference: 'fas fa-wrench',
    }[c] || 'fas fa-lightbulb');

    const formatInsightCategory = (c) => (c || '').replace(/_/g, ' ');

    const navigateToInsight = (insight) => {
      emit('panel-action', 'navigate-to-insight', insight);
    };

    const closePanel = () => {
      selectedExecution.value = null;
      emit('panel-action', 'close-panel');
    };

    const handleEditWorkflow = () => {
      if (selectedExecution.value && selectedExecution.value.workflowId) {
        emit('panel-action', 'edit-workflow', selectedExecution.value.workflowId);
      }
    };

    return {
      selectedExecution,
      showCopiedMessage,
      toggleNodeSection,
      isNodeSectionExpanded,
      getNodeType,
      formatTime,
      getDataSize,
      formatJSON,
      getUniqueNodeExecutions,
      uniqueNodeExecutions,
      filteredExecutionLog,
      getFilteredExecutionLog,
      getStatusIcon,
      formatDate,
      calculateDuration,
      calculateNodeDuration,
      copyExecutionDetails,
      updateSelectedExecution,
      handlePanelAction,
      recentExecutionsList,
      selectExecution,
      refreshRuns,
      exportRuns,
      formatDuration,
      formatRelativeDate,
      getExecutedTools,
      // Rendered output + tool execution helpers
      toggleRawView,
      isRawView,
      renderOutput,
      toolHasError,
      formatToolName,
      formatToolResponse,
      // Goal creation
      goalInput,
      goalInputRef,
      isCreatingGoal,
      createGoal,
      clearGoalInput,
      closePanel,
      handleEditWorkflow,
      // Linked insights
      linkedInsights,
      insightCategoryIcon,
      formatInsightCategory,
      navigateToInsight,
    };
  },
};
</script>

<style scoped>
.ui-panel.traces-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  background: var(--color-background-soft);
  color: var(--color-text);
  overflow-y: auto;
}

/* Common Section Styling */
/* .panel-section {
  border-radius: 0px;
  padding: 15px;
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(18, 224, 255, 0.1);
} */

.selected-execution-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

.selected-execution-header h2 {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.copy-btn,
.close-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.copy-btn:hover,
.close-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
}

.close-btn {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-red);
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
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
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
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
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.status-badge.running,
.status-badge.started {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.status-badge.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.status-badge.failed,
.status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.status-badge.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
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
  display: none;

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
  /* background: var(--color-darker-0); */
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

.node-card {
  border-left: 3px solid var(--color-green);
}

.node-card.has-error {
  border-left-color: var(--color-red);
}

.node-card:hover {
  background: var(--color-darker-1);
  /* border-color: rgba(var(--green-rgb), 0.3); */
}

/* Task Card Specific Styles */
.task-card {
  border-left: 3px solid var(--color-green);
}

.task-card.executing,
.task-card.running,
.task-card.started {
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

.task-card.pending {
  border-left-color: var(--color-grey);
}

.task-agent-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 0.9em;
}

.task-agent-info i {
  color: var(--color-blue);
  font-size: 0.9em;
}

.agent-label {
  color: var(--color-text-muted);
  font-weight: 500;
}

.agent-name {
  color: var(--color-blue);
  font-weight: 600;
}

.task-description {
  color: var(--color-text-muted);
  font-size: 0.9em;
  line-height: 1.4;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--color-darker-0);
  border-radius: 6px;
  border-left: 2px solid rgba(var(--green-rgb), 0.3);
}

.task-tools {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 193, 7, 0.2);
}

.task-tools.required-tools {
  background: rgba(255, 193, 7, 0.05);
  border-color: rgba(255, 193, 7, 0.2);
}

.task-tools.executed-tools {
  background: rgba(34, 197, 94, 0.05);
  border-color: rgba(34, 197, 94, 0.2);
}

.tools-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-text-muted);
}

.tools-header i {
  color: var(--color-yellow);
  font-size: 0.9em;
}

.executed-tools .tools-header i {
  color: var(--color-green);
}

.tools-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-badge {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.75em;
  font-weight: 500;
  text-transform: lowercase;
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-badge.required {
  background: rgba(255, 193, 7, 0.15);
  border: 1px solid rgba(255, 193, 7, 0.3);
  color: var(--color-yellow);
}

.tool-badge.executed {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: var(--color-green);
}

.tool-badge.executed i {
  font-size: 0.9em;
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
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.agent-prompt-section,
.agent-response-section {
  margin-top: 16px;
}

.node-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.node-status.failed,
.node-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.node-status.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
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
}

.io-header .raw-toggle {
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
  background: var(--color-darker-0);
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

.execution-log {
  background: var(--color-darker-1);
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

.io-data::-webkit-scrollbar,
.error-data::-webkit-scrollbar,
.execution-log::-webkit-scrollbar {
  width: 4px;
}

.io-data::-webkit-scrollbar-track,
.error-data::-webkit-scrollbar-track,
.execution-log::-webkit-scrollbar-track {
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

.execution-log::-webkit-scrollbar-thumb {
  background: rgba(var(--green-rgb), 0.3);
  border-radius: 2px;
}

.placeholder-section {
  text-align: center;
  color: var(--color-grey);
  padding: 30px 15px;
  border: 1px dashed rgba(var(--green-rgb), 0.2);
  border-radius: 4px;
}

.placeholder-section p {
  font-style: italic;
  margin: 0;
}

/* Default content sections */
.default-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-section {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  padding: 16px;
  border-radius: 8px;
}

.section-title {
  color: var(--color-text-muted);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
  font-weight: 600;
  opacity: 0.95;
}

.section-title i {
  color: var(--color-green);
}

/* Recent Runs */
.recent-runs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* max-height: 200px; */
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
}

.recent-run-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.recent-run-item:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
}

.run-info {
  flex: 1;
  min-width: 0;
}

.run-name {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75em;
}

.run-status {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px;
  border-radius: 8px;
  font-weight: 500;
  text-transform: uppercase;
}

.run-status.running {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.run-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.run-status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.run-status.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.run-status.pending {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.run-status.started {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.run-status i {
  font-size: 0.8em;
}

.run-duration {
  color: var(--color-green);
  font-weight: 600;
}

.run-date {
  font-size: 0.75em;
  color: var(--color-text-muted);
  white-space: nowrap;
  opacity: 0.8;
}

.no-runs {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.no-runs i {
  font-size: 1.5em;
  color: rgba(127, 129, 147, 0.3);
}

.no-runs span {
  font-size: 0.85em;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-button {
  padding: 8px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  font-size: 0.9em;
  justify-content: flex-start;
  width: 100%;
}

.action-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
}

.action-button i {
  width: 16px;
  text-align: center;
}

/* Goal Input Section */
.goal-input-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.goal-input {
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-size: 0.95em;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
  transition: all 0.2s ease;
}

.goal-input:focus {
  outline: none;
  border-color: rgba(var(--green-rgb), 0.5);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.1);
}

.goal-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
}

.create-goal-button {
  padding: 12px 20px;
  background: var(--color-darker-0);
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  align-self: flex-start;
}

.create-goal-button:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  transform: translateY(-1px);
}

.create-goal-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.create-goal-button.loading {
  opacity: 0.8;
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8em;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.input-hint i {
  color: var(--color-green);
  font-size: 0.9em;
}

/* Workflow Actions Section */
.workflow-actions-section {
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.workflow-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
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
  background: rgba(var(--green-rgb), 0.1);
  border-color: var(--color-green);
}

.action-button.edit {
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}

.action-button.edit:hover {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
}

/* Rendered Output */
.task-output-rendered {
  overflow: hidden;
}

.output-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(var(--green-rgb), 0.05);
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
  border-color: rgba(var(--green-rgb), 0.5);
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

.output-rendered :deep(h1) { font-size: 1.3em; }
.output-rendered :deep(h2) { font-size: 1.15em; }
.output-rendered :deep(h3) { font-size: 1.05em; }

.output-rendered :deep(p) { margin: 6px 0; }

.output-rendered :deep(ul),
.output-rendered :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}

.output-rendered :deep(li) { margin: 3px 0; }

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
  border-left: 3px solid rgba(var(--green-rgb), 0.4);
  margin: 8px 0;
  padding: 4px 12px;
  color: var(--color-text-muted);
}

.output-rendered :deep(a) { color: var(--color-green); }

.output-rendered :deep(hr) {
  border: none;
  border-top: 1px solid var(--terminal-border-color);
  margin: 12px 0;
}

.output-raw {
  max-height: 400px;
  overflow-y: auto;
}

/* Tool Executions Detail */
.tool-executions-section {
  border-color: rgba(var(--green-rgb), 0.15);
}

.tool-exec-detail-item {
  border-left: 3px solid var(--color-green);
  margin: 6px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.tool-exec-detail-item.tool-error {
  border-left-color: var(--color-red);
}

.tool-exec-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 0.85em;
  user-select: none;
  transition: background 0.2s;
}

.tool-exec-detail-header:hover {
  background: rgba(var(--green-rgb), 0.08);
}

.tool-exec-detail-header i {
  font-size: 0.75em;
  color: var(--color-green);
  transition: transform 0.2s ease;
}

.tool-exec-detail-header i.rotated {
  transform: rotate(90deg);
}

.tool-exec-detail-name {
  color: var(--color-text);
  font-weight: 500;
}

.tool-exec-detail-badge {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 0.8em;
  font-weight: 600;
}

.tool-exec-detail-badge.badge-ok {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.tool-exec-detail-badge.badge-error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.tool-exec-detail-body {
  border-top: 1px solid rgba(var(--green-rgb), 0.1);
}

.tool-exec-detail-block {
  border-top: 1px solid rgba(var(--green-rgb), 0.05);
}

.tool-exec-detail-block:first-child {
  border-top: none;
}

.tool-exec-detail-block-label {
  padding: 4px 10px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Responsive adjustments */
@media (max-width: 768px) {
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

  .detail-grid {
    grid-template-columns: 1fr;
  }
}

/* ═══ Linked Insights Section ═══ */
.insights-section h4 {
  display: flex;
  align-items: center;
  gap: 6px;
}
.insights-section h4 i {
  color: #f59e0b;
  font-size: 0.9em;
}
.insight-count {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  font-size: 0.75em;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
  margin-left: 4px;
}
.linked-insights-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.linked-insight-item {
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(var(--primary-rgb), 0.08);
  border-left: 3px solid rgba(245, 158, 11, 0.4);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.linked-insight-item:hover {
  background: rgba(var(--primary-rgb), 0.08);
  border-left-color: #f59e0b;
}
.linked-insight-header {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
}
.linked-insight-header i {
  margin-top: 2px;
  font-size: 0.8em;
  color: var(--color-grey);
  flex-shrink: 0;
}
.linked-insight-title {
  font-size: 0.82em;
  color: var(--color-text);
  line-height: 1.3;
  word-break: break-word;
}
.linked-insight-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 20px;
}
.insight-status-badge {
  font-size: 0.65em;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: capitalize;
  font-weight: 500;
}
.insight-status-badge.pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
.insight-status-badge.applied { background: rgba(var(--green-rgb),0.15); color: var(--color-green); }
.insight-status-badge.rejected { background: rgba(239,68,68,0.15); color: #ef4444; }
.insight-status-badge.superseded { background: rgba(150,150,150,0.15); color: #999; }
.insight-confidence {
  font-size: 0.7em;
  color: var(--color-grey);
  font-weight: 500;
}
.insight-category-label {
  font-size: 0.65em;
  color: var(--color-grey);
  text-transform: capitalize;
}
.no-insights {
  font-size: 0.8em;
  color: var(--color-grey);
  font-style: italic;
  padding: 6px 0;
}
</style>
