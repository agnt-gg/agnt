<template>
  <div class="response-area">
    <div class="response-header">
      <div class="response-title"><i class="fas fa-code"></i> Tool Output</div>
      <div class="response-controls">
        <Tooltip text="Reset" width="auto" position="bottom">
          <button class="control-button" @click="resetContent">
            <i class="fas fa-sync-alt"></i>
          </button>
        </Tooltip>
        <Tooltip text="Expand" width="auto" position="bottom">
          <button class="control-button" @click="toggleFullscreen">
            <i :class="isFullscreen ? 'fas fa-compress-alt' : 'fas fa-expand-alt'"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="response-body" ref="responseBodyRef" :class="{ fullscreen: isFullscreen }" id="response-area">
      <div v-if="!content" class="empty-state" id="placeholder-text">
        <div class="empty-icon">
          <i class="fas fa-code"></i>
        </div>
        <p>Select a tool template and generate content to see results here.</p>
      </div>

      <div v-else class="content-display assistant-message-receive" contenteditable="false">
        {{ content }}
      </div>
    </div>
  </div>
</template>

<script>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ResponseArea',
  components: { Tooltip },
  emits: ['content-loaded'],
  props: {
    content: {
      type: String,
      default: '',
    },
  },

  setup(props, { emit }) {
    const isFullscreen = ref(false);
    const responseBodyRef = ref(null);

    const resetContent = () => {
      emit('reset-content');
    };

    const toggleFullscreen = () => {
      isFullscreen.value = !isFullscreen.value;

      if (isFullscreen.value) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    };

    // Escape fullscreen mode with ESC key
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen.value) {
        toggleFullscreen();
      }
    };

    // Watch for content changes and emit the content-loaded event
    watch(
      () => props.content,
      (newContent) => {
        if (newContent) {
          emit('content-loaded');
        }
      }
    );

    onMounted(() => {
      document.addEventListener('keydown', handleKeyDown);
      emit('content-loaded');
    });

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeyDown);
      if (isFullscreen.value) {
        document.body.style.overflow = '';
      }
    });

    return {
      isFullscreen,
      responseBodyRef,
      resetContent,
      toggleFullscreen,
    };
  },
};
</script>

<style scoped>
.response-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  font-family: 'Courier New', monospace;
  background: var(--color-darker-0);
}

.response-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(18, 224, 255, 0.04) 0%, rgba(18, 224, 255, 0.02) 100%);
  border-bottom: 1px solid rgba(18, 224, 255, 0.1);
}

.response-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-green);
  font-weight: 500;
}

.response-controls {
  display: flex;
  gap: 8px;
}

.control-button {
  background: none;
  border: none;
  color: var(--color-grey);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.control-button:hover {
  color: var(--color-green);
  background: rgba(25, 239, 131, 0.1);
}

.response-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  transition: all 0.3s ease;
  position: relative;
  min-height: 100px;
  width: calc(100% - 32px);
  outline: none !important;
  border: none !important;
}

#response-area:focus,
.response-body:focus,
.assistant-message-receive:focus {
  outline: none !important;
  border: none !important;
}

.response-body.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: calc(100vw - 64px);
  height: calc(100vh - 64px);
  max-width: 100%;
  z-index: 9999;
  background: var(--color-dark-navy);
  padding: 32px;
  overflow-y: auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: calc(100% - 64px);
  color: var(--color-grey);
  text-align: center;
  padding: 32px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.3;
}

.content-display {
  line-height: 1.6;
  white-space: pre-wrap;
  color: var(--color-white);
  font-size: 14px;
}
</style>
