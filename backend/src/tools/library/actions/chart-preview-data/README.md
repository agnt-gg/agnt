# Chart Preview Dummy Data

This directory contains sample data files in various formats for testing the ChartPreview component and backend tool.

## File Formats

### 1. Full Chart.js Format (sales-data.json)

Complete chart data structure with labels, datasets, and styling.

```json
{
  "labels": ["January", "February", "March", "April", "May", "June"],
  "datasets": [
    {
      "label": "Monthly Sales",
      "data": [12500, 19800, 15300, 22100, 18900, 25400],
      "backgroundColor": [...]
    }
  ]
}
```

**Use Case**: Ready-to-render chart data with full customization
**Best For**: Bar, Line, Radar charts

---

### 2. CSV Format (product-performance.csv)

Simple comma-separated values with header row.

```csv
Product,Sales
Laptop,45
Smartphone,67
Tablet,32
```

**Use Case**: Import from spreadsheets or databases
**Best For**: Any chart type
**Note**: First column becomes labels, second column becomes values

---

### 3. Array of Objects (website-traffic.json)

Array with label-value pairs.

```json
[
  { "label": "Homepage", "value": 15420 },
  { "label": "Products", "value": 8930 },
  { "label": "Blog", "value": 5670 }
]
```

**Use Case**: Structured data from APIs or databases
**Best For**: Pie, Doughnut, Bar charts

---

### 4. Simple Number Array (simple-numbers.json)

Plain array of numeric values.

```json
[25, 45, 32, 67, 89, 54, 41, 73]
```

**Use Case**: Quick data visualization without labels
**Best For**: Line, Bar charts
**Note**: Auto-generates labels as "Item 1", "Item 2", etc.

---

## Usage Examples

### Frontend Component Usage

```vue
<template>
  <ChartPreview :chartData="chartData" chartType="bar" />
</template>

<script>
export default {
  data() {
    return {
      // Option 1: Full format
      chartData: {
        labels: ['Q1', 'Q2', 'Q3', 'Q4'],
        datasets: [
          {
            label: 'Revenue',
            data: [45000, 52000, 48000, 61000],
          },
        ],
      },

      // Option 2: Array of objects
      chartData: [
        { label: 'Product A', value: 120 },
        { label: 'Product B', value: 85 },
      ],

      // Option 3: Simple array
      chartData: [10, 20, 30, 40, 50],

      // Option 4: JSON string
      chartData: '{"labels":["A","B"],"datasets":[{"data":[10,20]}]}',
    };
  },
};
</script>
```

### Backend Tool Usage

```javascript
// Execute chart-preview tool
const result = await chartPreview.execute({
  chartData: salesData,  // Any format above
  chartType: 'bar'       // bar, line, pie, doughnut, radar
}, inputData, workflowEngine);

// Result structure
{
  success: true,
  chartData: {
    labels: [...],
    datasets: [...]
  },
  chartType: 'bar',
  metadata: {
    dataPointCount: 6,
    datasetCount: 1,
    hasLabels: true,
    valueRange: { min: 12500, max: 25400 },
    totalValue: 114000,
    averageValue: 19000
  },
  error: null
}
```

### Drag & Drop Usage

The ChartPreview component supports drag-and-drop for:

- `.json` files (any format above)
- `.csv` files
- `.txt` files (JSON or CSV content)

Simply drag any of the sample files onto the ChartPreview widget to load the data.

---

## Chart Types

### Bar Chart (`chartType: 'bar'`)

- Best for comparing discrete categories
- Works with all data formats
- Example: Monthly sales, product comparisons

### Line Chart (`chartType: 'line'`)

- Best for showing trends over time
- Works with all data formats
- Example: Stock prices, temperature changes

### Pie Chart (`chartType: 'pie'`)

- Best for showing proportions of a whole
- Works best with 3-7 data points
- Example: Market share, budget allocation

### Doughnut Chart (`chartType: 'doughnut'`)

- Similar to pie chart with center hole
- Better for displaying percentages
- Example: Survey results, resource usage

### Radar Chart (`chartType: 'radar'`)

- Best for multivariate data comparison
- Shows multiple metrics simultaneously
- Example: Skill assessments, product features

---

## Data Validation

The backend tool validates and transforms all input formats to the standard Chart.js structure:

```javascript
{
  labels: string[],           // X-axis labels
  datasets: [{
    label: string,            // Dataset name
    data: number[],           // Y-axis values
    backgroundColor: string[] // Colors for each data point
  }]
}
```

### Automatic Transformations

1. **CSV → Chart Data**: Parses CSV and extracts labels/values
2. **Array → Chart Data**: Converts simple arrays to full structure
3. **String → Chart Data**: Parses JSON strings
4. **Color Generation**: Auto-generates colors if not provided

---

## Error Handling

The tool handles various error cases:

- **Invalid JSON**: Returns error with message
- **Empty data**: Returns success: false
- **Malformed CSV**: Attempts to parse or returns error
- **Missing values**: Uses 0 as default

---

## Testing Checklist

- [x] Full Chart.js format (sales-data.json)
- [x] CSV format (product-performance.csv)
- [x] Array of objects (website-traffic.json)
- [x] Simple number array (simple-numbers.json)
- [ ] Test drag-and-drop with each format
- [ ] Test all chart types with each format
- [ ] Test error cases (invalid data)
- [ ] Test metadata extraction

---

## Additional Examples

### Multi-Dataset Example

```json
{
  "labels": ["Jan", "Feb", "Mar"],
  "datasets": [
    {
      "label": "2023",
      "data": [100, 120, 115],
      "backgroundColor": "rgba(255, 99, 132, 0.7)"
    },
    {
      "label": "2024",
      "data": [110, 135, 125],
      "backgroundColor": "rgba(54, 162, 235, 0.7)"
    }
  ]
}
```

### Percentage Data Example

```json
[
  { "label": "Completed", "value": 75 },
  { "label": "In Progress", "value": 15 },
  { "label": "Pending", "value": 10 }
]
```

### Time Series Example

```json
{
  "labels": ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"],
  "datasets": [
    {
      "label": "Server Load",
      "data": [45, 32, 78, 92, 85, 56]
    }
  ]
}
```
