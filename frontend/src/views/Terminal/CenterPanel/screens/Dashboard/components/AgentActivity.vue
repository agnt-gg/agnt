<template>
  <div class="activity-feed">
    <div class="header-with-info main-header">
      <h3><i class="fas fa-robot"></i> Agent Activity</h3>
      <Tooltip
        title="Agent Activity Feed"
        text="Real-time feed of your agents' activities. See what your agents are doing, their earnings, and when activities occurred. This helps you monitor your automated operations and track performance."
        position="top"
      >
        <i class="fas fa-info-circle info-icon"></i>
      </Tooltip>
    </div>
    <div class="feed-container">
      <div v-for="activity in agentActivities" :key="activity.id" class="activity-item" :class="activity.type">
        <div class="activity-icon">
          <i :class="getActivityIcon(activity.type)"></i>
        </div>
        <div class="activity-content">
          <span class="agent-name">{{ activity.agentName }}</span>
          <span class="activity-text">{{ activity.text }}</span>
          <span class="activity-time">{{ formatActivityTime(activity.timestamp) }}</span>
        </div>
        <div v-if="activity.tokens" class="activity-tokens">+{{ activity.tokens }}T</div>
      </div>
      <p v-if="agentActivities.length === 0" class="empty-state">No agent activities yet. Agents will appear here once they start working.</p>
    </div>
  </div>
</template>

<script>
import { formatDistanceToNow } from 'date-fns';
import Tooltip from '../../../../_components/Tooltip.vue';

export default {
  name: 'AgentActivity',
  components: { Tooltip },
  props: {
    agentActivities: {
      type: Array,
      default: () => [],
    },
  },
  methods: {
    getActivityIcon(type) {
      const icons = {
        mining: 'fas fa-hammer',
        mission: 'fas fa-flag',
        achievement: 'fas fa-trophy',
        default: 'fas fa-robot',
      };
      return icons[type] || icons.default;
    },

    formatActivityTime(timestamp) {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    },
  },
};
</script>

<style scoped>
/* Agent Activity Feed */
.activity-feed {
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 4px;
  padding: 16px;
  margin: 0;
  height: 396px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: visible;
}

.activity-feed h3 {
  margin: 0 0 16px 0;
  color: var(--color-green);
  font-size: 1.1em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.feed-container {
  display: flex;
  flex: 1;
  overflow-y: auto;
  margin-right: -16px;
  padding-right: 8px;
  overflow: auto !important;
  gap: 8px;
  flex-direction: column;
  scrollbar-color: #19ef831f transparent;
  scrollbar-width: thin;
}

.activity-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px;
  cursor: text;
  border-radius: 8px;
  border-bottom: none;
  transition: background-color 0.2s;
}

.activity-item:hover {
  background: rgba(25, 239, 131, 0.1);
}

.activity-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(25, 239, 131, 0.1);
  border-radius: 50%;
}

.activity-icon i {
  color: var(--color-green);
}

.activity-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-name {
  color: var(--color-green);
  font-weight: bold;
}

.activity-text {
  color: var(--color-grey-light);
}

.activity-time {
  font-size: 0.8em;
  color: var(--color-grey);
}

.activity-tokens {
  color: var(--color-green);
  font-weight: bold;
  font-size: 1.1em;
  padding-right: 16px;
}

/* Activity Types */
.activity-item.mining {
  background: rgba(25, 239, 131, 0.05);
}
.activity-item.mission {
  background: rgba(66, 135, 245, 0.05);
}
.activity-item.achievement {
  background: rgb(111 7 255 / 5%);
}

.empty-state {
  color: var(--color-grey-light);
  font-style: italic;
  font-size: 0.9em;
  margin: 8px 0;
  text-align: center;
}

/* Header and Icon Styling */
.header-with-info {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-start;
  text-wrap-mode: nowrap;
}

.header-with-info h4,
.header-with-info h3 {
  margin: 0;
}

/* Style for main section headers vs stat card headers */
.header-with-info.main-header {
  width: 100%;
  margin-bottom: 16px;
  display: flex;
}

.info-icon {
  color: var(--color-grey);
  font-size: 0.85em !important;
  cursor: help;
  transition: color 0.2s ease;
  line-height: 1;
  vertical-align: middle;
  margin-left: 4px;
  opacity: 0.25;
}

.info-icon:hover {
  color: var(--color-green);
}

/* Scrollbar styling */
.feed-container::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.feed-container::-webkit-scrollbar-track {
  background: rgba(25, 239, 131, 0.05);
  border-radius: 0;
}

.feed-container::-webkit-scrollbar-thumb {
  background: rgba(25, 239, 131, 0.3);
  border-radius: 0;
  border: 2px solid rgba(25, 239, 131, 0.05);
}

.feed-container::-webkit-scrollbar-thumb:hover {
  background: rgba(25, 239, 131, 0.5);
}
</style>
