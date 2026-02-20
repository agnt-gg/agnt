<template>
  <div class="chart-section">
    <div class="chart-header">
      <div class="header-with-info">
        <h4>Network Throughput & Efficiency</h4>
        <Tooltip
          title="Network Performance"
          text="Real-time visualization of token flow (Earned vs. Spent) and current operational efficiency metrics."
          position="bottom"
          width="350px"
        >
          <i class="fas fa-info-circle info-icon"></i>
        </Tooltip>
      </div>
      <div class="chart-controls">
        <Tooltip text="Line Chart" width="auto">
        <button class="chart-type-toggle clickable" :class="{ active: chartType === 'line' }" @click="setChartType('line')">
          <i class="fas fa-chart-line"></i>
        </button>
        </Tooltip>
        <Tooltip text="Bar Chart" width="auto">
        <button class="chart-type-toggle clickable" :class="{ active: chartType === 'bar' }" @click="setChartType('bar')">
          <i class="fas fa-chart-bar"></i>
        </button>
        </Tooltip>
      </div>
    </div>
    <div class="chart-container" :class="{ loading: isLoading }">
      <div v-if="isLoading" class="loading-overlay">Initializing visualization matrix...</div>
      <canvas ref="chartCanvas"></canvas>
    </div>
    <!-- Performance Insights -->
    <!-- <div class="performance-insights" v-if="performanceData">
      <div class="insight-card" :class="getInsightCardClass(performanceData.efficiencyScore)">
        <i :class="getInsightIcon(performanceData.efficiencyScore)"></i>
        <div class="insight-text-content">
            <span class="insight-score">Efficiency: {{ performanceData.efficiencyScore }}%</span>
            <span>{{ performanceData.dynamicInsight }}</span>
        </div>
      </div>
    </div> -->
  </div>
</template>

<script>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { Chart, registerables } from 'chart.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

Chart.register(...registerables);

