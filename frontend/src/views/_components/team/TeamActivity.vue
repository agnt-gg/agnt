<template>
  <div class="team-body">
    <section class="section">
      <h3>Activity</h3>
      <p v-if="!onTeamInstance" class="muted">Open {{ team.name }} to see its activity.</p>
      <ul v-else class="rows" aria-label="Team activity">
        <li v-for="entry in events" :key="entry.id">
          <div class="who"><strong>{{ describe(entry.action) }}</strong><span>{{ entry.actor_email || entry.actor_id }}</span></div>
          <small class="muted">{{ formatTime(entry.created_at) }}</small>
        </li>
      </ul>
      <p v-if="onTeamInstance && !events.length && !busy" class="empty">Nothing has happened here yet.</p>
    </section>
  </div>
</template>
<script setup>
import { onMounted, ref, watch } from 'vue';
import { teamRequest } from '@/utils/teamClient.js';

const LABELS = { 'workspace.created': 'Created a project', 'workspace.updated': 'Updated a project', 'workspace.archived': 'Archived a project', 'asset.saved': 'Saved a library item', 'asset.created': 'Added a library item' };
const describe = action => LABELS[action] || action.replace(/[._]/g, ' ');
const formatTime = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); };
const props = defineProps({ team: { type: Object, required: true }, onTeamInstance: { type: Boolean, default: false } });
const emit = defineEmits(['error']);
const events = ref([]), busy = ref(false);
async function load() {
  if (!props.onTeamInstance) return;
  busy.value = true;
  try { events.value = await teamRequest('/' + props.team.id + '/activity'); } catch (error) { emit('error', error.message); } finally { busy.value = false; }
}
onMounted(load);
watch(() => [props.team.id, props.onTeamInstance], load);
</script>
