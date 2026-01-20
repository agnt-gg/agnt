<template>
  <div class="suggestions-bar" v-if="suggestions.length" :class="{ loading: isLoading }">
    <div class="suggestions-container">
      <TransitionGroup name="suggestion" tag="div" class="suggestions-grid">
        <button v-for="suggestion in suggestions" :key="suggestion.id" class="suggestion-card" @click="$emit('execute', suggestion)">
          <span class="suggestion-icon">{{ suggestion.icon }}</span>
          <span class="suggestion-text">{{ suggestion.text }}</span>
          <div class="suggestion-glow"></div>
        </button>
      </TransitionGroup>
    </div>
  </div>
</template>

<script>
export default {
  name: 'QuickActions',
  props: {
    suggestions: {
      type: Array,
      required: true,
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['execute'],
};
</script>

<style scoped>
.suggestions-bar {
  padding: 8px;
  border-top: 1px solid var(--terminal-border-color);
  padding-right: 96px;
}

.suggestions-container {
  max-width: 100%;
  margin: 0 auto;
}

.suggestions-grid {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.suggestion-card {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 7px 16px 8px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  border-radius: 24px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  justify-content: center;
}

.suggestion-icon {
  font-size: var(--font-size-xs);
}

.suggestion-text {
  font-weight: 300;
}

.suggestions-bar.loading {
  opacity: 0.7;
}

.suggestions-grid.loading .suggestion-card {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

.suggestion-enter-active {
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

.suggestion-leave-active {
  transition: opacity 0.3s ease-in, transform 0.3s ease-in;
  position: absolute;
}

.suggestion-enter-from {
  opacity: 0;
  transform: translateY(15px);
}

.suggestion-leave-to {
  opacity: 0;
  transform: translateY(15px);
}

.suggestion-move {
  transition: transform 0.3s ease-in-out;
}

@media (max-width: 768px) {
  .suggestions-grid {
    flex-wrap: wrap;
  }
}
</style>
