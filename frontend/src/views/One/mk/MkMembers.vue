<template>
  <!-- The approved mockup's Members page, on the real team roster. -->
  <div class="content">
    <div class="page">
      <div class="page-head">
        <div><h1>Members</h1><p>Three roles: Owner/Admin, Member, Guest. Item-level access is handled by each item’s Share button, not here.</p></div>
      </div>
      <template v-if="team">
        <TeamMembers :team="team" @error="ctx.toast" @changed="ctx.reload" />
        <div class="sec-head"><h3>Agents are members too</h3></div>
        <div class="cards">
          <template v-for="s in spaces" :key="s.id">
            <div v-for="a in bySpace[s.id] || []" :key="s.id + a.id" class="card clickable" @click="ctx.go({ view: 'space', space: s.id, tab: 'agents' })">
              <div class="card-top"><span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span><div style="min-width: 0"><h4>{{ a.name }}</h4><div class="mk-muted">{{ s.name }}</div></div></div>
              <div class="card-foot"><span class="tag" :class="a.status === 'published' ? 'green' : ''">{{ a.status === 'published' ? 'Published' : 'Draft' }}</span><span class="fill"></span><span class="scope sm"><MkIcon name="users" size="sm" />{{ s.name }}</span></div>
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
import { computed, inject, onMounted, ref } from 'vue';
import MkIcon from './MkIcon.vue';
import TeamMembers from '@/views/_components/team/TeamMembers.vue';
import { teamApi } from '@/views/One/team/useTeam.js';
import '@/views/_components/team/team.css';

const ctx = inject('teamCtx');
const team = computed(() => ctx.team.value);
const spaces = computed(() => ctx.spaces.value);
const bySpace = ref({});
const loaded = ref(false);
const agentCount = computed(() => Object.values(bySpace.value).reduce((n, list) => n + list.length, 0));
onMounted(async () => {
  if (team.value) {
    const entries = await Promise.all(spaces.value.map(async (s) => [s.id, (await teamApi.native(s.id).catch(() => [])).filter((x) => x.kind === 'agent')]));
    bySpace.value = Object.fromEntries(entries);
  }
  loaded.value = true;
});
</script>
