<template>
  <Tooltip :text="tooltipText" :width="tooltipWidth">
    <button
      type="button"
      class="chat-stop-button"
      :class="`chat-stop-button--${variant}`"
      @click="$emit('click', $event)"
    >
      <i class="fas fa-stop"></i>
    </button>
  </Tooltip>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ChatStopButton',
  components: { Tooltip },
  emits: ['click'],
  props: {
    tooltipText: {
      type: String,
      default: 'Stop generating',
    },
    tooltipWidth: {
      type: String,
      default: 'auto',
    },
    variant: {
      type: String,
      default: 'pill',
      validator: (v) => ['pill', 'circle'].includes(v),
    },
  },
};
</script>

<style scoped>
.chat-stop-button {
  border: none;
  background: transparent;
  color: var(--color-red);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
  animation: chat-stop-pulse 2s ease-in-out infinite;
}

.chat-stop-button--pill {
  min-width: 40px;
  height: 40px;
  border-radius: 20px;
}

.chat-stop-button--circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  margin-left: 8px;
}

.chat-stop-button:hover {
  background: rgba(var(--red-rgb), 0.15);
  transform: scale(1.05);
}

@keyframes chat-stop-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
