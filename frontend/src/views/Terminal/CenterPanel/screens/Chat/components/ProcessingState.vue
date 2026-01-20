<template>
  <div class="processing-state">
    <div class="processing-animation">
      <div class="wave"></div>
      <div class="wave"></div>
      <div class="wave"></div>
    </div>
    <span class="processing-text">{{ text }}</span>
  </div>
</template>

<script>
export default {
  name: 'ProcessingState',
  props: {
    text: {
      type: String,
      default: 'Agent is working...'
    }
  }
}
</script>

<style scoped>
.processing-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px;
}

.processing-animation {
  display: flex;
  gap: 8px;
}

.wave {
  width: 4px;
  height: 20px;
  background: linear-gradient(
    to top,
    rgba(18, 224, 255, 0.4) 0%,
    rgba(18, 224, 255, 0.8) 100%
  );
  border-radius: 2px;
  animation: wave-motion 1.2s ease-in-out infinite;
}

.wave:nth-child(2) {
  animation-delay: 0.1s;
}
.wave:nth-child(3) {
  animation-delay: 0.2s;
}

@keyframes wave-motion {
  0%,
  100% {
    transform: scaleY(0.5);
    opacity: 0.4;
  }
  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

.processing-text {
  font-size: 0.85em;
  color: var(--color-med-navy);
  font-weight: 300;
}
</style> 