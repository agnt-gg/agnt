<template>
  <div
    class="media-preview-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile, 'has-content': hasMediaContent }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Image preview -->
    <img
      v-if="mediaPreviewUrl && detectedMediaType === 'image'"
      :src="mediaPreviewUrl"
      class="media-preview image-preview"
      @error="handleMediaError"
      @load="handleMediaLoad"
      @mousedown="$emit('prevent-drag', $event)"
      @dragstart.prevent
      draggable="false"
      alt="Image Preview"
    />

    <!-- Video preview (direct video files) -->
    <video
      v-else-if="mediaPreviewUrl && detectedMediaType === 'video' && !isEmbeddedVideo"
      :src="mediaPreviewUrl"
      class="media-preview video-preview"
      @error="handleMediaError"
      @loadeddata="handleMediaLoad"
      @mousedown="$emit('prevent-drag', $event)"
      @dragstart.prevent
      controls
      preload="metadata"
      draggable="false"
    >
      Your browser does not support the video tag.
    </video>

    <!-- Embedded video (YouTube, Vimeo, etc.) -->
    <iframe
      v-else-if="mediaPreviewUrl && detectedMediaType === 'video' && isEmbeddedVideo"
      :src="mediaPreviewUrl"
      class="media-preview video-preview embedded-video"
      @mousedown="$emit('prevent-drag', $event)"
      @dragstart.prevent
      frameborder="0"
      allowfullscreen
      draggable="false"
    >
    </iframe>

    <!-- Placeholder when no media -->
    <div v-else class="media-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M21 19V5C21 3.9 20.1 3 19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19ZM8.5 13.5L11 16.51L14.5 12L19 18H5L8.5 13.5Z"
          fill="#6c757d"
        />
      </svg>
      <span v-if="!isDragHover && !isProcessingFile">Drop media files here <br />(10MB max)</span>
      <span v-else-if="isDragHover">Drop media file here</span>
      <span v-else-if="isProcessingFile">Processing file...</span>
    </div>

    <!-- Drag overlay -->
    <div v-if="isDragHover" class="drag-overlay">
      <div class="drag-message">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor" />
        </svg>
        <span>Drop media file here</span>
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
  name: 'MediaPreview',
  mixins: [WidgetBase],
  props: {
    mediaSource: {
      type: String,
      default: null,
    },
    mediaType: {
      type: String,
      default: 'image',
    },
  },
  data() {
    return {};
  },
  watch: {
    mediaSource: {
      handler(newMediaSource, oldMediaSource) {
        // If mediaSource is cleared (becomes empty, null, or undefined)
        if (!newMediaSource && this.localObjectUrl) {
          // Clean up the blob URL
          URL.revokeObjectURL(this.localObjectUrl);
          this.localObjectUrl = null;

          // Force a re-render to update the display
          this.$forceUpdate();

          // Also clean up any IndexedDB entries for this node
          this.cleanupOldContentForNode();
        }
        // If mediaSource changed to a different value, clean up old blob URL
        else if (newMediaSource !== oldMediaSource && this.localObjectUrl && !newMediaSource?.startsWith('blob:')) {
          URL.revokeObjectURL(this.localObjectUrl);
          this.localObjectUrl = null;
        }
      },
      immediate: false,
    },
  },
  computed: {
    mediaPreviewUrl() {
      // First priority: local blob URL from IndexedDB (for display only)
      if (this.localObjectUrl) {
        return this.localObjectUrl;
      }

      let mediaUrl = null;

      // Priority 1: Check direct output properties first (most common case)
      // Check if we have output with base64Data (direct - from enhanced backend)
      if (this.output && this.output.base64Data) {
        mediaUrl = this.output.base64Data;
      }
      // Check if we have output with mediaUrl (direct - backwards compatibility)
      else if (this.output && this.output.mediaUrl) {
        mediaUrl = this.output.mediaUrl;
      }
      // Check if we have output with imageUrl (direct - backwards compatibility)
      else if (this.output && this.output.imageUrl) {
        mediaUrl = this.output.imageUrl;
      }
      // Priority 2: Check nested result structure (less common)
      // Check if we have nested result structure with base64Data
      else if (this.output && this.output.result && this.output.result.base64Data) {
        mediaUrl = this.output.result.base64Data;
      }
      // Check if we have nested result structure with mediaUrl
      else if (this.output && this.output.result && this.output.result.mediaUrl) {
        mediaUrl = this.output.result.mediaUrl;
      }
      // Check if we have nested result structure with imageUrl
      else if (this.output && this.output.result && this.output.result.imageUrl) {
        mediaUrl = this.output.result.imageUrl;
      }
      // Check if we have nested result structure with imageData
      else if (this.output && this.output.result && this.output.result.imageData) {
        mediaUrl = this.output.result.imageData;
      }
      // Check parameters for initial value (only if it's not a template variable)
      else if (this.mediaSource) {
        // Check for IndexedDB reference and load it
        if (typeof this.mediaSource === 'string' && this.mediaSource.startsWith('idb://')) {
          this.loadContentFromIndexedDB(this.mediaSource);
          return null; // Return null for now, will update when loaded
        }
        // Now we store blob URLs directly as strings, so just check if it's not a template
        else if (typeof this.mediaSource === 'string' && !this.mediaSource.includes('{{') && !this.mediaSource.includes('}}')) {
          mediaUrl = this.mediaSource;
        }
      }

      // Validate that we have a proper URL or base64 data
      if (mediaUrl) {
        // Additional check: ensure it's not a template variable that wasn't resolved
        if (mediaUrl.includes('{{') || mediaUrl.includes('}}')) {
          console.warn('Media preview: Template variable detected but not resolved:', mediaUrl.substring(0, 100));
          return null;
        }

        const isValidUrl = mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://') || mediaUrl.startsWith('blob:');
        const isValidImageBase64 = mediaUrl.startsWith('data:image/');
        const isValidVideoBase64 = mediaUrl.startsWith('data:video/');

        if (isValidUrl || isValidImageBase64 || isValidVideoBase64) {
          return mediaUrl;
        }
      }

      return null;
    },
    detectedMediaType() {
      // Priority 1: Check output mediaType from backend (most reliable)
      if (this.output && this.output.mediaType) {
        return this.output.mediaType;
      }
      // Check nested result structure
      else if (this.output && this.output.result && this.output.result.mediaType) {
        return this.output.result.mediaType;
      }

      // Priority 2: Auto-detect from URL/base64 data
      const url = this.mediaPreviewUrl;
      if (url) {
        // Check base64 data URI prefix (most reliable for base64)
        if (url.startsWith('data:image/')) {
          return 'image';
        } else if (url.startsWith('data:video/')) {
          return 'video';
        }

        // Check URL extensions and domains
        const lowerUrl = url.toLowerCase();

        // Video extensions
        const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.m4v', '.mkv', '.wmv'];
        const hasVideoExtension = videoExtensions.some((ext) => lowerUrl.includes(ext));

        // Video streaming platforms
        const videoStreamingDomains = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv'];
        const isVideoStreaming = videoStreamingDomains.some((domain) => lowerUrl.includes(domain));

        if (hasVideoExtension || isVideoStreaming) {
          return 'video';
        }
      }

      // Priority 3: Check stored mediaType parameter (from drag & drop or manual setting)
      // Only use this as fallback if we couldn't detect from URL
      if (this.mediaType && this.mediaType !== 'unknown') {
        return this.mediaType;
      }

      // Default to unknown if we can't determine
      return 'unknown';
    },
    isEmbeddedVideo() {
      const url = this.mediaPreviewUrl;
      if (!url || this.detectedMediaType !== 'video') return false;

      // Check if it's an embedded video URL (YouTube, Vimeo, etc.)
      return url.includes('youtube.com/embed') || url.includes('vimeo.com/video') || url.includes('dailymotion.com/embed');
    },
    hasMediaContent() {
      return !!this.mediaPreviewUrl;
    },
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];

      const validVideoTypes = [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/mov',
        'video/avi',
        'video/x-msvideo',
        'video/quicktime',
        'video/x-ms-wmv',
      ];

      return validImageTypes.includes(file.type) || validVideoTypes.includes(file.type);
    },

    // Override base process file method
    async processFile(file) {
      // CRITICAL: Clean up old IndexedDB entries for this node parameter
      await this.cleanupOldContentForNode();

      // Clean up previous object URL to prevent memory leaks
      if (this.localObjectUrl) {
        URL.revokeObjectURL(this.localObjectUrl);
      }

      // Use Object URL for much better performance and memory usage
      this.localObjectUrl = URL.createObjectURL(file);

      // For display purposes, use the blob URL directly but keep metadata
      const mediaSource = this.localObjectUrl;

      // Determine media type from file
      const isVideo = file.type.startsWith('video/');

      // Emit BOTH parameters in a single update to prevent race conditions
      this.updateContent({
        mediaSource: mediaSource,
        mediaType: isVideo ? 'video' : 'image',
      });

      // Set up automatic cleanup timer
      this.scheduleCleanup();
    },

    handleMediaError() {
      console.warn('Failed to load media for node:', this.nodeId);
      this.$emit('content-error', { nodeId: this.nodeId, error: 'Failed to load media' });
    },

    handleMediaLoad() {
      console.log('Media loaded successfully for node:', this.nodeId);
      this.$emit('content-loaded', { nodeId: this.nodeId });
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
};
</script>

