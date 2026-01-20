# Widget System Documentation

## Overview

The Widget System provides a modular, extensible architecture for creating preview components in the WorkflowForge canvas. All widgets extend from a common `WidgetBase` mixin that provides shared functionality for drag & drop, file processing, and memory management.

## Architecture

```
WidgetBase.js (Base Mixin)
├── MediaPreview.vue      - Images & Videos
├── HtmlPreview.vue       - HTML iframes with sandbox
├── CodePreview.vue       - Syntax-highlighted code
├── PdfPreview.vue        - PDF documents
├── AudioPreview.vue      - Audio player with waveform
├── MarkdownPreview.vue   - Rendered markdown
└── ChartPreview.vue      - Data visualizations
```

## WidgetBase Mixin

### Provided Props

- `nodeId` (String, required) - Unique identifier for the node
- `isTinyMode` (Boolean) - Whether widget is in tiny/collapsed mode
- `allowDragDrop` (Boolean) - Enable/disable drag & drop functionality
- `output` (Object) - Node execution output data

### Provided Data

- `isDragHover` - Drag overlay state
- `isProcessingFile` - File processing indicator
- `dragCounter` - Track multiple drag events
- `localObjectUrl` - Blob URL for memory management
- `cleanupTimer` - Automatic cleanup timer

### Provided Methods

#### Drag & Drop

- `handleDragEnter(e)` - Handle drag enter events
- `handleDragOver(e)` - Handle drag over events
- `handleDragLeave(e)` - Handle drag leave events
- `handleDrop(e)` - Handle file drop events

#### File Processing

- `validateFile(file)` - Validate file type (override in child)
- `processFile(file)` - Process dropped file (override in child)
- `validateFileSize(file, maxSize)` - Validate file size
- `fileToBase64(file)` - Convert file to base64
- `fileToText(file)` - Convert file to text

#### Memory Management

- `scheduleCleanup()` - Schedule automatic cleanup
- `performCleanup()` - Clean up blob URLs
- `cleanupIndexedDB()` - Clean up old IndexedDB entries
- `cleanupOldContentForNode()` - Clean up node-specific entries

#### IndexedDB

- `openMediaDB()` - Open IndexedDB connection
- `getMediaFromIndexedDB(mediaId)` - Retrieve media from IndexedDB
- `loadContentFromIndexedDB(idbReference)` - Load content from IndexedDB

#### Notifications

- `showError(message)` - Show error notification
- `showSuccess(message)` - Show success notification
- `showInfo(message)` - Show info notification

#### Content Updates

- `updateContent(updates)` - Emit content update event

### Provided Emits

- `show-notification` - Notification events
- `update:content` - Content update events
- `content-loaded` - Content loaded successfully
- `content-error` - Content loading error

### Lifecycle

- `beforeUnmount()` - Automatic cleanup of timers and blob URLs

## Available Widgets

### 1. MediaPreview.vue

**Purpose:** Display images and videos (direct files or embedded)

**Props:**

- `mediaSource` (String) - URL or base64 data
- `mediaType` (String) - 'image' | 'video'

**Features:**

- Image display with object-fit
- Video playback with controls
- Embedded video support (YouTube, Vimeo)
- Auto-detects media type
- 10MB file size limit

**Supported Formats:**

- Images: JPEG, PNG, GIF, WebP, SVG, BMP
- Videos: MP4, WebM, OGG, MOV, AVI

**Usage:**

```vue
<MediaPreview
  :node-id="node.id"
  :media-source="node.parameters.mediaSource"
  :media-type="node.parameters.mediaType"
  :output="output"
  @update:content="handleUpdate"
/>
```

---

### 2. HtmlPreview.vue

**Purpose:** Render HTML content in sandboxed iframe

**Props:**

