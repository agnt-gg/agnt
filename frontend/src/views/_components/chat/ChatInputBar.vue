<template>
  <div class="chat-input-bar" :class="{ 'is-expanded': isExpanded, 'is-compact': compact }">
    <!-- File / mention chips above the input -->
    <div v-if="hasChips" class="chat-input-chips">
      <div v-for="(file, index) in selectedFiles" :key="`f-${index}-${file.name}`" class="chat-chip">
        <span class="chat-chip-icon">📎</span>
        <span class="chat-chip-label">{{ file.name }}</span>
        <button @click="$emit('remove-file', index)" class="chat-chip-remove" title="Remove file">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div v-for="(agent, index) in mentionedAgents" :key="`m-${index}-${agent.id}`" class="chat-chip chat-chip-mention">
        <span class="chat-chip-icon">@</span>
        <span class="chat-chip-label">{{ agent.name }}</span>
        <button @click="$emit('remove-mention', index)" class="chat-chip-remove" title="Remove mention">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <div class="chat-input-row">
      <slot name="before-input" />

      <div class="chat-input-textarea-wrap">
        <div v-if="showHighlightBackdrop" class="chat-input-backdrop" ref="backdropRef">
          <div class="chat-input-highlights" v-html="highlightHtml"></div>
        </div>
        <textarea
          ref="textareaRef"
          class="chat-input-textarea"
          :value="modelValue"
          :placeholder="placeholder"
          :disabled="disabled"
          rows="1"
          @input="onInput"
          @keydown="onKeydown"
          @paste="onPaste"
          @scroll="onScroll"
        ></textarea>
      </div>

      <input v-if="showAttachments" ref="fileInputRef" type="file" multiple :accept="attachAccept" @change="onFileSelect" style="display: none" />

      <!-- Inline (non-compact) layout: every button shown in a row -->
      <template v-if="!compact">
        <Tooltip v-if="showAttachments && !isStreaming" text="Attach files" width="auto">
          <button @click="triggerFileInput" :disabled="disabled" class="chat-icon-btn chat-attach-btn">
            <i class="fas fa-paperclip"></i>
          </button>
        </Tooltip>
        <slot name="extra-buttons" :is-streaming="isStreaming" />
        <Tooltip v-if="showVoice && voiceSupported && !isStreaming" :text="voiceListening ? 'Stop recording' : 'Start voice input'" width="auto">
          <button @click="$emit('toggle-voice')" :disabled="disabled" class="chat-icon-btn chat-mic-btn" :class="{ 'is-listening': voiceListening }">
            <i :class="voiceListening ? 'fas fa-stop' : 'fas fa-microphone'"></i>
          </button>
        </Tooltip>
      </template>

      <!-- Compact (sidebar) layout: secondary buttons collapse into "..." menu.
           When voice is actively listening, surface a dedicated Stop-recording
           button in the row instead of hiding it inside the overflow menu —
           the user needs to be able to stop dictating without clicking through. -->
      <template v-else>
        <Tooltip v-if="showVoice && voiceSupported && voiceListening && !isStreaming" text="Stop recording" width="auto">
          <button
            @click="$emit('toggle-voice')"
            :disabled="disabled"
            class="chat-icon-btn chat-mic-btn is-listening"
            type="button"
          >
            <i class="fas fa-stop"></i>
          </button>
        </Tooltip>
        <div v-else-if="hasOverflowItems && !isStreaming" class="chat-overflow-wrap" v-click-outside="closeOverflow">
          <Tooltip text="More" width="auto">
            <button
              @click.stop="overflowOpen = !overflowOpen"
              :disabled="disabled"
              class="chat-icon-btn chat-overflow-btn"
              :class="{ 'is-open': overflowOpen }"
              type="button"
            >
              <i class="fas fa-ellipsis-h"></i>
            </button>
          </Tooltip>
          <div v-if="overflowOpen" class="chat-overflow-menu">
            <button v-if="showAttachments" @click="onOverflowItem(triggerFileInput)" class="chat-overflow-item" type="button">
              <i class="fas fa-paperclip"></i>
              <span>Attach files</span>
            </button>
            <button
              v-if="showVoice && voiceSupported"
              @click="onOverflowItem(() => $emit('toggle-voice'))"
              class="chat-overflow-item"
              type="button"
            >
              <i class="fas fa-microphone"></i>
              <span>Voice input</span>
            </button>
            <slot name="overflow-items" :close="closeOverflow" />
          </div>
        </div>
      </template>

      <!-- Send / Stop is always inline; it's the primary action -->
      <template v-if="!isStreaming">
        <Tooltip text="Send message" width="auto">
          <button @click="onSend" :disabled="disabled || !canSend" class="chat-icon-btn chat-send-btn" type="button">
            <i class="fas fa-paper-plane"></i>
          </button>
        </Tooltip>
      </template>
      <template v-else>
        <Tooltip text="Stop generating" width="auto">
          <button @click="$emit('stop')" class="chat-icon-btn chat-stop-btn" type="button">
            <i class="fas fa-stop"></i>
          </button>
        </Tooltip>
      </template>
    </div>
  </div>
