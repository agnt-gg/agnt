<template>
  <div class="dashboard-section integration-health">
    <h3 class="section-title">CONNECTED INTEGRATIONS</h3>

    <div class="integration-overview">
      <div class="health-meter">
        <div class="meter-track">
          <div class="meter-fill" :style="{ width: integrationHealthPercentage + '%' }" :class="healthStatusClass"></div>
        </div>
        <div class="health-labels">
          <span>Critical</span>
          <span>Degraded</span>
          <span>Healthy</span>
        </div>
      </div>

      <div class="health-summary">
        <span class="health-status" :class="healthStatusClass">{{ healthStatusText }}</span>
        <span class="health-count">{{ healthyConnectionsCount }}/{{ totalConnectionsCount }} healthy</span>
        <button @click="refreshHealth" class="refresh-button" :disabled="refreshing">
          {{ refreshing ? '⟳' : '↻' }}
        </button>
      </div>

      <div class="integration-grid">
        <Tooltip
          v-for="integration in integrationDetails"
          :key="integration.provider"
          :text="`${integration.name}: ${integration.metric}`"
          width="auto"
        >
          <div
            class="integration-tile"
            :class="integration.statusClass"
          >
            <div class="integration-icon">
              <SvgIcon :name="integration.icon" />
            </div>
            <span class="integration-name">{{ integration.name }}</span>
            <span class="integration-status-dot" :class="integration.statusClass"></span>
          </div>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'IntegrationHealth',
  components: {
    SvgIcon,
    Tooltip,
  },
  setup() {
    const store = useStore();
    const refreshing = computed(() => store.getters['appAuth/isHealthCheckLoading']);

    const connectionHealth = computed(() => store.state.appAuth.connectionHealth);

    const healthStatusText = computed(() => {
      const status = store.getters['appAuth/connectionHealthStatus'];
      switch (status) {
        case 'healthy':
          return 'All Systems Operational';
        case 'degraded':
          return 'Some Issues Detected';
        case 'critical':
          return 'Critical Issues';
        case 'no_connections':
          return 'No Connections';
        default:
          return 'Status Unknown';
      }
    });

    const healthStatusClass = computed(() => {
      const status = store.getters['appAuth/connectionHealthStatus'];
      return `status-${status}`;
    });

    const healthyConnectionsCount = computed(() => store.getters['appAuth/healthyConnectionsCount']);
    const totalConnectionsCount = computed(() => store.getters['appAuth/totalConnectionsCount']);

    const integrationHealthPercentage = computed(() => {
      const total = totalConnectionsCount.value;
      const healthy = healthyConnectionsCount.value;
      if (total === 0) return 0;
      return Math.round((healthy / total) * 100);
    });

    const integrationDetails = computed(() => {
      if (!connectionHealth.value?.providers) return [];

      return connectionHealth.value.providers.map((provider) => {
        const iconMap = {
          github: 'github',
          slack: 'slack',
          google: 'google',
          twitter: 'twitter',
          openai: 'openai',
          anthropic: 'anthropic',
          stripe: 'stripe',
          discord: 'discord',
          dropbox: 'dropbox',
          notion: 'notion',
          groq: 'groq',
          gemini: 'google',
          agnt: 'custom',
          firecrawl: 'fire',
          deepseek: 'deepseek',
          togetherai: 'together-ai',
          grokai: 'grok-ai',
        };

        return {
          provider: provider.provider,
          icon: iconMap[provider.provider] || 'custom',
          name: provider.provider.charAt(0).toUpperCase() + provider.provider.slice(1),
          metric: provider.details?.error || provider.error || 'Connected',
          statusClass: provider.status,
        };
      });
    });

    const refreshHealth = async () => {
      try {
        await store.dispatch('appAuth/checkConnectionHealthStream');
      } catch (error) {
        console.error('Error refreshing health:', error);
        await store.dispatch('appAuth/checkConnectionHealth');
      }
    };

    return {
      integrationHealthPercentage,
      integrationDetails,
      healthStatusText,
      healthStatusClass,
      healthyConnectionsCount,
      totalConnectionsCount,
      refreshHealth,
      refreshing,
    };
  },
};
</script>

<style scoped>
.dashboard-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-text-muted);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: var(--font-family-primary);
}

.health-meter {
  margin-bottom: 20px;
}

.meter-track {
  height: 8px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.meter-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-yellow) 0%, var(--color-green) 100%);
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.health-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7em;
  color: var(--color-text-muted);
}

.health-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.health-status {
  font-size: 0.9em;
  font-weight: 500;
}

.health-status.status-healthy {
  color: var(--color-green);
}

.health-status.status-degraded {
  color: var(--color-yellow);
}

.health-status.status-critical {
  color: var(--color-red);
}

.health-status.status-unknown {
  color: var(--color-text-muted);
}

.health-count {
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.refresh-button {
  background: none;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.9em;
  transition: all 0.2s;
}

.refresh-button:hover:not(:disabled) {
  border-color: var(--color-blue);
  color: var(--color-blue);
}

.refresh-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.integration-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 8px;
  margin-top: 16px;
  padding: 16px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.15);
  border-radius: 8px;
}

/* Fix Tooltip container to fill grid cells */
.integration-grid :deep(.tooltip-container) {
  width: 100%;
}

.integration-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: rgba(127, 129, 147, 0.05);
  border: 2px solid transparent;
  border-radius: 16px;
  transition: all 0.2s ease;
  cursor: pointer;
  min-height: 32px;
}

.integration-tile:hover {
  background: rgba(127, 129, 147, 0.1);
  transform: translateY(-2px);
}

.integration-tile.healthy {
  border-color: var(--color-green);
}

.integration-tile.error {
  border-color: var(--terminal-border-color);
  opacity: 0.8;
}

/* .integration-icon {
  margin-bottom: 8px;
} */

.integration-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.integration-name {
  display: none;
  font-size: 0.75em;
  color: var(--color-text-muted);
  text-align: center;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.integration-status-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

.integration-status-dot.healthy {
  background: var(--color-green);
  box-shadow: 0 0 4px var(--color-green);
}

.integration-status-dot.error {
  background: var(--color-red);
  box-shadow: 0 0 4px var(--color-red);
}

.integration-status-dot.checking {
  background: var(--color-yellow);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 768px) {
  .integration-grid {
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 6px;
    padding: 12px;
  }

  .integration-tile {
    padding: 10px 6px;
    min-height: 50px;
  }

  .integration-icon :deep(svg) {
    width: 24px;
    height: 24px;
  }

  .integration-tile .integration-name {
    font-size: 0.7em;
  }
}

@media (min-width: 1200px) {
  .integration-grid {
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  }
}
</style>