- `htmlSource` (String) - HTML content
- `sandboxMode` (String) - 'Strict' | 'Allow Scripts' | 'Full Access'
- `customWidth` (Number) - Custom width in pixels
- `customHeight` (Number) - Custom height in pixels
- `allowResize` (Boolean) - Enable resize handles

**Features:**

- Sandboxed iframe rendering
- Three security levels
- Resizable with corner handles
- Drag & drop HTML files

**Sandbox Modes:**

- **Strict:** Blocks scripts and forms
- **Allow Scripts:** Allows JavaScript execution
- **Full Access:** Minimal restrictions

**Usage:**

```vue
<HtmlPreview
  :node-id="node.id"
  :html-source="node.parameters.htmlSource"
  :sandbox-mode="node.parameters.sandboxMode"
  :custom-width="node.parameters.customWidth"
  :custom-height="node.parameters.customHeight"
  @update:content="handleUpdate"
/>
```

---

### 3. CodePreview.vue

**Purpose:** Display syntax-highlighted code

**Props:**

- `codeSource` (String) - Code content
- `language` (String) - Programming language

**Features:**

- Syntax highlighting (basic)
- Language selector dropdown
- Auto-detects language from file extension
- Monospace font display

**Supported Languages:**
JavaScript, TypeScript, Python, Java, C#, C++, HTML, CSS, JSON, Markdown, SQL, Bash

**Usage:**

```vue
<CodePreview :node-id="node.id" :code-source="node.parameters.codeSource" :language="node.parameters.language" @update:content="handleUpdate" />
```

---

### 4. PdfPreview.vue

**Purpose:** Display PDF documents

**Props:**

- `pdfSource` (String) - PDF URL or blob URL

**Features:**

- PDF iframe rendering
- Download button
- 20MB file size limit

**Usage:**

```vue
<PdfPreview :node-id="node.id" :pdf-source="node.parameters.pdfSource" @update:content="handleUpdate" />
```

---

### 5. AudioPreview.vue

**Purpose:** Audio playback with visualization

**Props:**

- `audioSource` (String) - Audio URL or blob URL

**Features:**

- Native audio player with controls
- Duration display
- Waveform visualization placeholder
- 10MB file size limit

**Supported Formats:**
MP3, WAV, OGG, WebM, AAC, M4A

**Usage:**

```vue
<AudioPreview :node-id="node.id" :audio-source="node.parameters.audioSource" @update:content="handleUpdate" />
```

---

### 6. MarkdownPreview.vue

**Purpose:** Render markdown content

**Props:**

- `markdownSource` (String) - Markdown content

**Features:**

- Markdown to HTML rendering
- Preview/Source toggle
- Basic markdown syntax support

**Supported Syntax:**
Headers, Bold, Italic, Links, Code blocks, Inline code, Lists

**Usage:**

```vue
<MarkdownPreview :node-id="node.id" :markdown-source="node.parameters.markdownSource" @update:content="handleUpdate" />
```

---

### 7. ChartPreview.vue

**Purpose:** Data visualization

**Props:**

- `chartData` (String | Object | Array) - Chart data
- `chartType` (String) - Chart type

**Features:**

- Multiple chart types (bar, line, pie, doughnut, radar)
- JSON/CSV data support
- Canvas-based rendering
- Chart type selector

**Data Format:**

```json
{
  "labels": ["Jan", "Feb", "Mar"],
  "datasets": [
    {
      "label": "Sales",
      "data": [10, 20, 30],
      "backgroundColor": ["#ff6384", "#36a2eb", "#ffce56"]
    }
  ]
}
```

**Usage:**

```vue
<ChartPreview :node-id="node.id" :chart-data="node.parameters.chartData" :chart-type="node.parameters.chartType" @update:content="handleUpdate" />
```

## Creating a New Widget

### Step 1: Create Widget Component

