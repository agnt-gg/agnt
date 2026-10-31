<template>
  <div>
    <div class="board-bar">
      <span v-if="kind === 'agent'" style="color: var(--text-secondary); font-size: 13.5px">Published agents anyone in {{ spaceName }} can @mention or assign. Runs use team connections.</span>
      <span class="fill"></span>
      <button v-if="kind === 'agent'" type="button" class="btn" @click="$emit('library')"><MkIcon name="library" size="sm" />Add from Library</button>
      <!-- As in the mockup: agents come in from the Library (a new one is made from New…); routines start here. -->
      <button v-if="kind !== 'agent'" type="button" class="primary" @click="$emit('open-editor', null)"><MkIcon name="plus" size="sm" />New routine</button>
    </div>

    <!-- Agents: cards, as in the mockup. -->
    <template v-if="kind === 'agent'">
      <ul v-if="!items.length" class="list"><li class="empty">{{ loading ? 'Loading…' : 'No agents yet.' }}</li></ul>
      <div v-else class="cards">
        <div v-for="item in items" :key="item.id" class="card clickable" role="button" tabindex="0" @click="$emit('open-editor', item)" @keydown.enter="$emit('open-editor', item)">
          <div class="card-top">
            <TeamAvatar :who="{ kind: 'agent', id: item.id }" :label="item.name" size="lg" />
            <div style="min-width: 0"><h4>{{ item.name }}</h4><div style="font-size: 12px; color: var(--text-tertiary)">Team agent · {{ spaceName }}</div></div>
          </div>
          <p>{{ item.description || 'No description yet.' }}</p>
          <div class="card-foot" style="flex-wrap: wrap">
            <span class="tag" :class="STATUS[item.status].tone">{{ STATUS[item.status].label(item) }}</span>
            <button v-if="canPublish && item.status !== 'published'" type="button" class="btn sm" :disabled="busy === item.id" @click.stop="publish(item)">{{ busy === item.id ? 'Publishing…' : 'Publish' }}</button>
            <span class="fill"></span>
            <span class="scope team sm"><MkIcon name="users" size="sm" />{{ spaceName }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Routines: one list of rows, as in the mockup. -->
    <ul v-else class="list">
      <li v-if="!items.length" class="empty">{{ loading ? 'Loading…' : 'No routines yet.' }}</li>
      <li v-for="item in items" :key="item.id">
        <div class="r clickable" role="button" tabindex="0" @click="$emit('open-editor', item)" @keydown.enter="$emit('open-editor', item)">
          <span class="r-icon"><MkIcon name="bolt" size="sm" /></span>
          <span class="r-text"><strong>{{ item.name }}</strong><small>{{ item.description || (item.status === 'published' ? 'Runs on the team’s connections' : 'Publish it to let it run for the team') }}</small></span>
          <span class="tag" :class="STATUS[item.status].tone">{{ STATUS[item.status].label(item) }}</span>
          <button v-if="canPublish && item.status !== 'published'" type="button" class="btn sm" :disabled="busy === item.id" @click.stop="publish(item)">{{ busy === item.id ? 'Publishing…' : 'Publish' }}</button>
          <span class="scope team sm"><MkIcon name="users" size="sm" />{{ spaceName }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import TeamAvatar from './TeamAvatar.vue';
import { teamApi } from './useTeam.js';

const STATUS = Object.freeze({
  draft: { label: () => 'Draft', tone: '' },
  published: { label: (item) => (item.publishedRevision ? `Published v${item.publishedRevision}` : 'Published'), tone: 'green' },
  changed: { label: () => 'Changed since publishing', tone: 'amber' },
});
const props = defineProps({ workspaceId: { type: String, required: true }, spaceName: { type: String, default: '' }, kind: { type: String, default: 'agent' } });
defineEmits(['open-editor', 'library']);
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
