<template>
  <RouterView />
  <!-- At the root, not inside the signed-in shell: on Windows an update installs
       only when the user clicks "Restart to update", and a banner that exists
       only after sign-in left a signed-out user with no way to install one.
       Found in the update rehearsal (a fresh install opens on the sign-in page). -->
  <UpdateNotification />
  <AIGuidedTourHost v-if="isAuthenticated" />
  <!-- One share sheet and one receive card for the whole app; see composables/useShare.js. -->
  <ShareSheet v-if="isAuthenticated" />
  <ReceiveShareDialog v-if="isAuthenticated" />
</template>

<script setup>
import { RouterView } from 'vue-router';
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useRealtimeSync } from '@/composables/useRealtimeSync';
import AIGuidedTourHost from '@/views/_components/utility/AIGuidedTourHost.vue';
import UpdateNotification from '@/views/_components/common/UpdateNotification.vue';
import ShareSheet from '@/views/_components/share/ShareSheet.vue';
import ReceiveShareDialog from '@/views/_components/share/ReceiveShareDialog.vue';

const store = useStore();
const isAuthenticated = computed(() => store.getters['userAuth/isAuthenticated'] === true);

// Initialize real-time sync (connects on mount, disconnects on unmount)
const { isConnected } = useRealtimeSync();
</script>

<style scoped></style>
