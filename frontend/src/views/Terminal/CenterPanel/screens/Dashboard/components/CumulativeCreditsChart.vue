<template>
  <div class="cumulative-credits-section">
    <div class="chart-header">
      <div class="header-with-info">
        <h4>Task Seconds Automated</h4>
        <Tooltip
          title="Seconds Automated Over Time"
          text="Tracks how many seconds of task time are automated over time while workflow automations work. Toggle between cumulative and daily views."
          position="bottom"
          width="350px"
        >
          <i class="fas fa-info-circle info-icon"></i>
        </Tooltip>
        <Tooltip text="Your current automation streak!" width="auto" position="bottom">
        <div class="streak-badge clickable">
          <span class="streak-count">{{ daysStreak }} day streak</span>
          <span v-if="daysStreak > 0" class="streak-icon">🔥</span>
        </div>
        </Tooltip>
      </div>
      <div class="chart-controls">
        <select v-model.number="activityDays" @change="onTimeRangeChange" class="time-range-select">
          <option :value="7">Last 7 Days</option>
          <option :value="14">Last 14 Days</option>
          <option :value="30">Last 30 Days</option>
          <option :value="60">Last 60 Days</option>
          <option :value="90">Last 90 Days</option>
          <option :value="180">Last 180 Days</option>
          <option :value="365">Last 365 Days</option>
        </select>
        <Tooltip :text="isCumulativeView ? 'Show Daily' : 'Show Cumulative'" width="auto" position="bottom">
        <button
          class="chart-type-toggle clickable"
          :class="{ active: isCumulativeView }"
          @click="toggleView"
        >
          <i :class="isCumulativeView ? 'fas fa-chart-line' : 'fas fa-chart-bar'"></i>
          <span class="toggle-label">{{ isCumulativeView ? 'Cumulative' : 'Daily' }}</span>
        </button>
        </Tooltip>
      </div>
    </div>
    <div class="chart-container" :class="{ loading: isLoading }">
      <div v-if="isLoading" class="loading-overlay">Loading credits data...</div>
      <canvas ref="chartCanvas"></canvas>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useStore } from 'vuex';
import { Chart, registerables } from 'chart.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

Chart.register(...registerables);