</template>

<script>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const clickOutside = {
  beforeMount(el, binding) {
    el.__clickOutside__ = (event) => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value(event);
      }
    };
    document.addEventListener('click', el.__clickOutside__);
  },
  unmounted(el) {
    document.removeEventListener('click', el.__clickOutside__);
    delete el.__clickOutside__;
  },
};

export default {
  name: 'ChatInputBar',
  components: { Tooltip },
  directives: { clickOutside },
  props: {
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: 'Type a message...' },
    disabled: { type: Boolean, default: false },
    isStreaming: { type: Boolean, default: false },
    showAttachments: { type: Boolean, default: false },
    attachAccept: {
      type: String,
      default: '.pdf,.docx,.txt,.csv,.md,.json,.js,.py,.html,.css,.jpg,.jpeg,.png,.gif,.webp',
    },
    showVoice: { type: Boolean, default: true },
    voiceSupported: { type: Boolean, default: false },
    voiceListening: { type: Boolean, default: false },
    selectedFiles: { type: Array, default: () => [] },
    mentionedAgents: { type: Array, default: () => [] },
    showHighlightBackdrop: { type: Boolean, default: false },
    highlightHtml: { type: String, default: '' },
    compact: { type: Boolean, default: false },
    maxHeight: { type: Number, default: 150 },
    expandedThreshold: { type: Number, default: 30 },
  },
  emits: [
    'update:modelValue',
    'submit',
    'stop',
    'attach-files',
    'paste-files',
    'remove-file',
    'remove-mention',
    'toggle-voice',
    'textarea-input',
    'textarea-keydown',
    'textarea-scroll',
  ],
  setup(props, { emit, expose }) {
    const textareaRef = ref(null);
    const backdropRef = ref(null);
    const fileInputRef = ref(null);
    const isExpanded = ref(false);
    const overflowOpen = ref(false);

    const canSend = computed(() => props.modelValue.trim().length > 0 || props.selectedFiles.length > 0);
    const hasChips = computed(() => props.selectedFiles.length > 0 || props.mentionedAgents.length > 0);
    const hasOverflowItems = computed(() => props.showAttachments || (props.showVoice && props.voiceSupported));

    const MIN_HEIGHT = 40;
    const autoResize = () => {
      const el = textareaRef.value;
      if (!el) return;
      // Empty textarea always collapses to MIN_HEIGHT — this avoids a regression
      // we saw in Agent/Widget/Tool sidebars where the parent panel's flex layout
      // hadn't resolved on first mount, scrollHeight reported a stale/inflated
      // value, and the input rendered ~80px tall until the first keystroke.
      // For empty input we don't need to measure anything.
      if (!el.value || el.value.length === 0) {
        el.style.height = `${MIN_HEIGHT}px`;
        isExpanded.value = false;
        if (backdropRef.value) backdropRef.value.scrollTop = 0;
        return;
      }
      // Reset so scrollHeight reports the natural content height (not previous inline height).
      el.style.height = 'auto';
      const measured = el.scrollHeight;
      const h = Math.max(MIN_HEIGHT, Math.min(measured, props.maxHeight));
      el.style.height = `${h}px`;
      isExpanded.value = h > MIN_HEIGHT;
      if (backdropRef.value) backdropRef.value.scrollTop = el.scrollTop;
    };

    const focus = () => {
      nextTick(() => textareaRef.value?.focus());
    };

    const onInput = (event) => {
      emit('update:modelValue', event.target.value);
      nextTick(autoResize);
      emit('textarea-input', event, textareaRef.value);
    };

    const onKeydown = (event) => {
      // Let consumer intercept (e.g. command menu) — they call event.preventDefault() if handled.
      emit('textarea-keydown', event, textareaRef.value);
      if (event.defaultPrevented) return;

      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        onSend();
      }
    };

    const onScroll = () => {
      if (backdropRef.value && textareaRef.value) {
        backdropRef.value.scrollTop = textareaRef.value.scrollTop;
      }
      emit('textarea-scroll');
    };

    const onSend = () => {
      if (!canSend.value || props.disabled) return;
      emit('submit', props.modelValue);
      // Caller is responsible for clearing modelValue. Reset textarea height defensively
      // on next tick once their clear lands.
      nextTick(autoResize);
      focus();
    };

    const triggerFileInput = () => {
      fileInputRef.value?.click();
    };

    const onFileSelect = (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length > 0) emit('attach-files', files);
      if (fileInputRef.value) fileInputRef.value.value = '';
    };

    const onPaste = (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const imageFiles = [];
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) emit('paste-files', imageFiles);
    };

    const onOverflowItem = (fn) => {
      overflowOpen.value = false;
      try {
        fn();
      } catch (e) {
        console.error('[ChatInputBar] overflow item error:', e);
      }
    };

    const closeOverflow = () => {
      overflowOpen.value = false;
    };

    let resizeObserver = null;
    onMounted(() => {
      // Run after the next frame so the parent's flex layout has resolved.
      // Without this, sidebar panels that wrap the input in a `flex: 1` column
      // measure scrollHeight before the column has a definite height, and the
      // textarea ends up taller than its empty 40px baseline until the user
      // types their first character.
      requestAnimationFrame(() => autoResize());

      // Re-measure when the textarea's width changes (panel resize, navigating
      // back to the page, fullscreen toggle). Empty input takes the early-out
      // in autoResize so this is essentially free.
      if (typeof ResizeObserver !== 'undefined' && textareaRef.value) {
        resizeObserver = new ResizeObserver(() => autoResize());
        resizeObserver.observe(textareaRef.value);
      }
    });

    onBeforeUnmount(() => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    });

    expose({
      focus,
      autoResize,
      get textarea() {
        return textareaRef.value;
      },
    });

    return {
      textareaRef,
      backdropRef,
      fileInputRef,
      isExpanded,
      overflowOpen,
      canSend,
      hasChips,
      hasOverflowItems,
      onInput,
      onKeydown,
      onScroll,
      onSend,
      onPaste,
      onFileSelect,
      triggerFileInput,
      onOverflowItem,
      closeOverflow,
    };
  },
};
</script>

