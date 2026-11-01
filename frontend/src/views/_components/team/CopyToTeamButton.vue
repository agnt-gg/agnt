<template>
  <!-- "Visible to" for a personal item: the same control as on team cards, agents and routines.
       A personal item stays yours (Only you); choosing a teamspace sends it a COPY, through the
       Copy to team dialog, which shows what goes with it and strips credentials first. -->
  <template v-if="!inTeamSpace && id">
    <div class="visible-to-field">
      <span class="visible-to-label">Visible to</span>
      <VisibleToSelect :model-value="PRIVATE_SCOPE" :options="options" :disabled="options.length < 2" @change="choose" />
      <p v-if="copiedTo.length" class="copy-to-team-note">
        Copies in {{ copiedTo.join(', ') }}.<template v-if="staleLink"> Changed since you copied it: pick that teamspace to update it.</template>
      </p>
      <p v-else-if="loaded && options.length < 2" class="copy-to-team-note">Join a team to share it with a teamspace.</p>
    </div>

    <Teleport to="body">
      <div v-if="target" class="copy-dialog-scrim" @click.self="close">
        <section class="copy-dialog team-panel" role="dialog" aria-modal="true" :aria-label="'Copy ' + name + ' to a team'">
          <header>
            <h2>Copy to {{ target.label }}</h2>
            <button class="icon" aria-label="Close" @click="close"><i class="fas fa-times"></i></button>
          </header>
          <TeamShareTab :kind="kind" :id="id" :name="name" :preset-team-id="target.teamId" :preset-project-id="target.projectId" :project-name="target.projectName" @close="close" @copied="loadLinks" />
        </section>
      </div>
    </Teleport>
  </template>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import TeamShareTab from '@/views/_components/team/TeamShareTab.vue';
import VisibleToSelect from '@/views/_components/team/VisibleToSelect.vue';
import { shareRequest, teamRequest } from '@/utils/teamClient.js';
import { currentTeamScope } from '@/composables/useSpaces.js';
import { isBundleKind } from '@/services/share/shareKinds.js';
import { spaceEmoji, PRIVATE_SCOPE } from '@/views/One/team/teamModel.js';
import '@/views/_components/team/team.css';

const props = defineProps({
  kind: { type: String, required: true, validator: isBundleKind },
  id: { type: [String, Number], default: '' },
  name: { type: String, default: 'This item' },
});
// Inside a team space the team IS the destination; copying out is started from Personal.
const inTeamSpace = Boolean(currentTeamScope());
const links = ref([]), destinations = ref([]), loaded = ref(false), target = ref(null);
const itemRef = computed(() => props.kind + ':' + props.id);
const staleLink = computed(() => links.value.find(link => link.stale) || null);
const linkTo = d => links.value.find(link => link.teamId === d.teamId && (!d.projectId || link.projectId === d.projectId)) || null;
const options = computed(() => [
  { value: PRIVATE_SCOPE, label: 'Only you' },
  ...destinations.value.map(d => ({ value: d.value, label: `${d.label} (${linkTo(d) ? 'update copy' : 'copy'})` })),
]);
const copiedTo = computed(() => destinations.value.filter(linkTo).map(d => d.label));

async function loadLinks() {
  if (inTeamSpace || !props.id) return;
  try { links.value = await shareRequest('/links?items=' + encodeURIComponent(itemRef.value)); } catch (e) { links.value = []; console.warn('[VisibleTo] links:', e.message); }
}
/** Every teamspace this person can add to, team by team. A team whose spaces cannot be read is offered as a whole (its default space). */
async function loadDestinations() {
  if (inTeamSpace || !props.id) return;
  try {
    const list = await teamRequest('');
    const teams = (Array.isArray(list) ? list : []).filter(t => t.tenantUrl && t.role !== 'viewer');
    const perTeam = await Promise.all(teams.map(async team => {
      try {
        const spaces = await shareRequest('/team/' + encodeURIComponent(team.id) + '/spaces');
        return spaces.map(space => ({ value: team.id + '|' + space.id, teamId: team.id, projectId: space.id, projectName: space.name, label: `${team.name} › ${spaceEmoji(space)} ${space.name}` }));
      } catch (e) {
        console.warn('[VisibleTo] spaces of', team.name + ':', e.message);
        return [{ value: team.id + '|', teamId: team.id, projectId: '', projectName: '', label: team.name }];
      }
    }));
    destinations.value = perTeam.flat();
  } catch (e) { destinations.value = []; console.warn('[VisibleTo] teams:', e.message); } finally { loaded.value = true; }
}
function choose(value) { target.value = destinations.value.find(d => d.value === value) || null; }
function close() { target.value = null; }
onMounted(() => { loadLinks(); loadDestinations(); });
watch(itemRef, () => { links.value = []; loadLinks(); });
</script>
<style scoped>
.visible-to-field { display: grid; gap: 6px; }
.visible-to-label { font-size: 12px; color: var(--color-text-muted); }
.copy-to-team-note { margin: 0; font-size: 11px; color: var(--color-text-muted); }
.copy-dialog-scrim { position: fixed; inset: 0; z-index: 3000; background: var(--scrim); display: grid; place-items: center; padding: 16px; }
.copy-dialog { width: min(520px, 100%); max-height: 90vh; height: auto; border: 1px solid var(--terminal-border-color); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }
.copy-dialog header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.copy-dialog header h2 { margin: 0; font-size: 17px; }
.copy-dialog :deep(.body) { padding: 18px 20px; }
</style>
