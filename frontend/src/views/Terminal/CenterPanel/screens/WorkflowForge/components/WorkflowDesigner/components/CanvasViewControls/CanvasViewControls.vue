<template>
  <div class="canvas-view-controls">
    <Tooltip :text="isTinyNodeMode ? 'Disable Tiny Node Mode' : 'Enable Tiny Node Mode'" width="auto">
      <button @click="toggleTinyNodeMode" :class="{ active: isTinyNodeMode }">
        <i :class="['fas', isTinyNodeMode ? 'fa-expand' : 'fa-compress']"></i>
      </button>
    </Tooltip>
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'CanvasViewControls',
  components: {
    Tooltip,
  },
  props: {
    isTinyNodeMode: {
      type: Boolean,
      default: false,
    },
  },
  methods: {
    toggleTinyNodeMode() {
      this.$emit('toggle-tiny-node-mode');
    },
  },
};
</script>

<style scoped>
.canvas-view-controls {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 9;
}

.canvas-view-controls button {
  border: 1px solid var(--terminal-border-color);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  opacity: 0.5;
}

.canvas-view-controls button:hover {
  opacity: 1;
  transform: scale(1.05);
}

.canvas-view-controls button i {
  font-size: 16px;
}
</style>
