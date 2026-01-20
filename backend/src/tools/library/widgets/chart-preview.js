import BaseAction from '../BaseAction.js';

class ChartPreview extends BaseAction {
  static schema = {
    title: 'Chart Preview',
    category: 'utility',
    type: 'chart-preview',
    icon: 'flow-3',
    description: 'Data visualization with multiple chart types (bar, line, pie, doughnut, radar). Supports JSON and CSV data formats.',
    parameters: {
      chartData: {
        type: 'string',
        inputType: 'textarea',
        description:
          'Chart data in JSON or CSV format. JSON format: {"labels": [...], "datasets": [{"label": "...", "data": [...]}]}. Supports drag & drop of .json and .csv files.',
      },
      chartType: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['bar', 'line', 'pie', 'doughnut', 'radar'],
        default: 'bar',
        description: 'Type of chart to display',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the chart data was successfully processed',
      },
      chartData: {
        type: 'object',
        description: 'The parsed and formatted chart data',
      },
      chartType: {
        type: 'string',
        description: 'The chart type',
      },
      metadata: {
        type: 'object',
        description: 'Chart metadata including data point count, dataset count, value range, total, and average',
      },
      error: {
        type: 'string',
        description: 'Error message if chart processing failed',
      },
    },
  };

  constructor() {
    super('chart-preview');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('📊 ChartPreview execute called with params:', JSON.stringify(params).substring(0, 200) + '...');
    try {
      // Validate input
      if (!params.chartData) {
        console.error('❌ ChartPreview: No chart data provided');
        return {
          success: false,
          error: 'No chart data provided',
          chartData: null,
          chartType: null,
          metadata: null,
        };
      }

      const chartType = params.chartType || 'bar';

      console.log('🔍 ChartPreview: Processing chart data:', {
        type: typeof params.chartData,
        chartType,
      });

      // Parse and validate chart data
      const parsedData = this.parseChartData(params.chartData);

      if (!parsedData) {
        return {
          success: false,
          error: 'Invalid chart data format',
          chartData: null,
          chartType: chartType,
          metadata: null,
        };
      }

      // Initialize result object
      const result = {
        success: true,
        chartData: parsedData,
        chartType: chartType,
        metadata: {
          dataPointCount: 0,
          datasetCount: 0,
          hasLabels: false,
          valueRange: { min: 0, max: 0 },
          totalValue: 0,
          averageValue: 0,
        },
        error: null,
      };

      // Extract metadata
      result.metadata = this.extractChartMetadata(parsedData);

      return result;
    } catch (error) {
      console.error('❌ ChartPreview error:', error);
      return {
        success: false,
        error: error.message,
        chartData: null,
        chartType: null,
        metadata: null,
      };
    }
  }

  parseChartData(data) {
    try {
      // If it's already an object with labels and datasets, return it
      if (typeof data === 'object' && data.labels && data.datasets) {
        return data;
      }

      // If it's a string, try to parse it as JSON
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          return this.parseChartData(parsed);
        } catch (e) {
          // If not JSON, try to parse as CSV
          return this.parseCSV(data);
        }
      }

      // If it's an array, convert to chart format
      if (Array.isArray(data)) {
        return {
          labels: data.map((item, index) => item.label || `Item ${index + 1}`),
          datasets: [
            {
              label: 'Data',
              data: data.map((item) => (typeof item === 'object' ? item.value : item)),
              backgroundColor: this.generateColors(data.length),
            },
          ],
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing chart data:', error);
      return null;
    }
  }

  parseCSV(csvText) {
    try {
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

      return {
        labels: data.map((item) => item.label),
        datasets: [
          {
            label: headers[1] || 'Value',
            data: data.map((item) => item.value),
            backgroundColor: this.generateColors(data.length),
          },
        ],
      };
    } catch (error) {
      console.error('Error parsing CSV:', error);
      return null;
    }
  }

  generateColors(count) {
    // System color palette from frontend/src/styles/base/_variables.css
    const colors = [
      '#fe4e4e', // --color-red
      '#12e0ff', // --color-blue
      '#ffd700', // --color-yellow
      '#19ef83', // --color-green
      '#7d3de5', // --color-indigo
      '#ff9500', // --color-orange
      '#d13de5', // --color-violet
      '#e53d8f', // --color-pink
    ];
    return Array.from({ length: count }, (_, i) => colors[i % colors.length]);
  }

  extractChartMetadata(chartData) {
    const metadata = {
      dataPointCount: 0,
      datasetCount: 0,
      hasLabels: false,
      valueRange: { min: 0, max: 0 },
      totalValue: 0,
      averageValue: 0,
    };

    try {
      if (!chartData || !chartData.datasets) return metadata;

      // Count datasets
      metadata.datasetCount = chartData.datasets.length;

      // Check for labels
      metadata.hasLabels = chartData.labels && chartData.labels.length > 0;

      // Analyze first dataset
      if (chartData.datasets[0] && chartData.datasets[0].data) {
        const values = chartData.datasets[0].data;
        metadata.dataPointCount = values.length;

        // Calculate statistics
        const numericValues = values.filter((v) => typeof v === 'number');
        if (numericValues.length > 0) {
          metadata.valueRange.min = Math.min(...numericValues);
          metadata.valueRange.max = Math.max(...numericValues);
          metadata.totalValue = numericValues.reduce((sum, val) => sum + val, 0);
          metadata.averageValue = metadata.totalValue / numericValues.length;
        }
      }

      console.log('📊 Chart Metadata extracted:', metadata);
    } catch (error) {
      console.warn('⚠️ Error extracting chart metadata:', error);
    }

    return metadata;
  }
}

export default new ChartPreview();
