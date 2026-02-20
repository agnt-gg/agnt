<template>
  <div class="context-monitor">
    <div class="context-header">
      <span class="monitor-title">Context Usage</span>
      <span class="model-badge">{{ contextStatus?.model || 'N/A' }}</span>
    </div>

    <div class="context-bar">
      <div class="usage-bar">
        <div class="usage-fill" :class="getUsageClass()" :style="{ width: utilizationPercent + '%' }"></div>
      </div>
      <div class="context-info">
        <span class="token-count"> {{ formatNumber(contextStatus?.currentTokens || 0) }} / {{ formatNumber(contextStatus?.tokenLimit || 0) }} </span>
        <span class="percentage">{{ utilizationPercent.toFixed(1) }}%</span>
      </div>
    </div>

    <div v-if="lastManaged" class="last-managed">
      <span class="managed-icon">⚡</span>
      <span class="managed-text"> Last managed: {{ lastManaged?.reduction?.toLocaleString() || '0' }} tokens saved </span>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'ContextMonitor',
  props: {
    contextStatus: {
      type: Object,
      default: () => ({
        currentTokens: 0,
        tokenLimit: 16000,
        utilizationPercent: 0,
        model: 'N/A',
        messagesCount: 0,
      }),
    },
    lastManaged: {
      type: Object,
      default: null,
    },
  },
  setup(props) {
    const utilizationPercent = computed(() => {
      if (!props.contextStatus?.tokenLimit || !props.contextStatus?.currentTokens) return 0;
      return Math.min((props.contextStatus.currentTokens / props.contextStatus.tokenLimit) * 100, 100);
    });

    const getUsageClass = () => {
      const percent = utilizationPercent.value;
      if (percent >= 90) return 'critical';
      if (percent >= 75) return 'warning';
      if (percent >= 50) return 'moderate';
      return 'low';
    };

    const formatNumber = (num) => {
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
      }
      return num.toString();
    };

    return {
      utilizationPercent,
      getUsageClass,
      formatNumber,
    };
  },
};
</script>

<style scoped>
.context-monitor {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0;
  padding: 12px 16px;
  /* margin-bottom: 8px; */
}

.context-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.monitor-title {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.model-badge {
  font-size: 0.7em;
  padding: 2px 8px;
  background: rgba(var(--blue-rgb), 0.1);
  border: 1px solid rgba(var(--blue-rgb), 0.2);
  border-radius: 12px;
  color: var(--color-blue);
  font-family: var(--font-family-mono);
}

.context-bar {
  margin-bottom: 8px;
}

.usage-bar {
  width: 100%;
  height: 6px;
  background: var(--color-darker-1);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;
}

.usage-fill {
  height: 100%;
  border-radius: 3px;
  transition: all 0.3s ease;
}

.usage-fill.low {
  background: linear-gradient(90deg, var(--color-green), rgba(var(--green-rgb), 0.8));
}

.usage-fill.moderate {
  background: linear-gradient(90deg, var(--color-blue), rgba(var(--blue-rgb), 0.8));
}

.usage-fill.warning {
  background: linear-gradient(90deg, var(--color-orange), rgba(var(--orange-rgb), 0.8));
}

.usage-fill.critical {
  background: linear-gradient(90deg, var(--color-red), rgba(var(--red-rgb), 0.8));
}

.context-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.token-count {
  font-size: 0.8em;
  color: var(--color-bright-light-navy);
  font-family: var(--font-family-mono);
}

.percentage {
  font-size: 0.8em;
  font-weight: 600;
  color: var(--color-light-med-navy);
}

.last-managed {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.1);
  border-radius: 6px;
  margin-top: 8px;
}

.managed-icon {
  font-size: 0.9em;
}

.managed-text {
  font-size: 0.7em;
  color: var(--color-green);
  font-weight: 500;
}

@media (max-width: 768px) {
  .context-monitor {
    padding: 8px 12px;
  }

  .context-header {
    margin-bottom: 6px;
  }

  .monitor-title {
    font-size: 0.7em;
  }

  .model-badge {
    font-size: 0.65em;
    padding: 1px 6px;
  }
}
</style>
