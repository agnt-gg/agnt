<template>
  <div class="health-panel">
    <div class="health-header">
      <span class="panel-title">System Health</span>
    </div>

    <div class="health-items">
      <div class="health-item" :class="getContextStatus()">
        <span class="indicator"></span>
        <span class="item-label">Context Management</span>
        <span class="item-status">{{ contextManaged ? 'Active' : 'Idle' }}</span>
      </div>

      <div class="health-item" :class="getErrorRecoveryStatus()">
        <span class="indicator"></span>
        <span class="item-label">Error Recovery</span>
        <span class="item-status">{{ errorsCaught }} handled</span>
      </div>

      <div class="health-item" :class="getToolStatus()">
        <span class="indicator"></span>
        <span class="item-label">Tool Output</span>
        <span class="item-status">{{ toolTruncations }} managed</span>
      </div>

      <div class="health-item" :class="getToolsLoadedStatus()">
        <span class="indicator"></span>
        <span class="item-label">Tool Calls</span>
        <span class="item-status">{{ toolsLoadedCount || 0 }} this session</span>
      </div>

      <div class="health-item" :class="getCacheStatus()">
        <span class="indicator"></span>
        <span class="item-label">Cache</span>
        <span class="item-status">{{ cacheStatusText }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'SystemHealthPanel',
  props: {
    contextManaged: {
      type: Boolean,
      default: false,
    },
    errorsCaught: {
      type: Number,
      default: 0,
    },
    toolTruncations: {
      type: Number,
      default: 0,
    },
    toolsLoadedCount: {
      type: Number,
      default: 0,
    },
    cacheMetrics: {
      type: Object,
      default: null,
    },
  },
  setup(props) {
    const cacheHitRate = computed(() => {
      if (!props.cacheMetrics) return -1;
      return parseFloat(props.cacheMetrics.hitRate || 0);
    });

    const cacheStatusText = computed(() => {
      if (!props.cacheMetrics) return 'No data';
      const rate = cacheHitRate.value;
      if (rate >= 80) return `${rate}% hit rate`;
      if (rate > 0) return `${rate}% hit rate`;
      return 'No hits';
    });

    const getContextStatus = () => {
      return props.contextManaged ? 'active' : 'idle';
    };

    const getErrorRecoveryStatus = () => {
      if (props.errorsCaught > 0) return 'active';
      return 'healthy';
    };

    const getToolStatus = () => {
      if (props.toolTruncations > 0) return 'warning';
      return 'healthy';
    };

    const getToolsLoadedStatus = () => {
      if (props.toolsLoadedCount > 0) return 'healthy';
      return 'idle';
    };

    const getCacheStatus = () => {
      const rate = cacheHitRate.value;
      if (rate < 0) return 'idle';
      if (rate >= 80) return 'healthy';
      if (rate >= 40) return 'warning';
      if (rate > 0) return 'active';
      return 'idle';
    };

    return {
      cacheStatusText,
      getContextStatus,
      getErrorRecoveryStatus,
      getToolStatus,
      getToolsLoadedStatus,
      getCacheStatus,
    };
  },
};
</script>

<style scoped>
.health-panel {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0;
  padding: 12px 16px;
}

.health-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.panel-title {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.health-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.health-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.health-item.healthy {
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.1);
}

.health-item.active {
  background: rgba(var(--blue-rgb), 0.05);
  border: 1px solid rgba(var(--blue-rgb), 0.1);
}

.health-item.warning {
  background: rgba(var(--orange-rgb), 0.05);
  border: 1px solid rgba(var(--orange-rgb), 0.1);
}

.health-item.error {
  background: rgba(var(--red-rgb), 0.05);
  border: 1px solid rgba(var(--red-rgb), 0.1);
}

.health-item.idle {
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid rgba(127, 129, 147, 0.1);
}

.indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.health-item.healthy .indicator {
  background: var(--color-green);
  box-shadow: 0 0 6px rgba(var(--green-rgb), 0.4);
}

.health-item.active .indicator {
  background: var(--color-blue);
  box-shadow: 0 0 6px rgba(var(--blue-rgb), 0.4);
  animation: pulse 2s infinite;
}

.health-item.warning .indicator {
  background: var(--color-orange);
  box-shadow: 0 0 6px rgba(var(--orange-rgb), 0.4);
}

.health-item.error .indicator {
  background: var(--color-red);
  box-shadow: 0 0 6px rgba(var(--red-rgb), 0.4);
}

.health-item.idle .indicator {
  background: var(--color-med-navy);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.item-label {
  font-size: 0.75em;
  color: var(--color-text);
  flex: 1;
}

.item-status {
  font-size: 0.7em;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
}

.health-item.healthy .item-status {
  color: var(--color-green);
}

.health-item.active .item-status {
  color: var(--color-blue);
}

.health-item.warning .item-status {
  color: var(--color-orange);
}

.health-item.error .item-status {
  color: var(--color-red);
}

@media (max-width: 768px) {
  .health-panel {
    padding: 8px 12px;
  }

  .health-items {
    gap: 6px;
  }

  .health-item {
    padding: 4px 6px;
  }

  .item-label {
    font-size: 0.7em;
  }

  .item-status {
    font-size: 0.65em;
  }
}
</style>
