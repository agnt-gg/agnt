<template>
  <div
    v-if="mission"
    class="mission-details-section"
    ref="missionDetailsRef"
  >
    <div class="section-header">
      <h3><i class="fas fa-tasks"></i> Mission Intel: {{ mission?.title }}</h3>
      <Tooltip text="Close Details" width="auto">
      <button
        class="close-button clickable"
        @click="$emit('close')"
      >
        <i class="fas fa-times"></i>
      </button>
      </Tooltip>
    </div>

    <div class="details-content">
      <div class="detail-grid">
        <!-- Status -->
        <div class="detail-block">
          <h4 class="detail-block-title"><i class="fas fa-info-circle"></i> Status</h4>
          <p :class="`status-badge status-${mission.status?.toLowerCase() || 'unknown'}`">
            <i :class="getStatusIcon(mission.status)"></i>
            {{ formatMissionStatus(mission.status) }}
          </p>
        </div>

        <!-- Progress -->
        <div class="detail-block">
          <h4 class="detail-block-title"><i class="fas fa-chart-line"></i> Progress</h4>
          <div class="mission-progress-section-detail">
            <div class="mission-progress-text-detail">
              <span v-if="mission.objectives && mission.objectives.length > 0">
                {{ getCompletedObjectives(mission) }}/{{ mission.objectives.length }} objectives
              </span>
              <span v-else-if="mission.progressPercent !== undefined">
                {{ mission.progressPercent }}% complete
              </span>
              <span v-else-if="mission.status !== 'processing'">
                Pending...
              </span>
              <span v-else>
                Processing...
              </span>
            </div>
            <div class="progress-bar-container-detail" v-if="mission.status !== 'processing' && (mission.objectives || mission.progressPercent !== undefined)">
              <div class="progress-bar-fill-detail" :style="{ width: getMissionProgressPercent(mission) + '%' }"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Description -->
      <div class="detail-block">
        <h4 class="detail-block-title"><i class="fas fa-file-alt"></i> Description</h4>
        <p class="mission-description-text">
          {{ mission.description || "No description available." }}
        </p>
      </div>

      <!-- Enhanced Objectives Section -->
      <div class="detail-block" v-if="mission.objectives?.length">
        <h4 class="detail-block-title">
          <i class="fas fa-check-square"></i> 
          Objectives & Tasks
          <span class="objectives-summary">({{ getCompletedObjectives(mission) }}/{{ mission.objectives.length }} completed)</span>
        </h4>
        
        <div class="objectives-container">
          <div 
            v-for="(objective, index) in mission.objectives" 
            :key="index"
            class="objective-card"
            :class="{ 
              'completed': objective.completed,
              'in-progress': objective.status === 'in-progress',
              'expandable': objective.subTasks?.length || objective.details
            }"
            @click="toggleObjectiveExpansion(index)"
          >
            <div class="objective-header">
              <div class="objective-status">
                <i :class="getObjectiveIcon(objective)"></i>
              </div>
              <div class="objective-content">
                <div class="objective-title">
                  {{ objective.label || objective.description || `Objective ${index + 1}` }}
                </div>
                <div class="objective-meta" v-if="objective.estimatedTime || objective.priority">
                  <span v-if="objective.estimatedTime" class="meta-item">
                    <i class="fas fa-clock"></i> {{ objective.estimatedTime }}
                  </span>
                  <span v-if="objective.priority" class="meta-item priority" :class="`priority-${objective.priority}`">
                    <i class="fas fa-flag"></i> {{ objective.priority }}
                  </span>
                </div>
              </div>
              <div class="objective-actions">
                <span v-if="objective.subTasks?.length" class="subtask-count">
                  {{ getCompletedSubTasks(objective) }}/{{ objective.subTasks.length }}
                </span>
                <i v-if="objective.subTasks?.length || objective.details" 
                   class="fas fa-chevron-down expand-icon"
                   :class="{ 'expanded': expandedObjectives.has(index) }"></i>
              </div>
            </div>

            <!-- Expanded Objective Details -->
            <div v-if="expandedObjectives.has(index)" class="objective-details">
              <!-- Objective Description -->
              <div v-if="objective.details" class="objective-description">
                <p>{{ objective.details }}</p>
              </div>

              <!-- Sub-tasks -->
              <div v-if="objective.subTasks?.length" class="subtasks-section">
                <h5 class="subtasks-title">
                  <i class="fas fa-list"></i> Sub-tasks
                </h5>
                <div class="subtasks-list">
                  <div 
                    v-for="(subTask, subIndex) in objective.subTasks" 
                    :key="subIndex"
                    class="subtask-item"
                    :class="{ 'completed': subTask.completed }"
                  >
                    <div class="subtask-status">
                      <i :class="subTask.completed ? 'fas fa-check-circle' : 'far fa-circle'"></i>
                    </div>
                    <div class="subtask-content">
                      <div class="subtask-title">{{ subTask.title || subTask.description }}</div>
                      <div class="subtask-meta" v-if="subTask.assignedTo || subTask.completedAt">
                        <span v-if="subTask.assignedTo" class="meta-item">
                          <i class="fas fa-user"></i> {{ subTask.assignedTo }}
                        </span>
                        <span v-if="subTask.completedAt" class="meta-item">
                          <i class="fas fa-calendar-check"></i> {{ formatDate(subTask.completedAt) }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Objective Progress Details -->
              <div v-if="objective.progress" class="objective-progress-details">
                <div class="progress-info">
                  <span class="progress-label">Progress:</span>
                  <span class="progress-value">{{ objective.progress }}%</span>
                </div>
                <div class="mini-progress-bar">
                  <div class="mini-progress-fill" :style="{ width: objective.progress + '%' }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="detail-block" v-else-if="mission.status !== 'processing'">
        <h4 class="detail-block-title"><i class="fas fa-check-square"></i> Objectives</h4>
        <p>No objectives explicitly defined for this mission.</p>
      </div>

      <!-- Rewards -->
      <div class="detail-block" v-if="mission.rewards">
        <h4 class="detail-block-title"><i class="fas fa-gift"></i> Rewards</h4>
        <div class="rewards-display-detail">
          <Tooltip v-if="mission.rewards.tokens" text="AGNT Tokens" width="auto">
          <span class="reward-item-detail">
            <i class="fas fa-coins"></i> {{ mission.rewards.tokens }}T
          </span>
          </Tooltip>
          <Tooltip v-if="mission.rewards.xp" text="Experience Points" width="auto">
          <span class="reward-item-detail">
            <i class="fas fa-star"></i> {{ mission.rewards.xp }} XP
          </span>
          </Tooltip>
          <Tooltip v-if="mission.rewards.items && mission.rewards.items.length" :text="mission.rewards.items.join(', ')" width="auto">
          <span class="reward-item-detail">
            <i class="fas fa-box-open"></i> {{ mission.rewards.items.join(', ') }}
          </span>
          </Tooltip>
        </div>
        <p v-if="!mission.rewards.tokens && !mission.rewards.xp && (!mission.rewards.items || mission.rewards.items.length === 0)">
          No specific rewards listed.
        </p>
      </div>
      <div class="detail-block" v-else>
        <h4 class="detail-block-title"><i class="fas fa-gift"></i> Rewards</h4>
        <p>Reward information pending or not applicable.</p>
      </div>

      <!-- Timing -->
      <div class="detail-grid" v-if="mission.estimatedDurationSeconds || mission.timeElapsedSeconds">
        <div class="detail-block" v-if="mission.timeElapsedSeconds !== undefined">
          <h4 class="detail-block-title"><i class="fas fa-hourglass-half"></i> Time Elapsed</h4>
          <p>{{ formatDuration(mission.timeElapsedSeconds) }}</p>
        </div>
        <div class="detail-block" v-if="mission.estimatedDurationSeconds !== undefined">
          <h4 class="detail-block-title"><i class="fas fa-clock"></i> Est. Duration</h4>
          <p>{{ formatDuration(mission.estimatedDurationSeconds) }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, inject } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'MissionDetails',
  components: { Tooltip },
  props: {
    mission: {
      type: Object,
      default: null
    }
  },
  emits: ['close', 'log-message'],
  setup(props, { emit }) {
    const missionDetailsRef = ref(null);
    const expandedObjectives = ref(new Set());
    
    const playSound = inject("playSound");

    const toggleObjectiveExpansion = (index) => {
      if (expandedObjectives.value.has(index)) {
        expandedObjectives.value.delete(index);
      } else {
        expandedObjectives.value.add(index);
      }
      playSound("typewriterKeyPress");
    };

    const getCompletedObjectives = (mission) => {
      if (!mission || !mission.objectives) return 0;
      return mission.objectives.filter((obj) => obj.completed).length;
    };

    const getCompletedSubTasks = (objective) => {
      if (!objective.subTasks) return 0;
      return objective.subTasks.filter((task) => task.completed).length;
    };

    const getMissionProgressPercent = (mission) => {
      if (!mission) return 0;
      if (mission.progressPercent !== undefined) {
        return mission.progressPercent;
      }
      if (mission.objectives && mission.objectives.length > 0) {
        const completed = getCompletedObjectives(mission);
        return Math.round((completed / mission.objectives.length) * 100);
      }
      return 0;
    };

    const formatMissionStatus = (status) => {
      if (!status) return "Unknown";
      const statusMap = {
        active: "Active",
        processing: "Processing",
        completed: "Completed",
        failed: "Failed",
        pending: "Pending",
        new: "New" 
      };
      return statusMap[status.toLowerCase()] || status.charAt(0).toUpperCase() + status.slice(1);
    };

    const getStatusIcon = (status) => {
      if (!status) return "fas fa-question-circle";
      const iconMap = {
        active: "fas fa-play-circle",
        processing: "fas fa-spinner fa-spin",
        completed: "fas fa-check-circle",
        failed: "fas fa-times-circle",
        pending: "fas fa-pause-circle",
        new: "far fa-circle"
      };
      return iconMap[status.toLowerCase()] || "fas fa-info-circle";
    };

    const getObjectiveIcon = (objective) => {
      if (objective.completed) return 'fas fa-check-square';
      if (objective.status === 'in-progress') return 'fas fa-play-circle';
      return 'far fa-square';
    };

    const formatDuration = (totalSeconds) => {
      if (totalSeconds === undefined || totalSeconds === null) return "N/A";
      if (totalSeconds < 1) return "< 1 sec";
      
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = Math.floor(totalSeconds % 60);

      let durationString = "";
      if (hours > 0) durationString += `${hours}h `;
      if (minutes > 0) durationString += `${minutes}m `;
      if (seconds > 0 || (hours === 0 && minutes === 0)) durationString += `${seconds}s`;
      
      return durationString.trim();
    };

    const formatDate = (dateString) => {
      if (!dateString) return '';
      return new Date(dateString).toLocaleDateString();
    };

    return {
      missionDetailsRef,
      expandedObjectives,
      toggleObjectiveExpansion,
      getCompletedObjectives,
      getCompletedSubTasks,
      getMissionProgressPercent,
      formatMissionStatus,
      getStatusIcon,
      getObjectiveIcon,
      formatDuration,
      formatDate
    };
  }
};
</script>

