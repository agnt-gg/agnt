<template>
  <div
    class="code-preview-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile, 'has-content': hasCodeContent }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Code preview with syntax highlighting -->
    <pre v-if="codePreviewContent" class="code-preview" :class="`language-${detectedLanguage}`"><code v-text="codePreviewContent"></code></pre>

    <!-- Placeholder when no code -->
    <div v-else class="code-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" fill="#6c757d" />
      </svg>
      <span v-if="!isDragHover && !isProcessingFile">Drop code files here <br />or paste code content</span>
      <span v-else-if="isDragHover">Drop code file here</span>
      <span v-else-if="isProcessingFile">Processing file...</span>
    </div>

    <!-- Drag overlay -->
    <div v-if="isDragHover" class="drag-overlay">
      <div class="drag-message">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor" />
        </svg>
        <span>Drop code file here</span>
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
  name: 'CodePreview',
  mixins: [WidgetBase],
  props: {
    codeSource: {
      type: String,
      default: null,
    },
    language: {
      type: String,
      default: 'javascript',
    },
  },
  data() {
    return {
      selectedLanguage: this.language || 'javascript',
    };
  },
  computed: {
    codePreviewContent() {
      // Priority 1: Check output from backend execution
      if (this.output && this.output.codeContent) {
        return this.output.codeContent;
      }
      // Priority 2: Check nested result structure
      else if (this.output && this.output.result && this.output.result.codeContent) {
        return this.output.result.codeContent;
      }
      // Priority 3: Check parameters for initial value - show ANY code
      else if (this.codeSource && typeof this.codeSource === 'string') {
        return this.codeSource;
      }
      return null;
    },
    detectedLanguage() {
      // Priority 1: Check if language is specified in output from backend
      if (this.output && this.output.language) {
        return this.output.language;
      }
      // Priority 2: Check nested result structure
      else if (this.output && this.output.result && this.output.result.language) {
        return this.output.result.language;
      }
      // Priority 3: Use selected language or prop
      return this.selectedLanguage;
    },
    hasCodeContent() {
      return !!this.codePreviewContent;
    },
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      const validCodeExtensions = [
        '.js',
        '.ts',
        '.jsx',
        '.tsx',
        '.py',
        '.java',
        '.cs',
        '.cpp',
        '.c',
        '.h',
        '.hpp',
        '.html',
        '.css',
        '.scss',
        '.json',
        '.md',
        '.sql',
        '.sh',
        '.bash',
        '.txt',
      ];

      const fileName = file.name.toLowerCase();
      return validCodeExtensions.some((ext) => fileName.endsWith(ext));
    },

    // Override base process file method
    async processFile(file) {
      // Read code file as text
      const codeContent = await this.fileToText(file);

      // Detect language from file extension
      const detectedLang = this.detectLanguageFromFilename(file.name);

      // Update the codeSource parameter with the code content
      this.updateContent({
        codeSource: codeContent,
        language: detectedLang,
      });

      this.selectedLanguage = detectedLang;
      this.$emit('content-loaded', { nodeId: this.nodeId });
    },

    detectLanguageFromFilename(filename) {
      const ext = filename.toLowerCase().split('.').pop();
      const languageMap = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        java: 'java',
        cs: 'csharp',
        cpp: 'cpp',
        c: 'cpp',
        h: 'cpp',
        hpp: 'cpp',
        html: 'html',
        css: 'css',
        scss: 'css',
        json: 'json',
        md: 'markdown',
        sql: 'sql',
        sh: 'bash',
        bash: 'bash',
        txt: 'plaintext',
      };
      return languageMap[ext] || 'plaintext';
    },

    updateLanguage() {
      this.updateContent({
        language: this.selectedLanguage,
      });
    },

    // Escape HTML entities to prevent rendering
    escapeHtml(text) {
      if (!text) return text;
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
};
</script>

<style scoped>
/* Code Preview Container */
.code-preview-container {
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

/* When no code is loaded, use fixed height */
.code-preview-container:not(.has-content) {
  height: 200px;
}

.code-preview {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 16px;
  overflow: auto;
  /* font-family: 'Consolas', 'Monaco', 'Courier New', monospace; */
  /* font-size: 13px; */
  /* line-height: 1.5; */
  /* color: #d4d4d4; */
  /* background: #1e1e1e; */
  border-radius: 4px;
  white-space: pre;
  text-align: left;
  box-sizing: border-box;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.code-preview code {
  font-family: inherit;
  color: inherit;
  font-size: var(--font-size-xs);
  line-height: 100%;
}

.node.no-select.code-preview {
  padding: 8px;
}

.code-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6c757d;
  gap: 8px;
  font-size: 14px;
  text-align: center;
}

.code-placeholder svg {
  opacity: 0.5;
}

/* Language Selector */
.language-selector {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
}

.language-selector select {
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.7);
  color: #d4d4d4;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.language-selector select:hover {
  background: rgba(0, 0, 0, 0.9);
}

/* Code-specific drag & drop styles */
.code-preview-container.drag-hover {
  border: 2px dashed var(--color-blue) !important;
  background: rgba(59, 130, 246, 0.05);
  transform: scale(1.02);
  transition: all 0.2s ease;
}

.code-preview-container.processing {
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
.code-placeholder span {
  transition: color 0.2s ease;
}

.code-preview-container.drag-hover .code-placeholder span {
  color: var(--color-blue);
  font-weight: 600;
}

/* Prevent dragging interference with existing code */
.code-preview-container.drag-hover .code-preview {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}

/* Syntax highlighting colors (basic) */
.language-javascript .code-preview,
.language-typescript .code-preview {
  color: #d4d4d4;
}

.language-python .code-preview {
  color: #d4d4d4;
}

.language-json .code-preview {
  color: #ce9178;
}
</style>
