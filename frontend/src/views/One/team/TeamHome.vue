<template>
  <div class="content">
    <div class="page">
      <h1 class="greet">Good {{ partOfDay() }}{{ firstName ? ', ' + firstName : '' }}.</h1>
      <p class="lead">{{ lead }}</p>
      <div class="chips">
        <button type="button" class="chip" @click="ctx.ask('')"><MkIcon name="chats" />Ask Annie</button>
        <button type="button" class="chip" @click="ctx.create('task')"><MkIcon name="task" />New task</button>
        <button type="button" class="chip" @click="ctx.create('doc')"><MkIcon name="doc" />New doc</button>
        <button type="button" class="chip" @click="ctx.create('agent')"><MkIcon name="bot" />New agent</button>
        <button type="button" class="chip" @click="ctx.create('routine')"><MkIcon name="bolt" />New routine</button>
      </div>

      <!-- Home IS the inbox: what needs me first, then my work. -->
      <section class="hm-inbox" aria-label="Inbox" data-testid="home-inbox">
        <div class="hm-inbox-h">
          <nav class="tabs" aria-label="Inbox" style="margin: 0; border: 0">
            <button v-for="t in TABS" :key="t.id" type="button" class="tab" :class="{ 'is-active': tab === t.id }" @click="tab = t.id">
              {{ t.label }}<span v-if="t.id === 'needs' && needCount" class="count">{{ needCount }}</span>
            </button>
          </nav>
          <span class="fill"></span>
          <button v-if="team" type="button" class="btn ghost sm" :disabled="!ctx.unread.value" @click="readAll"><MkIcon name="check" size="xs" />Mark all read</button>
        </div>
        <div class="hm-inbox-b">
          <template v-if="tab === 'needs'">
            <div v-if="checkpointsWaiting.length" class="hm-sub">Waiting for your OK</div>
            <ul v-if="checkpointsWaiting.length" class="list"><li v-for="c in checkpointsWaiting" :key="c.id"><TeamCheckpointRow :checkpoint="c" /></li></ul>
            <div v-if="runsWaiting.length" class="hm-sub">Routine runs to review</div>
            <ul v-if="runsWaiting.length" class="list"><li v-for="r in runsWaiting" :key="r.id"><TeamRunRow :run="r" /></li></ul>
            <div v-if="pluginAsks.length" class="hm-sub">Plugin requests</div>
            <ul v-if="pluginAsks.length" class="list" data-testid="plugin-requests">
              <li v-for="r in pluginAsks" :key="r.id"><TeamPluginRequestRow :request="r" decider :busy="deciding === r.id" @approve="approvePlugin" @decline="declinePlugin" /></li>
            </ul>
            <div v-if="pluginOutcomes.length" class="hm-sub">Your plugin requests</div>
            <ul v-if="pluginOutcomes.length" class="list">
              <li v-for="r in pluginOutcomes" :key="r.id"><TeamPluginRequestRow :request="r" @dismiss="(x) => plugins.seen(x.id)" /></li>
            </ul>
            <div v-if="teamNeeds.length" class="hm-sub">Mentions, assignments and agent results</div>
            <ul v-if="teamNeeds.length" class="list"><li v-for="item in teamNeeds" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li></ul>
            <ul v-if="!needCount" class="list"><li class="empty">Nothing needs you right now.</li></ul>
          </template>
          <template v-else-if="tab === 'mentions'">
            <ul class="list">
              <li v-if="!mentions.length" class="empty">{{ team ? 'No mentions yet.' : 'Mentions come from teammates. Open a team to see them.' }}</li>
              <li v-for="item in mentions" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li>
            </ul>
          </template>
          <template v-else-if="tab === 'runs'">
            <ul class="list">
              <li v-if="!runs.length" class="empty">{{ runsLoaded ? 'No routine runs yet.' : 'Loading…' }}</li>
              <li v-for="r in runs" :key="r.id"><TeamRunRow :run="r" /></li>
            </ul>
          </template>
          <template v-else>
            <div v-if="checkpointsWaiting.length" class="hm-sub">Waiting for your OK</div>
            <ul v-if="checkpointsWaiting.length" class="list"><li v-for="c in checkpointsWaiting" :key="c.id"><TeamCheckpointRow :checkpoint="c" /></li></ul>
            <div v-if="ctx.inbox.value.length" class="hm-sub">Everything else</div>
            <ul class="list">
              <li v-if="!ctx.inbox.value.length && !checkpointsWaiting.length" class="empty">Nothing here yet.</li>
              <li v-for="item in ctx.inbox.value" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li>
            </ul>
          </template>
        </div>
      </section>

      <template v-if="team">
        <div class="two">
          <div>
            <div class="sec-head"><h3>My tasks</h3><button type="button" class="btn ghost sm" @click="ctx.go({ view: 'mine' })">All</button></div>
            <ul class="list">
              <li v-if="!myTasks.length" class="empty">{{ loading ? 'Loading…' : 'No open tasks assigned to you.' }}</li>
              <li v-for="t in myTasks.slice(0, 6)" :key="t.id"><TeamTaskRow :task="t" @open="ctx.go({ view: 'space', space: t.workspaceId, tab: 'board', task: t.id })" /></li>
            </ul>
          </div>
          <div>
            <div class="sec-head"><h3>Agents at work</h3><button type="button" class="btn ghost sm" @click="ctx.openPage('activity')">Activity</button></div>
            <ul class="list">
              <li v-if="!agentTasks.length" class="empty">{{ loading ? 'Loading…' : 'No agent is working on a card.' }}</li>
              <li v-for="t in agentTasks.slice(0, 6)" :key="t.id"><TeamTaskRow :task="t" @open="ctx.go({ view: 'space', space: t.workspaceId, tab: 'board', task: t.id })" /></li>
            </ul>
            <div class="sec-head"><h3>Your teamspaces</h3></div>
            <div class="cards" style="grid-template-columns: 1fr">
              <button v-for="s in spaces" :key="s.id" type="button" class="card" @click="ctx.go({ view: 'space', space: s.id, tab: 'board' })">
                <div class="card-top">
                  <span class="space-icon" style="width: 34px; height: 34px; font-size: 16px; border-radius: 10px">{{ spaceEmoji(s) }}</span>
                  <div style="flex: 1"><h4>{{ s.name }}</h4><p>{{ openCount(s.id) }} open</p></div>
                  <span class="stack"><TeamAvatar v-for="p in ctx.people.value.slice(0, 4)" :key="p.id" :who="{ kind: 'person', id: p.id }" :label="p.name" size="sm" /></span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="sec-head"><h3>Your teams</h3></div>
        <ul class="list">
          <li v-if="!teams.length" class="empty">You are not on a team yet. A team shares chat, a board, docs and agents, each person keeping their own private space. <button type="button" class="link" @click="ctx.teamSettings()">Set one up</button>.</li>
          <li v-for="t in teams" :key="t.id">
            <div class="r">
              <span class="r-icon"><img src="/images/agnt-logo-mark.svg" alt="" style="width: 15px" /></span>
              <span class="r-text"><strong>{{ t.name }}</strong><small>{{ roleLabel(t.role) }}</small></span>
              <button type="button" class="primary sm" @click="ctx.openTeam(t)">Open</button>
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
import TeamAvatar from './TeamAvatar.vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import TeamTaskRow from './TeamTaskRow.vue';
import TeamCheckpointRow from './TeamCheckpointRow.vue';
import TeamRunRow from './TeamRunRow.vue';
import TeamPluginRequestRow from './TeamPluginRequestRow.vue';
import { usePluginRequests } from '@/composables/usePluginRequests.js';
import { teamApi } from './useTeam.js';
import { roleLabel } from '@/utils/teamClient.js';
import { partOfDay, spaceEmoji } from './teamModel.js';

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
// Plugin requests: the ones you decide, and your own once decided (until dismissed).
const plugins = usePluginRequests();
const pluginAsks = computed(() => (plugins.state.canDecide ? plugins.state.pending : []));
const pluginOutcomes = computed(() => plugins.state.mine.filter((r) => r.status !== 'pending'));
const deciding = ref(null);
async function decidePlugin(request, approve) {
  deciding.value = request.id;
  try {
    const result = approve ? await plugins.approve(request.id) : await plugins.decline(request.id);
    const name = request.pluginName.replace(/-plugin$/, '');
    ctx.toast(approve ? `Installed ${name}${result.approved > 1 ? ` for ${result.approved} people` : ''}. They’ve been told it’s ready.` : `Declined ${name}. They’ve been told.`);
  } catch (e) { ctx.toast(e.message); await plugins.load(); } finally { deciding.value = null; }
}
const approvePlugin = (r) => decidePlugin(r, true);
const declinePlugin = (r) => decidePlugin(r, false);
const needCount = computed(() => checkpointsWaiting.value.length + runsWaiting.value.length + teamNeeds.value.length + pluginAsks.value.length + pluginOutcomes.value.length);
const myTasks = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'person' && t.assignee.id === ctx.me.value));
const agentTasks = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'agent'));
const openCount = (id) => tasks.value.filter((t) => t.workspaceId === id && t.status !== 'done').length;
/** The mockup's sentence: "7 things need you, 4 tasks on your plate and 2 agent jobs in flight." */
const lead = computed(() => {
  const n = needCount.value;
  const need = n ? `${n} ${n === 1 ? 'thing needs' : 'things need'} you, ` : 'Nothing needs you, ';
  if (!team.value) return `${need.replace(/, $/, '.')} This is your personal space; everything here is private to you.`;
  const plate = myTasks.value.length, jobs = agentTasks.value.length;
  return `${need}${plate} ${plate === 1 ? 'task' : 'tasks'} on your plate and ${jobs} agent ${jobs === 1 ? 'job' : 'jobs'} in flight.`;
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
watch(() => [ctx.version.value, spaces.value.length, team.value?.id], () => { load(); plugins.load(); });
onMounted(() => { load(); ctx.checkpoints.loadPending(); ctx.loadRoutineRuns(); plugins.load(); });
</script>
