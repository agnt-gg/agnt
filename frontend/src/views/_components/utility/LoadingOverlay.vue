<template>
  <div class="loading-overlay">
    <div class="loader"></div>
  </div>
</template>

<script>
export default {
  name: "LoadingOverlay",
};
</script>

<style scoped>
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

body.dark .loading-overlay {
  background: rgba(0, 0, 0, 0.8);
}

.loader {
  width: 40px;
  height: 40px;
  border: 4px solid var(--color-light-navy);
  border-top: 4px solid var(--color-pink);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

body.dark .loader {
  border: 4px solid var(--color-dull-navy);
  border-top: 4px solid var(--color-green);
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
