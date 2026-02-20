<template>
  <div class="health-panel">
    <div class="health-header">
      <span class="panel-title">System Health</span>
      <span class="uptime" v-if="systemHealth?.uptime">{{ systemHealth.uptime }}</span>
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

      <div class="health-item" :class="getBackgroundStatus()">
        <span class="indicator"></span>
        <span class="item-label">Background Services</span>
        <span class="item-status">{{ activeProcesses.length }} running</span>
      </div>
    </div>

    <div v-if="systemHealth?.memoryUsage" class="memory-info">
      <span class="memory-label">Memory:</span>
      <span class="memory-value">{{ systemHealth.memoryUsage }}</span>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'SystemHealthPanel',
  props: {
    systemHealth: {
      type: Object,
      default: () => ({
        memoryUsage: null,
        activeProcesses: [],
        errorsCaught: 0,
        uptime: null,
      }),
    },
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
  },
  setup(props) {
    const activeProcesses = computed(() => {
      return props.systemHealth?.activeProcesses || ['EmailReceiver', 'WebhookReceiver'];
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

    const getBackgroundStatus = () => {
      const processCount = activeProcesses.value.length;
      if (processCount >= 2) return 'healthy';
      if (processCount === 1) return 'warning';
      return 'error';
    };

    return {
      activeProcesses,
      getContextStatus,
      getErrorRecoveryStatus,
      getToolStatus,
      getBackgroundStatus,
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
  /* margin-bottom: 8px; */
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

.uptime {
  font-size: 0.7em;
  color: var(--color-text);
  font-family: var(--font-family-mono);
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
  color: var(--color-bright-light-navy);
  flex: 1;
}

.item-status {
  font-size: 0.7em;
  color: var(--color-med-navy);
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

.memory-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding: 6px 8px;
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid rgba(127, 129, 147, 0.1);
  border-radius: 6px;
}

.memory-label {
  font-size: 0.7em;
  color: var(--color-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.memory-value {
  font-size: 0.7em;
  color: var(--color-bright-light-navy);
  font-family: var(--font-family-mono);
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
