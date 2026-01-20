<template>
  <div
    class="audio-preview-container"
    :class="{ 'drag-hover': isDragHover, processing: isProcessingFile, 'has-content': hasAudioContent, 'is-playing': isPlaying }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Audio player -->
    <div v-if="audioPreviewUrl" class="audio-player">
      <audio
        ref="audioElement"
        :src="audioPreviewUrl"
        @loadedmetadata="handleAudioLoad"
        @error="handleAudioError"
        @play="handlePlay"
        @pause="handlePause"
        @ended="handleEnded"
        controls
        preload="metadata"
      >
        Your browser does not support the audio element.
      </audio>

      <!-- Audio info -->
      <div v-if="audioInfo" class="audio-info">
        <div class="audio-title">{{ audioInfo.title || 'Audio File' }}</div>
        <div class="audio-duration">{{ formatDuration(audioInfo.duration) }}</div>
      </div>

      <!-- Perlin noise audio visualizer -->
      <PerlinAudioVisualizer :audioElement="$refs.audioElement" :isPlaying="isPlaying" />
    </div>

    <!-- Placeholder when no audio -->
    <div v-else class="audio-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z" fill="#6c757d" />
      </svg>
      <span v-if="!isDragHover && !isProcessingFile">Drop audio files here <br />(MP3, WAV, OGG - 10MB max)</span>
      <span v-else-if="isDragHover">Drop audio file here</span>
      <span v-else-if="isProcessingFile">Processing file...</span>
    </div>

    <!-- Drag overlay -->
    <div v-if="isDragHover" class="drag-overlay">
      <div class="drag-message">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor" />
        </svg>
        <span>Drop audio file here</span>
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
import WidgetBase from '../WidgetBase.js';
import PerlinAudioVisualizer from './PerlinAudioVisualizer.vue';