<style scoped>
/* Mission Details Section Styles */
.mission-details-section {
  background: rgba(0,0,0,0.1);
  border: 1px solid rgba(25, 239, 131, 0.25);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  padding: 20px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.15);
}

.section-header h3 {
  color: var(--color-green);
  margin: 0;
  font-size: 1.2em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.close-button {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--color-grey-light);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  font-size: 0.9em;
}

.close-button:hover {
  color: var(--color-green);
  background: rgba(25, 239, 131, 0.15);
  border-color: var(--color-green);
}

.details-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.detail-block {
  background-color: rgba(25, 239, 131, 0.03);
  padding: 16px;
  border-radius: 6px;
  border: 1px solid rgba(25, 239, 131, 0.1);
}

.detail-block-title {
  color: var(--color-light-green);
  margin: 0 0 10px 0;
  font-size: 0.95em;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.1);
  padding-bottom: 6px;
}

.detail-block-title i {
  color: var(--color-green);
  opacity: 0.8;
}

.objectives-summary {
  font-size: 0.8em;
  color: var(--color-grey);
  font-weight: normal;
  margin-left: 8px;
}

.detail-block p, .detail-block ul {
  margin: 0;
  color: var(--color-grey-light);
  line-height: 1.5;
  font-size: 0.9em;
}

