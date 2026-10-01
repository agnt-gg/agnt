<template>
  <section class="simple-page" :aria-label="title">
    <header class="simple-page-head">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ sub }}</p>
      </div>
      <button v-if="actionLabel" type="button" class="simple-primary" @click="$emit('action')">
        <i class="fas fa-plus" aria-hidden="true"></i>{{ actionLabel }}
      </button>
    </header>
    <slot name="tabs" />
    <label class="simple-page-search">
      <i class="fas fa-search" aria-hidden="true"></i>
      <input :value="query" type="search" :placeholder="searchPlaceholder" :aria-label="searchPlaceholder" @input="$emit('update:query', $event.target.value)" />
    </label>
    <slot />
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  sub: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
  query: { type: String, default: '' },
  searchPlaceholder: { type: String, default: 'Search' },
});
defineEmits(['action', 'update:query']);
</script>
