<template>
  <div
    :class="[
      'node',
      'no-select',
      node.type,
      {
        'label-node': node.type === 'label',
        selected: node.isSelected,
        'tiny-node': isTinyNodeMode,
        trigger: node.isTrigger,
        'has-media-content': hasMediaContent,
        'has-html-content': hasHtmlContent,
      },
      node.category,
      { 'has-output': output },
      { 'has-error': error },
    ]"
    :style="nodeStyle"
    @mousedown.stop="startDragging"
    @click.stop="selectNode"
    :data-id="node.id"
    :data-category="node.category"
    :title="node.title || node.text"
  >
    <SvgIcon
      v-if="node.icon && node.type !== 'label' && !hasMediaContent && !hasHtmlContent && !hasContent && !hasWidget"
      :name="node.icon"
      class="node-icon"
    />

    <!-- Regular node content -->
    <div
      v-if="!hasWidget"
      class="node-content"
      @dblclick="startEditing"
      :contenteditable="node.isEditing"
      @blur="finishEditing"
      @keydown="handleNodeKeydown"
    >
      {{ node.text || 'Untitled Node' }}
    </div>

    <!-- Media preview widget -->
    <MediaPreview
      v-else-if="isMediaPreview"
      :node-id="node.id"
      :is-tiny-mode="isTinyNodeMode"
      :output="output"
      :media-source="node.parameters?.mediaSource || node.parameters?.imageSource"
      :media-type="node.parameters?.mediaType"
      @prevent-drag="startDragging"
      @update:content="handleWidgetUpdate"
      @show-notification="$emit('show-notification', $event)"
    />

    <!-- HTML preview widget -->
    <HtmlPreview
      v-else-if="isHtmlPreview"
      :node-id="node.id"
      :is-tiny-mode="isTinyNodeMode"
      :output="output"
      :html-source="node.parameters?.htmlSource"
      :sandbox-mode="node.parameters?.sandboxMode"
      :custom-width="node.parameters?.customWidth"
      :custom-height="node.parameters?.customHeight"
      @prevent-drag="startDragging"
      @update:content="handleWidgetUpdate"
      @show-notification="$emit('show-notification', $event)"
    />

    <!-- Code preview widget -->
    <CodePreview
      v-else-if="isCodePreview"
      :node-id="node.id"
      :is-tiny-mode="isTinyNodeMode"
      :output="output"
      :code-source="node.parameters?.codeSource"
      :language="node.parameters?.language"
      :custom-width="node.parameters?.customWidth"
      :custom-height="node.parameters?.customHeight"
      @prevent-drag="startDragging"
      @update:content="handleWidgetUpdate"
      @show-notification="$emit('show-notification', $event)"
    />

    <!-- PDF preview widget -->
    <PdfPreview
      v-else-if="isPdfPreview"
      :node-id="node.id"
      :is-tiny-mode="isTinyNodeMode"
      :output="output"
      :pdf-source="node.parameters?.pdfSource"
      :custom-width="node.parameters?.customWidth"
      :custom-height="node.parameters?.customHeight"
      @prevent-drag="startDragging"
      @update:content="handleWidgetUpdate"
      @show-notification="$emit('show-notification', $event)"
    />

    <!-- Audio preview widget -->
    <AudioPreview
      v-else-if="isAudioPreview"
      :node-id="node.id"
      :is-tiny-mode="isTinyNodeMode"
      :output="output"
      :audio-source="node.parameters?.audioSource"
      :custom-width="node.parameters?.customWidth"
      :custom-height="node.parameters?.customHeight"
      @prevent-drag="startDragging"
      @update:content="handleWidgetUpdate"
      @show-notification="$emit('show-notification', $event)"
    />

    <!-- Markdown preview widget -->
    <MarkdownPreview
      v-else-if="isMarkdownPreview"
      :node-id="node.id"
      :is-tiny-mode="isTinyNodeMode"
      :output="output"
      :markdown-source="node.parameters?.markdownSource"
      :custom-width="node.parameters?.customWidth"
      :custom-height="node.parameters?.customHeight"
      @prevent-drag="startDragging"
      @update:content="handleWidgetUpdate"
      @show-notification="$emit('show-notification', $event)"
    />

    <!-- Chart preview widget -->
    <ChartPreview
      v-else-if="isChartPreview"
      :node-id="node.id"
      :is-tiny-mode="isTinyNodeMode"
      :output="output"
      :chart-data="node.parameters?.chartData"
      :chart-type="node.parameters?.chartType"
      :custom-width="node.parameters?.customWidth"
      :custom-height="node.parameters?.customHeight"
      @prevent-drag="startDragging"
      @update:content="handleWidgetUpdate"
      @show-notification="$emit('show-notification', $event)"
    />
    <template v-if="node.type !== 'label'">
      <!-- Show grabber only when no error and no media/HTML content and no widget content -->
      <svg
        v-if="!error && !hasMediaContent && !hasHtmlContent && !hasContent && !hasWidget"
        class="grabber"
        xmlns="http://www.w3.org/2000/svg"
        width="10"
        height="14"
        viewBox="0 0 10 14"
        fill="none"
      >
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M3.07692 1.81486C3.07692 2.20777 2.91484 2.58459 2.62632 2.86242C2.3378 3.14025 1.94649 3.29634 1.53846 3.29634C1.13044 3.29634 0.739122 3.14025 0.450605 2.86242C0.162087 2.58459 0 2.20777 0 1.81486C0 1.42194 0.162087 1.04512 0.450605 0.76729C0.739122 0.489458 1.13044 0.333374 1.53846 0.333374C1.94649 0.333374 2.3378 0.489458 2.62632 0.76729C2.91484 1.04512 3.07692 1.42194 3.07692 1.81486ZM1.53846 8.48152C1.94649 8.48152 2.3378 8.32544 2.62632 8.04761C2.91484 7.76977 3.07692 7.39295 3.07692 7.00004C3.07692 6.60713 2.91484 6.23031 2.62632 5.95248C2.3378 5.67464 1.94649 5.51856 1.53846 5.51856C1.13044 5.51856 0.739122 5.67464 0.450605 5.95248C0.162087 6.23031 0 6.60713 0 7.00004C0 7.39295 0.162087 7.76977 0.450605 8.04761C0.739122 8.32544 1.13044 8.48152 1.53846 8.48152ZM1.53846 13.6667C1.94649 13.6667 2.3378 13.5106 2.62632 13.2328C2.91484 12.955 3.07692 12.5781 3.07692 12.1852C3.07692 11.7923 2.91484 11.4155 2.62632 11.1377C2.3378 10.8598 1.94649 10.7037 1.53846 10.7037C1.13044 10.7037 0.739122 10.8598 0.450605 11.1377C0.162087 11.4155 0 11.7923 0 12.1852C0 12.5781 0.162087 12.955 0.450605 13.2328C0.739122 13.5106 1.13044 13.6667 1.53846 13.6667ZM10 1.81486C10 2.20777 9.83791 2.58459 9.54939 2.86242C9.26088 3.14025 8.86956 3.29634 8.46154 3.29634C8.05351 3.29634 7.6622 3.14025 7.37368 2.86242C7.08517 2.58459 6.92308 2.20777 6.92308 1.81486C6.92308 1.42194 7.08517 1.04512 7.37368 0.76729C7.6622 0.489458 8.05351 0.333374 8.46154 0.333374C8.86956 0.333374 9.26088 0.489458 9.54939 0.76729C9.83791 1.04512 10 1.42194 10 1.81486ZM8.46154 8.48152C8.86956 8.48152 9.26088 8.32544 9.54939 8.04761C9.83791 7.76977 10 7.39295 10 7.00004C10 6.60713 9.83791 6.23031 9.54939 5.95248C9.26088 5.67464 8.86956 5.51856 8.46154 5.51856C8.05351 5.51856 7.6622 5.67464 7.37368 5.95248C7.08517 6.23031 6.92308 6.60713 6.92308 7.00004C6.92308 7.39295 7.08517 7.76977 7.37368 8.04761C7.6622 8.32544 8.05351 8.48152 8.46154 8.48152ZM8.46154 13.6667C8.86956 13.6667 9.26088 13.5106 9.54939 13.2328C9.83791 12.955 10 12.5781 10 12.1852C10 11.7923 9.83791 11.4155 9.54939 11.1377C9.26088 10.8598 8.86956 10.7037 8.46154 10.7037C8.05351 10.7037 7.6622 10.8598 7.37368 11.1377C7.08517 11.4155 6.92308 11.7923 6.92308 12.1852C6.92308 12.5781 7.08517 12.955 7.37368 13.2328C7.6622 13.5106 8.05351 13.6667 8.46154 13.6667Z"
          fill="#01052A"
          fill-opacity="0.25"
        />
      </svg>

      <!-- Show error only when there's actually an error and no media content -->
      <div v-if="error && !hasMediaContent" class="node-error">
        <i class="fas fa-exclamation-triangle"></i>
      </div>
    </template>
    <template v-if="node.type !== 'label'">
      <div v-if="!node.isTrigger" class="connector input" @mousedown.stop="startConnecting($event, 'input')">
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="6" viewBox="0 0 8 5" fill="none">
          <path d="M1 1.00195L4 4.00195L1 1.00195ZM4 4.00195L7 1.00195L4 4.00195Z" fill="#01052A" />
          <path
            d="M1 1.00195L4 4.00195L7 1.00195"
            stroke="#01052A"
            stroke-opacity="0.5"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <div class="connector output" @mousedown.stop="startConnecting($event, 'output')">
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="6" viewBox="0 0 8 5" fill="none">
          <path d="M1 1.00195L4 4.00195L1 1.00195ZM4 4.00195L7 1.00195L4 4.00195Z" fill="#01052A" />
          <path
            d="M1 1.00195L4 4.00195L7 1.00195"
            stroke="#01052A"
            stroke-opacity="0.5"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </template>

    <!-- Resize handles for widget nodes -->
    <template v-if="hasWidget && !isTinyNodeMode && hasContent">
      <div
        v-for="handle in resizeHandles"
        :key="handle.position"
        :class="['resize-handle', handle.position]"
        @mousedown="startResizing($event, handle.position)"
      ></div>
    </template>

    <div class="node-delete-button" @click.stop="deleteNode">x</div>
  </div>