export default {
  name: 'ChartCard',
  components: { Tooltip },
  props: {
    tokenActivity: {
      type: Object,
      default: () => ({ labels: [], earned: [], spent: [] }),
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
    performanceData: {
      type: Object,
      default: () => ({ dynamicInsight: 'System nominal.', efficiencyScore: 100 }),
    },
  },
  setup(props) {
    const chartCanvas = ref(null);
    const chartType = ref('line');
    let chartInstance = null;

    const renderChart = () => {
      if (!chartCanvas.value || !props.tokenActivity) return;

      const data = props.tokenActivity;

      if (chartInstance) {
        chartInstance.data.labels = data.labels;
        chartInstance.data.datasets[0].data = data.earned;
        chartInstance.data.datasets[1].data = data.spent;
        chartInstance.config.type = chartType.value;
        chartInstance.data.datasets.forEach((dataset, index) => {
          const isEarnedDataset = index === 0;
          if (chartType.value === 'line') {
            dataset.backgroundColor = isEarnedDataset ? 'rgba(var(--green-rgb), 0.2)' : 'rgba(255, 99, 132, 0.2)';
            dataset.borderColor = isEarnedDataset ? 'rgba(var(--green-rgb), 1)' : 'rgba(255, 99, 132, 1)';
            dataset.borderWidth = 2;
            dataset.tension = 0.4;
            dataset.pointRadius = 1;
            dataset.pointHoverRadius = 3;
            dataset.fill = true;
          } else {
            dataset.backgroundColor = isEarnedDataset ? 'rgba(var(--green-rgb), 0.6)' : 'rgba(255, 99, 132, 0.6)';
            dataset.borderColor = isEarnedDataset ? 'rgba(var(--green-rgb), 1)' : 'rgba(255, 99, 132, 1)';
            dataset.borderWidth = 0;
          }
        });
        chartInstance.update('none');
      } else {
        const ctx = chartCanvas.value.getContext('2d');
        if (!ctx) return;

        chartInstance = new Chart(ctx, {
          type: chartType.value,
          data: {
            labels: data.labels,
            datasets: [
              {
                label: 'Tokens Earned/Sec',
                data: data.earned,
                borderColor: 'rgba(var(--green-rgb), 1)',
                backgroundColor: 'rgba(var(--green-rgb), 0.2)',
                tension: 0.4,
                borderWidth: 2,
                fill: true,
                pointRadius: 1,
                pointHoverRadius: 3,
              },
              {
                label: 'Tokens Spent/Sec',
                data: data.spent,
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                tension: 0.4,
                borderWidth: 2,
                fill: true,
                pointRadius: 1,
                pointHoverRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
              intersect: false,
              mode: 'index',
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: {
                  color: 'rgba(var(--green-rgb), 0.05)',
                },
                ticks: {
                  color: 'rgba(var(--green-rgb), 0.5)',
                  font: { size: 10 },
                  maxTicksLimit: 5,
                },
              },
              x: {
                grid: {
                  display: false,
                },
                ticks: {
                  color: 'rgba(var(--green-rgb), 0.5)',
                  font: { size: 10 },
                  maxRotation: 0,
                  minRotation: 0,
                  autoSkip: true,
                  maxTicksLimit: 8,
                },
              },
            },
            plugins: {
              legend: {
                display: true,
                position: 'bottom',
                labels: {
                  color: 'rgba(var(--green-rgb), 0.7)',
                  font: { size: 10 },
                  boxWidth: 10,
                  padding: 10,
                },
              },
              tooltip: {
                enabled: true,
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0,0,0,0.7)',
                titleFont: { size: 12 },
                bodyFont: { size: 10 },
                padding: 8,
              },
            },
          },
        });
      }
    };

    const setChartType = (type) => {
      if (!chartInstance || chartType.value === type) return;
      chartType.value = type;
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      renderChart();
    };

    const getInsightCardClass = (score) => {
      if (score >= 90) return 'status-optimal';
      if (score >= 70) return 'status-good';
      return 'status-warning';
    };

    const getInsightIcon = (score) => {
      if (score >= 90) return 'fas fa-check-circle';
      if (score >= 70) return 'fas fa-tools';
      return 'fas fa-exclamation-triangle';
    };

    watch(
      () => props.tokenActivity,
      () => {
        if (!props.isLoading) {
          renderChart();
        }
      },
      { deep: true, immediate: true }
    );

    watch(
      () => props.isLoading,
      (newIsLoading) => {
        if (!newIsLoading && chartInstance) {
          renderChart();
        } else if (newIsLoading && chartInstance) {
        }
      }
    );

    onMounted(() => {
      renderChart();
    });

    onUnmounted(() => {
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
    });

    return {
      chartCanvas,
      chartType,
      setChartType,
      getInsightCardClass,
      getInsightIcon,
    };
  },
};
</script>

<style scoped>
/* ROI Performance Chart */
.chart-section {
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  padding: 16px;
  border-radius: 4px;
  position: relative;
  overflow: visible !important;
  display: flex;
  flex-direction: column;
}

.chart-container {
  width: 100%;
  min-height: 280px;
  flex-grow: 1;
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.15);
  padding: 8px;
  box-sizing: border-box;
  position: relative;
  cursor: crosshair;
  margin: 8px 0 0;
}

.chart-container.loading {
  opacity: 0.7;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  color: var(--color-green);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.performance-insights {
  margin-top: 12px;
}

.insight-card {
  border: 1px solid;
  padding: 10px 14px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9em;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.insight-text-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.insight-score {
  font-weight: bold;
  font-size: 1em;
}

.insight-card.status-optimal {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
  color: var(--color-green-light);
}
.insight-card.status-optimal i {
  color: var(--color-green);
}

.insight-card.status-good {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.3);
  color: var(--color-yellow);
}
.insight-card.status-good i {
  color: var(--color-yellow);
}

.insight-card.status-warning {
  background: rgba(255, 99, 132, 0.1);
  border-color: rgba(255, 99, 132, 0.3);
  color: #ff6384;
}
.insight-card.status-warning i {
  color: #ff6384;
}

.insight-card i {
  font-size: 1.2em;
  margin-right: 4px;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.chart-header h4 {
  color: var(--color-light-green);
  font-size: 1em;
}

.chart-controls {
  display: flex;
  gap: 8px;
}

.chart-type-toggle {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-grey-light);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.chart-type-toggle:hover {
  background: rgba(var(--green-rgb), 0.2);
  color: var(--color-green);
}

.chart-type-toggle.active {
  background: var(--color-green);
  color: var(--color-dark-navy);
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

/* Common clickable element styles */
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
