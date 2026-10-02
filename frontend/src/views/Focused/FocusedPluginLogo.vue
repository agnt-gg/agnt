<template>
  <!-- The brand's own colored mark, on no background. -->
  <span v-if="src && !failed" class="focused-plugin-logo" aria-hidden="true">
    <img :src="src" alt="" loading="lazy" referrerpolicy="no-referrer" :class="tone" @error="failed = true" />
  </span>
  <!-- No brand mark (unknown to Simple Icons, or offline): the app's icon in
       the brand's color, or a color of its own, also on no background. -->
  <span v-else class="focused-plugin-logo fallback" :style="tint" aria-hidden="true">
    <SvgIcon v-if="icon" :name="icon" />
    <template v-else>{{ initialOf(name) }}</template>
  </span>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { logoUrl, logoTone, brandHue, brandColor, initialOf } from './focusedModel.js';

const props = defineProps({
  providerId: { type: String, required: true },
  name: { type: String, default: '' },
  icon: { type: String, default: '' },
});

const failed = ref(false);
const src = computed(() => logoUrl(props.providerId));
const tone = computed(() => logoTone(props.providerId));
watch(src, () => (failed.value = false));

// The brand's own color when known (its logo shape in its color), else a
// stable hue from the name.
const tint = computed(() => {
  const brand = brandColor(props.providerId);
  if (brand) return { '--logo-fg': brand };
  return { '--logo-fg': `hsl(${brandHue(props.name || props.providerId)} 70% 60%)` };
});
</script>