</template>

<script>
import { inject } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import MediaPreview from '../Widgets/MediaPreview.vue';
import HtmlPreview from '../Widgets/HtmlPreview.vue';
import CodePreview from '../Widgets/CodePreview.vue';
import PdfPreview from '../Widgets/PdfPreview.vue';
import AudioPreview from '../Widgets/AudioPreview/AudioPreview.vue';
import MarkdownPreview from '../Widgets/MarkdownPreview.vue';
import ChartPreview from '../Widgets/ChartPreview.vue';

export default {
  name: 'Node',
  components: {
    SvgIcon,
    MediaPreview,
    HtmlPreview,
    CodePreview,
    PdfPreview,
    AudioPreview,
    MarkdownPreview,
    ChartPreview,
  },
  setup() {
    const playSound = inject('playSound', () => {});
    return { playSound };
  },
  props: {
    node: Object,
    index: Number,
    gridSize: Number,
    zoomLevel: Number,
    isTinyNodeMode: {
      type: Boolean,
      default: false,
    },
    output: Object,
    error: String,
  },
  data() {
    return {
      isResizing: false,
      resizeStartX: 0,
      resizeStartY: 0,
      resizeStartWidth: 0,
      resizeStartHeight: 0,
      resizeHandle: null, // 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'
    };
  },
  watch: {
    node: {
      handler(newNode) {
        this.$emit('update:node', newNode);
      },
      deep: true,
    },
  },
  computed: {
    nodeStyle() {
      const baseStyle = {
        transform: `translate(${this.node.x}px, ${this.node.y}px)`,
        border: this.node.isSelected ? '2px solid var(--color-primary)' : '',
      };

      // Use custom dimensions for ALL resizable widget preview nodes if they exist
      if (
        (this.isMediaPreview ||
          this.isHtmlPreview ||
          this.isCodePreview ||
          this.isPdfPreview ||
          this.isAudioPreview ||
          this.isMarkdownPreview ||
          this.isChartPreview) &&
        this.node.parameters
      ) {
        const customWidth = this.node.parameters.customWidth;
        const customHeight = this.node.parameters.customHeight;

        if (customWidth && customHeight) {
          baseStyle.width = `${customWidth}px`;
          baseStyle.height = `${customHeight}px`;
          return baseStyle;
        }
      }

      // Default dimensions
      baseStyle.width = this.isTinyNodeMode ? '48px' : '288px';

      // Adjust height for ALL widget preview nodes
      if (
        (this.isMediaPreview ||
          this.isHtmlPreview ||
          this.isCodePreview ||
          this.isPdfPreview ||
          this.isAudioPreview ||
          this.isMarkdownPreview ||
          this.isChartPreview) &&
        !this.isTinyNodeMode
      ) {
        baseStyle.height = '288px';
        baseStyle.minHeight = '200px';
      }

      return baseStyle;
    },
    hasWidget() {
      return (
        this.isMediaPreview ||
        this.isHtmlPreview ||
        this.isCodePreview ||
        this.isPdfPreview ||
        this.isAudioPreview ||
        this.isMarkdownPreview ||
        this.isChartPreview
      );
    },
    isMediaPreview() {
      return this.node.type === 'media-preview' || this.node.type === 'image-preview';
    },
    isHtmlPreview() {
      return this.node.type === 'html-preview';
    },
    isCodePreview() {
      return this.node.type === 'code-preview';
    },
    isPdfPreview() {
      return this.node.type === 'pdf-preview';
    },
    isAudioPreview() {
      return this.node.type === 'audio-preview';
    },
    isMarkdownPreview() {
      return this.node.type === 'markdown-preview';
    },
    isChartPreview() {
      return this.node.type === 'chart-preview';
    },
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
      else if (this.node.parameters && this.node.parameters.htmlSource) {
        const paramValue = this.node.parameters.htmlSource;
        if (typeof paramValue === 'string' && !paramValue.includes('{{') && !paramValue.includes('}}')) {
          return paramValue;
        }
      }
      return null;
    },
    sandboxAttributes() {
      const sandboxMode = this.node.parameters?.sandboxMode || 'Strict';

      if (sandboxMode === 'Strict') {
        // Most restrictive - blocks scripts and forms
        return 'allow-same-origin';
      } else if (sandboxMode === 'Allow Scripts') {
        // Allow scripts but still sandbox
        return 'allow-scripts allow-same-origin';
      } else {
        // Full Access - minimal restrictions
        return 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';
      }
    },
    hasMediaContent() {
      // This is now handled by MediaPreview widget, but we keep this computed
      // property for template compatibility (checks if media preview widget is active)
      return this.isMediaPreview;
    },
    hasHtmlContent() {
      return this.isHtmlPreview && this.htmlPreviewContent;
    },
    resizeHandles() {
      return [{ position: 'nw' }, { position: 'ne' }, { position: 'sw' }, { position: 'se' }];
    },
    hasContent() {
      // Check if any widget has content
      if (this.isMediaPreview) {
        return !!(
          (this.output && (this.output.mediaUrl || this.output.imageUrl || this.output.base64Data)) ||
          (this.output && this.output.result && (this.output.result.mediaUrl || this.output.result.imageUrl || this.output.result.base64Data)) ||
          this.node.parameters?.mediaSource
        );
      }
      if (this.isHtmlPreview) {
        return !!this.htmlPreviewContent;
      }
      if (this.isCodePreview) {
        return !!(
          (this.output && this.output.codeContent) ||
          (this.output && this.output.result && this.output.result.codeContent) ||
          (this.node.parameters?.codeSource && typeof this.node.parameters.codeSource === 'string')
        );
      }
      if (this.isPdfPreview) {
        return !!(
          (this.output && this.output.pdfUrl) ||
          (this.output && this.output.result && this.output.result.pdfUrl) ||
          (this.node.parameters?.pdfSource && !this.node.parameters.pdfSource.includes('{{'))
        );
      }
      if (this.isAudioPreview) {
        return !!(
          (this.output && this.output.audioUrl) ||
          (this.output && this.output.result && this.output.result.audioUrl) ||
          (this.node.parameters?.audioSource && !this.node.parameters.audioSource.includes('{{'))
        );
      }
      if (this.isMarkdownPreview) {
        return !!(
          (this.output && this.output.markdownContent) ||
          (this.output && this.output.result && this.output.result.markdownContent) ||
          (this.node.parameters?.markdownSource && !this.node.parameters.markdownSource.includes('{{'))
        );
      }
      if (this.isChartPreview) {
        return !!(
          (this.output && this.output.chartData) ||
          (this.output && this.output.result && this.output.result.chartData) ||
          this.node.parameters?.chartData
        );
      }
      return false;
    },
  },
  methods: {
    handleNodeKeydown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.finishEditing();
      }
    },
    selectNode() {
      this.$emit('select-node', this.index);
      this.$emit('node-selected', { ...this.node });
    },
    startDragging(e) {
      this.playSound('buttonClick');
      if (e.target.classList.contains('connector')) return;
      this.$emit('start-dragging', e, this.index);
    },
    startEditing() {
      this.$emit('start-editing', this.index);
    },
    finishEditing() {
      const nodeContent = this.$el.querySelector('.node-content');
      const content = nodeContent.textContent.trim();
      this.$emit('finish-editing', this.index, content);
    },
    adjustNodeSize(event) {
      // Implement node size adjustment logic here if needed
      this.$emit('adjust-node-size', this.index, event);
    },
    startConnecting(e, type) {
      this.$emit('start-connecting', e, this.node.id, type);
    },
    deleteNode() {
      this.$emit('delete-node', this.index);
    },

    // Handle widget content updates
    handleWidgetUpdate(event) {
      // Forward the widget update event to the parent
      this.$emit('update-node-parameter', event);
    },

    // Resize methods for HTML preview nodes
    startResizing(e, handle) {
      e.preventDefault();
      e.stopPropagation();

      this.isResizing = true;
      this.resizeHandle = handle;

      // Get current node dimensions
      const nodeRect = this.$el.getBoundingClientRect();
      this.resizeStartWidth = nodeRect.width;
      this.resizeStartHeight = nodeRect.height;
      this.resizeStartX = e.clientX;
      this.resizeStartY = e.clientY;

      // Add global event listeners
      document.addEventListener('mousemove', this.performResize);
      document.addEventListener('mouseup', this.stopResizing);

      // Prevent text selection during resize
      document.body.classList.add('no-select');
    },

    performResize(e) {
      if (!this.isResizing) return;

      const deltaX = e.clientX - this.resizeStartX;
      const deltaY = e.clientY - this.resizeStartY;

      let newWidth = this.resizeStartWidth;
      let newHeight = this.resizeStartHeight;

      // Calculate new dimensions based on handle position
      switch (this.resizeHandle) {
        case 'se': // Bottom-right corner
          newWidth = this.resizeStartWidth + deltaX;
          newHeight = this.resizeStartHeight + deltaY;
          break;
        case 'sw': // Bottom-left corner
          newWidth = this.resizeStartWidth - deltaX;
          newHeight = this.resizeStartHeight + deltaY;
          break;
        case 'ne': // Top-right corner
          newWidth = this.resizeStartWidth + deltaX;
          newHeight = this.resizeStartHeight - deltaY;
          break;
        case 'nw': // Top-left corner
          newWidth = this.resizeStartWidth - deltaX;
          newHeight = this.resizeStartHeight - deltaY;
          break;
      }

      // Set minimum dimensions
      const minWidth = 200;
      const minHeight = 200;
      newWidth = Math.max(newWidth, minWidth);
      newHeight = Math.max(newHeight, minHeight);

      // Snap to grid
      const gridSize = this.gridSize || 16;
      newWidth = Math.round(newWidth / gridSize) * gridSize;
      newHeight = Math.round(newHeight / gridSize) * gridSize;

      // Update node parameters with custom dimensions
      this.$emit('update-node-parameter', {
        nodeId: this.node.id,
        parameters: {
          customWidth: newWidth,
          customHeight: newHeight,
        },
      });
    },

    stopResizing() {
      if (!this.isResizing) return;

      this.isResizing = false;
      this.resizeHandle = null;

      // Remove event listeners
      document.removeEventListener('mousemove', this.performResize);
      document.removeEventListener('mouseup', this.stopResizing);

      // Restore text selection
      document.body.classList.remove('no-select');
    },
  },
  beforeUnmount() {
    // Clean up resize event listeners if still active
    if (this.isResizing) {
      document.removeEventListener('mousemove', this.performResize);
      document.removeEventListener('mouseup', this.stopResizing);
      document.body.classList.remove('no-select');
    }
  },
};
</script>

