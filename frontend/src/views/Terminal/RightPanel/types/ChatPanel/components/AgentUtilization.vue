<template>
  <div class="dashboard-section agent-utilization">
    <h3 class="section-title">AGENT UTILIZATION</h3>

    <div class="agents-card">
      <div v-for="agent in agents" :key="agent.id" class="agent-row">
        <div class="agent-info">
          <span class="agent-name">{{ agent.name }}</span>
          <span class="agent-status" :class="agent.statusClass">{{ agent.status }}</span>
        </div>
        <div class="utilization-meter">
          <div class="utilization-label">{{ agent.utilization.toFixed(2) }}%</div>
          <div class="utilization-bars" :ref="(el) => setBarRef(agent.id, el)"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

export default {
  name: 'AgentUtilization',
  setup() {
    const agents = ref([
      {
        id: 'scribe',
        name: 'AI Scribe',
        status: 'Active',
        statusClass: 'active',
        utilization: 45,
        trend: 1,
        barElements: [],
      },
      {
        id: 'analyst',
        name: 'Data Analyst',
        status: 'Processing',
        statusClass: 'processing',
        utilization: 78,
        trend: -2,
        barElements: [],
      },
      {
        id: 'coordinator',
        name: 'Task Coordinator',
        status: 'Idle',
        statusClass: 'idle',
        utilization: 12,
        trend: 0.5,
        barElements: [],
      },
      {
        id: 'researcher',
        name: 'Research Agent',
        status: 'Active',
        statusClass: 'active',
        utilization: 63,
        trend: 1.5,
        barElements: [],
      },
    ]);

    const barRefs = ref({});
    let animationInterval = null;

    const setBarRef = (agentId, el) => {
      if (el) {
        barRefs.value[agentId] = el;
      }
    };

    const createBarsForAgent = (agent) => {
      const container = barRefs.value[agent.id];
      if (!container) return;

      // Clear existing bars
      container.innerHTML = '';
      agent.barElements = [];

      // Create 30 permanent bar elements
      for (let i = 0; i < 30; i++) {
        const bar = document.createElement('span');
        bar.textContent = '░';
        bar.className = 'empty';
        container.appendChild(bar);
        agent.barElements.push(bar);
      }
    };

    const updateAgentBars = (agent) => {
      if (!agent.barElements.length) return;

      const bars = Math.floor((agent.utilization / 100) * 30);

      // Update existing bar elements
      for (let i = 0; i < 30; i++) {
        if (i < bars) {
          const colorIndex = Math.floor(i / 3) % 7; // 3 bars per color
          agent.barElements[i].textContent = '█';
          agent.barElements[i].className = `bar bar-${colorIndex}`;
        } else {
          agent.barElements[i].textContent = '░';
          agent.barElements[i].className = 'empty';
        }
      }
    };

    const animateUtilization = () => {
      agents.value.forEach((agent) => {
        // Random fluctuation with trending behavior
        const change = (Math.random() - 0.5) * 8 + agent.trend;
        agent.utilization += change;

        // Keep within bounds
        if (agent.utilization > 95) {
          agent.utilization = 95;
          agent.trend = -2;
        } else if (agent.utilization < 0) {
          agent.utilization = 0;
          agent.trend = 2;
        }

        // Occasionally change trend
        if (Math.random() < 0.05) {
          agent.trend = (Math.random() - 0.5) * 3;
        }

        // Update status based on utilization
        if (agent.utilization > 70) {
          agent.status = 'High Load';
          agent.statusClass = 'high-load';
        } else if (agent.utilization > 30) {
          agent.status = 'Active';
          agent.statusClass = 'active';
        } else if (agent.utilization > 10) {
          agent.status = 'Low Activity';
          agent.statusClass = 'low-activity';
        } else {
          agent.status = 'Idle';
          agent.statusClass = 'idle';
        }

        agent.utilization = Math.max(0, Math.min(100, agent.utilization));
        updateAgentBars(agent);
      });
    };

    onMounted(() => {
      nextTick(() => {
        // Create bars for all agents
        agents.value.forEach((agent) => {
          createBarsForAgent(agent);
          updateAgentBars(agent);
        });

        // Start animation
        animationInterval = setInterval(animateUtilization, 50);
      });
    });

    onUnmounted(() => {
      if (animationInterval) {
        clearInterval(animationInterval);
      }
    });

    return {
      agents,
      setBarRef,
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
  color: var(--color-duller-navy);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: var(--font-family-primary);
}

.agents-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-row {
  padding: 0;
  border-bottom: 1px solid rgba(127, 129, 147, 0.2);
  padding-bottom: 12px;
}

.agent-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.agent-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.agent-name {
  font-size: 0.9em;
  color: var(--color-text);
  font-weight: 500;
}

.agent-status {
  font-size: 0.8em;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.agent-status.active {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
}

.agent-status.processing {
  color: var(--color-blue);
  background: rgba(18, 224, 255, 0.1);
}

.agent-status.high-load {
  color: var(--color-yellow);
  background: rgba(255, 215, 0, 0.1);
}

.agent-status.low-activity {
  color: var(--color-med-navy);
  background: rgba(127, 129, 147, 0.1);
}

.agent-status.idle {
  color: var(--color-duller-navy);
  background: rgba(127, 129, 147, 0.05);
}

.utilization-meter {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.utilization-label {
  font-size: 0.85em;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  text-align: left;
}

.utilization-bars {
  flex: 1;
  font-family: var(--font-family-mono);
  font-size: 12px;
  line-height: 1;
}

.utilization-bars :deep(.bar),
.utilization-bars :deep(.empty) {
  display: inline;
  margin-right: 1px;
}

.utilization-bars :deep(.bar-0) {
  color: #d4a5a5;
} /* Very desaturated Red */

.utilization-bars :deep(.bar-1) {
  color: #d4b5a5;
} /* Very desaturated Orange */

.utilization-bars :deep(.bar-2) {
  color: #d4d4a5;
} /* Very desaturated Yellow */

.utilization-bars :deep(.bar-3) {
  color: #a5d4b5;
} /* Very desaturated Green */

.utilization-bars :deep(.bar-4) {
  color: #a5c4d4;
} /* Very desaturated Blue */

.utilization-bars :deep(.bar-5) {
  color: #b5a5d4;
} /* Very desaturated Indigo */

.utilization-bars :deep(.bar-6) {
  color: #d4a5d4;
} /* Very desaturated Violet */

.utilization-bars :deep(.empty) {
  color: rgba(127, 129, 147, 0.3);
}

@media (max-width: 768px) {
  .utilization-meter {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .utilization-label {
    text-align: left;
    min-width: auto;
  }

  .utilization-bars {
    font-size: 10px;
  }
}
</style>
