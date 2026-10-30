<template>
  <div>
    <div class="board-bar">
      <span class="mk-muted">{{ kind === 'agent' ? `Agents anyone in ${spaceName} can @mention or put on a card. They run on the team's connections, only once published.` : `Routines that run for ${spaceName}, on the team's connections.` }}</span>
      <span class="fill"></span>
      <button type="button" class="btn" @click="$emit('open-editor', null)"><i class="fas fa-plus" aria-hidden="true"></i>New {{ kind === 'agent' ? 'agent' : 'routine' }}</button>
    </div>
    <div v-if="!items.length" class="list"><p class="empty">{{ loading ? 'Loading…' : kind === 'agent' ? 'No agents here yet. Make one, or copy one in from your personal space.' : 'No routines here yet.' }}</p></div>
    <div v-else class="cards">
      <div v-for="item in items" :key="item.id" class="card">
        <div class="row-gap" style="flex-wrap: nowrap">
          <TeamAvatar v-if="kind === 'agent'" :who="{ kind: 'agent', id: item.id }" size="lg" />
          <span v-else class="r-icon"><i class="fas fa-sync-alt" aria-hidden="true"></i></span>
          <h4 style="min-width: 0; overflow: hidden; text-overflow: ellipsis">{{ item.name }}</h4>
        </div>
        <div class="card-foot">
          <span class="tag" :class="STATUS[item.status].tone">{{ STATUS[item.status].label }}</span>
          <span class="fill"></span>
          <button v-if="canPublish && item.status !== 'published'" type="button" class="btn sm" :disabled="busy === item.id" @click="publish(item)">{{ busy === item.id ? 'Publishing…' : 'Publish' }}</button>
          <button type="button" class="btn sm" @click="$emit('open-editor', item)">Open</button>
        </div>
        <p v-if="item.status === 'changed'" class="mk-muted" style="margin: 0">Edited since publishing. The published version keeps running until you publish again.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { teamApi } from './useTeam.js';

const STATUS = Object.freeze({
  draft: { label: 'Draft, not runnable yet', tone: '' },
  published: { label: 'Published', tone: 'green' },
  changed: { label: 'Changed since publishing', tone: 'amber' },
});
const props = defineProps({ workspaceId: { type: String, required: true }, spaceName: { type: String, default: '' }, kind: { type: String, default: 'agent' } });
defineEmits(['open-editor']);
const ctx = inject('teamCtx');

const all = ref([]);
const loading = ref(true);
const busy = ref(null);
const items = computed(() => all.value.filter((i) => i.kind === props.kind));
const canPublish = computed(() => ['owner', 'admin'].includes(ctx.role.value));

async function load() {
  try { all.value = await teamApi.native(props.workspaceId); } catch (e) { ctx.toast(e.message); } finally { loading.value = false; }
}
async function publish(item) {
  busy.value = item.id;
  try {
    await teamApi.publish(props.workspaceId, item.kind, item.id);
    ctx.toast(`${item.name} is published. The team can run it now.`);
    await load();
  } catch (e) {
    ctx.toast(e.code === 'connection_required' ? `Connect ${e.provider || 'a model'} for the team first (Team, Connections).` : e.message);
  } finally { busy.value = null; }
}
watch(() => props.workspaceId, () => { loading.value = true; load(); });
onMounted(load);
</script>