.mission-description-text {
  white-space: pre-wrap;
}

/* Enhanced Objectives Styles */
.objectives-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.objective-card {
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.15);
  border-radius: 6px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.objective-card.expandable {
  cursor: pointer;
}

.objective-card.expandable:hover {
  background: rgba(25, 239, 131, 0.08);
  border-color: rgba(25, 239, 131, 0.25);
}

.objective-card.completed {
  opacity: 0.7;
  background: rgba(25, 239, 131, 0.02);
}

.objective-card.in-progress {
  border-color: rgba(251, 191, 36, 0.3);
  background: rgba(251, 191, 36, 0.05);
}

.objective-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.objective-status {
  flex-shrink: 0;
}

.objective-status i {
  color: var(--color-green);
  width: 16px;
  font-size: 1.1em;
}

.objective-card.completed .objective-status i {
  color: var(--color-grey);
}

.objective-card.in-progress .objective-status i {
  color: #fbbf24;
}

.objective-content {
  flex: 1;
  min-width: 0;
}

.objective-title {
  color: var(--color-grey-light);
  font-size: 0.9em;
  font-weight: 500;
  margin-bottom: 4px;
  line-height: 1.3;
}

.objective-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  color: var(--color-grey);
}

.meta-item i {
  font-size: 0.8em;
  width: 12px;
}

