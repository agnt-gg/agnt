<template>
  <div v-if="done" class="team-share body">
    <p class="ok"><i class="fas fa-check" aria-hidden="true"></i> {{ name }} is now in {{ done.team.name }}.</p>
    <p v-if="done.needs.length">It uses {{ needsText(done.needs) }}. The team runs it with its own connections, never yours.</p>
    <div class="row"><button class="primary" @click="openCopiedTeam">Open {{ done.team.name }}</button><button @click="$emit('close')">Done</button></div>
  </div>

  <div v-else class="team-share body">
    <p v-if="!teams.length && !loading" class="empty">You are not on a team you can add to yet.</p>
    <label v-else>Team
      <CustomSelect v-model="teamId" :options="teams.map(t => ({ value: t.id, label: t.name }))" aria-label="Team" />
    </label>
    <label class="check"><input v-model="includeDependencies" type="checkbox" @change="loadPreview" /> Include what it uses (tools, workflows, skills, widgets)</label>

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
      <button @click="$emit('close')">Cancel</button>
    </div>
  </div>
</template>
<script setup>
/**
 * Copy one item (and, by default, what it uses) into a team. The body of both
 * the Copy to team button and the Team tab of the share sheet, so the two can
 * never drift apart.
 */
import { computed, onMounted, ref } from 'vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { shareRequest, teamRequest, providerName } from '@/utils/teamClient.js';
import { openTeam } from '@/composables/useSpaces.js';
import { kindLabel } from '@/services/share/shareKinds.js';
import '@/views/_components/team/team.css';

const props = defineProps({
  kind: { type: String, required: true },
  id: { type: [String, Number], required: true },
  name: { type: String, default: 'This item' },
});
const emit = defineEmits(['close', 'copied']);
const loading = ref(false), busy = ref(false), error = ref('');
const teams = ref([]), teamId = ref(''), includeDependencies = ref(true), preview = ref(null), done = ref(null), links = ref([]);
const itemRef = computed(() => props.kind + ':' + props.id);
const currentTeam = computed(() => teams.value.find(t => t.id === teamId.value) || null);
const existingLink = computed(() => links.value.find(link => link.teamId === teamId.value) || null);
const needsText = needs => needs.map(n => providerName(n.provider) + (n.reason === 'model' ? ' models' : '')).join(', ');

async function loadPreview() {
  loading.value = true; error.value = '';
  try { preview.value = await shareRequest('/preview', { method: 'POST', body: JSON.stringify({ items: [itemRef.value], includeDependencies: includeDependencies.value }) }); } catch (e) { preview.value = null; error.value = e.message; } finally { loading.value = false; }
}
async function load() {
  loading.value = true;
  try {
    const [list, copies] = await Promise.all([teamRequest(''), shareRequest('/links?items=' + encodeURIComponent(itemRef.value)).catch(() => [])]);
    links.value = Array.isArray(copies) ? copies : [];
    teams.value = (Array.isArray(list) ? list : []).filter(t => t.tenantUrl && t.role !== 'viewer');
    teamId.value = links.value.find(link => link.stale)?.teamId || teams.value[0]?.id || '';
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
  if (teams.value.length) await loadPreview();
}
async function copy() {
  busy.value = true; error.value = '';
  try {
    done.value = await shareRequest('/team/' + encodeURIComponent(teamId.value), { method: 'POST', body: JSON.stringify({ items: [itemRef.value], includeDependencies: includeDependencies.value }) });
    emit('copied', done.value);
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
const openCopiedTeam = async () => { const team = currentTeam.value; emit('close'); if (team) await openTeam(team); };
onMounted(load);
</script>
<style scoped>
.team-share { display: grid; gap: 12px; }
.team-share label { display: grid; gap: 6px; font-size: 12px; color: var(--color-text-muted); }
.team-share label.check { display: flex; align-items: center; gap: 8px; }
.team-share label.check input { width: auto; }
.team-share .row { display: flex; gap: 8px; flex-wrap: wrap; }
.team-share .warn { color: var(--color-yellow, #ffd700); }
.team-share .ok { color: var(--color-green, #19ef83); font-size: 14px; }
.team-share .error { padding: 10px 12px; border-radius: 6px; }
</style>
