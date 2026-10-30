<template>
  <div class="ot-scroll">
    <div class="ot-page">
      <h1 class="ot-greet">Good {{ partOfDay() }}{{ firstName ? ', ' + firstName : '' }}.</h1>
      <p class="ot-lead">{{ lead }}</p>
      <div class="ot-chips">
        <button type="button" class="ot-chip" @click="ctx.ask('')"><i class="far fa-comment" aria-hidden="true"></i>Ask Annie</button>
        <template v-if="team && spaces.length">
          <button type="button" class="ot-chip" @click="ctx.go({ view: 'space', space: spaces[0].id, tab: 'board' })"><i class="far fa-check-square" aria-hidden="true"></i>New task</button>
          <button type="button" class="ot-chip" @click="ctx.go({ view: 'space', space: spaces[0].id, tab: 'docs' })"><i class="far fa-file-alt" aria-hidden="true"></i>New doc</button>
          <button type="button" class="ot-chip" @click="ctx.go({ view: 'space', space: spaces[0].id, tab: 'chat' })"><i class="fas fa-hashtag" aria-hidden="true"></i>Message the team</button>
        </template>
        <button type="button" class="ot-chip" @click="ctx.openPage('scheduled')"><i class="fas fa-sync-alt" aria-hidden="true"></i>Routines</button>
      </div>

      <template v-if="team">
        <div class="ot-two">
          <div>
            <div class="ot-sec"><h3>Needs you</h3><button type="button" class="focused-btn is-small" @click="ctx.go({ view: 'inbox' })">Open inbox</button></div>
            <ul class="ot-list">
              <li v-if="!needsYou.length" class="ot-empty">Nothing needs you right now.</li>
              <li v-for="item in needsYou" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li>
            </ul>
            <div class="ot-sec"><h3>My tasks</h3><button type="button" class="focused-btn is-small" @click="ctx.go({ view: 'mine' })">All</button></div>
            <ul class="ot-list">
              <li v-if="!myTasks.length" class="ot-empty">{{ loading ? 'Loading…' : 'No open tasks assigned to you.' }}</li>
              <li v-for="t in myTasks.slice(0, 6)" :key="t.id"><TeamTaskRow :task="t" @open="ctx.go({ view: 'space', space: t.workspaceId, tab: 'board', task: t.id })" /></li>
            </ul>
          </div>
          <div>
            <div class="ot-sec"><h3>Agents at work</h3></div>
            <ul class="ot-list">
              <li v-if="!agentTasks.length" class="ot-empty">{{ loading ? 'Loading…' : 'No agent is working on a card.' }}</li>
              <li v-for="t in agentTasks.slice(0, 6)" :key="t.id"><TeamTaskRow :task="t" @open="ctx.go({ view: 'space', space: t.workspaceId, tab: 'board', task: t.id })" /></li>
            </ul>
            <div class="ot-sec"><h3>Teamspaces</h3></div>
            <div class="ot-cards" style="grid-template-columns: 1fr">
              <button v-for="s in spaces" :key="s.id" type="button" class="ot-card" @click="ctx.go({ view: 'space', space: s.id })">
                <div class="ot-row" style="flex-wrap: nowrap">
                  <span class="ot-space-icon" style="width: 34px; height: 34px; font-size: 15px; border-radius: 10px">#</span>
                  <div style="flex: 1; min-width: 0"><h4>{{ s.name }}</h4><p>{{ openCount(s.id) }} open {{ openCount(s.id) === 1 ? 'card' : 'cards' }}</p></div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="ot-sec"><h3>Your teams</h3></div>
        <ul class="ot-list">
          <li v-if="!teams.length" class="ot-empty">You are not on a team yet. A team shares chat, a board, docs and agents, each person keeping their own private space. <button type="button" class="ot-link" @click="ctx.teamSettings()">Set one up</button>.</li>
          <li v-for="t in teams" :key="t.id">
            <div class="ot-r">
              <span class="ot-r-icon"><img src="/images/agnt-logo-mark.svg" alt="" style="width: 15px" /></span>
              <span class="ot-r-text"><strong>{{ t.name }}</strong><small>{{ roleLabel(t.role) }}</small></span>
              <button type="button" class="focused-primary is-small" @click="ctx.openTeam(t)">Open</button>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import TeamInboxRow from './TeamInboxRow.vue';
import TeamTaskRow from './TeamTaskRow.vue';
import { teamApi } from './useTeam.js';
import { roleLabel } from '@/utils/teamClient.js';
import { partOfDay, pendingApprovals } from './teamModel.js';

const ctx = inject('teamCtx');
const team = computed(() => ctx.team.value);
const teams = computed(() => ctx.teams.value);
const spaces = computed(() => ctx.spaces.value);
const firstName = computed(() => ctx.people.value.find((p) => p.isMe)?.first || '');
const tasks = ref([]);
const loading = ref(true);

const needsYou = computed(() => ctx.inbox.value.filter((i) => !i.read || (i.kind === 'approval' && i.state === 'pending')).slice(0, 4));
const myTasks = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'person' && t.assignee.id === ctx.me.value));
const agentTasks = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'agent'));
const openCount = (id) => tasks.value.filter((t) => t.workspaceId === id && t.status !== 'done').length;
const lead = computed(() => {
  if (!team.value) return 'This is your personal space. Everything here is private to you.';
  const approvals = pendingApprovals(ctx.inbox.value).length;
  const parts = [];
  if (approvals) parts.push(`${approvals} ${approvals === 1 ? 'result needs' : 'results need'} your approval`);
  parts.push(`${myTasks.value.length} ${myTasks.value.length === 1 ? 'task' : 'tasks'} on your plate`);
  parts.push(`${agentTasks.value.length} with agents`);
  return parts.join(', ') + '.';
});

/** Every teamspace's board, read through its own authorized route. A space you cannot read is skipped. */
async function load() {
  if (!team.value) { loading.value = false; return; }
  const lists = await Promise.all(spaces.value.map((s) => teamApi.tasks(s.id).catch(() => [])));
  tasks.value = lists.flat();
  loading.value = false;
}
watch(() => [ctx.version.value, spaces.value.length, team.value?.id], load);
onMounted(load);
</script>
