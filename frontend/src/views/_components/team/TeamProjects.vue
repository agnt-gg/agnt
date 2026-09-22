<template>
  <div class="team-body">
    <section class="section">
      <div>
        <h3>Projects</h3>
        <p>Everything the team builds lives in a project. Everyone gets access to every project according to their role. Make another project only when some work should be separate.</p>
      </div>
      <p v-if="!onTeamInstance" class="muted">Open {{ team.name }} to see its projects.</p>
      <template v-else>
        <ul class="rows" aria-label="Projects">
          <li v-for="project in projects" :key="project.id">
            <div class="who"><strong>{{ project.name }}</strong><span>{{ project.is_default ? 'Default project' : 'Project' }}</span></div>
            <div class="actions">
              <button class="primary" @click="$emit('open-project', project)">Open</button>
              <button v-if="canManage" :aria-expanded="accessFor === project.id" @click="toggleAccess(project)">Access</button>
              <button v-if="isOwner && !project.is_default" class="danger" :disabled="busy" @click="archive(project)">Archive</button>
            </div>
            <div v-if="accessFor === project.id" class="access" role="region" :aria-label="'Access to ' + project.name">
              <p>People get their role's access here automatically. Add an exception only when one person needs more or less on this project.</p>
              <ul class="rows">
                <li v-for="member in members" :key="member.user_id">
                  <div class="who"><strong>{{ member.email || member.user_id }}</strong><span>{{ roleLabel(member.role) }}{{ overrides[member.user_id]?.length ? ' · with exceptions' : '' }}</span></div>
                  <details v-if="member.role !== 'owner'" @toggle="event => event.target.open && loadOverrides(project, member)">
                    <summary>Advanced</summary>
                    <div class="grid-table">
                      <label v-for="capability in CAPABILITY_LABELS" :key="capability.id">
                        <input type="checkbox" :checked="effective(member).has(capability.id)" :disabled="busy" @change="event => setCapability(project, member, capability.id, event.target.checked)" />
                        {{ capability.label }}
                      </label>
                      <button v-if="overrides[member.user_id]?.length" class="link" :disabled="busy" @click="reset(project, member)">Reset to {{ roleLabel(member.role) }}</button>
                    </div>
                  </details>
                </li>
              </ul>
            </div>
          </li>
        </ul>
        <form v-if="isOwner" class="inline-form" @submit.prevent="create">
          <input v-model="name" required maxlength="100" placeholder="New project name" aria-label="New project name" />
          <button :disabled="busy">Create project</button>
        </form>
      </template>
    </section>
  </div>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { roleLabel, teamRequest } from '@/utils/teamClient.js';

/** Plain-language names for the cloud's capability strings. Mirrors backend TeamAccess.js. */
const CAPABILITY_LABELS = [
  { id: 'resources.read', label: 'See agents, workflows and tools' },
  { id: 'resources.write', label: 'Create and edit them' },
  { id: 'runs.execute', label: 'Run them' },
  { id: 'runs.read', label: 'See run history' },
  { id: 'files.read', label: 'Read files' },
  { id: 'files.write', label: 'Change files' },
  { id: 'connections.use', label: 'Use team connections' },
  { id: 'access.manage', label: 'Manage access' },
];
const ROLE_BASELINE = {
  owner: CAPABILITY_LABELS.map(c => c.id),
  admin: CAPABILITY_LABELS.map(c => c.id),
  member: CAPABILITY_LABELS.map(c => c.id).filter(id => id !== 'access.manage'),
  viewer: ['resources.read', 'files.read', 'runs.read'],
};

const props = defineProps({ team: { type: Object, required: true }, onTeamInstance: { type: Boolean, default: false } });
const emit = defineEmits(['error', 'open-project']);
const projects = ref([]), members = ref([]), overrides = ref({}), accessFor = ref(''), name = ref(''), busy = ref(false);
const isOwner = computed(() => props.team.role === 'owner');
const canManage = computed(() => ['owner', 'admin'].includes(props.team.role));

function effective(member) {
  const result = new Set(ROLE_BASELINE[member.role] || []);
  for (const { capability, granted } of overrides.value[member.user_id] || []) granted ? result.add(capability) : result.delete(capability);
  return result;
}
async function perform(fn) {
  busy.value = true;
  try { await fn(); } catch (error) { emit('error', error.message); } finally { busy.value = false; }
}
async function load() {
  if (!props.onTeamInstance) return;
  projects.value = await teamRequest('/' + props.team.id + '/workspaces');
}
async function toggleAccess(project) {
  if (accessFor.value === project.id) { accessFor.value = ''; return; }
  accessFor.value = project.id; overrides.value = {};
  await perform(async () => { members.value = await teamRequest('/' + props.team.id + '/members'); });
}
const base = (project, member) => '/' + props.team.id + '/workspaces/' + project.id + '/members/' + encodeURIComponent(member.user_id);
const loadOverrides = (project, member) => perform(async () => { overrides.value = { ...overrides.value, [member.user_id]: await teamRequest(base(project, member) + '/overrides') }; });
const setCapability = (project, member, capability, granted) => perform(async () => {
  await teamRequest(base(project, member) + '/capabilities/' + capability, { method: granted ? 'PUT' : 'DELETE' });
  overrides.value = { ...overrides.value, [member.user_id]: await teamRequest(base(project, member) + '/overrides') };
});
const reset = (project, member) => perform(async () => { await teamRequest(base(project, member) + '/overrides', { method: 'DELETE' }); overrides.value = { ...overrides.value, [member.user_id]: [] }; });
const create = () => perform(async () => { await teamRequest('/' + props.team.id + '/workspaces', { method: 'POST', body: JSON.stringify({ name: name.value }) }); name.value = ''; await load(); });
function archive(project) {
  if (!window.confirm('Archive ' + project.name + ' for the whole team?')) return;
  perform(async () => { await teamRequest('/' + props.team.id + '/workspaces/' + project.id + '/archive', { method: 'POST' }); await load(); });
}
onMounted(() => perform(load));
watch(() => [props.team.id, props.onTeamInstance], () => { accessFor.value = ''; perform(load); });
defineExpose({ reload: () => perform(load) });
</script>
<style scoped>
.access { flex-basis: 100%; padding: 4px 0 4px 12px; border-left: 2px solid rgba(var(--primary-rgb), .3); display: grid; gap: 8px; }
.grid-table { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); padding-top: 8px; }
</style>
