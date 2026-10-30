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

      <!-- Home IS the inbox: what needs me first, then my work. -->
      <section class="ot-inbox" aria-label="Inbox" data-testid="home-inbox">
        <div class="ot-inbox-head">
          <nav class="ot-tabs" aria-label="Inbox">
            <button v-for="t in TABS" :key="t.id" type="button" class="ot-tab" :class="{ 'is-active': tab === t.id }" @click="tab = t.id">
              {{ t.label }}<span v-if="t.id === 'needs' && needCount" class="ot-count">{{ needCount }}</span>
            </button>
          </nav>
          <span class="ot-fill"></span>
          <button v-if="team" type="button" class="focused-btn is-small" :disabled="!ctx.unread.value" @click="readAll"><i class="fas fa-check" aria-hidden="true"></i>Mark all read</button>
        </div>
        <div class="ot-inbox-body">
          <template v-if="tab === 'needs'">
            <div v-if="checkpointsWaiting.length" class="ot-sub">Waiting for your OK</div>
            <ul v-if="checkpointsWaiting.length" class="ot-list"><li v-for="c in checkpointsWaiting" :key="c.id"><TeamCheckpointRow :checkpoint="c" /></li></ul>
            <div v-if="runsWaiting.length" class="ot-sub">Routine runs to review</div>
            <ul v-if="runsWaiting.length" class="ot-list"><li v-for="r in runsWaiting" :key="r.id"><TeamRunRow :run="r" /></li></ul>
            <div v-if="teamNeeds.length" class="ot-sub">Mentions, assignments and agent results</div>
            <ul v-if="teamNeeds.length" class="ot-list"><li v-for="item in teamNeeds" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li></ul>
            <ul v-if="!needCount" class="ot-list"><li class="ot-empty">Nothing needs you right now.</li></ul>
          </template>
          <template v-else-if="tab === 'mentions'">
            <ul class="ot-list">
              <li v-if="!mentions.length" class="ot-empty">{{ team ? 'No mentions yet.' : 'Mentions come from teammates. Open a team to see them.' }}</li>
              <li v-for="item in mentions" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li>
            </ul>
          </template>
          <template v-else-if="tab === 'runs'">
            <ul class="ot-list">
              <li v-if="!runs.length" class="ot-empty">{{ runsLoaded ? 'No routine runs yet.' : 'Loading…' }}</li>
              <li v-for="r in runs" :key="r.id"><TeamRunRow :run="r" /></li>
            </ul>
          </template>
          <template v-else>
            <div v-if="checkpointsWaiting.length" class="ot-sub">Waiting for your OK</div>
            <ul v-if="checkpointsWaiting.length" class="ot-list"><li v-for="c in checkpointsWaiting" :key="c.id"><TeamCheckpointRow :checkpoint="c" /></li></ul>
            <div v-if="ctx.inbox.value.length" class="ot-sub">Everything else</div>
            <ul class="ot-list">
              <li v-if="!ctx.inbox.value.length && !checkpointsWaiting.length" class="ot-empty">Nothing here yet.</li>
              <li v-for="item in ctx.inbox.value" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li>
            </ul>
          </template>
        </div>
      </section>

      <template v-if="team">
        <div class="ot-two">
          <div>
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
import TeamCheckpointRow from './TeamCheckpointRow.vue';
import TeamRunRow from './TeamRunRow.vue';
import { teamApi } from './useTeam.js';
import { roleLabel } from '@/utils/teamClient.js';
import { partOfDay, pendingApprovals } from './teamModel.js';

const TABS = [{ id: 'needs', label: 'Needs you' }, { id: 'mentions', label: 'Mentions' }, { id: 'runs', label: 'Runs' }, { id: 'all', label: 'All' }];
const props = defineProps({ initialTab: { type: String, default: 'needs' } });
const ctx = inject('teamCtx');
const team = computed(() => ctx.team.value);
const teams = computed(() => ctx.teams.value);
const spaces = computed(() => ctx.spaces.value);
const firstName = computed(() => ctx.people.value.find((p) => p.isMe)?.first || '');
const tab = ref(TABS.some((t) => t.id === props.initialTab) ? props.initialTab : 'needs');
const tasks = ref([]);
const loading = ref(true);

const checkpointsWaiting = computed(() => ctx.checkpoints.state.pending);
const runs = computed(() => ctx.routineRuns.value);
const runsLoaded = computed(() => ctx.routineRunsLoaded.value);
const runsWaiting = computed(() => runs.value.filter((r) => r.status === 'needs_review'));
const teamNeeds = computed(() => ctx.inbox.value.filter((i) => !i.read || (i.kind === 'approval' && i.state === 'pending')));
const mentions = computed(() => ctx.inbox.value.filter((i) => i.kind === 'mention'));
const needCount = computed(() => checkpointsWaiting.value.length + runsWaiting.value.length + teamNeeds.value.length);
const myTasks = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'person' && t.assignee.id === ctx.me.value));
const agentTasks = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'agent'));
const openCount = (id) => tasks.value.filter((t) => t.workspaceId === id && t.status !== 'done').length;
const lead = computed(() => {
  const parts = [];
  const approvals = checkpointsWaiting.value.length + runsWaiting.value.length + pendingApprovals(ctx.inbox.value).length;
  parts.push(needCount.value ? `${needCount.value} ${needCount.value === 1 ? 'thing needs' : 'things need'} you` : 'Nothing needs you');
  if (approvals) parts.push(`${approvals} waiting for your OK`);
  if (team.value) parts.push(`${myTasks.value.length} ${myTasks.value.length === 1 ? 'task' : 'tasks'} on your plate`);
  const summary = parts.join(', ') + '.';
  return team.value ? summary : `${summary} This is your personal space; everything here is private to you.`;
});

async function readAll() {
  try { await teamApi.markAllRead(); ctx.markLocalRead(null); } catch (e) { ctx.toast(e.message); }
}
/** Every teamspace's board, read through its own authorized route. A space you cannot read is skipped. */
async function load() {
  if (!team.value) { loading.value = false; return; }
  const lists = await Promise.all(spaces.value.map((s) => teamApi.tasks(s.id).catch(() => [])));
  tasks.value = lists.flat();
  loading.value = false;
}
watch(() => props.initialTab, (value) => { if (TABS.some((t) => t.id === value)) tab.value = value; });
watch(() => [ctx.version.value, spaces.value.length, team.value?.id], load);
onMounted(() => { load(); ctx.checkpoints.loadPending(); ctx.loadRoutineRuns(); });
</script>
