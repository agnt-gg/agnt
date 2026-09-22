<template>
  <section class="team-workspace main-panel" :class="'team-panel'">
    <header class="team-header">
      <div class="title">
        <h2>{{ currentTeam ? currentTeam.name : 'Teams' }}</h2>
        <p v-if="currentTeam">{{ roleLabel(currentTeam.role) }} · <a :href="currentTeam.tenantUrl" target="_blank" rel="noopener">{{ host(currentTeam.tenantUrl) }}</a></p>
      </div>
      <div class="actions">
        <button v-if="currentTeam && !onTeamInstance" class="primary" @click="open(currentTeam)">Open {{ currentTeam.name }}</button>
        <button v-if="currentTeam && !onTeamInstance && !inTeamSpace" @click="copyFrom = currentTeam">Copy from {{ currentTeam.name }}…</button>
        <button v-if="unteamedBusinessTenants.length" @click="mode = 'create'">Enable a team</button>
        <button @click="mode = 'join'">Join with an invitation</button>
      </div>
    </header>
    <CopyFromTeamDialog v-if="copyFrom" :team="copyFrom" @close="copyFrom = null" />
    <div v-if="error" class="error" role="alert">{{ error }} <button class="link" @click="error = ''">Dismiss</button></div>
    <p v-if="loading" class="loading" role="status">Loading…</p>

    <form v-if="mode === 'create'" class="team-body" @submit.prevent="create">
      <h3>Enable a team</h3>
      <p>A team is one of your Business or Enterprise cloud instances, shared with the people you choose.</p>
      <CustomSelect v-model="tenantSlug" :options="unteamedBusinessTenants.map(t => ({ value: t.slug, label: t.slug + ' · ' + (t.planName || t.plan) }))" placeholder="Choose an instance" aria-label="Cloud instance" />
      <div class="inline-form"><button class="primary" :disabled="busy || !tenantSlug">Enable team</button><button type="button" @click="mode = ''">Cancel</button></div>
    </form>
    <form v-else-if="mode === 'join'" class="team-body" @submit.prevent="join">
      <h3>Join a team</h3>
      <p>Sign in with the invited email, then paste the invitation code. Codes are single use and expire after seven days.</p>
      <input v-model="inviteToken" required autocomplete="off" aria-label="Invitation code" placeholder="Invitation code" />
      <div class="inline-form"><button class="primary" :disabled="busy">Join</button><button type="button" @click="mode = ''">Cancel</button></div>
    </form>

    <template v-else-if="currentTeam">
      <div class="overview">
        <div><small>Seats</small><strong>{{ seats.used }} / {{ seats.total }}</strong><span v-if="seats.total && seats.used >= seats.total" class="pill warn">Full</span></div>
        <div><small>Plan</small><strong>{{ currentTeam.entitlement?.teamsEnabled ? 'AGNT Team' : 'Inactive' }}</strong><button v-if="currentTeam.capabilities?.manageBilling" class="link" @click="$emit('open-billing')">Manage billing</button></div>
      </div>
      <nav aria-label="Team views"><button v-for="name in TABS" :key="name" :class="{ active: tab === name }" :aria-current="tab === name ? 'page' : undefined" @click="tab = name">{{ name }}</button></nav>
      <TeamMembers v-if="tab === 'Members'" :team="currentTeam" @error="showError" @changed="loadTeams" />
      <TeamProjects v-else-if="tab === 'Projects'" :team="currentTeam" :on-team-instance="onTeamInstance" @error="showError" @open-project="project => open(currentTeam, project.id)" />
      <TeamConnections v-else-if="tab === 'Connections'" :team="currentTeam" @error="showError" />
      <TeamActivity v-else-if="tab === 'Activity'" :team="currentTeam" :on-team-instance="onTeamInstance" @error="showError" />
      <TeamLibrary v-else :team="currentTeam" :on-team-instance="onTeamInstance" @error="showError" />
    </template>

    <div v-else-if="!mode" class="team-body">
      <template v-if="teams.length">
        <p>Each team is a shared, always-on instance. Open one to work in it; your personal work stays private.</p>
        <ul class="rows" aria-label="Your teams">
          <li v-for="team in teams" :key="team.id">
            <div class="who"><strong>{{ team.name }}</strong><span>{{ roleLabel(team.role) }} · {{ team.seats?.used }}/{{ team.seats?.total }} seats</span></div>
            <div class="actions"><button @click="select(team.id)">Manage</button><button class="primary" @click="open(team)">Open</button></div>
          </li>
        </ul>
      </template>
      <template v-else-if="unteamedBusinessTenants.length">
        <p>You have a Business instance that is not a team yet.</p>
        <div><button class="primary" @click="mode = 'create'">Enable a team</button></div>
      </template>
      <ProGate v-else feature="teams" label="Teams" suggest="business" hint="AGNT Team is one always-on instance shared by three people, with a shared credential vault and audit receipts. $99/mo.">
        <template #preview><p>Work together in a shared, always-on instance. Add people, share agents and automations, and keep personal work private.</p></template>
      </ProGate>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import ProGate from '@/components/ProGate.vue';