```vue
<template>
  <div
    class="my-widget-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Your widget content here -->

    <!-- Drag overlay (copy from other widgets) -->
    <!-- Processing overlay (copy from other widgets) -->
  </div>
</template>

<script>
import WidgetBase from './WidgetBase.js';

export default {
  name: 'MyWidget',
  mixins: [WidgetBase],
  props: {
    mySource: {
      type: String,
      default: null,
    },
  },
  computed: {
    myContent() {
      // Check output first
      if (this.output && this.output.myContent) {
        return this.output.myContent;
      }
      // Then check parameters
      else if (this.mySource) {
        return this.mySource;
      }
      return null;
    },
    hasContent() {
      return !!this.myContent;
    },
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      // Implement your file type validation
      return file.type === 'your/mime-type';
    },

    // Override base process file method
    async processFile(file) {
      // Process the file
      const content = await this.fileToText(file);

      // Update content
      this.updateContent({
        mySource: content,
      });

      this.$emit('content-loaded', { nodeId: this.nodeId });
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
};
</script>

<style scoped>
/* Your widget styles */
</style>
```

### Step 2: Import in Node.vue

```javascript
import MyWidget from '../Widgets/MyWidget.vue';

export default {
  components: {
    SvgIcon,
    MediaPreview,
    HtmlPreview,
    MyWidget, // Add your widget
  },
  // ...
};
```

### Step 3: Add to Template

```vue
<MyWidget
  v-else-if="node.type === 'my-widget'"
  :node-id="node.id"
  :is-tiny-mode="isTinyNodeMode"
  :output="output"
  :my-source="node.parameters?.mySource"
  @prevent-drag="startDragging"
  @update:content="handleWidgetUpdate"
  @show-notification="$emit('show-notification', $event)"
/>
```

### Step 4: Add Computed Properties

```javascript
computed: {
  isMyWidget() {
    return this.node.type === 'my-widget';
  },
  hasMyContent() {
    return this.isMyWidget && this.node.parameters?.mySource;
  },
}
```

## Best Practices

### 1. File Validation

Always validate file types and sizes:

```javascript
validateFile(file) {
  const validTypes = ['type1', 'type2'];
  return validTypes.includes(file.type);
}
```

### 2. Memory Management

Use blob URLs for large files and clean up properly:

```javascript
async processFile(file) {
  if (this.localObjectUrl) {
    URL.revokeObjectURL(this.localObjectUrl);
  }
  this.localObjectUrl = URL.createObjectURL(file);
  this.scheduleCleanup();
}
```

### 3. Error Handling

Always handle errors gracefully:

```javascript
try {
  await this.processFile(file);
} catch (error) {
  this.showError('Failed to process file');
}
```

### 4. Template Variables

Check for template variables before using values:

```javascript
if (typeof value === 'string' && !value.includes('{{') && !value.includes('}}')) {
  return value;
}
```

### 5. Event Propagation

Prevent drag events from interfering with node dragging:

```vue
@mousedown="$emit('prevent-drag', $event)" @dragstart.prevent
```

## Common Patterns

### Drag & Drop Overlay

```vue
<div v-if="isDragHover" class="drag-overlay">
  <div class="drag-message">
    <svg><!-- Icon --></svg>
    <span>Drop file here</span>
  </div>
</div>
```

### Processing Overlay

```vue
<div v-if="isProcessingFile" class="processing-overlay">
  <div class="processing-spinner"></div>
  <span>Processing file...</span>
</div>
```

### Placeholder State

```vue
<div v-else class="widget-placeholder">
  <svg><!-- Icon --></svg>
  <span v-if="!isDragHover && !isProcessingFile">
    Drop files here
  </span>
</div>
```

## Styling Guidelines

### Container

```css
.widget-container {
  width: 100%;
  height: 100%;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  margin: 0 16px;
  position: relative;
}
```

### Drag States

```css
.widget-container.drag-hover {
  border: 2px dashed var(--color-blue);
  background: rgba(59, 130, 246, 0.05);
  transform: scale(1.02);
}
```

### Processing States

