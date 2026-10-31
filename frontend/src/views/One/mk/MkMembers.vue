<template>
  <!-- The approved mockup's Members page, on the real team roster. -->
  <div class="content">
    <div class="page">
      <div class="page-head">
        <div><h1>Members</h1><p>Three roles: Owner/Admin, Member, Guest. Item-level access is handled by each item’s Share button, not here.</p></div>
        <button v-if="team && canManage" type="button" class="primary" @click="inviting = !inviting"><MkIcon name="plus" size="sm" />{{ inviting ? 'Done' : 'Invite by email' }}</button>
      </div>
      <template v-if="team">
        <!-- Adding, inviting, seats and finishing a half-added person: the full manager, on demand. -->
        <div v-if="inviting" class="banner" style="display: block; margin-bottom: 16px"><TeamMembers :team="team" @error="ctx.toast" @changed="onChanged" /></div>
        <div class="list" style="overflow: auto">
          <table class="tbl">
            <thead><tr><th>Person</th><th>Role</th><th>Teamspaces</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!people.length"><td colspan="4" class="mk-muted">{{ loaded ? 'No one yet.' : 'Loading…' }}</td></tr>
              <tr v-for="p in people" :key="p.user_id">
                <td><div class="who"><TeamAvatar :who="{ kind: 'person', id: p.user_id }" :label="p.name || p.email" size="lg" /><div><b style="font-weight: 500">{{ p.name || p.email }}{{ p.user_id === me ? ' (you)' : '' }}</b><div style="font-size: 12px; color: var(--text-tertiary)">{{ p.email }}</div></div></div></td>
                <td>
                  <span v-if="p.role === 'owner'" class="tag pink">Owner</span>
                  <CustomSelect v-else-if="canManage && p.user_id !== me" :model-value="p.role" :options="roleOptions" :disabled="busy" :aria-label="'Role for ' + (p.email || p.name)" @update:model-value="(value) => setRole(p, value)" />
                  <span v-else class="tag">{{ roleLabel(p.role) }}</span>
                </td>
                <td><div class="row-gap"><span v-for="s in spaces" :key="s.id" class="tag">{{ spaceEmoji(s) }} {{ s.name }}</span><span v-if="!spaces.length" style="color: var(--text-tertiary); font-size: 12.5px">None</span></div></td>
                <td style="text-align: right"><button v-if="canManage && p.role !== 'owner' && p.user_id !== me" type="button" class="btn ghost sm danger" :disabled="busy" @click="remove(p)">Remove</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sec-head"><h3>Agents are members too</h3></div>
        <div class="cards">
          <template v-for="s in spaces" :key="s.id">
            <div v-for="a in bySpace[s.id] || []" :key="s.id + a.id" class="card clickable" @click="ctx.go({ view: 'space', space: s.id, tab: 'agents' })">
              <div class="card-top"><span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span><div style="min-width: 0"><h4>{{ a.name }}</h4><div style="font-size: 12px; color: var(--text-tertiary)">Team agent · {{ s.name }}</div></div></div>
              <p>{{ a.description || 'No description yet.' }}</p>
              <div class="card-foot"><span class="tag" :class="a.status === 'published' ? 'green' : ''">{{ a.status === 'published' ? (a.publishedRevision ? `Published v${a.publishedRevision}` : 'Published') : 'Draft' }}</span><span class="fill"></span><span class="scope team sm"><MkIcon name="users" size="sm" />{{ s.name }}</span></div>
            </div>
          </template>
          <div v-if="loaded && !agentCount" class="empty">No team agents yet.</div>
        </div>
      </template>
      <div v-else class="banner"><MkIcon name="users" size="sm" /><span style="flex: 1">Members belong to a team. You are in your personal space.</span><button type="button" class="primary" @click="ctx.teamSettings()">Create or join a team</button></div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import MkIcon from './MkIcon.vue';
import TeamAvatar from '@/views/One/team/TeamAvatar.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import TeamMembers from '@/views/_components/team/TeamMembers.vue';
import { teamApi } from '@/views/One/team/useTeam.js';
import { spaceEmoji } from '@/views/One/team/teamModel.js';
import { ROLES, roleLabel, teamRequest, removePerson, changeRole } from '@/utils/teamClient.js';
import '@/views/_components/team/team.css';

const ctx = inject('teamCtx');
const team = computed(() => ctx.team.value);
const spaces = computed(() => ctx.spaces.value);
const me = computed(() => ctx.me.value);
const canManage = computed(() => team.value?.capabilities?.manageMembers === true || ['owner', 'admin'].includes(team.value?.role));
const roleOptions = ROLES.map((r) => ({ value: r.value, label: r.label }));
const roster = ref([]);
const bySpace = ref({});
const loaded = ref(false);
const busy = ref(false);
const inviting = ref(false);
const agentCount = computed(() => Object.values(bySpace.value).reduce((n, list) => n + list.length, 0));
const people = computed(() => [...roster.value].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0) || String(a.email).localeCompare(String(b.email))));

async function load() {
  if (!team.value) { loaded.value = true; return; }
  const [members, entries] = await Promise.all([
    teamRequest('/' + team.value.id + '/members').catch((e) => { ctx.toast(e.message); return []; }),
    Promise.all(spaces.value.map(async (s) => [s.id, (await teamApi.native(s.id).catch(() => [])).filter((x) => x.kind === 'agent')])),
  ]);
  roster.value = Array.isArray(members) ? members : [];
  bySpace.value = Object.fromEntries(entries);
  loaded.value = true;
}
async function perform(fn) {
  busy.value = true;
  try { await fn(); await load(); ctx.reload(); } catch (e) { ctx.toast(e.message); } finally { busy.value = false; }
}
const setRole = (p, role) => perform(() => changeRole(team.value, p.user_id, role));
function remove(p) {
  if (!window.confirm(`Remove ${p.email || p.name}? They lose access to ${team.value.name} immediately. Everything the team made stays.`)) return;
  perform(() => removePerson(team.value, p.user_id));
}
function onChanged() { load(); ctx.reload(); }
watch(() => [team.value?.id, spaces.value.length], load);
onMounted(load);
</script>
