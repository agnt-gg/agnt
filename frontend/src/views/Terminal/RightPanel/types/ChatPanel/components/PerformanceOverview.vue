<template>
  <div class="dashboard-section performance-overview">
    <h3 class="section-title">AUTOMATION PERFORMANCE</h3>

    <div class="performance-grid">
      <div class="performance-card">
        <canvas ref="performanceCanvas" class="performance-chart"></canvas>
        <div class="card-metrics">
          <span class="metric-primary">{{ automationEfficiency }}%</span>
          <span class="metric-label">Efficiency</span>
        </div>
      </div>

      <div class="performance-stats">
        <div class="stat-row">
          <span class="stat-label">Tasks Processed</span>
          <span class="stat-value">{{ tasksProcessed }}/hour</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">System Load</span>
          <span class="stat-value">{{ systemLoad }}%</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Time Saved</span>
          <span class="stat-value positive">{{ timeSaved }} hrs/week</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useStore } from "vuex";

export default {
  name: "PerformanceOverview",
  setup() {
    const store = useStore();
    const performanceCanvas = ref(null);

    const automationEfficiency = computed(
      () => store.getters["userStats/roiPercentage"] || 0
    );
    const tasksProcessed = computed(
      () => store.getters["userStats/totalWorkflows"] || 0
    );
    const systemLoad = ref(68);
    const timeSaved = ref(23);

    const animatePerformanceChart = () => {
      if (!performanceCanvas.value) return;
      const ctx = performanceCanvas.value.getContext("2d");
      const width = performanceCanvas.value.width;
      const height = performanceCanvas.value.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 3;

      ctx.clearRect(0, 0, width, height);

      // Draw efficiency arc background
      ctx.strokeStyle = "rgba(25, 239, 131, 0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        centerX,
        centerY,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2,
        false
      );
      ctx.stroke();

      // Draw actual efficiency
      const efficiencyValue = automationEfficiency.value / 100;
      ctx.strokeStyle = "rgba(25, 239, 131, 0.8)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(
        centerX,
        centerY,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * efficiencyValue,
        false
      );
      ctx.stroke();
    };

    let animationFrame = null;

    const startAnimations = () => {
      const animate = () => {
        animatePerformanceChart();
        animationFrame = requestAnimationFrame(animate);
      };
      animate();
    };

    const stopAnimations = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };

    onMounted(() => {
      nextTick(() => {
        if (performanceCanvas.value) {
          performanceCanvas.value.width = 120;
          performanceCanvas.value.height = 120;
        }
        startAnimations();
      });
    });

    onUnmounted(() => {
      stopAnimations();
    });

    return {
      performanceCanvas,
      automationEfficiency,
      tasksProcessed,
      systemLoad,
      timeSaved,
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
  font-family: system-ui, -apple-system, sans-serif;
}

.performance-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 24px;
  align-items: center;
}

.performance-card {
  position: relative;
}

.performance-chart {
  width: 120px;
  height: 120px;
}

.card-metrics {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.metric-primary {
  font-size: 1.8em;
  font-weight: 300;
  color: var(--color-white);
}

.metric-label {
  font-size: 0.7em;
  color: var(--color-med-navy);
  margin-top: 4px;
}

.performance-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(127, 129, 147, 0.1);
}

.stat-label {
  font-size: 0.85em;
  color: var(--color-med-navy);
}

.stat-value {
  font-size: 0.95em;
  color: var(--color-bright-light-navy);
  font-variant-numeric: tabular-nums;
}

.stat-value.positive {
  color: var(--color-green);
}

@media (max-width: 768px) {
  .performance-grid {
    grid-template-columns: 1fr;
  }
}
</style> 