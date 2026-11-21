<!-- Activity: Home's full history, newest first: teamspace activity (tasks,
     docs, chat, members) and every run. What needs a look is pinned on top. -->
<template>
  <div class="mk mk-page">
    <div class="content">
      <div class="page">
        <div class="page-head"><div><h1>Activity</h1><p>Everything Annie{{ team.state.team ? ' and your team' : '' }} did for you, newest first.</p></div></div>
        <nav class="tabs" role="tablist" aria-label="Show">
          <button
            v-for="k in kinds"
            :key="k.id"
            type="button"
            role="tab"
            class="tab focused-tab"
            :class="{ 'is-active': kind === k.id, active: kind === k.id }"
            :aria-selected="kind === k.id ? 'true' : 'false'"
            :data-kind="k.id"
            @click="kind = k.id"
          >{{ k.label }}</button>
        </nav>
        <ul v-if="loading && !rows.length" class="list"><li class="empty">Loading…</li></ul>
        <ul v-else-if="!rows.length" class="list"><li class="empty">{{ kind !== 'all' ? 'Nothing here yet.' : 'No activity yet. Start a chat and it shows up here.' }}</li></ul>
        <template v-else>
          <div data-testid="activity-list" data-tour-id="traces.list">
            <section v-for="group in groups" :key="group.id" class="v2-section" :data-group="group.id">
              <div class="v2-sec-head"><h2>{{ group.label }}<span class="v2-sec-count">{{ group.rows.length }}</span></h2></div>
              <ul class="list" :class="{ 'v2-needs': group.id === 'needs' }">
                <li v-for="r in group.rows" :key="r.id">
                  <!-- What a person did in a teamspace. -->
                  <button v-if="r.kind === 'team'" type="button" class="r" data-kind="team" @click="openTeam(r)">
                    <TeamAvatar :who="{ kind: 'person', id: r.actorId }" :label="personName(r.actorId) || r.actor" size="lg" />
                    <span class="r-text">
                      <strong style="white-space: normal">{{ r.actor }} <span style="font-weight: 400; color: var(--text-secondary)">{{ r.sentence }}</span></strong>
                      <small>Teamspace<template v-if="r.where"> · {{ r.where }}</template></small>
                    </span>
                    <span class="v2-time">{{ ago(r.at) }}</span>
                  </button>
                  <!-- A run: a chat with Annie, an agent, a workflow or a routine. -->
                  <button v-else type="button" class="r" :data-kind="r.kind" @click="nav.go({ page: 'activity', item: r.id })">
                    <span class="r-icon" :class="'v2-kind-' + r.kind"><MkIcon :name="KIND_ICON[r.kind] || 'activity'" /></span>
                    <span class="r-text">
                      <span class="v2-title-row"><strong>{{ r.title }}</strong><span class="tag" :class="TONE[r.status.tone] || ''">{{ r.status.label }}</span></span>
                      <small>{{ KIND_LABEL[r.kind] }}<template v-if="r.detail"> · {{ r.detail }}</template></small>
                    </span>
                    <span class="v2-time">{{ ago(r.at) }}</span>
                    <MkIcon name="chev" size="sm" class="v2-go" />
                  </button>
                </li>
              </ul>
            </section>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import '@/views/One/mk/mk.css';
import '@/views/One/mk/mk-frame.css';
import TeamAvatar from '@/views/One/team/TeamAvatar.vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { useTeam, teamApi } from '@/views/One/team/useTeam.js';
import { teamRequest } from '@/utils/teamClient.js';
import { ACTIVITY_KINDS, activityRows, teamActivityRows, activityGroups } from './focusedActivity.js';