<style scoped>
.chat-input-bar {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.chat-input-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 8px 0;
}

.chat-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 10px;
  background: var(--color-darker-1);
  border: 1px solid var(--color-dull-navy, var(--terminal-border-color));
  border-radius: 14px;
  font-size: 0.8em;
  color: var(--color-light-med-navy, var(--color-light-green));
  max-width: 200px;
}

.chat-chip-mention {
  background: rgba(var(--primary-rgb), 0.15);
  border-color: rgba(var(--primary-rgb), 0.4);
}

.chat-chip-icon {
  font-size: 0.95em;
  flex-shrink: 0;
}

.chat-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.chat-chip-remove {
  background: none;
  border: none;
  color: var(--color-med-navy, var(--color-grey));
  cursor: pointer;
  padding: 0 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85em;
  transition: color 0.2s;
}
.chat-chip-remove:hover {
  color: var(--color-red);
}

.chat-input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.chat-input-textarea-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.chat-input-textarea {
  position: relative;
  z-index: 1;
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  /* Single style for both empty + multi-line states. JS autoResize sets inline
     height between min and max as content grows. Border-radius softens slightly
     when expanded via the .is-expanded modifier below. */
  padding: 9px 16px;
  min-height: 40px;
  max-height: 150px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-light-green, var(--color-text));
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: 1.4;
  resize: none;
  overflow: hidden; /* never any scrollbar */
  scrollbar-width: none;
  -ms-overflow-style: none;
  transition: border-color 0.2s ease, background 0.2s ease, border-radius 0.2s ease;
}

.chat-input-bar.is-expanded .chat-input-textarea {
  border-radius: 16px;
}