<style scoped>
/* Media Preview Container */
.media-preview-container {
  width: 100%;
  height: fit-content;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* overflow: hidden; */
  border-radius: 4px;
  margin: 0 16px;
  position: relative;
}

/* When no media is loaded, use fixed height */
.media-preview-container:not(.has-content) {
  height: 200px;
}

.media-preview {
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  border-radius: 4px;
}

.image-preview {
  object-fit: contain;
}

.video-preview {
  object-fit: contain;
}

.embedded-video {
  width: 100%;
  height: 100%;
  border: none;
}

.media-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6c757d;
  gap: 8px;
  font-size: 14px;
  text-align: center;
}

.media-placeholder svg {
  opacity: 0.5;
}

/* Drag & Drop Styles */
.media-preview-container.drag-hover {
  border: 2px dashed var(--color-primary) !important;
  background: rgba(233, 61, 143, 0.05);
  transform: scale(1.02);
  transition: all 0.2s ease;
}

.media-preview-container.processing {
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
.media-placeholder span {
  transition: color 0.2s ease;
}

.media-preview-container.drag-hover .media-placeholder span {
  color: var(--color-primary);
  font-weight: 600;
}

/* Prevent dragging interference with existing media */
.media-preview-container.drag-hover .media-preview {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}
</style>
