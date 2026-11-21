<template>
  <!-- The sign-in's brand mark: the same shipped icon every other list draws (services/brandIcons). -->
  <span class="focused-connector-logo" aria-hidden="true"><SvgIcon :name="brandIcon(providerId, icon)" /></span>
</template>

<script setup>
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { brandIcon } from '@/services/brandIcons.js';

defineProps({
  providerId: { type: String, required: true },
  icon: { type: String, default: '' },
});
</script>
