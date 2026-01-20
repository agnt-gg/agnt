<template>
  <div class="ui-panel">
    <p>Default Panel</p>
  </div>
</template>

<script>
export default {
  name: "DefaultPanel",
  emits: ["panel-action"],
  setup() {
    return {};
  },
};
</script>

<style scoped>
.ui-panel {
  display: flex;
  flex-direction: column;
  gap: 15px;
  width: 100%;
  flex-shrink: 0;
  position: relative;
  z-index: 3;
}
</style>
