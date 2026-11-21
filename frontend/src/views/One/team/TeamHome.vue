<template>
  <div class="content">
    <div class="page">
      <h1 class="greet">Good {{ partOfDay() }}{{ firstName ? ', ' + firstName : '' }}.</h1>
      <!-- In a team, a status line: what has stopped, what is working, which team is at its limit. Each count goes to its list. -->
      <div v-if="team" class="flow-status" data-testid="flow-status">
        <button v-for="s in status" :key="s.id" type="button" class="flow-stat" :class="'is-' + s.tone" @click="goTo(s.target)">
          <span v-if="s.tone === 'working'" class="pulse" aria-hidden="true"></span><span v-else class="flow-dot" aria-hidden="true"></span>{{ s.label }}
        </button>
      </div>
      <p v-else class="lead">{{ lead }}</p>
      <div class="chips">
        <button type="button" class="chip" @click="ctx.ask('')"><MkIcon name="chats" />Ask Annie</button>
        <button type="button" class="chip" @click="ctx.create('doc')"><MkIcon name="doc" />New file</button>
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
          <button v-if="reviewTasks.length" type="button" class="primary sm" data-testid="review-sitting-open" @click="sitting = [...reviewTasks]">Review {{ reviewTasks.length === 1 ? 'the agent result' : `${reviewTasks.length} agent results` }}</button>
          <button v-if="team" type="button" class="btn ghost sm" :disabled="!ctx.unread.value" @click="readAll"><MkIcon name="check" size="xs" />Mark all read</button>
        </div>
        <div class="hm-inbox-b">
          <template v-if="tab === 'needs'">
            <div ref="stoppedRef" class="flow-group" data-group="stopped">
              <div v-if="stoppedCount" class="hm-sub">Stopped until you answer<span v-if="stoppedTasks.length > 1" class="hm-sub-note">sorted by what they hold up</span></div>
              <ul v-if="stoppedTasks.length" class="list" data-testid="stuck-tasks"><li v-for="t in stoppedTasks" :key="t.id"><TeamTaskRow :task="t" @open="openTask" /></li></ul>
              <ul v-if="waitingRoutines.length" class="list" data-testid="routines-waiting">
                <li v-for="run in waitingRoutines" :key="run.id">
                  <div class="r">
                    <span class="r-icon"><MkIcon name="routines" /></span>
                    <span class="r-text"><strong>{{ run.routineName }}</strong><small>Routine · {{ run.error || 'It has a question for you' }} · {{ since(run.fired_at) }}</small></span>
                    <span class="tag amber">Your answer</span>
                    <button type="button" class="primary sm" @click="ctx.openRoutine(run.routineId)">Answer</button>
                  </div>
                </li>
              </ul>
              <ul v-if="brokenRoutines.length" class="list" data-testid="broken-routines"><li v-for="r in brokenRoutines" :key="r.id"><TeamRunRow :run="r" /></li></ul>
              <ul v-if="appsToConnect.length" class="list" data-testid="apps-to-connect">
              <li v-for="card in appsToConnect" :key="card.id">
                <div class="r" :data-app="card.id">
                  <span class="r-icon"><SvgIcon :name="brandIcon(card.providerId, card.icon)" /></span>
                  <span class="r-text">
                    <strong>{{ card.name }}</strong>
                    <small>{{ card.status === 'reconnect' ? 'Its sign-in stopped working' : 'Not connected yet' }}<template v-if="describeApps(card)"> · {{ describeApps(card) }} can’t run until then</template></small>
                  </span>
                  <button type="button" class="primary sm" :disabled="signIn.busy.value" @click="connectApp(card)">{{ card.status === 'reconnect' ? 'Reconnect' : 'Connect' }}</button>
                </div>
              </li>
              </ul>
            </div>
            <div v-if="readyCount" class="hm-sub">Ready for your review</div>
            <ul v-if="reviewGoals.length" class="list" data-testid="goals-review">
              <li v-for="goal in reviewGoals" :key="goal.id">
                <div class="r">
                  <span class="r-icon"><MkIcon name="task" /></span>
                  <span class="r-text"><strong>{{ goal.title || 'Untitled goal' }}</strong><small>Goal · finished, waiting for your review · {{ since(goal.updated_at || goal.created_at) }}</small></span>
                  <span class="tag pink">Your OK</span>
                  <button type="button" class="primary sm" @click="ctx.openGoal(goal.id)">Review</button>
                </div>
              </li>
            </ul>
            <ul v-if="checkpointsWaiting.length" class="list"><li v-for="c in checkpointsWaiting" :key="c.id"><TeamCheckpointRow :checkpoint="c" /></li></ul>
            <ul v-if="reviewTasks.length" class="list" data-testid="review-tasks"><li v-for="t in reviewTasks" :key="t.id"><TeamTaskRow :task="t" @open="openTask" /></li></ul>
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

      <!-- Routines: what got done while you were away, and what runs next without you. -->
      <div v-if="doneToday.length || upcoming.length" ref="routinesRef" class="two" data-testid="home-routines">
        <div>
          <div class="sec-head"><h3>Done while you were away</h3><button type="button" class="btn ghost sm" @click="ctx.openPage('scheduled')">Routines</button></div>
          <ul class="list">
            <li v-if="!doneToday.length" class="empty">Nothing has finished in the last day.</li>
            <li v-for="run in doneToday" :key="run.id">
              <button type="button" class="r" @click="ctx.openRoutine(run.routineId)">
                <span class="r-icon"><MkIcon name="routines" /></span>
                <span class="r-text"><strong>{{ run.routineName }}</strong><small>Routine · {{ since(run.fired_at) }}</small></span>
                <span class="tag green">Done</span>
                <span class="r-go">Open result</span>
              </button>
            </li>
          </ul>
        </div>
        <div>
          <div class="sec-head"><h3>Coming up</h3></div>
          <ul class="list">
            <li v-if="!upcoming.length" class="empty">Nothing scheduled.</li>
            <li v-for="row in upcoming" :key="row.id">
              <button type="button" class="r" @click="ctx.openRoutine(row.id)">
                <span class="r-icon"><MkIcon name="routines" /></span>
                <span class="r-text"><strong>{{ row.label }}</strong><small>{{ formatNextRun(row.next) }} · {{ row.cadence }}</small></span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      <!-- A team without teamspaces: one line, not two empty panels. -->
      <template v-if="team && !spaces.length">
        <div class="sec-head"><h3>Your team</h3></div>
        <ul class="list" data-testid="team-no-spaces">
          <li>
            <div class="r">
              <span class="r-icon"><MkIcon name="users" /></span>
              <span class="r-text"><strong>{{ team.name }}</strong><small>No teamspaces yet. A teamspace shares chat, a board, files and agents.</small></span>
              <button v-if="canCreateSpace" type="button" class="btn sm" @click="ctx.newTeamspace()">Create a teamspace</button>
            </div>
          </li>
        </ul>
      </template>
      <template v-else-if="team">
        <div class="two">
          <div>
            <div class="sec-head"><h3>My tasks</h3><button type="button" class="btn ghost sm" @click="ctx.go({ view: 'mine' })">All</button></div>
            <ul class="list">
              <li v-if="!myTasks.length" class="empty">{{ loading ? 'Loading…' : 'No open tasks assigned to you.' }}</li>
              <li v-for="t in myTasks.slice(0, 6)" :key="t.id"><TeamTaskRow :task="t" @open="openTask" /></li>
            </ul>
          </div>
          <div ref="teamsRef">
            <div class="sec-head"><h3>Teams at work</h3><button type="button" class="btn ghost sm" @click="ctx.openPage('activity')">Activity</button></div>
            <ul class="list" data-testid="teams-at-work">
              <li v-if="!teamRows.length" class="empty">{{ loading ? 'Loading…' : 'No teamspaces yet.' }}</li>
              <li v-for="row in teamRows" :key="row.space.id">
                <button type="button" class="r" :data-space="row.space.id" @click="ctx.go({ view: 'space', space: row.space.id, tab: 'board' })">
                  <span class="r-icon" aria-hidden="true">{{ spaceEmoji(row.space) }}</span>
                  <span class="r-text"><strong>{{ row.space.name }}</strong><small>{{ row.line.text }}</small></span>
                  <span v-if="row.line.tag" class="tag" :class="row.line.tag.tone">{{ row.line.tag.label }}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="sec-head"><h3>Your teams</h3></div>
        <ul class="list">
          <li v-if="!teams.length" class="empty">You are not on a team yet. A team shares chat, a board, files and agents, each person keeping their own private space. <button type="button" class="link" @click="ctx.teamSettings()">Set one up</button>.</li>
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
    <TeamReviewSitting v-if="sitting" :tasks="sitting" @changed="ctx.loadBoards()" @close="closeSitting" />
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted, nextTick } from 'vue';
import TeamInboxRow from './TeamInboxRow.vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import TeamTaskRow from './TeamTaskRow.vue';
import TeamCheckpointRow from './TeamCheckpointRow.vue';
import TeamRunRow from './TeamRunRow.vue';
import TeamPluginRequestRow from './TeamPluginRequestRow.vue';
import TeamReviewSitting from './TeamReviewSitting.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { usePluginRequests } from '@/composables/usePluginRequests.js';
import { useAppCards } from '@/composables/useAppCards.js';
import { useAppSignIn } from '@/views/Focused/useAppSignIn.js';
import { findAppCard, describeApps } from '@/services/appCards.js';
import { brandIcon } from '@/services/brandIcons.js';
import { cardNeedsYou } from '@/services/pluginDirectory.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import { useStore } from 'vuex';
import { teamApi } from './useTeam.js';
import { roleLabel } from '@/utils/teamClient.js';
import { partOfDay, spaceEmoji, tasksNeedingMe, routinesNeedingALook, spaceFlow, teamFlowLine, byWhatTheyHoldUp, plural, ago, doneRecently, comingUp } from './teamModel.js';
import { usePersonalNeeds } from './usePersonalNeeds.js';
import { scheduleRows } from '@/views/Focused/focusedModel.js';
import { formatNextRun } from '@/views/Focused/focusedTime.js';