.meta-item.priority {
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 0.75em;
}

.priority-high {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.priority-medium {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.priority-low {
  background: rgba(107, 114, 128, 0.15);
  color: #9ca3af;
}

.objective-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.subtask-count {
  font-size: 0.8em;
  color: var(--color-grey);
  background: rgba(25, 239, 131, 0.1);
  padding: 2px 6px;
  border-radius: 10px;
}

.expand-icon {
  color: var(--color-grey);
  transition: transform 0.2s;
  font-size: 0.8em;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.objective-details {
  border-top: 1px solid rgba(25, 239, 131, 0.1);
  padding: 16px;
  background: rgba(0, 0, 0, 0.1);
}

.objective-description p {
  color: var(--color-grey-light);
  font-size: 0.85em;
  line-height: 1.4;
  margin-bottom: 16px;
}

.subtasks-section {
  margin-top: 12px;
}

.subtasks-title {
  color: var(--color-light-green);
  font-size: 0.85em;
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.subtasks-title i {
  color: var(--color-green);
  font-size: 0.9em;
}

.subtasks-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.subtask-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(25, 239, 131, 0.03);
  border-radius: 4px;
  border: 1px solid rgba(25, 239, 131, 0.08);
}

.subtask-item.completed {
  opacity: 0.6;
}

.subtask-status i {
  color: var(--color-green);
  margin-top: 2px;
}

.subtask-item.completed .subtask-status i {
  color: var(--color-grey);
}

.subtask-content {
  flex: 1;
}

.subtask-title {
  color: var(--color-grey-light);
  font-size: 0.85em;
  line-height: 1.3;
  margin-bottom: 4px;
}

.subtask-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.objective-progress-details {
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(25, 239, 131, 0.05);
  border-radius: 4px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.progress-label {
  font-size: 0.8em;
  color: var(--color-grey);
}

.progress-value {
  font-size: 0.8em;
  color: var(--color-green);
  font-weight: 600;
}

.mini-progress-bar {
  height: 4px;
  background: rgba(25, 239, 131, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.mini-progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
}

/* Status Badges */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.9em;
  font-weight: 500;
  text-transform: capitalize;
}

.status-badge i {
  font-size: 0.9em;
}

.status-badge.status-active, .status-badge.status-processing {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.status-badge.status-completed {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-badge.status-failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-badge.status-pending, .status-badge.status-new, .status-badge.status-unknown {
  background: rgba(107, 114, 128, 0.15);
  color: #9ca3af;
  border: 1px solid rgba(107, 114, 128, 0.3);
}

/* Progress and Rewards (existing styles) */
.mission-progress-section-detail {
  margin-top: 4px;
}

.mission-progress-text-detail {
  font-size: 0.9em;
  color: var(--color-grey-light);
  margin-bottom: 6px;
}

.progress-bar-container-detail {
  width: 100%;
  height: 8px;
  background-color: rgba(25, 239, 131, 0.15);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill-detail {
  height: 100%;
  background-color: var(--color-green);
  border-radius: 4px;
  transition: width 0.4s ease-in-out;
}

.rewards-display-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reward-item-detail {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-grey-light);
  background-color: rgba(255, 255, 255, 0.03);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 0.9em;
}

.reward-item-detail i {
  color: var(--color-green);
  width: 16px;
}

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
</style>
