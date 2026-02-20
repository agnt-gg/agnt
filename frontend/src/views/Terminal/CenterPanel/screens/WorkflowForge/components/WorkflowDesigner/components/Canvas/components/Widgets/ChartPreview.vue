<template>
  <div
    class="chart-preview-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile, 'has-content': hasChartData }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Chart visualization -->
    <div v-if="hasChartData" class="chart-display">
      <canvas ref="chartCanvas"></canvas>
    </div>

    <!-- Placeholder when no chart data -->
    <div v-else class="chart-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 13h2v8H3v-8zm4-6h2v14H7V7zm4-4h2v18h-2V3zm4 9h2v9h-2v-9zm4-5h2v14h-2V7z" fill="#6c757d" />
      </svg>
      <span v-if="!isDragHover && !isProcessingFile">Drop JSON/CSV data here <br />or paste chart data</span>
      <span v-else-if="isDragHover">Drop data file here</span>
      <span v-else-if="isProcessingFile">Processing file...</span>
    </div>

    <!-- Chart type selector -->
    <div v-if="hasChartData" class="chart-controls">
      <select v-model="selectedChartType" @change="updateChart" class="chart-type-select">
        <option value="bar">Bar Chart</option>
        <option value="line">Line Chart</option>
        <option value="pie">Pie Chart</option>
        <option value="doughnut">Doughnut Chart</option>
        <option value="radar">Radar Chart</option>
      </select>
    </div>

    <!-- Drag overlay -->
    <div v-if="isDragHover" class="drag-overlay">
      <div class="drag-message">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor" />
        </svg>
        <span>Drop data file here</span>
      </div>
    </div>

    <!-- Processing overlay -->
    <div v-if="isProcessingFile" class="processing-overlay">
      <div class="processing-spinner"></div>
      <span>Processing file...</span>
    </div>
  </div>
</template>

<script>
import WidgetBase from './WidgetBase.js';