const store = useStore();
const nav = inject('focusedNav');
const team = useTeam(store);
// The mockup's tag tones for each run outcome.
const TONE = Object.freeze({ ok: 'green', success: 'green', good: 'green', done: 'green', running: 'blue', live: 'blue', warn: 'amber', bad: 'amber', error: 'amber', failed: 'amber', stopped: '' });
const KIND_LABEL = Object.freeze({ chat: 'Chat with Annie', agent: 'Agent', workflow: 'Automation', routine: 'Goal' });
const KIND_ICON = Object.freeze({ chat: 'chats', agent: 'bot', workflow: 'bolt', routine: 'task' });
const CAP = 300;
const kind = ref('all');
const loading = ref(false);
const teamRows = ref([]);

const kinds = computed(() => (team.state.team ? ACTIVITY_KINDS : ACTIVITY_KINDS.filter((k) => k.id !== 'team')));
const runRows = computed(() => activityRows(store.getters['executionHistory/getExecutions'] || [], { kind: kind.value === 'team' ? 'none' : kind.value }));
const rows = computed(() => {
  const team_ = kind.value === 'all' || kind.value === 'team' ? teamRows.value : [];
  return [...team_, ...runRows.value].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
});
// What needs a look first, then by day; a long history shows its newest rows.
const groups = computed(() => {
  const { needs, days } = activityGroups(rows.value.slice(0, CAP));
  return [...(needs.length ? [{ id: 'needs', label: 'Needs a look', rows: needs }] : []), ...days];
});

/** The team's events, named from the lists this person may read. */
async function loadTeam() {
  const t = team.state.team;
  if (!t) { teamRows.value = []; return; }
  const spaces = team.state.spaces || [];
  const [events, lists] = await Promise.all([
    teamRequest('/' + encodeURIComponent(t.id) + '/activity').catch(() => []),
    Promise.all(spaces.map(async (s) => ({ s, tasks: await teamApi.tasks(s.id).catch(() => []), docs: await teamApi.docs(s.id).catch(() => []) }))),
  ]);
  // Your own private My Space cards are yours to see in your activity.
  const home = spaces.find((s) => s.is_default) || spaces[0];
  const mine = home ? await teamApi.tasks(home.id, { private: true }).catch(() => []) : [];
  // Each list is read per teamspace, so the teamspace is known even when a row does not carry it.
  const tasks = new Map([...lists.flatMap((l) => l.tasks.map((x) => ({ workspaceId: l.s.id, ...x }))), ...mine.map((x) => ({ workspaceId: home.id, ...x }))].map((x) => [x.id, x]));
  const docs = new Map(lists.flatMap((l) => l.docs.map((d) => ({ ...d, workspaceId: d.workspaceId || l.s.id }))).map((d) => [d.id, d]));
  teamRows.value = teamActivityRows(events, {
    spaces: new Map(spaces.map((s) => [s.id, s])), tasks, docs,
    people: new Map((team.state.members || []).map((p) => [p.id, p.name])), me: team.state.me,
  });
}
/** The real name behind "You", for the avatar's initials. */
const personName = (id) => (team.state.members || []).find((p) => p.id === id)?.name || '';
function openTeam(r) {
  const target = r.target;
  if (!target) return;
  if (target.type === 'task') nav.go({ page: 'team', view: 'space', space: target.space, tab: 'board', task: target.id });
  else if (target.type === 'doc') nav.go({ page: 'team', view: 'doc', space: target.space, doc: target.id });
  else if (target.type === 'space') nav.go({ page: 'team', view: 'space', space: target.space });
  else if (target.type === 'members') nav.go({ page: 'team', view: 'members' });
}

function ago(at) {
  if (!at) return '';
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(at).toLocaleDateString();
}

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([
      store.dispatch('executionHistory/fetchExecutions', { forceRefresh: true }),
      (store.getters['contentOutputs/outputs'] || []).length ? null : store.dispatch('contentOutputs/fetchOutputs').catch(() => {}),
      loadTeam().catch((e) => console.warn('[Activity] team events:', e?.message || e)),
    ]);
  } finally {
    loading.value = false;
  }
});
</script>
