<template>
  <CoachMark :view="view" @action="handleAction" @prompt="usePrompt" @close="handleAction('close')" />
  <JourneyChecklist />
</template>

<script setup>
/**
 * Mounts the journey once for the signed-in app (App.vue): the coach card for
 * missions and offers, and the getting-started checklist.
 */
import { onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from 'vuex';
import CoachMark from '@/views/_components/utility/CoachMark.vue';
import JourneyChecklist from '@/views/_components/utility/JourneyChecklist.vue';
import { installJourney, useJourney } from '@/composables/useJourney.js';

const store = useStore();
const router = useRouter();
const { view, handleAction, usePrompt } = useJourney();

let uninstall = null;
onMounted(() => {
  uninstall = installJourney({ store, router });
});
onBeforeUnmount(() => uninstall?.());
</script>