export default {
  name: 'CumulativeCreditsChart',
  components: { Tooltip },
  setup() {
    const store = useStore();
    const chartCanvas = ref(null);

    // Load saved preferences from localStorage
    const savedView = localStorage.getItem('creditsChart_viewType');
    const savedDays = localStorage.getItem('creditsChart_timeRange');

    const isCumulativeView = ref(savedView ? savedView === 'cumulative' : true);
    const activityDays = ref(savedDays ? parseInt(savedDays) : 14);
    let chartInstance = null;

    // Use computed properties to get data from store
    const creditsActivity = computed(() => store.getters['userStats/creditsActivity']);
    const isLoading = computed(() => store.getters['userStats/isCreditsActivityLoading']);
    const daysStreak = computed(() => store.getters['userStats/daysStreak']);

    // Computed property to process data based on view mode
    const chartData = computed(() => {
      if (!creditsActivity.value.rawData || creditsActivity.value.rawData.length === 0) {
        return { labels: [], data: [] };
      }

      if (isCumulativeView.value) {
        // Calculate cumulative from raw data
        let cumulative = 0;
        const processedData = creditsActivity.value.rawData.map((item) => {
          cumulative += item.credits_used;
          return { date: item.date, credits_used: cumulative };
        });
        return {
          labels: processedData.map((item) => item.date),
          data: processedData.map((item) => item.credits_used),
        };
      } else {
        // Use raw daily data
        return {
          labels: creditsActivity.value.rawData.map((item) => item.date),
          data: creditsActivity.value.rawData.map((item) => item.credits_used),
        };
      }
    });

    // Resolve CSS variable for Canvas 2D (which can't parse var() references)
    // Read from document.body since theme variables are set on body.* selectors
    const getPrimaryRgb = () => {
      const raw = getComputedStyle(document.body).getPropertyValue('--primary-rgb').trim();
      return raw || '229, 61, 143';
    };

    const fetchCreditsData = () => {
      // Dispatch action to fetch from store
      store.dispatch('userStats/fetchCreditsActivity', {
        activityDays: activityDays.value,
        isCumulativeView: isCumulativeView.value,
      });
    };

    const renderChart = () => {
      if (!chartCanvas.value) return;

      const data = chartData.value;

      if (!data || !data.labels || !data.data || data.labels.length === 0) {
        console.log('No data to render');
        return;
      }

      // Always destroy and recreate the chart
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }

      const ctx = chartCanvas.value.getContext('2d');
      if (!ctx) return;

      // Clear the canvas completely
      ctx.clearRect(0, 0, chartCanvas.value.width, chartCanvas.value.height);

      console.log('Rendering chart with', data.labels.length, 'data points', 'Range:', activityDays.value, 'days');

      const g = getPrimaryRgb();

      chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: isCumulativeView.value ? 'Cumulative Seconds Automated' : 'Daily Seconds Automated',
              data: data.data,
              fill: true,
              backgroundColor: (context) => {
                const chart = context.chart;
                const { ctx, chartArea } = chart;
                if (!chartArea) {
                  return null;
                }
                const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                gradient.addColorStop(0, `rgba(${g}, 0)`);
                gradient.addColorStop(1, `rgba(${g}, 0.3)`);
                return gradient;
              },
              borderColor: `rgba(${g}, 1)`,
              tension: 0.4,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointBackgroundColor: `rgba(${g}, 1)`,
              pointHoverBackgroundColor: `rgba(${g}, 1)`,
              pointBorderColor: '#fff',
              pointHoverBorderColor: '#fff',
              pointBorderWidth: 2,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 750,
            easing: 'easeInOutQuart',
          },
          interaction: {
            intersect: false,
            mode: 'index',
          },
          scales: {
            y: {
              beginAtZero: true,
              min: 0,
              grid: {
                color: `rgba(${g}, 0.05)`,
              },
              ticks: {
                color: `rgba(${g}, 0.5)`,
                font: { size: 10 },
                maxTicksLimit: 6,
                callback: function (value) {
                  return new Intl.NumberFormat('en-US', {
                    maximumFractionDigits: 0,
                  }).format(value);
                },
              },
            },
            x: {
              grid: {
                display: false,
              },
              ticks: {
                color: `rgba(${g}, 0.5)`,
                font: { size: 10 },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 10,
              },
            },
          },
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              enabled: true,
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: '#fff',
              bodyColor: '#fff',
              borderColor: `rgba(${g}, 0.3)`,
              borderWidth: 1,
              padding: 10,
              displayColors: false,
              titleFont: { size: 12 },
              bodyFont: { size: 11 },
              callbacks: {
                label: function (context) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  if (context.parsed.y !== null) {
                    label += new Intl.NumberFormat('en-US', {
                      maximumFractionDigits: 2,
                    }).format(context.parsed.y);
                  }
                  return label;
                },
              },
            },
          },
        },
      });
    };

    const onTimeRangeChange = () => {
      console.log('Time range changed to:', activityDays.value, 'days');
      // Save preference to localStorage
      localStorage.setItem('creditsChart_timeRange', activityDays.value.toString());
      fetchCreditsData();
    };

    const toggleView = () => {
      isCumulativeView.value = !isCumulativeView.value;
      // Save preference to localStorage
      localStorage.setItem('creditsChart_viewType', isCumulativeView.value ? 'cumulative' : 'daily');
      // No need to fetch - just re-render with existing data
      nextTick(() => {
        renderChart();
      });
    };

    // Watch chartData and force re-render when it changes
    watch(
      () => chartData.value,
      () => {
        if (!isLoading.value && chartData.value.labels.length > 0) {
          nextTick(() => {
            renderChart();
          });
        }
      },
      { deep: true }
    );

    // Watch for changes in creditsActivity from store
    watch(
      () => creditsActivity.value.rawData,
      () => {
        if (!isLoading.value && creditsActivity.value.rawData.length > 0) {
          nextTick(() => {
            renderChart();
          });
        }
      },
      { deep: true }
    );

    // Re-render chart when theme changes (body class changes update CSS variables)
    let themeObserver = null;

    onMounted(() => {
      fetchCreditsData();

      // If data already exists in store (from cache), render immediately
      if (creditsActivity.value.rawData && creditsActivity.value.rawData.length > 0) {
        nextTick(() => {
          renderChart();
        });
      }

      // Watch for theme changes on <body> class list
      // Use a short delay so CSS variables have time to update after the class swap
      themeObserver = new MutationObserver(() => {
        if (chartData.value.labels.length > 0) {
          setTimeout(() => {
            renderChart();
          }, 100);
        }
      });
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });

    onUnmounted(() => {
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      if (themeObserver) {
        themeObserver.disconnect();
        themeObserver = null;
      }
    });

    return {
      chartCanvas,
      isCumulativeView,
      isLoading,
      activityDays,
      daysStreak,
      toggleView,
      onTimeRangeChange,
    };
  },
};
</script>

<style scoped>
.cumulative-credits-section {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 16px;
  border-radius: 8px;
  position: relative;
  overflow: visible !important;
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
}

.chart-container {
  width: 100%;
  height: 280px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
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
  background: var(--color-darker-0);
  color: var(--color-primary);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.chart-header h4 {
  color: var(--color-primary);
  font-size: 1em;
  margin: 0;
}

.streak-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(var(--yellow-rgb), 0.1);
  border: 1px solid rgba(var(--yellow-rgb), 0.3);
  padding: 2px 8px;
  border-radius: 4px;
  margin-left: 8px;
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  color: var(--color-orange);
  transition: all 0.2s ease;
}

.streak-badge:hover {
  background: rgba(var(--yellow-rgb), 0.2);
  transform: translateY(-1px);
}

.streak-count {
  font-weight: bold;
}

.chart-controls {
  display: flex;
  gap: 8px;
}

.chart-type-toggle {
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  color: var(--color-text-muted);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
}

.chart-type-toggle:hover {
  background: rgba(var(--primary-rgb), 0.2);
  color: var(--color-primary);
}

.chart-type-toggle.active {
  background: var(--color-primary);
  color: #ffffff;
}

.toggle-label {
  font-size: 0.85em;
  font-weight: 500;
}

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

.header-with-info h4 {
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
  color: var(--color-primary);
}

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

.time-range-select {
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  color: var(--color-text-muted);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.85em;
  font-weight: 500;
  outline: none;
}

.time-range-select:hover {
  background: rgba(var(--primary-rgb), 0.2);
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.5);
}

.time-range-select:focus {
  background: rgba(var(--primary-rgb), 0.15);
  border-color: var(--color-primary);
}

.time-range-select option {
  background: var(--color-dark-navy);
  color: var(--color-text);
  padding: 8px;
}
</style>