export default {
  name: 'AudioPreview',
  components: {
    PerlinAudioVisualizer,
  },
  mixins: [WidgetBase],
  props: {
    audioSource: {
      type: String,
      default: null,
    },
  },
  data() {
    return {
      audioInfo: null,
      previousAudioUrl: null,
      isPlaying: false,
      audioContext: null,
      analyser: null,
      dataArray: null,
      animationFrameId: null,
      sourceNode: null,
    };
  },
  computed: {
    audioPreviewUrl() {
      console.log('🎵 AudioPreview: Computing audioPreviewUrl', {
        hasOutput: !!this.output,
        hasAudioSource: !!this.audioSource,
        audioSourceType: typeof this.audioSource,
        audioSourceValue: this.audioSource,
      });

      // Priority 1: Check output from backend execution
      if (this.output && this.output.audioUrl) {
        console.log('✅ AudioPreview: Using output.audioUrl:', this.output.audioUrl);
        return this.output.audioUrl;
      }
      // Priority 2: Check nested result structure for audioUrl
      else if (this.output && this.output.result && this.output.result.audioUrl) {
        console.log('✅ AudioPreview: Using output.result.audioUrl:', this.output.result.audioUrl);
        return this.output.result.audioUrl;
      }
      // Priority 3: Check nested result structure for audioContent (base64 without prefix)
      else if (this.output && this.output.result && this.output.result.audioContent) {
        const contentType = this.output.result.contentType || 'audio/mpeg';
        console.log('✅ AudioPreview: Using output.result.audioContent (base64)');
        return `data:${contentType};base64,${this.output.result.audioContent}`;
      }
      // Priority 4: Local blob URL from drag & drop
      else if (this.localObjectUrl) {
        console.log('✅ AudioPreview: Using localObjectUrl:', this.localObjectUrl);
        return this.localObjectUrl;
      }
      // Priority 5: Check parameters for initial value
      else if (this.audioSource) {
        const paramValue = this.audioSource;
        console.log('🔍 AudioPreview: Checking audioSource parameter:', { paramValue, type: typeof paramValue });

        // Handle object with text/data property (from file uploads)
        if (typeof paramValue === 'object' && paramValue !== null) {
          // Check for base64 data in text property
          if (paramValue.text && typeof paramValue.text === 'string') {
            // If it's already a data URL, return it
            if (paramValue.text.startsWith('data:audio/')) {
              return paramValue.text;
            }
            // If it's a blob URL, return it
            if (paramValue.text.startsWith('blob:')) {
              return paramValue.text;
            }
            // If it's a regular URL, return it
            if (paramValue.text.startsWith('http://') || paramValue.text.startsWith('https://')) {
              return paramValue.text;
            }
          }
          // Check for data property (base64 without prefix)
          if (paramValue.data && typeof paramValue.data === 'string') {
            const mimeType = paramValue.type || 'audio/mpeg';
            return `data:${mimeType};base64,${paramValue.data}`;
          }
          // Check for audioUrl property
          if (paramValue.audioUrl) {
            return paramValue.audioUrl;
          }
        }

        // Handle string values
        if (typeof paramValue === 'string' && !paramValue.includes('{{') && !paramValue.includes('}}')) {
          // If it's already a data URL, return it
          if (paramValue.startsWith('data:audio/')) {
            return paramValue;
          }
          // If it's a blob URL, return it
          if (paramValue.startsWith('blob:')) {
            return paramValue;
          }
          // If it's a regular URL, return it
          if (paramValue.startsWith('http://') || paramValue.startsWith('https://')) {
            console.log('✅ AudioPreview: Using URL from audioSource:', paramValue);
            return paramValue;
          }
        }
      }

      console.log('⚠️ AudioPreview: No valid audio source found');
      return null;
    },
    hasAudioContent() {
      return !!this.audioPreviewUrl;
    },
  },
  watch: {
    audioPreviewUrl(newUrl, oldUrl) {
      if (oldUrl && oldUrl !== newUrl) {
        // Clean up old audio element
        this.cleanupAudioElement();

        // Revoke old blob URL if it was a blob
        if (oldUrl.startsWith('blob:') && oldUrl !== this.localObjectUrl) {
          URL.revokeObjectURL(oldUrl);
        }
      }

      // Store for comparison
      this.previousAudioUrl = newUrl;
    },
  },
  methods: {
    // Override base validation method
    validateFile(file) {
      const validAudioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/m4a'];

      const validExtensions = ['.mp3', '.wav', '.ogg', '.webm', '.aac', '.m4a'];

      return validAudioTypes.includes(file.type) || validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
    },

    // Override base process file method
    async processFile(file) {
      // Clean up old resources FIRST
      this.cleanupAudioElement();

      // Clean up old blob URL
      if (this.localObjectUrl) {
        URL.revokeObjectURL(this.localObjectUrl);
        this.localObjectUrl = null;
      }

      // Create blob URL for audio
      this.localObjectUrl = URL.createObjectURL(file);

      // Update the audioSource parameter
      this.updateContent({
        audioSource: this.localObjectUrl,
      });

      // Set up automatic cleanup
      this.scheduleCleanup();

      this.$emit('content-loaded', { nodeId: this.nodeId });
    },

    setupAudioContext() {
      if (!this.$refs.audioElement || this.audioContext) return;

      try {
        // Create audio context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();

        // Create analyser
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 64; // Small FFT size for performance
        this.analyser.smoothingTimeConstant = 0.8;

        // Create source node from audio element
        this.sourceNode = this.audioContext.createMediaElementSource(this.$refs.audioElement);
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);

        // Create data array for frequency data
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        console.log('✅ Audio context setup successful');
      } catch (error) {
        console.error('❌ Failed to setup audio context:', error);
        // If audio context fails, disconnect everything and let audio play normally
        if (this.sourceNode) {
          try {
            this.sourceNode.disconnect();
          } catch (e) {}
          this.sourceNode = null;
        }
        if (this.analyser) {
          try {
            this.analyser.disconnect();
          } catch (e) {}
          this.analyser = null;
        }
        if (this.audioContext) {
          try {
            this.audioContext.close();
          } catch (e) {}
          this.audioContext = null;
        }
      }
    },

    handlePlay() {
      this.isPlaying = true;
    },

    handlePause() {
      this.isPlaying = false;
    },

    handleEnded() {
      this.isPlaying = false;
    },

    cleanupAudioElement() {
      this.isPlaying = false;

      if (this.$refs.audioElement) {
        const audio = this.$refs.audioElement;

        // Pause playback
        audio.pause();

        // Reset playback position
        audio.currentTime = 0;

        // Remove source to free memory buffer
        audio.removeAttribute('src');

        // Force browser to release the audio buffer
        audio.load();

        // Clear audio info
        this.audioInfo = null;
      }
    },

    handleAudioLoad() {
      if (this.$refs.audioElement) {
        const audio = this.$refs.audioElement;
        this.audioInfo = {
          title: 'Audio File',
          duration: audio.duration,
        };
      }
      this.$emit('content-loaded', { nodeId: this.nodeId });
    },

    handleAudioError(event) {
      const audio = this.$refs.audioElement;
      console.error('❌ Failed to load audio for node:', this.nodeId);
      console.error('❌ Audio error details:', {
        error: audio?.error,
        errorCode: audio?.error?.code,
        errorMessage: audio?.error?.message,
        networkState: audio?.networkState,
        readyState: audio?.readyState,
        src: audio?.src,
        currentSrc: audio?.currentSrc,
      });

      // Show user-friendly error message
      let errorMsg = 'Failed to load audio';
      if (audio?.error?.code === 4) {
        errorMsg = 'Audio format not supported or file not found';
      } else if (audio?.error?.code === 2) {
        errorMsg = 'Network error loading audio';
      } else if (audio?.error?.code === 3) {
        errorMsg = 'Audio decoding failed';
      }

      this.showError(errorMsg);
      this.$emit('content-error', { nodeId: this.nodeId, error: errorMsg });
    },

    formatDuration(seconds) {
      if (!seconds || isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
  },
  emits: ['prevent-drag', 'show-notification', 'update:content', 'content-loaded', 'content-error'],
  beforeUnmount() {
    // Clean up audio element and its buffers
    this.cleanupAudioElement();

    // Clean up timers
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Clean up blob URLs
    if (this.localObjectUrl) {
      URL.revokeObjectURL(this.localObjectUrl);
      this.localObjectUrl = null;
    }

    if (this.previousAudioUrl && this.previousAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.previousAudioUrl);
      this.previousAudioUrl = null;
    }
  },
};
</script>

