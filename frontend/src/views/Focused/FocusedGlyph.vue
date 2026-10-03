<template>
  <img v-if="kind === 'image' && !imageFailed" :src="icon" alt="" @error="imageFailed = true" />
  <i v-else-if="kind === 'image'" :class="fallback" aria-hidden="true"></i>
  <i v-else-if="kind === 'class'" :class="icon" aria-hidden="true"></i>
  <SvgIcon v-else-if="kind === 'name'" :name="icon" />
  <template v-else-if="kind === 'text'">{{ icon }}</template>
  <i v-else :class="fallback" aria-hidden="true"></i>
</template>

<script setup>
// An item's icon, whatever form it was saved in. Agents store any of three:
// a Font Awesome class list ("fas fa-robot"), a name in the app's icon set
// ("user-check", drawn by SvgIcon as Studio does), or an emoji. Rendering a
// name as text showed the literal word "user-check" in the icon box.
import { computed, ref, watch } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { glyphKind } from './focusedModel.js';

const props = defineProps({
  icon: { type: String, default: '' },
  fallback: { type: String, default: 'fas fa-cube' },
});
const kind = computed(() => glyphKind(props.icon));
const imageFailed = ref(false);
watch(() => props.icon, () => { imageFailed.value = false; });
</script>