import TeamMembers from '@/views/_components/team/TeamMembers.vue';
import TeamProjects from '@/views/_components/team/TeamProjects.vue';
import TeamConnections from '@/views/_components/team/TeamConnections.vue';
import TeamActivity from '@/views/_components/team/TeamActivity.vue';
import TeamLibrary from '@/views/_components/team/TeamLibrary.vue';
import { roleLabel, teamRequest, tenantRequest } from '@/utils/teamClient.js';
import { currentTeamScope, openTeam } from '@/composables/useSpaces.js';
import CopyFromTeamDialog from '@/views/_components/team/CopyFromTeamDialog.vue';
import '@/views/_components/team/team.css';

const TABS = ['Members', 'Projects', 'Connections', 'Activity', 'Library'];
// Older callers still ask for the tabs by their previous names.
const LEGACY_TABS = { Assets: 'Library', Workspaces: 'Projects' };
const normalizeTab = name => (TABS.includes(name) ? name : LEGACY_TABS[name] || 'Members');

const props = defineProps({ selectedTeamId: { type: String, default: '' }, initialTab: { type: String, default: 'Members' }, hideScopeSelector: { type: Boolean, default: false } });
const emit = defineEmits(['close', 'update:selectedTeamId', 'teams-loaded', 'open-billing']);
const store = useStore();
const teams = ref([]), tenants = ref([]), teamId = ref(props.selectedTeamId), tab = ref(normalizeTab(props.initialTab));
const mode = ref(''), tenantSlug = ref(''), inviteToken = ref(''), busy = ref(false), loading = ref(false), error = ref('');
let generation = 0;
const copyFrom = ref(null);
// Copying INTO Personal is started from Personal, where the personal backend lives.
const inTeamSpace = Boolean(currentTeamScope());

const currentTeam = computed(() => teams.value.find(t => t.id === teamId.value) || null);
const onTeamInstance = computed(() => { try { return Boolean(currentTeam.value?.tenantUrl) && window.location.origin === new URL(currentTeam.value.tenantUrl).origin; } catch { return false; } });
const seats = computed(() => tenants.value.find(t => t.slug === currentTeam.value?.tenantSlug)?.seats || currentTeam.value?.seats || { used: 0, total: 0 });
/** Business/Enterprise instances the user owns that are not teams yet. */
const unteamedBusinessTenants = computed(() => tenants.value.filter(t => t.isOwner && t.status === 'active' && ['business', 'enterprise'].includes(t.plan) && !teams.value.some(team => team.tenantSlug === t.slug)));
const host = url => { try { return new URL(url).host; } catch { return url; } };
const showError = message => { error.value = message; };

async function perform(fn) {
  busy.value = true; error.value = '';
  try { await fn(); } catch (e) { error.value = e.message; console.warn('[TeamWorkspace]', e.message); } finally { busy.value = false; }
}
async function loadTeams() {
  const ticket = ++generation;
  loading.value = true;
  try {
    const [list, tenantList] = await Promise.all([teamRequest(''), tenantRequest('').catch(e => { console.warn('[TeamWorkspace] tenants:', e.message); return { tenants: [] }; })]);
    if (ticket !== generation) return;
    teams.value = Array.isArray(list) ? list : [];
    tenants.value = tenantList.tenants || [];
    emit('teams-loaded', teams.value);
    if (teamId.value && !currentTeam.value) select('');
  } finally { if (ticket === generation) loading.value = false; }
}
function select(id) { teamId.value = id; mode.value = ''; emit('update:selectedTeamId', id); }
const open = (team, projectId = null) => perform(async () => { if (!(await openTeam(team, projectId))) throw new Error('This team has no instance address yet.'); });
const create = () => perform(async () => { const team = await teamRequest('', { method: 'POST', body: JSON.stringify({ tenantSlug: tenantSlug.value.trim() }) }); await loadTeams(); select(team.id); });
const join = () => perform(async () => { const team = await teamRequest('/accept', { method: 'POST', body: JSON.stringify({ token: inviteToken.value.trim() }) }); inviteToken.value = ''; await loadTeams(); select(team.id); });

onMounted(() => perform(loadTeams));
watch(() => props.selectedTeamId, id => { if (id !== teamId.value) teamId.value = id; });
watch(() => props.initialTab, name => { tab.value = normalizeTab(name); });
watch(() => store.state.userAuth?.token, () => { generation++; teams.value = []; teamId.value = ''; emit('close'); });
onBeforeUnmount(() => { generation++; });
</script>
<style scoped>
/* The theme's shared .main-panel rule layers wallpaper opacity/blur over this base color. */
.team-workspace { background: var(--color-background); }
.team-header { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.team-header .title a { color: inherit; }
.team-header .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.loading { padding: 12px 20px; }
.overview { display: flex; gap: 28px; padding: 12px 20px; border-bottom: 1px solid var(--terminal-border-color); flex-wrap: wrap; }
.overview > div { display: flex; gap: 8px; align-items: baseline; }
.overview small { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); }
.overview strong { font-size: 16px; font-weight: 500; }
nav { display: flex; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--terminal-border-color); flex-wrap: wrap; }
nav button.active { color: var(--color-primary); border-color: rgba(var(--primary-rgb), .35); }
</style>
