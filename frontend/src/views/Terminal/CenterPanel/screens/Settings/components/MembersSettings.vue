<template>
  <section class="members-settings" aria-label="Members">
    <div class="members-heading"><h1>Members</h1><p>Manage team access, invitations and roles.</p></div>
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
.members-heading { margin-bottom: 20px; }
.members-heading h1 { margin: 0; color: var(--text-primary); font-size: 26px; font-weight: 600; }
.members-heading p { margin: 7px 0 0; color: var(--text-secondary); font-size: 14px; }
</style>