<style scoped>
/* Audio Preview Container */
.audio-preview-container {
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
  transition: all 0.3s ease;
}

/* When no audio is loaded, use fixed height */
.audio-preview-container:not(.has-content) {
  height: 180px;
}

/* Subtle glow when playing */
/* .audio-preview-container.is-playing {
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
} */

.audio-player {
  width: 100%;
  height: 100%;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: space-between;
}

.audio-player audio {
  width: 100%;
  border-radius: 8px;
  height: 24px !important;
  min-height: 24px !important;
}

.audio-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: white;
  padding: 0 4px;
}

.audio-title {
  font-weight: 600;
  font-size: 14px;
}

.audio-duration {
  font-size: 12px;
  opacity: 0.8;
}

.waveform-placeholder {
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  flex: 1;
  background: url(/images/backgrounds/bg7.jpg);
  background-position: center;
  background-size: cover;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Animated audio bars */
.audio-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  height: 80%;
  width: 90%;
  gap: 2px;
  position: relative;
  z-index: 2;
}

.audio-bar {
  flex: 1;
  background: linear-gradient(to top, rgba(59, 130, 246, 0.8), rgba(147, 197, 253, 0.6));
  border-radius: 2px 2px 0 0;
  height: 20%;
  min-height: 5%;
  transition: height 0.1s ease;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
}

/* Animate bars when playing */
.is-playing .audio-bar {
  animation: pulse 0.8s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

/* Pulsing overlay effect */
.pulse-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.2) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.pulse-overlay.active {
  opacity: 1;
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.3;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.6;
  }
}

.audio-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6c757d;
  gap: 8px;
  font-size: 14px;
  text-align: center;
}

.audio-placeholder svg {
  opacity: 0.5;
}

.audio-placeholder svg path {
  fill: white;
}

/* Audio-specific drag & drop styles */
.audio-preview-container.drag-hover {
  border: 2px dashed white !important;
  transform: scale(1.02);
  transition: all 0.2s ease;
}

.audio-preview-container.processing {
  border: 2px solid white;
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
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
  color: white;
  font-weight: 600;
  gap: 12px;
  font-size: 16px;
  text-align: center;
}

.drag-message svg {
  opacity: 0.9;
}

.drag-message svg path {
  fill: white;
}

.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 4px;
  backdrop-filter: blur(2px);
  color: white;
  font-weight: 600;
  gap: 12px;
  font-size: 14px;
}

.processing-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Enhanced placeholder text for drag state */
.audio-placeholder span {
  transition: color 0.2s ease;
}

.audio-preview-container.drag-hover .audio-placeholder span {
  font-weight: 700;
}

/* Prevent dragging interference with existing audio */
.audio-preview-container.drag-hover .audio-player {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}
</style>