const TABS = [{ id: 'needs', label: 'Needs you' }, { id: 'mentions', label: 'Mentions' }, { id: 'runs', label: 'Runs' }, { id: 'all', label: 'All' }];
const props = defineProps({ initialTab: { type: String, default: 'needs' } });
const ctx = inject('teamCtx');
const nav = inject('focusedNav');
const store = useStore();
const team = computed(() => ctx.team.value);
const teams = computed(() => ctx.teams.value);
const spaces = computed(() => ctx.spaces.value);
const firstName = computed(() => ctx.people.value.find((p) => p.isMe)?.first || '');
const tab = ref(TABS.some((t) => t.id === props.initialTab) ? props.initialTab : 'needs');
// Every teamspace's board, from the shared team state (the drawer reads the same boards).
const tasks = computed(() => spaces.value.flatMap((s) => ctx.boards.value[s.id] || []));
const loading = ref(true);
const sitting = ref(null);
const stoppedRef = ref(null);
const teamsRef = ref(null);
const routinesRef = ref(null);

const checkpointsWaiting = computed(() => ctx.checkpoints.state.pending);
const runs = computed(() => ctx.routineRuns.value);
const runsLoaded = computed(() => ctx.routineRunsLoaded.value);
const runsWaiting = computed(() => runs.value.filter((r) => r.status === 'needs_review'));
const brokenRoutines = computed(() => routinesNeedingALook(runs.value));
// Your own work waiting on you: routines with a question, goals waiting for review (shared with the rail badge).
const personal = usePersonalNeeds(store);
const waitingRoutines = personal.waitingRoutines;
const reviewGoals = personal.reviewGoals;
const routineRows = computed(() => scheduleRows(store.getters['schedules/allSchedules'], '', store.getters['goals/allGoals']));
const doneToday = computed(() => doneRecently(runs.value));
const upcoming = computed(() => comingUp(routineRows.value, new Set(waitingRoutines.value.map((run) => String(run.routineId)))));
const canCreateSpace = computed(() => ['owner', 'admin'].includes(ctx.role?.value));
/** "3d ago", "just now". */
function since(at) {
  const text = ago(at);
  return !text || text === 'just now' ? text : `${text} ago`;
}
// Yours: you made the card or it is assigned to you. Stopped ones first, by what they hold up.
const cardsNeedingMe = computed(() => tasksNeedingMe(tasks.value, ctx.me.value));
const stoppedTasks = computed(() => byWhatTheyHoldUp(cardsNeedingMe.value.filter((t) => t.agentState === 'blocked')));
const reviewTasks = computed(() => cardsNeedingMe.value.filter((t) => t.agentState === 'waiting'));
const openTask = (t) => ctx.go({ view: 'space', space: t.workspaceId, tab: 'board', task: t.id });

