<template>
  <div class="team-body">
    <section class="section">
      <div>
        <h3>Library</h3>
        <p>Documents and snapshots saved to the team. To share an agent, workflow or tool, use <strong>Copy to team</strong> from its menu instead.</p>
      </div>
      <p v-if="!onTeamInstance" class="muted">Open {{ team.name }} to see its library.</p>
      <template v-else>
        <input v-model="query" placeholder="Find in the library…" aria-label="Find in the library" />
        <ul class="rows" aria-label="Library items">
          <li v-for="asset in filtered" :key="asset.id">
            <div class="who"><strong>{{ asset.name }}</strong><span>{{ asset.kind }} · version {{ asset.revision }}</span></div>
            <div class="actions"><button :disabled="busy" @click="download(asset)">Download</button></div>
          </li>
        </ul>
        <p v-if="!filtered.length && !busy" class="empty">The library is empty.</p>
      </template>
    </section>
  </div>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { teamRequest } from '@/utils/teamClient.js';

const EXTENSIONS = { markdown: 'md', csv: 'csv', html: 'html', text: 'txt' };
const props = defineProps({ team: { type: Object, required: true }, onTeamInstance: { type: Boolean, default: false } });
const emit = defineEmits(['error']);
const assets = ref([]), query = ref(''), busy = ref(false);
const filtered = computed(() => assets.value.filter(a => a.name.toLowerCase().includes(query.value.toLowerCase())));
async function perform(fn) {
  busy.value = true;
  try { await fn(); } catch (error) { emit('error', error.message); } finally { busy.value = false; }
}
const load = async () => { if (props.onTeamInstance) assets.value = await teamRequest('/' + props.team.id + '/assets'); };
const download = asset => perform(async () => {
  const full = await teamRequest('/' + props.team.id + '/assets/' + asset.id);
  const url = URL.createObjectURL(new Blob([full.content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = (full.name || 'item') + '.' + (EXTENSIONS[full.kind] || 'json');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
onMounted(() => perform(load));
watch(() => [props.team.id, props.onTeamInstance], () => perform(load));
</script>
