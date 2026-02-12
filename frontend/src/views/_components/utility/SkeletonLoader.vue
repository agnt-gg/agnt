<template>
  <div class="skeleton-loader" :style="containerStyle">
    <div
      v-for="i in lines"
      :key="i"
      class="skeleton-line"
      :style="getLineStyle(i)"
    />
  </div>
</template>

<script>
export default {
  name: 'SkeletonLoader',
  props: {
    lines: {
      type: Number,
      default: 3,
    },
    height: {
      type: String,
      default: '12px',
    },
    gap: {
      type: String,
      default: '10px',
    },
    rounded: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const containerStyle = {
      gap: props.gap,
    };

    const getLineStyle = (index) => ({
      height: props.height,
      width: index === props.lines ? '60%' : '100%',
      borderRadius: props.rounded ? '8px' : '4px',
    });

    return { containerStyle, getLineStyle };
  },
};
</script>

<style scoped>
.skeleton-loader {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.skeleton-line {
  background: linear-gradient(
    90deg,
    var(--terminal-lighten-color, rgba(255, 255, 255, 0.04)) 25%,
    rgba(255, 255, 255, 0.08) 50%,
    var(--terminal-lighten-color, rgba(255, 255, 255, 0.04)) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
