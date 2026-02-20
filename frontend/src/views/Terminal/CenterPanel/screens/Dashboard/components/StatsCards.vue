<template>
  <div class="stats-snapshot">
    <div class="stat-card">
      <div class="stat-header">
        <i class="fas fa-robot stat-icon"></i>
        <div class="stat-info">
          <div class="header-with-info">
            <h4>Agent Status</h4>
            <Tooltip title="Agent Status" text="Overview of your agent workforce: Active vs. Idle." position="right">
              <i class="fas fa-info-circle info-icon"></i>
            </Tooltip>
          </div>
          <p>{{ agentsActive }} Active / {{ agentsIdle }} Idle</p>
        </div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <i class="fas fa-tachometer-alt stat-icon"></i>
        <div class="stat-info">
          <div class="header-with-info">
            <h4>Mission Rate</h4>
            <Tooltip title="Missions per Second" text="Current rate of mission processing by your agents." position="right">
              <i class="fas fa-info-circle info-icon"></i>
            </Tooltip>
          </div>
          <p ref="missionRateElement">{{ missionsPerSecond.toFixed(1) }} /sec</p>
        </div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <i class="fas fa-coins stat-icon"></i>
        <div class="stat-info">
          <div class="header-with-info">
            <h4>Token Flow</h4>
            <Tooltip title="Tokens per Second" text="Current rate of token earnings." position="left">
              <i class="fas fa-info-circle info-icon"></i>
            </Tooltip>
          </div>
          <p ref="tokenRateElement">+{{ localizeNumber(tokensPerSecond.toFixed(0)) }} /sec</p>
        </div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <i class="fas fa-piggy-bank stat-icon"></i>
        <div class="stat-info">
          <div class="header-with-info">
            <h4>Total Tokens</h4>
            <Tooltip title="Total Accumulated Tokens" text="Your current entire token wealth." position="left">
              <i class="fas fa-info-circle info-icon"></i>
            </Tooltip>
          </div>
          <p ref="tokensElement">{{ localizeNumber(totalTokens.toFixed(0)) }} T</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { ref, watch, nextTick } from 'vue';

export default {
  name: 'StatsCards',
  components: { Tooltip },
  props: {
    agentsActive: {
      type: Number,
      default: 0,
    },
    agentsIdle: {
      type: Number,
      default: 0,
    },
    missionsPerSecond: {
      type: Number,
      default: 0,
    },
    tokensPerSecond: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
  },
  setup(props) {
    const tokensElement = ref(null);
    const tokenRateElement = ref(null);
    const missionRateElement = ref(null);

    // Watch for increases and trigger particle effects
    const previousTotalTokens = ref(props.totalTokens);
    const previousTokensPerSecond = ref(props.tokensPerSecond);
    const previousMissionsPerSecond = ref(props.missionsPerSecond);

    const createParticle = (element, value, isPositive = true) => {
      if (!element) return;

      const particle = document.createElement('div');
      particle.className = `particle-effect ${isPositive ? 'positive' : 'negative'}`;
      particle.textContent = isPositive ? `+${value}` : `-${value}`;

      // Position relative to the element
      const rect = element.getBoundingClientRect();
      particle.style.position = 'fixed';
      particle.style.left = rect.right + 'px';
      particle.style.top = rect.top + 'px';
      particle.style.zIndex = '9999';
      particle.style.pointerEvents = 'none';

      document.body.appendChild(particle);

      // Animate and remove
      setTimeout(() => {
        particle.style.transform = 'translateY(-30px)';
        particle.style.opacity = '0';
      }, 10);

      setTimeout(() => {
        if (particle.parentNode) {
          particle.parentNode.removeChild(particle);
        }
      }, 1000);
    };

    watch(
      () => props.totalTokens,
      (newVal, oldVal) => {
        if (newVal > oldVal && oldVal > 0) {
          nextTick(() => {
            createParticle(tokensElement.value?.$el || tokensElement.value, Math.floor(newVal - oldVal));
          });
        }
        previousTotalTokens.value = newVal;
      }
    );

    watch(
      () => props.tokensPerSecond,
      (newVal, oldVal) => {
        if (newVal > oldVal * 1.1 && oldVal > 0) {
          // Only trigger on significant increases
          nextTick(() => {
            createParticle(tokenRateElement.value?.$el || tokenRateElement.value, '↑');
          });
        }
        previousTokensPerSecond.value = newVal;
      }
    );

    watch(
      () => props.missionsPerSecond,
      (newVal, oldVal) => {
        if (newVal > oldVal * 1.1 && oldVal > 0) {
          nextTick(() => {
            createParticle(missionRateElement.value?.$el || missionRateElement.value, '↑');
          });
        }
        previousMissionsPerSecond.value = newVal;
      }
    );

    const localizeNumber = (value) => {
      return parseFloat(value).toLocaleString('en-US');
    };

    return {
      tokensElement,
      tokenRateElement,
      missionRateElement,
      localizeNumber,
    };
  },
};
</script>

<style scoped>
/* Global Stats Snapshot */
.stats-snapshot {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(192px, 1fr));
  gap: 16px;
  position: relative;
  overflow: visible !important;
}

.stat-card {
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  padding: 16px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(var(--green-rgb), 0.1);
}

.stat-card i.stat-icon {
  font-size: 1.6em;
  color: var(--color-green);
  width: 30px;
  text-align: center;
}

.stat-info {
  flex: 1;
}

.stat-info h4 {
  margin: 0;
  color: var(--color-grey-light);
  font-size: 0.9em;
  white-space: nowrap;
}

.stat-info p {
  margin: 5px 0 0 0;
  color: var(--color-white);
  font-size: 1.2em;
  font-weight: bold;
  line-height: 1.1;
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
  white-space: nowrap;
}

.header-with-info h4,
.header-with-info h3 {
  margin: 0;
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

/* Adjust Stat Card Layout */
.stat-card {
  align-items: flex-start;
}

.stat-icon {
  margin-top: 4px;
}

.stat-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}

.stat-info p {
  margin: 2px 0 0 0;
  font-size: 1.15em;
}

.stats-snapshot {
  overflow: visible;
}

/* Particle Effects */
:global(.particle-effect) {
  font-size: 14px;
  font-weight: bold;
  transition: all 1s ease-out;
  z-index: 9999;
  pointer-events: none;
}

:global(.particle-effect.positive) {
  color: var(--color-green);
  text-shadow: 0 0 4px var(--color-green);
}

:global(.particle-effect.negative) {
  color: var(--color-red);
  text-shadow: 0 0 4px var(--color-red);
}

/* Glowing animation for increasing values */
.stat-card.increasing {
  animation: value-increase-glow 0.5s ease-out;
}

@keyframes value-increase-glow {
  0% {
    box-shadow: 0 0 5px rgba(var(--green-rgb), 0.3);
  }
  50% {
    box-shadow: 0 0 20px rgba(var(--green-rgb), 0.6);
  }
  100% {
    box-shadow: 0 0 5px rgba(var(--green-rgb), 0.1);
  }
}

.stat-info p {
  margin: 2px 0 0 0;
  font-size: 1.15em;
  transition: all 0.3s ease;
}

.stat-info p.flash {
  animation: number-flash 0.3s ease-out;
}

@keyframes number-flash {
  0% {
    transform: scale(1);
    color: var(--color-white);
  }
  50% {
    transform: scale(1.1);
    color: var(--color-green);
  }
  100% {
    transform: scale(1);
    color: var(--color-white);
  }
}
</style>
