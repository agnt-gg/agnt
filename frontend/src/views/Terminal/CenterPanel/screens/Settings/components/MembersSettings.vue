<template>
  <!-- The page header is Settings' own content-header (Settings.vue), like
       every other section; this is only the section's body. -->
  <section class="members-settings" aria-label="Members">
    <TeamWorkspace
      :selected-team-id="selectedTeamId"
      initial-tab="Members"
      :hide-scope-selector="true"
      @update:selected-team-id="selectedTeamId = $event"
      @teams-loaded="refreshSpaces"
      @open-billing="$emit('open-billing')"
      @close="$emit('close')"
    />
  </section>
</template>
<script setup>
import { ref } from 'vue';
import TeamWorkspace from '@/views/_components/one/TeamWorkspace.vue';
import { currentTeamScope } from '@/composables/useSpaces.js';
defineEmits(['open-billing', 'close']);
const selectedTeamId = ref(currentTeamScope()?.teamId || '');
// The toolbar keeps its space list current without making Settings own space switching.
function refreshSpaces() { window.dispatchEvent(new CustomEvent('agnt:team-membership-changed')); }
</script>
<style scoped>
/* Settings' column is the width; the team views' own 980px cap is for their
   standalone panel, not for a page that already has one. */
.members-settings { width: 100%; }
.members-settings :deep(.team-body) { max-width: none; }
</style>