```css
.widget-container.processing {
  border: 2px solid var(--color-blue);
  background: rgba(59, 130, 246, 0.05);
}
```

## Integration with Node.vue

Widgets are integrated into Node.vue using dynamic component rendering:

```vue
<template>
  <div class="node">
    <!-- Regular content -->
    <div v-if="!hasWidget">{{ node.text }}</div>

    <!-- Widget rendering -->
    <MediaPreview v-else-if="isMediaPreview" ... />
    <HtmlPreview v-else-if="isHtmlPreview" ... />
    <CodePreview v-else-if="isCodePreview" ... />
    <!-- etc. -->
  </div>
</template>
```

## Event Flow

1. **User drops file** → Widget's `handleDrop()`
2. **File validated** → Widget's `validateFile()`
3. **File processed** → Widget's `processFile()`
4. **Content updated** → Widget's `updateContent()`
5. **Event emitted** → `update:content` event
6. **Node updated** → Node's `handleWidgetUpdate()`
7. **Parent notified** → Canvas updates node parameters

## Performance Considerations

### Memory Management

- Blob URLs are automatically cleaned up after 5 minutes
- IndexedDB entries older than 1 hour are purged
- Component cleanup on unmount

### File Size Limits

- Media files: 10MB
- PDF files: 20MB
- Code/Text files: No specific limit (reasonable sizes)

### Optimization Tips

- Use blob URLs instead of base64 for large files
- Implement lazy loading for heavy content
- Clean up resources in `beforeUnmount()`

## Future Enhancements

### Potential New Widgets

- **3DPreview.vue** - 3D model viewer (GLB, OBJ)
- **SpreadsheetPreview.vue** - Excel/CSV viewer
- **JsonPreview.vue** - JSON tree viewer
- **XmlPreview.vue** - XML tree viewer
- **DiagramPreview.vue** - Mermaid/PlantUML diagrams
- **MapPreview.vue** - Geographic maps
- **CalendarPreview.vue** - Calendar/timeline view

### Potential Features

- Real-time collaboration
- Version history
- Export functionality
- Advanced editing capabilities
- Plugin system for custom widgets

## Troubleshooting

### Widget Not Displaying

1. Check if widget is imported in Node.vue
2. Verify node type matches widget condition
3. Check console for errors
4. Ensure parameters are properly passed

### Drag & Drop Not Working

1. Verify `allowDragDrop` prop is true
2. Check file type validation
3. Ensure event propagation is stopped
4. Check file size limits

### Memory Leaks

1. Ensure blob URLs are revoked
2. Check cleanup timers are cleared
3. Verify IndexedDB cleanup is working
4. Monitor browser memory usage

## Examples

### Example 1: Using MediaPreview

```javascript
// In workflow node definition
{
  type: 'media-preview',
  parameters: {
    mediaSource: 'https://example.com/image.jpg',
    mediaType: 'image'
  }
}
```

### Example 2: Using ChartPreview

```javascript
// In workflow node definition
{
  type: 'chart-preview',
  parameters: {
    chartData: {
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      datasets: [{
        label: 'Revenue',
        data: [100, 150, 200, 180]
      }]
    },
    chartType: 'bar'
  }
}
```

### Example 3: Using CodePreview

```javascript
// In workflow node definition
{
  type: 'code-preview',
  parameters: {
    codeSource: 'function hello() {\n  console.log("Hello!");\n}',
    language: 'javascript'
  }
}
```

## Contributing

When creating new widgets:

1. **Extend WidgetBase** - Always use the mixin
2. **Follow naming conventions** - Use `WidgetName.vue` format
3. **Implement required methods** - Override `validateFile()` and `processFile()`
4. **Add proper documentation** - Update this README
5. **Test thoroughly** - Test drag & drop, display, and cleanup
6. **Handle edge cases** - Template variables, missing data, errors

## License

Part of the TaskTitan WorkflowForge system.
