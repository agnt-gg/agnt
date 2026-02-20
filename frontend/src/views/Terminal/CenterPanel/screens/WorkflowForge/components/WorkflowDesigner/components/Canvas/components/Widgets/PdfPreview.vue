<template>
  <div
    class="pdf-preview-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile, 'has-content': hasPdfContent }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- PDF preview using iframe or object -->
    <iframe v-if="pdfPreviewUrl" :src="pdfPreviewUrl" class="pdf-preview" type="application/pdf" frameborder="0"> </iframe>

    <!-- Placeholder when no PDF -->
    <div v-else class="pdf-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM16 18H8V16H16V18ZM16 14H8V12H16V14ZM13 9V3.5L18.5 9H13Z"
          fill="#6c757d"
        />
      </svg>
      <span v-if="!isDragHover && !isProcessingFile">Drop PDF files here <br />(20MB max)</span>
      <span v-else-if="isDragHover">Drop PDF file here</span>
      <span v-else-if="isProcessingFile">Processing file...</span>
    </div>

    <!-- PDF controls -->
    <div v-if="hasPdfContent" class="pdf-controls">
      <Tooltip text="Download PDF" width="auto">
        <button @click="downloadPdf" class="pdf-button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor" />
          </svg>
        </button>
      </Tooltip>
    </div>

    <!-- Drag overlay -->
    <div v-if="isDragHover" class="drag-overlay">
      <div class="drag-message">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor" />
        </svg>
        <span>Drop PDF file here</span>
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
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'PdfPreview',
  components: {
    Tooltip,
  },
  mixins: [WidgetBase],
  props: {
    pdfSource: {
      type: String,
      default: null,
    },
  },
  data() {
    return {};
  },
  computed: {
    pdfPreviewUrl() {
      // Priority 1: Check output from backend execution
      if (this.output && this.output.pdfUrl) {
        return this.output.pdfUrl;
      }
      // Priority 2: Check nested result structure
      else if (this.output && this.output.result && this.output.result.pdfUrl) {
        return this.output.result.pdfUrl;
      }
      // Priority 3: Local blob URL from drag & drop
      else if (this.localObjectUrl) {
        return this.localObjectUrl;
      }
      // Priority 4: Check parameters for initial value
      else if (this.pdfSource) {
        const paramValue = this.pdfSource;
        if (typeof paramValue === 'string' && !paramValue.includes('{{') && !paramValue.includes('}}')) {
          return paramValue;
        }
      }
      return null;
    },
    hasPdfContent() {
      return !!this.pdfPreviewUrl;
    },
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    },

    // Override base file size validation (PDFs can be larger)
    validateFileSize(file) {
      const maxSize = 20 * 1024 * 1024; // 20MB for PDFs
      if (file.size > maxSize) {
        this.showError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum size is 20MB.`);
        return false;
      }
      return true;
    },

    // Override base process file method
    async processFile(file) {
      // Clean up old blob URL
      if (this.localObjectUrl) {
        URL.revokeObjectURL(this.localObjectUrl);
      }

      // Create blob URL for PDF
      this.localObjectUrl = URL.createObjectURL(file);

      // Update the pdfSource parameter
      this.updateContent({
        pdfSource: this.localObjectUrl,
      });

      // Set up automatic cleanup
      this.scheduleCleanup();

      this.$emit('content-loaded', { nodeId: this.nodeId });
    },

    downloadPdf() {
      if (this.pdfPreviewUrl) {
        const link = document.createElement('a');
        link.href = this.pdfPreviewUrl;
        link.download = 'document.pdf';
        link.click();
      }
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
};
</script>

<style scoped>
/* PDF Preview Container */
.pdf-preview-container {
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

/* When no PDF is loaded, use fixed height */
.pdf-preview-container:not(.has-content) {
  height: 400px;
}

.pdf-preview {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 4px;
}

.pdf-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6c757d;
  gap: 8px;
  font-size: 14px;
  text-align: center;
}

.pdf-placeholder svg {
  opacity: 0.5;
}

/* PDF Controls */
.pdf-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  display: flex;
  gap: 8px;
}

.pdf-button {
  padding: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;
}

.pdf-button:hover {
  background: rgba(0, 0, 0, 0.9);
}

/* PDF-specific drag & drop styles */
.pdf-preview-container.drag-hover {
  border: 2px dashed var(--color-primary) !important;
  background: rgba(233, 61, 143, 0.05);
  transform: scale(1.02);
  transition: all 0.2s ease;
}

.pdf-preview-container.processing {
  border: 2px solid var(--color-blue);
  background: rgba(59, 130, 246, 0.05);
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(233, 61, 143, 0.1);
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
  color: var(--color-primary);
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
.pdf-placeholder span {
  transition: color 0.2s ease;
}

.pdf-preview-container.drag-hover .pdf-placeholder span {
  color: var(--color-primary);
  font-weight: 600;
}

/* Prevent dragging interference with existing PDF */
.pdf-preview-container.drag-hover .pdf-preview {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}
</style>