// Your apps whose sign-in is missing or failing: the same test the Apps page's "Needs you" uses.
const { cards } = useAppCards();
const appsToConnect = computed(() => (cards.value.yours || []).filter((card) => cardNeedsYou(card)));
const signIn = useAppSignIn({ store, nav, findCard: (id) => findAppCard(cards.value, id) });
const isModelProvider = (id) => AI_PROVIDERS_WITH_API.some((p) => p.toLowerCase() === String(id).toLowerCase());
/** Starts the sign-in right here; model keys live in Settings, and a sign-in AGNT cannot start opens Apps. */
function connectApp(card) {
  if (card.providerId && isModelProvider(card.providerId)) return nav.go({ page: 'settings' });
  if (!card.connectable || !card.providerId) return nav.go({ page: 'connectors', item: card.apps?.[0] ? `app:${card.apps[0].name}` : null });
  return signIn.signIn(card);
}
// An approval for a card already listed under Ready for your review is not listed twice.
const reviewIds = computed(() => new Set(reviewTasks.value.map((t) => t.id)));
const teamNeeds = computed(() => ctx.inbox.value.filter((i) => (!i.read || (i.kind === 'approval' && i.state === 'pending'))
  && !(i.kind === 'approval' && i.target?.kind === 'task' && reviewIds.value.has(i.target.id))));
