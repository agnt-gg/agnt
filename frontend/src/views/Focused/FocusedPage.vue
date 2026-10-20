<template>
  <section class="focused-page" :aria-label="title">
    <header class="focused-page-head">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ sub }}</p>
      </div>
      <!-- Quiet when the page body offers the lead action itself (an empty
           list offering "Ask Annie"): one page, one primary button. -->
      <button v-if="actionLabel" type="button" :class="actionQuiet ? 'focused-btn' : 'focused-primary'" data-action="page-action" @click="$emit('action')">
        <i class="fas fa-plus" aria-hidden="true"></i>{{ actionLabel }}
      </button>
    </header>
    <slot name="tabs" />
    <label v-if="searchable" class="focused-page-search">
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
  actionQuiet: Boolean,
  /** Off when there is nothing to search ("Search 0 agents" was a dead control). */
  searchable: { type: Boolean, default: true },
});
defineEmits(['action', 'update:query']);
</script>
