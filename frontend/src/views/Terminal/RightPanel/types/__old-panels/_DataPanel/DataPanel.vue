<template>
  <div class="ui-panel">
    <button class="retro-btn" @click="refreshData">Refresh Data</button>
    <button class="retro-btn" @click="toggleChart">
      {{ chartType === "line" ? "Show Bar Chart" : "Show Line Chart" }}
    </button>
    <div class="chart-container">
      <canvas ref="chartCanvas"></canvas>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from "vue";
import { Chart, registerables } from "chart.js";
import { useStore } from "vuex";

Chart.register(...registerables);

export default {
  name: "DashboardPanel",
  emits: ["panel-action"],
  setup(props, { emit }) {
    const store = useStore();
    const chartCanvas = ref(null);
    let chartInstance = null;
    const chartType = ref("line");

    const renderChart = () => {
      if (!chartCanvas.value || !store.state.userStats.agentActivity.labels.length) return;
      const ctx = chartCanvas.value.getContext("2d");
      if (!ctx) return;

      if (chartInstance) {
        chartInstance.data.labels = store.state.userStats.agentActivity.labels;
        chartInstance.data.datasets[0].data = store.state.userStats.agentActivity.data;
        chartInstance.update('none');
        return;
      }

      chartInstance = new Chart(ctx, {
        type: chartType.value,
        data: {
          labels: store.state.userStats.agentActivity.labels,
          datasets: [{
            label: "Tokens Used",
            data: store.state.userStats.agentActivity.data,
            backgroundColor: "rgba(25, 239, 131, 0.2)",
            borderColor: "rgba(25, 239, 131, 1)",
            borderWidth: 1,
            tension: 0.4,
            pointBackgroundColor: "rgba(11,11,23,1)",
            pointBorderColor: "#fff",
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 750,
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: "rgba(25, 239, 131, 0.7)" },
              grid: { color: "rgba(25, 239, 131, 0.1)" },
            },
            x: {
              ticks: { color: "rgba(25, 239, 131, 0.7)" },
              grid: { color: "rgba(25, 239, 131, 0.1)" },
            },
          },
          plugins: {
            legend: {
              display: true,
              labels: { color: "rgba(25, 239, 131, 0.9)" },
            },
          },
        },
      });
    };

    const refreshData = async () => {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 1);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 14);

      await store.dispatch('userStats/fetchAgentActivity', { startDate, endDate });
      renderChart();
      emit("panel-action", "refresh");
    };

    const toggleChart = () => {
      chartType.value = chartType.value === "line" ? "bar" : "line";
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      renderChart();
      emit("panel-action", "toggle-chart", chartType.value);
    };

    onMounted(async () => {
      await refreshData();
    });

    onUnmounted(() => {
      if (chartInstance) {
        chartInstance.destroy();
      }
    });

    return {
      chartCanvas,
      chartType,
      refreshData,
      toggleChart,
    };
  },
};
</script>

<style scoped>
.ui-panel {
  display: flex;
  flex-direction: column;
  gap: 15px;
  width: 100%;
  flex-shrink: 0;
  position: relative;
  z-index: 3;
}

.retro-btn {
  background: transparent;
  border: 2px solid var(--color-green);
  color: var(--color-green);
  padding: 8px 12px;
  font-family: "Courier New", monospace;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
  text-shadow: 0 0 3px rgba(25, 239, 131, 0.4);
  text-align: center;
  position: relative;
  z-index: 3;
}

.retro-btn:hover {
  background: rgba(25, 239, 131, 0.1);
  box-shadow: 0 0 8px rgba(25, 239, 131, 0.5);
}

.chart-container {
  width: 100%;
  height: 250px;
  background: rgba(0, 10, 0, 0.3);
  border: 1px solid rgba(25, 239, 131, 0.3);
  padding: 10px;
  box-sizing: border-box;
  position: relative;
  cursor: crosshair;
  z-index: 3;
}

canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
