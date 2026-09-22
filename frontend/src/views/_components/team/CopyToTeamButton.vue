<template>
  <template v-if="!inTeamSpace && id">
    <BaseButton :variant="variant" full-width class="copy-to-team" @click="openDialog">
      <i class="fas fa-users" aria-hidden="true"></i>
      {{ staleLink ? 'Update team copy' : 'Copy to team' }}
    </BaseButton>
    <p v-if="staleLink" class="copy-to-team-note">Changed since you copied it to {{ teamName(staleLink.teamId) }}.</p>

    <Teleport to="body">
      <div v-if="open" class="copy-dialog-scrim" @click.self="close">
        <section class="copy-dialog team-panel" role="dialog" aria-modal="true" :aria-label="'Copy ' + name + ' to a team'">
          <header>
            <h2>Copy to team</h2>
            <button class="icon" aria-label="Close" @click="close"><i class="fas fa-times"></i></button>
          </header>

          <div v-if="done" class="body">
            <p class="ok"><i class="fas fa-check" aria-hidden="true"></i> {{ name }} is now in {{ done.team.name }}.</p>
            <p v-if="done.needs.length">It uses {{ needsText(done.needs) }}. The team runs it with its own connections, never yours.</p>
            <div class="row"><button class="primary" @click="openCopiedTeam">Open {{ done.team.name }}</button><button @click="close">Done</button></div>
          </div>

          <div v-else class="body">
            <p v-if="!teams.length && !loading" class="empty">You are not on a team you can add to yet.</p>
            <label v-else>Team
              <CustomSelect v-model="teamId" :options="teams.map(t => ({ value: t.id, label: t.name }))" aria-label="Team" />
            </label>
            <label class="check"><input v-model="includeDependencies" type="checkbox" @change="loadPreview" /> Include what it uses (tools, workflows, skills)</label>

            <p v-if="loading" role="status">Checking what would be copied…</p>
            <template v-else-if="preview">
              <ul class="rows" aria-label="What will be copied">
                <li v-for="item in preview.items" :key="item.kind + item.id">
                  <div class="who"><strong>{{ item.name }}</strong><span>{{ kindLabel(item.kind) }}{{ item.dependency ? ' · used by ' + name : '' }}</span></div>
                </li>
              </ul>
              <p v-if="preview.dependencies.length" class="muted">Not included: {{ preview.dependencies.length }} item{{ preview.dependencies.length === 1 ? '' : 's' }} it uses. It may not work in the team without them.</p>
              <p v-if="preview.needs.length">Uses {{ needsText(preview.needs) }}. Your credentials are never copied; the team connects its own.</p>
              <p v-if="preview.removed" class="warn"><i class="fas fa-shield-alt" aria-hidden="true"></i> {{ preview.removed }} value{{ preview.removed === 1 ? ' that looked like a credential or a file on this computer was' : 's that looked like credentials or files on this computer were' }} removed from the copy.</p>
              <p class="muted">Your original stays yours and is not changed. {{ existingLink ? 'This updates the copy you made before.' : '' }}</p>
            </template>

            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <div class="row">
              <button class="primary" :disabled="busy || loading || !teamId || !preview" @click="copy">{{ existingLink ? 'Update team copy' : 'Copy to ' + (currentTeam?.name || 'team') }}</button>
              <button @click="close">Cancel</button>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </template>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { shareRequest, teamRequest, providerName } from '@/utils/teamClient.js';
import { currentTeamScope, openTeam } from '@/composables/useSpaces.js';
import '@/views/_components/team/team.css';

const props = defineProps({
  kind: { type: String, required: true, validator: v => ['agent', 'workflow', 'tool', 'skill'].includes(v) },
  id: { type: [String, Number], default: '' },
  name: { type: String, default: 'This item' },
  variant: { type: String, default: 'secondary' },
});
// Inside a team space the team IS the destination; copying out is started from Personal.
const inTeamSpace = Boolean(currentTeamScope());
const open = ref(false), loading = ref(false), busy = ref(false), error = ref('');
const teams = ref([]), teamId = ref(''), includeDependencies = ref(true), preview = ref(null), done = ref(null), links = ref([]);
const itemRef = computed(() => props.kind + ':' + props.id);
const currentTeam = computed(() => teams.value.find(t => t.id === teamId.value) || null);
const existingLink = computed(() => links.value.find(link => link.teamId === teamId.value) || null);
const staleLink = computed(() => links.value.find(link => link.stale) || null);
const teamName = id => teams.value.find(t => t.id === id)?.name || 'your team';
const kindLabel = kind => ({ agent: 'Agent', workflow: 'Workflow', tool: 'Tool', skill: 'Skill' })[kind] || kind;
const needsText = needs => needs.map(n => providerName(n.provider) + (n.reason === 'model' ? ' models' : '')).join(', ');

async function loadLinks() {
  if (inTeamSpace || !props.id) return;
  try { links.value = await shareRequest('/links?items=' + encodeURIComponent(itemRef.value)); } catch (e) { links.value = []; console.warn('[CopyToTeam] links:', e.message); }
}
async function loadPreview() {
  loading.value = true; error.value = '';
  try { preview.value = await shareRequest('/preview', { method: 'POST', body: JSON.stringify({ items: [itemRef.value], includeDependencies: includeDependencies.value }) }); } catch (e) { preview.value = null; error.value = e.message; } finally { loading.value = false; }
}
async function openDialog() {
  open.value = true; done.value = null; error.value = '';
  loading.value = true;
  try {
    const list = await teamRequest('');
    teams.value = (Array.isArray(list) ? list : []).filter(t => t.tenantUrl && t.role !== 'viewer');
    teamId.value = staleLink.value?.teamId || teams.value[0]?.id || '';
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
  if (teams.value.length) await loadPreview();
}
async function copy() {
  busy.value = true; error.value = '';
  try {
    done.value = await shareRequest('/team/' + encodeURIComponent(teamId.value), { method: 'POST', body: JSON.stringify({ items: [itemRef.value], includeDependencies: includeDependencies.value }) });
    await loadLinks();
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
const openCopiedTeam = async () => { const team = currentTeam.value; close(); if (team) await openTeam(team); };
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
.copy-dialog .body { padding: 18px 20px; display: grid; gap: 12px; }
.copy-dialog label { display: grid; gap: 6px; font-size: 12px; color: var(--color-text-muted); }
.copy-dialog label.check { display: flex; align-items: center; gap: 8px; }
.copy-dialog label.check input { width: auto; }
.copy-dialog .row { display: flex; gap: 8px; flex-wrap: wrap; }
.copy-dialog .warn { color: var(--color-yellow, #ffd700); }
.copy-dialog .ok { color: var(--color-green, #19ef83); font-size: 14px; }
.copy-dialog .error { padding: 10px 12px; border-radius: 6px; }
</style>
