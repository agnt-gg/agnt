<template>
  <div class="suggestions-bar" v-if="suggestions.length" :class="{ loading: isLoading }">
    <div class="suggestions-container">
      <TransitionGroup name="suggestion" tag="div" class="suggestions-grid">
        <button v-for="suggestion in suggestions" :key="suggestion.id" class="suggestion-card" @click="$emit('execute', suggestion)">
          <span class="suggestion-icon">{{ suggestion.icon }}</span>
          <span class="suggestion-text"><span class="suggestion-text-inner">{{ suggestion.text }}</span></span>
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
  gap: 12px;
  flex-wrap: nowrap;
  overflow-x: auto;
  justify-content: safe center;
  scrollbar-width: thin;
  padding-bottom: 2px;
}

.suggestion-card {
  position: relative;
  display: flex;
  flex-shrink: 0;
  width: auto;
  max-width: 280px;
  align-items: center;
  gap: 10px;
  padding: 7px 16px 8px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  border-radius: 24px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  justify-content: flex-start;
}

.suggestion-icon {
  font-size: var(--font-size-xs);
  flex-shrink: 0;
}

.suggestion-text {
  flex: 1;
  min-width: 0;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  container-type: inline-size;
  position: relative;
  font-weight: 300;
}

.suggestion-text-inner {
  display: inline-block;
  transition: transform 0.3s ease;
}

.suggestion-card:hover .suggestion-text-inner {
  /* Container query trick: if the text fits, 100cqw - 100% is positive,
     min() clamps to 0 (no movement). If it overflows, the value is
     negative and the text slides left to reveal the end on hover. */
  transition: transform 4s linear;
  transform: translateX(min(0px, calc(100cqw - 100%)));
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
    /* Stay single-row on mobile too — pills scroll horizontally via overflow-x. */
    justify-content: flex-start;
  }
}
</style>
