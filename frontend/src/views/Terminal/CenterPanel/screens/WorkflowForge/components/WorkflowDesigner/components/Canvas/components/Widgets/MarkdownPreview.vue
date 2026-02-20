<template>
  <div
    class="markdown-preview-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile, 'has-content': hasMarkdownContent }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Markdown rendered content -->
    <div v-if="markdownPreviewContent" class="markdown-preview" v-html="renderedMarkdown"></div>

    <!-- Placeholder when no markdown -->
    <div v-else class="markdown-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 3h18v18H3V3zm2 2v14h14V5H5zm2 2h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" fill="#6c757d" />
      </svg>
      <span v-if="!isDragHover && !isProcessingFile">Drop markdown files here <br />or paste markdown content</span>
      <span v-else-if="isDragHover">Drop markdown file here</span>
      <span v-else-if="isProcessingFile">Processing file...</span>
    </div>

    <!-- Drag overlay -->
    <div v-if="isDragHover" class="drag-overlay">
      <div class="drag-message">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor" />
        </svg>
        <span>Drop markdown file here</span>
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
  name: 'MarkdownPreview',
  mixins: [WidgetBase],
  props: {
    markdownSource: {
      type: String,
      default: null,
    },
  },
  data() {
    return {
      viewMode: 'preview',
    };
  },
  computed: {
    markdownPreviewContent() {
      // Priority 1: Check output from backend execution
      if (this.output && this.output.markdownContent) {
        return this.output.markdownContent;
      }
      // Priority 2: Check nested result structure
      else if (this.output && this.output.result && this.output.result.markdownContent) {
        return this.output.result.markdownContent;
      }
      // Priority 3: Check parameters for initial value
      else if (this.markdownSource) {
        const paramValue = this.markdownSource;
        if (typeof paramValue === 'string' && !paramValue.includes('{{') && !paramValue.includes('}}')) {
          return paramValue;
        }
      }
      return null;
    },
    renderedMarkdown() {
      if (!this.markdownPreviewContent) return '';

      // Priority 1: Check if backend already converted to HTML
      if (this.output && this.output.htmlContent) {
        return this.output.htmlContent;
      } else if (this.output && this.output.result && this.output.result.htmlContent) {
        return this.output.result.htmlContent;
      }

      // Priority 2: Convert markdown to HTML on frontend
      return this.simpleMarkdownToHtml(this.markdownPreviewContent);
    },
    hasMarkdownContent() {
      return !!this.markdownPreviewContent;
    },
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      const validExtensions = ['.md', '.markdown', '.txt'];
      const fileName = file.name.toLowerCase();
      return validExtensions.some((ext) => fileName.endsWith(ext));
    },

    // Override base process file method
    async processFile(file) {
      // Read markdown file as text
      const markdownContent = await this.fileToText(file);

      // Update the markdownSource parameter
      this.updateContent({
        markdownSource: markdownContent,
      });

      this.$emit('content-loaded', { nodeId: this.nodeId });
    },

    // Simple markdown to HTML converter (basic implementation)
    simpleMarkdownToHtml(markdown) {
      let html = markdown;

      // Headers
      html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

      // Bold
      html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
      html = html.replace(/__(.*?)__/gim, '<strong>$1</strong>');

      // Italic
      html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
      html = html.replace(/_(.*?)_/gim, '<em>$1</em>');

      // Links
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');

      // Code blocks
      html = html.replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>');

      // Inline code
      html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');

      // Lists
      html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
      html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

      // Line breaks
      html = html.replace(/\n\n/g, '</p><p>');
      html = html.replace(/\n/g, '<br>');

      // Wrap in paragraph
      html = '<p>' + html + '</p>';

      return html;
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
};
</script>

<style scoped>
/* Markdown Preview Container */
.markdown-preview-container {
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

/* When no markdown is loaded, use fixed height */
.markdown-preview-container:not(.has-content) {
  height: 200px;
}

.markdown-preview {
  width: 100%;
  height: 100%;
  /* max-height: 256px; */
  /* padding: 16px; */
  overflow: auto;
  /* font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; */
  font-size: var(--font-size-sm);
  line-height: 1.3;
  /* color: #333; */
  text-align: left;
  box-sizing: border-box;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.markdown-preview >>> h1 {
  /* font-size: 2em; */
  /* margin: 0 0 0.67em; */
  font-weight: 600;
}

.markdown-preview >>> h2 {
  /* font-size: 1.5em; */
  /* margin: 0.75em 0; */
  font-weight: 600;
}

.markdown-preview >>> h3 {
  /* font-size: 1.17em; */
  /* margin: 0.83em 0; */
  font-weight: 600;
}

.markdown-preview >>> code {
  /* background: #f5f5f5; */
  padding: 2px 6px;
  border-radius: 3px;
  font-family: var(--font-family-mono);
  /* font-size: 0.9em; */
}

.markdown-preview >>> pre {
  /* background: #f5f5f5; */
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}

.markdown-preview >>> pre code {
  background: none;
  padding: 0;
}

.markdown-preview >>> a {
  color: var(--color-blue);
  text-decoration: none;
}

.markdown-preview >>> a:hover {
  text-decoration: underline;
}

.markdown-preview >>> ul {
  padding-left: 20px;
}

.markdown-preview >>> li {
  /* margin: 4px 0; */
}

.markdown-preview >>> img {
  max-width: 100%;
  height: auto;
}

.markdown-preview >>> p {
  margin-bottom: 16px;
}

.markdown-source {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 20px;
  overflow: auto;
  /* font-family: 'Consolas', 'Monaco', 'Courier New', monospace; */
  /* font-size: 13px; */
  line-height: 1.5;
  /* color: #333;
  background: #f5f5f5; */
  border-radius: 4px;
  white-space: pre-wrap;
  text-align: left;
}

.markdown-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6c757d;
  gap: 8px;
  font-size: 14px;
  text-align: center;
}

.markdown-placeholder svg {
  opacity: 0.5;
}

/* View Toggle */
.view-toggle {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  padding: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.toggle-button {
  padding: 4px 12px;
  background: transparent;
  color: #666;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.toggle-button:hover {
  background: rgba(0, 0, 0, 0.05);
}

.toggle-button.active {
  background: var(--color-blue);
  color: white;
}

/* Markdown-specific drag & drop styles */
.markdown-preview-container.drag-hover {
  border: 2px dashed var(--color-blue) !important;
  background: rgba(59, 130, 246, 0.05);
  transform: scale(1.02);
  transition: all 0.2s ease;
}

.markdown-preview-container.processing {
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
.markdown-placeholder span {
  transition: color 0.2s ease;
}

.markdown-preview-container.drag-hover .markdown-placeholder span {
  color: var(--color-blue);
  font-weight: 600;
}

/* Prevent dragging interference with existing markdown */
.markdown-preview-container.drag-hover .markdown-preview,
.markdown-preview-container.drag-hover .markdown-source {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}
</style>