.chat-input-textarea::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.chat-input-textarea:focus {
  outline: none !important;
  border-color: var(--color-primary, var(--terminal-border-color)) !important;
}
.chat-input-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.chat-input-textarea::placeholder {
  color: var(--color-med-navy, rgba(127, 129, 147, 0.7));
}

/* Highlight backdrop (orchestrator @ mention coloring) */
.chat-input-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 16px;
  border-radius: 24px;
  border: 1px solid transparent;
  overflow: auto;
  pointer-events: none;
  z-index: 0;
}
.chat-input-highlights {
  white-space: pre-wrap;
  word-wrap: break-word;
  color: transparent;
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: 1.4;
  margin: 0;
  border: 0;
}
.chat-input-highlights :deep(mark) {
  color: transparent;
  background-color: rgba(var(--primary-rgb, 18, 224, 255), 0.2);
  border-radius: 0;
  padding: 0;
  margin: 0;
}

/* Buttons */
.chat-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-darker-2);
  color: var(--color-light-green, var(--color-dull-white));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.2s,
    color 0.2s,
    transform 0.2s;
  flex-shrink: 0;
}
.chat-icon-btn:hover:not(:disabled) {
  background: var(--color-darker-0);
  color: var(--color-primary, var(--color-green));
}
.chat-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-attach-btn,
.chat-mic-btn,
.chat-overflow-btn {
  /* base inherited */
}

.chat-mic-btn.is-listening,
.chat-overflow-item.is-listening {
  background: var(--color-red);
  color: white;
  animation: chat-pulse 1.5s ease-in-out infinite;
}

@keyframes chat-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--red-rgb, 255, 68, 68), 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(var(--red-rgb, 255, 68, 68), 0);
  }
}

.chat-send-btn {
  background: var(--color-green);
  color: var(--color-dark-navy);
}
.chat-send-btn:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.8);
  transform: scale(1.05);
}
.chat-send-btn:disabled {
  background: rgba(var(--green-rgb), 0.3);
  color: var(--color-dark-navy);
  transform: none;
}

.chat-stop-btn {
  background: var(--color-red, #ff6b6b);
  color: white;
  animation: chat-pulse-stop 2s ease-in-out infinite;
}
.chat-stop-btn:hover {
  background: rgba(255, 107, 107, 0.85);
  transform: scale(1.05);
}
@keyframes chat-pulse-stop {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--red-rgb, 255, 68, 68), 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(var(--red-rgb, 255, 68, 68), 0);
  }
}

/* Overflow menu (compact mode) */
.chat-overflow-wrap {
  position: relative;
  display: inline-block;
  flex-shrink: 0;
}
.chat-overflow-btn.is-open {
  background: var(--color-darker-0);
  color: var(--color-primary, var(--color-green));
}
.chat-overflow-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--color-popup, var(--color-darker-1));
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  padding: 4px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* Apply to both directly-rendered and slotted .chat-overflow-item buttons.
   :slotted() pierces Vue 3 scoped CSS into <slot> content from parent components. */
.chat-overflow-item,
.chat-overflow-menu :slotted(.chat-overflow-item) {
  display: flex !important;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 8px 10px;
  margin: 0;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--color-light-green, var(--color-text));
  cursor: pointer;
  text-align: left;
  font-size: 0.85em;
  font-family: inherit;
  line-height: 1.2;
  width: 100%;
  box-sizing: border-box;
  transition:
    background 0.15s,
    color 0.15s;
  text-transform: none;
  letter-spacing: normal;
}
.chat-overflow-item:hover,
.chat-overflow-menu :slotted(.chat-overflow-item:hover) {
  background: rgba(var(--primary-rgb, 18, 224, 255), 0.08);
  color: var(--color-primary, var(--color-green));
}
.chat-overflow-item i,
.chat-overflow-menu :slotted(.chat-overflow-item i) {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.chat-overflow-item span,
.chat-overflow-menu :slotted(.chat-overflow-item span) {
  flex: 1 1 auto;
  text-align: left;
}

/* Inherited slot buttons should match the icon-btn aesthetic — consumers passing
   their own buttons via #extra-buttons can also use the chat-icon-btn class. */
.chat-input-row :deep(.chat-icon-btn) {
  flex-shrink: 0;
}
</style>
