<template>
  <form class="base-form" @submit.prevent="$emit('submit')">
    <slot></slot>
  </form>
</template>

<script>
export default {
  name: 'BaseForm',
  emits: ['submit'],
};
</script>

<style scoped>
.base-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