<style scoped>
.node {
  position: absolute;
  width: 288px;
  height: 48px;
  margin: auto;
  border-radius: 8px;
  border: 1px solid rgba(1, 5, 42, 0.25);
  background: var(--color-dull-white);
  color: var(--Dark-Navy, #01052a);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  cursor: move;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  box-sizing: border-box;
  z-index: 2;
  margin: auto;
  text-align: center;
  transition: width 0.25s ease, stroke 0.25s ease;
  will-change: stroke, d;
  backdrop-filter: blur(4px);
}

.node::after {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border: 2px solid transparent;
  border-radius: 8px;
  z-index: -1;
  pointer-events: none;
  transition: border-color 0.25s ease;
}

.node.trigger::after {
  border-radius: 32px;
}

.node.selected::after {
  border-color: var(--color-primary);
}

.node.selected {
  border: 3px solid var(--color-primary) !important;
  /* border: none !important; */
  /* transition: none; */
  animation: none !important;
}

.node.trigger {
  border-radius: 32px;
}

.node.trigger .input {
  display: none;
  user-select: none;
}

.node-content {
  display: flex;
  align-content: center;
  align-items: center;
  justify-content: center;
  flex-direction: row;
  flex-wrap: nowrap;
  width: -webkit-fill-available;
  padding: 10px;
  transition: opacity 0.35s ease, transform 0.35s ease, visibility 0.35s ease;
  opacity: 1;
  transform: scale(1);
  visibility: visible;
  white-space: nowrap;
  text-wrap: nowrap;
}

.node svg.grabber {
  transition: opacity 0.35s ease, transform 0.35s ease, visibility 0.35s ease;
  opacity: 1;
  transform: scale(1);
  visibility: visible;
}

.node-icon {
  display: flex;
}

.node-content[contenteditable='true'] {
  cursor: text;
  user-select: text;
  outline: 2px solid #01052a25;
  border-radius: 6px;
}

.node-content:focus {
  outline: none;
}

.node.label-node {
  font-size: larger;
  font-weight: 600;
  line-height: 120%;
  background: transparent;
  border: none;
}

.node.label-node:hover {
  background: transparent;
  border: none;
}

.node-delete-button {
  position: absolute;
  top: -10px;
  right: -15px;
  width: 12px;
  height: 12px;
  border: none;
  background: transparent;
  color: var(--Dark-Navy, #01052a75);
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  font-size: 20px;
  font-weight: 400;
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
}

.node:hover .node-delete-button {
  opacity: 1;
}

.node-delete-button:hover {
  color: var(--color-primary);
  transform: scale(1.2);
}

.label-node {
  justify-content: center;
  background: transparent;
  border: none;
  box-shadow: none;
}

.node.starter.label {
  justify-content: center;
}

.label-node .node-content {
  padding: 5px;
  min-width: 50px;
  min-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
}

.label-node:hover {
  background: rgba(0, 0, 0, 0.05);
}

.label-node:focus-within {
  background: rgba(0, 0, 0, 0.1);
}

.connector {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(1, 5, 42, 0.25);
  background: var(--color-white);
  color: var(--Dark-Navy, #01052a);
  border-radius: 50%;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  align-content: center;
  flex-direction: row;
  opacity: 0;
  transition: 0.15s ease-in-out;
}

.node:hover .connector {
  opacity: 1;
}

.connector:hover {
  transform: translateY(-50%) scale(1.2);
  border: 1px solid rgba(1, 5, 42, 0.5);
}

.connector svg {
  transform: rotate(270deg);
}

.input {
  left: -8px;
}

.output {
  right: -8px;
}

/* IF TINY NODES ENABLED */
.node.tiny-node .node-content {
  /* display: none; */
  width: 0;
  padding: 0;
  opacity: 0;
  transform: scale(0);
  pointer-events: none;
}

/* .node.tiny-node.label-node .node-content {
      display: block;
  } */

.node.tiny-node .node-icon {
  padding: 16px;
  transform: scale(1);
}

.node.tiny-node.label-node .node-content {
  width: initial;
  padding: initial;
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

.node.tiny-node svg.grabber {
  display: none;
  opacity: 0;
  transform: scale(0.5);
  pointer-events: none;
}

.node.tiny-node {
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  padding: 0;
  text-align: center;
  align-content: center;
  transition: width 0.5s ease, height 0.5s ease, padding 0.5s ease;
}

.node.tiny-node .node-content,
.node.tiny-node svg.grabber {
  transition: opacity 0.5s ease, transform 0.5s ease, visibility 0s linear 0.5s;
  opacity: 0;
  transform: scale(0.5);
  visibility: hidden;
}

.node.tiny-node.label-node {
  width: 272px !important;
}

.node.tiny-node.label-node .node-content {
  opacity: 1;
  transform: scale(1);
  visibility: initial;
}

.node.tiny-node .connector {
  width: 14px;
  height: 14px;
}

.node.tiny-node .connector svg {
  transform: rotate(270deg) scale(0.75);
}

.node.has-output {
  /* border: 2px solid #14FF89; */
  border: 3px solid var(--color-green);
}

body.dark .node.has-output {
  border: 3px solid var(--color-green);
  /* border: 2px solid var(--color-blue); */
}

.node.has-error {
  border: 2px solid var(--color-red);
  /* color: #FE4E4E; */
  animation: breathe 1.25s ease-in-out infinite;
  border-color: var(--color-red);
}

body.dark .node.has-error.has-output {
  border: 2px solid var(--color-red);
  border-color: var(--color-red);
}

/* .node.has-error.selected::after {
    border-color: #FE4E4E;
  } */

.node-error {
  color: var(--color-red);
  font-family: var(--font-family-mono);
  font-size: 0.8em;
  margin-right: 0;
}

.node.tiny-node .node-error {
  display: none;
}

/* Adjust media preview nodes layout */
.node.media-preview,
.node.image-preview {
  flex-direction: column;
  align-items: stretch;
  padding: 12px;
}

.node.media-preview .node-icon,
.node.image-preview .node-icon {
  align-self: flex-start;
  margin-bottom: 8px;
}

/* When media content is present, adjust layout */
.node.has-media-content {
  justify-content: center;
  align-items: center;
  padding: 8px;
}

/* HTML Preview Styles */
.html-preview-container {
  width: 100%;
  height: 100%;
  min-height: 128px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
  /* margin: 0 16px; */
  /* background: #ffffff; */
}

/* When no HTML is loaded, use fixed height */
/* .node:not(.has-html-content) .html-preview-container {
  height: 200px;
} */

.html-preview {
  width: 100%;
  height: 100%;
  border: none;
  /* border-radius: 4px; */
  /* background: #ffffff; */
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

/* Adjust HTML preview nodes layout */
.node.html-preview {
  flex-direction: column;
  align-items: stretch;
  padding: 12px;
}

.node.html-preview .node-icon {
  align-self: flex-start;
  margin-bottom: 8px;
}

/* When HTML content is present, adjust layout */
.node.has-html-content {
  justify-content: center;
  align-items: center;
  padding: 8px;
}

.node.has-html-content .html-preview-container {
  margin: 0;
}

/* Hide HTML preview in tiny node mode */
.node.tiny-node .html-preview-container {
  display: none;
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

.html-preview-container.drag-hover .html-placeholder span {
  color: var(--color-blue);
  font-weight: 600;
}

/* Prevent dragging interference with existing HTML */
.html-preview-container.drag-hover .html-preview {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}

/* Resize Handle Styles */
.resize-handle {
  position: absolute;
  width: 6px;
  height: 6px;
  background: var(--color-text);
  border: 2px solid var(--terminal-border-color);
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.1s ease;
  z-index: 10;
}

.resize-handle:hover {
  transform: scale(1.2);
  background: var(--color-primary);
}

.node:hover .resize-handle {
  opacity: 1;
}

.resize-handle.nw {
  top: -6px;
  left: -6px;
  cursor: nw-resize;
}

.resize-handle.ne {
  top: -6px;
  right: -6px;
  cursor: ne-resize;
}

.resize-handle.sw {
  bottom: -6px;
  left: -6px;
  cursor: sw-resize;
}

.resize-handle.se {
  bottom: -6px;
  right: -6px;
  cursor: se-resize;
}

/* Prevent resize handles from interfering with other interactions */
.resize-handle:active {
  transform: scale(1.1);
}

/* CODE PREVIEW NODE */
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

.node.no-select.code-preview {
  padding: 8px;
}

/* CHART PREVIEW */
.node.no-select.chart-preview {
  padding: 8px;
}

/* PDF PREVIEW */
.node.no-select.pdf-preview {
  padding: 8px;
}
</style>
