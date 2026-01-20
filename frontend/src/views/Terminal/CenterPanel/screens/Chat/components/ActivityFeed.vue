<template>
  <div class="activity-feed">
    <div class="feed-header">
      <span class="feed-title">System Activity</span>
      <button class="clear-button" @click="clearActivities" v-if="activities.length > 0">Clear</button>
    </div>

    <div class="activity-list" ref="activityList">
      <TransitionGroup name="activity" tag="div">
        <div v-for="activity in displayActivities" :key="activity.id" class="activity-item" :class="activity.type">
          <span class="activity-timestamp">{{ formatTime(activity.timestamp) }}</span>
          <span class="activity-icon">{{ getActivityIcon(activity.type) }}</span>
          <span class="activity-text">{{ activity.text }}</span>
        </div>
      </TransitionGroup>
    </div>

    <div v-if="activities.length === 0" class="empty-state">
      <span class="empty-icon">📊</span>
      <span class="empty-text">System activity will appear here</span>
    </div>
  </div>
</template>

<script>
import { computed, nextTick, ref, watch } from 'vue';

export default {
  name: 'ActivityFeed',
  props: {
    activities: {
      type: Array,
      default: () => [],
    },
    maxItems: {
      type: Number,
      default: 10,
    },
  },
  emits: ['clear'],
  setup(props, { emit }) {
    const activityList = ref(null);

    const displayActivities = computed(() => {
      return props.activities.slice(-props.maxItems).reverse();
    });

    const formatTime = (timestamp) => {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    };

    const getActivityIcon = (type) => {
      const icons = {
        context: '🧠',
        tool: '⚙️',
        error: '🛡️',
        system: '💻',
        recovery: '🔄',
        truncation: '✂️',
        default: '📝',
      };
      return icons[type] || icons.default;
    };

    const clearActivities = () => {
      emit('clear');
    };

    const scrollToTop = () => {
      nextTick(() => {
        if (activityList.value) {
          activityList.value.scrollTop = 0;
        }
      });
    };

    // Auto-scroll to top when new activities are added
    watch(
      () => props.activities.length,
      (newLength, oldLength) => {
        if (newLength > oldLength) {
          scrollToTop();
        }
      }
    );

    return {
      activityList,
      displayActivities,
      formatTime,
      getActivityIcon,
      clearActivities,
    };
  },
};
</script>

<style scoped>
.activity-feed {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0;
  padding: 12px 16px;
  max-height: 200px;
  display: flex;
  flex-direction: column;
}

.feed-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.feed-title {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.clear-button {
  font-size: 0.7em;
  padding: 2px 8px;
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-med-navy);
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-button:hover {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-bright-light-navy);
}

.activity-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(127, 129, 147, 0.2) transparent;
}

.activity-list::-webkit-scrollbar {
  width: 4px;
}

.activity-list::-webkit-scrollbar-track {
  background: transparent;
}

.activity-list::-webkit-scrollbar-thumb {
  background: rgba(127, 129, 147, 0.2);
  border-radius: 2px;
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.activity-item:last-child {
  margin-bottom: 0;
}

.activity-item.context {
  background: rgba(18, 224, 255, 0.05);
  border: 1px solid rgba(18, 224, 255, 0.1);
}

.activity-item.tool {
  background: rgba(255, 165, 0, 0.05);
  border: 1px solid rgba(255, 165, 0, 0.1);
}

.activity-item.error {
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.1);
}

.activity-item.system {
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid rgba(127, 129, 147, 0.1);
}

.activity-item.recovery {
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.1);
}

.activity-item.truncation {
  background: rgba(255, 165, 0, 0.05);
  border: 1px solid rgba(255, 165, 0, 0.1);
}

.activity-timestamp {
  font-size: 0.65em;
  color: var(--color-duller-navy);
  font-family: 'SF Mono', monospace;
  flex-shrink: 0;
  min-width: 60px;
}

.activity-icon {
  font-size: 0.9em;
  flex-shrink: 0;
}

.activity-text {
  font-size: 0.7em;
  color: var(--color-bright-light-navy);
  line-height: 1.3;
  flex: 1;
}

.activity-item.context .activity-text {
  color: var(--color-blue);
}

.activity-item.tool .activity-text {
  color: #ffa500;
}

.activity-item.error .activity-text,
.activity-item.recovery .activity-text {
  color: var(--color-green);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--color-duller-navy);
}

.empty-icon {
  font-size: 1.5em;
  margin-bottom: 8px;
  opacity: 0.5;
}

.empty-text {
  font-size: 0.75em;
  text-align: center;
}

/* Transition animations */
.activity-enter-active {
  transition: all 0.3s ease-out;
}

.activity-leave-active {
  transition: all 0.3s ease-in;
}

.activity-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.activity-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.95);
}

.activity-move {
  transition: transform 0.3s ease;
}

@media (max-width: 768px) {
  .activity-feed {
    padding: 8px 12px;
    max-height: 150px;
  }

  .activity-item {
    padding: 4px 6px;
    gap: 6px;
  }

  .activity-timestamp {
    font-size: 0.6em;
    min-width: 50px;
  }

  .activity-text {
    font-size: 0.65em;
  }

  .empty-state {
    padding: 16px;
  }
}
</style>
