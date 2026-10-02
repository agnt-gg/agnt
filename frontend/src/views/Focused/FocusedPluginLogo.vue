<template>
  <!-- The brand's own colored mark, on a light tile so dark marks (GitHub, X)
       read in every theme, as in the AGNT One demo. -->
  <span v-if="src && !failed" class="focused-plugin-logo" aria-hidden="true">
    <img :src="src" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failed = true" />
  </span>
  <!-- No brand mark (unknown to Simple Icons, or offline): the app's icon,
       tinted with a color of its own so cards never blend together. -->
  <span v-else class="focused-plugin-logo fallback" :style="tint" aria-hidden="true">
    <SvgIcon v-if="icon" :name="icon" />
    <template v-else>{{ initialOf(name) }}</template>
  </span>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { logoUrl, brandHue, brandColor, initialOf } from './focusedModel.js';

const props = defineProps({
  providerId: { type: String, required: true },
  name: { type: String, default: '' },
  icon: { type: String, default: '' },
});

const failed = ref(false);
const src = computed(() => logoUrl(props.providerId));
watch(src, () => (failed.value = false));

// The brand's own color when known (its logo shape in its color), else a
// stable hue from the name.
const tint = computed(() => {
  const brand = brandColor(props.providerId);
  if (brand) return { '--logo-fg': brand, '--logo-bg': `color-mix(in srgb, ${brand} 16%, transparent)` };
  const h = brandHue(props.name || props.providerId);
  return { '--logo-fg': `hsl(${h} 70% 60%)`, '--logo-bg': `hsl(${h} 70% 60% / 0.14)` };
});
</script>
