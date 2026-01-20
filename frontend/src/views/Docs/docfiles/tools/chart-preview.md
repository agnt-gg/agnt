# Chart Preview

## Overview

The **Chart Preview** node provides data visualization with multiple chart types including bar, line, pie, doughnut, and radar charts. It supports both JSON and CSV data formats, making it perfect for displaying data insights and analytics in workflows.

## Category

**Widget**

## Parameters

### chartData

- **Type**: String (textarea)
- **Required**: Yes
- **Description**: Chart data in JSON or CSV format
- **JSON Format**:
  ```json
  {
    "labels": ["Label1", "Label2", "Label3"],
    "datasets": [
      {
        "label": "Dataset Name",
        "data": [10, 20, 30]
      }
    ]
  }
  ```
- **CSV Format**: First row as headers, subsequent rows as data
- **Features**: Supports drag & drop of .json and .csv files

### chartType

- **Type**: String (select)
- **Required**: No
- **Default**: bar
- **Options**:
  - **bar**: Vertical bar chart
  - **line**: Line chart with points
  - **pie**: Circular pie chart
  - **doughnut**: Doughnut chart (pie with center hole)
  - **radar**: Radar/spider chart
- **Description**: Type of chart to display

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the chart data was successfully processed

### chartData

- **Type**: Object
- **Description**: The parsed and formatted chart data

### chartType

- **Type**: String
- **Description**: The chart type being displayed

### metadata

- **Type**: Object
- **Description**: Chart metadata including:
  - Data point count
  - Dataset count
  - Value range (min/max)
  - Total sum
  - Average value

### error

- **Type**: String
- **Description**: Error message if chart processing failed

## Use Cases

1. **Analytics Dashboard**: Display business metrics and KPIs
2. **Sales Reports**: Visualize sales data over time
3. **Survey Results**: Show survey response distributions
4. **Performance Metrics**: Display system or application performance
5. **Financial Data**: Visualize financial trends and comparisons
6. **Data Comparison**: Compare multiple datasets visually

## Example Configurations

**Bar Chart (JSON)**

```
chartData: {
  "labels": ["Jan", "Feb", "Mar", "Apr"],
  "datasets": [{
    "label": "Sales",
    "data": [1200, 1900, 1500, 2100]
  }]
}
chartType: bar
```

**Line Chart (CSV)**

```
chartData: Month,Revenue
January,50000
February,65000
March,58000
April,72000
chartType: line
```

**Pie Chart**

```
chartData: {
  "labels": ["Product A", "Product B", "Product C"],
  "datasets": [{
    "label": "Market Share",
    "data": [45, 30, 25]
  }]
}
chartType: pie
```

## Chart Types Explained

### Bar Chart

- Best for comparing values across categories
- Vertical bars show magnitude
- Good for time series or categorical data

### Line Chart

- Best for showing trends over time
- Connects data points with lines
- Ideal for continuous data

### Pie Chart

- Best for showing proportions of a whole
- Each slice represents a percentage
- Limited to single dataset

### Doughnut Chart

- Similar to pie chart with center hole
- More modern appearance
- Better for displaying percentages

### Radar Chart

- Best for comparing multiple variables
- Shows data on multiple axes
- Good for performance comparisons

## Tips

- JSON format provides more control over chart configuration
- CSV format is simpler for basic data
- Metadata includes statistical information about your data
- Drag & drop support for easy data import
- Multiple datasets can be displayed on bar and line charts
- Choose chart type based on your data story

## Common Patterns

**API Data Visualization**

```
1. Fetch data from API with Custom API Request
2. Transform data with Data Transformer
3. Pass to Chart Preview with appropriate type
4. Display insights visually
```

**Database Analytics**

```
1. Query database with Database Operation
2. Format results as JSON
3. Display with Chart Preview
4. Use metadata for additional insights
```

**Real-time Monitoring**

```
1. Collect metrics over time
2. Store in array format
3. Update Chart Preview periodically
4. Monitor trends visually
```

## Data Format Examples

**Single Dataset (JSON)**

```json
{
  "labels": ["A", "B", "C"],
  "datasets": [
    {
      "label": "Values",
      "data": [10, 20, 15]
    }
  ]
}
```

**Multiple Datasets (JSON)**

```json
{
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "datasets": [
    {
      "label": "2023",
      "data": [100, 120, 115, 140]
    },
    {
      "label": "2024",
      "data": [110, 130, 125, 150]
    }
  ]
}
```

**CSV Format**

```
Category,Value
Item 1,25
Item 2,40
Item 3,35
```

## Related Nodes

- **Custom API Request**: For fetching data from APIs
- **Database Operation**: For querying databases
- **Data Transformer**: For formatting data
- **Execute JavaScript**: For complex data transformations
- **Google Sheets API**: For fetching spreadsheet data

## Tags

chart, graph, visualization, data, analytics, widget, bar, line, pie, dashboard