export default {
  name: 'ChartPreview',
  mixins: [WidgetBase],
  props: {
    chartData: {
      type: [String, Object, Array],
      default: null,
    },
    chartType: {
      type: String,
      default: 'bar',
    },
  },
  data() {
    return {
      selectedChartType: this.chartType || 'bar',
      chartInstance: null,
      resizeObserver: null,
    };
  },
  computed: {
    parsedChartData() {
      // Priority 1: Check output from backend execution (already parsed)
      if (this.output && this.output.chartData) {
        // Backend returns already parsed data, use it directly
        return this.output.chartData;
      }
      // Priority 2: Check nested result structure
      else if (this.output && this.output.result && this.output.result.chartData) {
        return this.output.result.chartData;
      }
      // Priority 3: Check parameters and parse if needed
      else if (this.chartData) {
        return this.parseChartData(this.chartData);
      }
      return null;
    },
    hasChartData() {
      return !!this.parsedChartData;
    },
  },
  watch: {
    parsedChartData: {
      handler() {
        this.$nextTick(() => {
          this.renderChart();
        });
      },
      immediate: true,
    },
    chartType: {
      handler(newType) {
        if (newType) {
          this.selectedChartType = newType;
          this.$nextTick(() => {
            this.renderChart();
          });
        }
      },
      immediate: true,
    },
  },
  mounted() {
    // Set up ResizeObserver to handle canvas resizing
    if (this.$refs.chartCanvas) {
      this.resizeObserver = new ResizeObserver(() => {
        this.renderChart();
      });
      this.resizeObserver.observe(this.$refs.chartCanvas.parentElement);
    }
  },
  beforeUnmount() {
    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      const validExtensions = ['.json', '.csv', '.txt'];
      const fileName = file.name.toLowerCase();
      return validExtensions.some((ext) => fileName.endsWith(ext));
    },

    // Override base process file method
    async processFile(file) {
      // Read data file as text
      const fileContent = await this.fileToText(file);

      // Try to parse as JSON or CSV
      let parsedData;
      try {
        parsedData = JSON.parse(fileContent);
      } catch (e) {
        // If not JSON, try to parse as CSV
        parsedData = this.parseCSV(fileContent);
      }

      // Update the chartData parameter
      this.updateContent({
        chartData: parsedData,
      });

      this.$emit('content-loaded', { nodeId: this.nodeId });
    },

    parseChartData(data) {
      if (!data) return null;

      // If it's already an object with labels and datasets, return it
      if (typeof data === 'object' && data.labels && data.datasets) {
        return data;
      }

      // If it's a string, try to parse it
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          return this.parseChartData(parsed);
        } catch (e) {
          return null;
        }
      }

      // If it's an array, convert to chart format
      if (Array.isArray(data)) {
        return {
          labels: data.map((item, index) => item.label || `Item ${index + 1}`),
          datasets: [
            {
              label: 'Data',
              data: data.map((item) => item.value || item),
              backgroundColor: this.generateColors(data.length),
            },
          ],
        };
      }

      return null;
    },

    parseCSV(csvText) {
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) return null;

      const headers = lines[0].split(',').map((h) => h.trim());
      const data = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        data.push({
          label: values[0],
          value: parseFloat(values[1]) || 0,
        });
      }

      return data;
    },

    generateColors(count) {
      // System color palette from frontend/src/styles/base/_variables.css
      const style = getComputedStyle(document.body);
      const colors = [
        style.getPropertyValue('--color-red').trim() || '#ff4444',
        style.getPropertyValue('--color-blue').trim() || '#12e0ff',
        style.getPropertyValue('--color-yellow').trim() || '#ffd700',
        style.getPropertyValue('--color-green').trim() || '#19ef83',
        style.getPropertyValue('--color-indigo').trim() || '#7d3de5',
        style.getPropertyValue('--color-orange').trim() || '#ff9500',
        style.getPropertyValue('--color-violet').trim() || '#d13de5',
        style.getPropertyValue('--color-primary').trim() || '#e53d8f',
      ];
      return Array.from({ length: count }, (_, i) => colors[i % colors.length]);
    },

    renderChart() {
      if (!this.parsedChartData || !this.$refs.chartCanvas) return;

      // Simple canvas-based chart rendering (basic implementation)
      // In production, you'd use a library like Chart.js
      const canvas = this.$refs.chartCanvas;
      const ctx = canvas.getContext('2d');

      // Set canvas size
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Render based on chart type
      this.renderSimpleChart(ctx, canvas.width, canvas.height);
    },

    renderSimpleChart(ctx, width, height) {
      const data = this.parsedChartData;
      if (!data || !data.datasets || !data.datasets[0]) return;

      const values = data.datasets[0].data;
      const labels = data.labels;
      const colors = data.datasets[0].backgroundColor;

      if (this.selectedChartType === 'bar') {
        this.renderBarChart(ctx, width, height, values, labels, colors);
      } else if (this.selectedChartType === 'line') {
        this.renderLineChart(ctx, width, height, values, labels);
      } else if (this.selectedChartType === 'pie' || this.selectedChartType === 'doughnut') {
        this.renderPieChart(ctx, width, height, values, labels, colors, this.selectedChartType === 'doughnut');
      }
    },

    renderBarChart(ctx, width, height, values, labels, colors) {
      const padding = 40;
      const barWidth = (width - padding * 2) / values.length;
      const maxValue = Math.max(...values);

      // Get the actual computed color by checking the component's element
      const textColor = this.$el ? getComputedStyle(this.$el).color : '#333';

      values.forEach((value, index) => {
        const barHeight = (value / maxValue) * (height - padding * 2) || 0;
        const x = padding + index * barWidth;
        const y = height - padding - barHeight;

        ctx.fillStyle = colors[index] || '#12e0ff';
        ctx.fillRect(x, y, barWidth * 0.8, barHeight);

        // Label
        ctx.fillStyle = textColor;
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(labels[index] || '', x + barWidth * 0.4, height - padding + 15);
      });
    },

    renderLineChart(ctx, width, height, values, labels) {
      const padding = 40;
      const maxValue = Math.max(...values);
      const stepX = (width - padding * 2) / (values.length - 1);

      // Get the actual computed color by checking the component's element
      const textColor = this.$el ? getComputedStyle(this.$el).color : '#333';

      ctx.strokeStyle = '#12e0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();

      values.forEach((value, index) => {
        const x = padding + index * stepX;
        const y = height - padding - (value / maxValue) * (height - padding * 2);

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        // Draw point
        ctx.fillStyle = '#12e0ff';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Label
        if (labels && labels[index]) {
          ctx.fillStyle = textColor;
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(labels[index], x, height - padding + 15);
        }
      });

      ctx.stroke();
    },

    renderPieChart(ctx, width, height, values, labels, colors, isDoughnut) {
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 2 - 40;
      const total = values.reduce((sum, val) => sum + val, 0);

      // Get the actual computed background color from the component's element
      const backgroundColor = this.$el ? getComputedStyle(this.$el).backgroundColor : '#fff';

      let currentAngle = -Math.PI / 2;

      values.forEach((value, index) => {
        const sliceAngle = (value / total) * Math.PI * 2;

        ctx.fillStyle = colors[index] || '#12e0ff';
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.closePath();
        ctx.fill();

        currentAngle += sliceAngle;
      });

      // Doughnut hole
      if (isDoughnut) {
        ctx.fillStyle = backgroundColor;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    updateChart() {
      this.updateContent({
        chartType: this.selectedChartType,
      });
      this.renderChart();
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
};
</script>

<style scoped>
/* Chart Preview Container */
.chart-preview-container {
  width: 100%;
  height: 100%;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
  /* margin: 0 16px; */
  position: relative;
}

.node.no-select.chart-preview {
  padding: 8px;
}

/* When no chart data is loaded, use fixed height */
.chart-preview-container:not(.has-content) {
  height: 300px;
}

.chart-display {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.chart-display canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

.chart-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6c757d;
  gap: 8px;
  font-size: 14px;
  text-align: center;
}

.chart-placeholder svg {
  opacity: 0.5;
}

/* Chart Controls */
.chart-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
}

.chart-type-select {
  padding: 6px 12px;
  background: white;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: none;
}

.chart-type-select:hover {
  border-color: var(--color-blue);
}

/* Chart-specific drag & drop styles */
.chart-preview-container.drag-hover {
  border: 2px dashed var(--color-blue) !important;
  background: rgba(59, 130, 246, 0.05);
  transform: scale(1.02);
  transition: all 0.2s ease;
}

.chart-preview-container.processing {
  border: 2px solid var(--color-blue);
  background: rgba(59, 130, 246, 0.05);
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(59, 130, 246, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 4px;
  backdrop-filter: blur(2px);
}

.drag-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-blue);
  font-weight: 600;
  gap: 12px;
  font-size: 16px;
  text-align: center;
}

.drag-message svg {
  opacity: 0.8;
}

.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(59, 130, 246, 0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 4px;
  backdrop-filter: blur(2px);
  color: var(--color-blue);
  font-weight: 600;
  gap: 12px;
  font-size: 14px;
}

.processing-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(59, 130, 246, 0.2);
  border-radius: 50%;
  border-top-color: var(--color-blue);
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Enhanced placeholder text for drag state */
.chart-placeholder span {
  transition: color 0.2s ease;
}

.chart-preview-container.drag-hover .chart-placeholder span {
  color: var(--color-blue);
  font-weight: 600;
}

/* Prevent dragging interference with existing chart */
.chart-preview-container.drag-hover .chart-display {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}
</style>
