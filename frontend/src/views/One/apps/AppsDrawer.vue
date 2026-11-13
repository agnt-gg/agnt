<template>
  <!-- At body level: an ancestor with a filter or transform would otherwise become the
       containing block of this fixed layer and move it (one.css, on backdrop-filter). -->
  <Teleport to="body">
    <div class="za">
      <div class="za-layer" data-testid="apps-drawer">
        <div class="scrim" @click="emit('close')"></div>
        <aside class="drawer" role="dialog" aria-modal="true" :aria-label="title">
          <div class="dr-head">
            <slot name="logo" />
            <div class="dr-title">
              <h2 class="ellipsis">{{ title }}</h2>
              <div v-if="$slots.sub" class="sub-line"><slot name="sub" /></div>
            </div>
            <button type="button" class="icon-btn" aria-label="Close" data-action="close" @click="emit('close')"><AppsGlyph name="x" /></button>
          </div>
          <div class="dr-body"><slot /></div>
          <div v-if="$slots.foot" class="dr-foot"><slot name="foot" /></div>
        </aside>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
// The side panel a row opens: a title, its details, and its actions along the foot.
import AppsGlyph from './AppsGlyph.vue';

defineProps({ title: { type: String, required: true } });
const emit = defineEmits(['close']);
</script>
