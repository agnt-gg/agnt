<template>
  <template v-if="!inTeamSpace && id">
    <BaseButton :variant="variant" full-width class="copy-to-team" @click="openDialog">
      <i class="fas fa-users" aria-hidden="true"></i>
      {{ staleLink ? 'Update team copy' : 'Copy to team' }}
    </BaseButton>
    <p v-if="staleLink" class="copy-to-team-note">Changed since you copied it to a team.</p>

    <Teleport to="body">
      <div v-if="open" class="copy-dialog-scrim" @click.self="close">
        <section class="copy-dialog team-panel" role="dialog" aria-modal="true" :aria-label="'Copy ' + name + ' to a team'">
          <header>
            <h2>Copy to team</h2>
            <button class="icon" aria-label="Close" @click="close"><i class="fas fa-times"></i></button>
          </header>
          <TeamShareTab :kind="kind" :id="id" :name="name" @close="close" @copied="loadLinks" />
        </section>
      </div>
    </Teleport>
  </template>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import TeamShareTab from '@/views/_components/team/TeamShareTab.vue';
import { shareRequest } from '@/utils/teamClient.js';
import { currentTeamScope } from '@/composables/useSpaces.js';
import { isBundleKind } from '@/services/share/shareKinds.js';
import '@/views/_components/team/team.css';

const props = defineProps({
  kind: { type: String, required: true, validator: isBundleKind },
  id: { type: [String, Number], default: '' },
  name: { type: String, default: 'This item' },
  variant: { type: String, default: 'secondary' },
});
// Inside a team space the team IS the destination; copying out is started from Personal.
const inTeamSpace = Boolean(currentTeamScope());
const open = ref(false), links = ref([]);
const itemRef = computed(() => props.kind + ':' + props.id);
const staleLink = computed(() => links.value.find(link => link.stale) || null);

async function loadLinks() {
  if (inTeamSpace || !props.id) return;
  try { links.value = await shareRequest('/links?items=' + encodeURIComponent(itemRef.value)); } catch (e) { links.value = []; console.warn('[CopyToTeam] links:', e.message); }
}
function openDialog() { open.value = true; }
function close() { open.value = false; }
onMounted(loadLinks);
watch(itemRef, () => { links.value = []; loadLinks(); });
</script>
<style scoped>
.copy-to-team-note { margin: 4px 0 0; font-size: 11px; color: var(--color-text-muted); }
.copy-dialog-scrim { position: fixed; inset: 0; z-index: 3000; background: rgba(0, 0, 0, .55); display: grid; place-items: center; padding: 16px; }
.copy-dialog { width: min(520px, 100%); max-height: 90vh; height: auto; border: 1px solid var(--terminal-border-color); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }
.copy-dialog header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.copy-dialog header h2 { margin: 0; font-size: 17px; }
.copy-dialog :deep(.body) { padding: 18px 20px; }
</style>
