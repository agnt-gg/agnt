<template>
  <div
    class="html-preview-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile, 'has-content': hasHtmlContent }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- HTML iframe preview -->
    <iframe
      v-if="htmlPreviewContent"
      :srcdoc="htmlPreviewContent"
      class="html-preview"
      :sandbox="sandboxAttributes"
      @mousedown="$emit('prevent-drag', $event)"
      @dragstart.prevent
      frameborder="0"
      draggable="false"
    >
    </iframe>

    <!-- Placeholder when no HTML -->
    <div v-else class="html-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" fill="#6c757d" />
      </svg>
      <span v-if="!isDragHover && !isProcessingFile">Drop HTML files here <br />or paste HTML content</span>
      <span v-else-if="isDragHover">Drop HTML file here</span>
      <span v-else-if="isProcessingFile">Processing file...</span>
    </div>

    <!-- Drag overlay -->
    <div v-if="isDragHover" class="drag-overlay">
      <div class="drag-message">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor" />
        </svg>
        <span>Drop HTML file here</span>
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
  name: 'HtmlPreview',
  mixins: [WidgetBase],
  props: {
    htmlSource: {
      type: String,
      default: null,
    },
    sandboxMode: {
      type: String,
      default: 'Strict',
    },
  },
  data() {
    return {};
  },
  computed: {
    htmlPreviewContent() {
      // Check if we have output with htmlContent
      if (this.output && this.output.htmlContent) {
        return this.output.htmlContent;
      }
      // Check nested result structure
      else if (this.output && this.output.result && this.output.result.htmlContent) {
        return this.output.result.htmlContent;
      }
      // Check parameters for initial value (only if it's not a template variable)
      else if (this.htmlSource) {
        const paramValue = this.htmlSource;
        if (typeof paramValue === 'string' && !paramValue.includes('{{') && !paramValue.includes('}}')) {
          return paramValue;
        }
      }
      return null;
    },
    sandboxAttributes() {
      if (this.sandboxMode === 'Strict') {
        // Most restrictive - blocks scripts and forms
        return 'allow-same-origin';
      } else if (this.sandboxMode === 'Allow Scripts') {
        // Allow scripts but still sandbox
        return 'allow-scripts allow-same-origin';
      } else {
        // Full Access - minimal restrictions
        return 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';
      }
    },
    hasHtmlContent() {
      return !!this.htmlPreviewContent;
    },
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      const validHtmlTypes = ['text/html', 'text/plain'];
      const isHtmlByExtension = file.name && file.name.toLowerCase().endsWith('.html');
      return validHtmlTypes.includes(file.type) || isHtmlByExtension;
    },

    // Override base process file method
    async processFile(file) {
      // Read HTML file as text
      const htmlContent = await this.fileToText(file);

      // Update the htmlSource parameter directly with the HTML content
      this.updateContent({
        htmlSource: htmlContent,
      });

      this.$emit('content-loaded', { nodeId: this.nodeId });
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
};
</script>

<style scoped>
/* HTML Preview Container */
.html-preview-container {
  width: 100%;
  height: 100%;
  min-height: 128px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  /* margin: 0 16px; */
  position: relative;
}

/* When no HTML is loaded, use fixed height */
/* .html-preview-container:not(.has-content) {
  height: 200px;
} */

.html-preview {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 8px;
}

.html-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6c757d;
  gap: 8px;
  font-size: 14px;
  text-align: center;
}

.html-placeholder svg {
  opacity: 0.5;
}

/* HTML-specific drag & drop styles */
.html-preview-container.drag-hover {
  border: 2px dashed var(--color-blue) !important;
  background: rgba(59, 130, 246, 0.05);
  transform: scale(1.02);
  transition: all 0.2s ease;
}

.html-preview-container.processing {
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
.html-placeholder span {
  transition: color 0.2s ease;
}

.html-preview-container.drag-hover .html-placeholder span {
  color: var(--color-blue);
  font-weight: 600;
}

/* Prevent dragging interference with existing HTML */
.html-preview-container.drag-hover .html-preview {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}
</style>