const mentions = computed(() => ctx.inbox.value.filter((i) => i.kind === 'mention'));
// Plugin requests: the ones you decide, and your own once decided (until dismissed).
const plugins = usePluginRequests();
const pluginAsks = computed(() => (plugins.state.canDecide ? plugins.state.pending : []));
// Your own requests: waiting ones too, so asking never looks like nothing happened.
const pluginOutcomes = computed(() => plugins.state.mine);
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
const stoppedCount = computed(() => stoppedTasks.value.length + waitingRoutines.value.length + brokenRoutines.value.length + appsToConnect.value.length);
const readyCount = computed(() => checkpointsWaiting.value.length + reviewTasks.value.length + runsWaiting.value.length + reviewGoals.value.length);
const needCount = computed(() => stoppedCount.value + readyCount.value + teamNeeds.value.length + pluginAsks.value.length + pluginOutcomes.value.length);
const myTasks = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'person' && t.assignee.id === ctx.me.value));

// Teams at work: one line per teamspace this person can see, from its board and its work limits.
const teamRows = computed(() => spaces.value
  .filter((s) => ctx.boards.value[s.id])
  .map((s) => {
    const flow = spaceFlow(ctx.boards.value[s.id], ctx.limits.value[s.id] || {});
    return { space: s, flow, line: teamFlowLine(flow) };
  }));
// The status line: everything waiting on you, then what ran and what runs next. Calm when nothing needs you.
const status = computed(() => {
  const needs = needCount.value;
  const working = teamRows.value.reduce((sum, row) => sum + row.flow.working, 0);
  const atLimit = teamRows.value.filter((row) => row.flow.atLimit).length;
  const next = upcoming.value[0];
  return [
    { id: 'needs', tone: needs ? 'alert' : 'calm', target: 'stopped', label: needs ? `${needs} need${needs === 1 ? 's' : ''} you` : 'Nothing needs you' },
    doneToday.value.length && { id: 'done', tone: 'calm', target: 'routines', label: `${plural(doneToday.value.length, 'routine')} ran today` },
    teamRows.value.length && { id: 'working', tone: 'working', target: 'teams', label: `${working} working` },
    atLimit && { id: 'limit', tone: 'warn', target: 'teams', label: atLimit === 1 ? '1 team at its work limit' : `${atLimit} teams at their work limit` },
    next && { id: 'next', tone: 'plain', target: 'routines', label: `Next: ${next.label}, ${formatNextRun(next.next)}` },
  ].filter(Boolean);
});
async function goTo(target) {
  if (target === 'stopped') tab.value = 'needs';
  // After the tab switch renders, so the list is there to scroll to.
  await nextTick();
  const refs = { stopped: stoppedRef, teams: teamsRef, routines: routinesRef };
  refs[target]?.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}
function closeSitting() {
  sitting.value = null;
  ctx.loadBoards();
}
/** Outside a team there is no status line: one sentence instead. */
const lead = computed(() => {
  const n = needCount.value;
  return `${n ? `${n} ${n === 1 ? 'thing needs' : 'things need'} you.` : 'Nothing needs you.'} This is your personal space; everything here is private to you.`;
});

async function readAll() {
  try { await teamApi.markAllRead(); ctx.markLocalRead(null); } catch (e) { ctx.toast(e.message); }
}
/** Every teamspace's board, from the shared team state. */
async function load() {
  if (team.value) await ctx.loadBoards();
  loading.value = false;
}
watch(() => props.initialTab, (value) => { if (TABS.some((t) => t.id === value)) tab.value = value; });
watch(() => [spaces.value.length, team.value?.id], load);
watch(() => ctx.version.value, () => plugins.load());
onMounted(() => { load(); ctx.checkpoints.loadPending(); personal.load(); plugins.load(); });
</script>

<style scoped>
/* The status line under the greeting; tones follow the board's tags (mk.css). */
.flow-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 2px 0 16px; }
.flow-stat { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--raised); color: var(--text-primary); font-size: 14px; }
.flow-stat:hover { border-color: var(--border-strong); background: var(--surface-hover); }
.flow-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--green-text); }
.flow-stat.is-alert { border-color: rgba(var(--pink-rgb), 0.35); background: rgba(var(--pink-rgb), 0.06); }
.flow-stat.is-alert .flow-dot { background: var(--pink); }
.flow-stat.is-warn { border-color: rgba(var(--orange-rgb), 0.4); background: rgba(var(--orange-rgb), 0.07); }
.flow-stat.is-warn .flow-dot { background: var(--amber-text); }
.flow-stat.is-plain .flow-dot { background: var(--text-tertiary); }
.hm-sub-note { margin-left: 8px; text-transform: none; letter-spacing: 0; font-size: 12px; }
</style>
