<template>
  <!-- The approved mockup's Agents page: yours (private), then each teamspace's. -->
  <div class="content">
    <div class="page">
      <div class="page-head">
        <div><h1>Agents</h1><p>Your private agents, and the ones each teamspace has published. Agents show up as members: @mention them or assign them a card.</p></div>
        <button type="button" class="primary" @click="ctx.create('agent')"><MkIcon name="plus" size="sm" />New agent</button>
      </div>
      <div class="sec-head"><h3><MkIcon name="lock" size="xs" /> Mine · private</h3></div>
      <div class="cards">
        <div class="card clickable" @click="ctx.ask('')">
          <div class="card-top"><span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span><div><h4>Annie</h4><div class="mk-muted">Built in</div></div></div>
          <p>Your assistant. Knows everything you can see, nothing you can’t.</p>
          <div class="card-foot"><span class="tag pink">Always on</span></div>
        </div>
        <template v-if="!team">
          <div v-for="a in mine" :key="a.id" class="card clickable" @click="ctx.go({ view: 'agent', item: String(a.id) })">
            <div class="card-top"><span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span><div style="min-width: 0"><h4>{{ a.name }}</h4><div class="mk-muted">by you</div></div></div>
            <p>{{ a.description || 'No description yet.' }}</p>
            <div class="card-foot"><span class="tag">Draft</span><span>{{ (a.assignedTools || []).length }} tools</span><span class="fill"></span><span class="scope sm mk-private"><MkIcon name="lock" size="sm" />Private</span></div>
          </div>
        </template>
        <div v-else class="card">
          <div class="card-top"><span class="r-icon"><MkIcon name="lock" size="sm" /></span><div><h4>Your private agents</h4></div></div>
          <p>They live in your Personal space. Copy one in from there to share it with a teamspace.</p>
        </div>
      </div>
      <template v-if="team">
        <!-- Each teamspace's agents are a team: its numbers, its team lead, and what each agent is doing. -->
        <section v-for="s in spaces" :key="s.id" class="agent-team" :data-team="s.id">
          <div class="team-head">
            <h3>{{ spaceEmoji(s) }} {{ s.name }}</h3>
            <div class="team-kpis" :data-testid="`team-kpis-${s.id}`">
              <span class="tag" :class="{ amber: flowOf(s.id).atLimit }">{{ wipLabel(s.id) }}</span>
              <span v-if="flowOf(s.id).firstTimeRate !== null" class="tag green">{{ flowOf(s.id).firstTimeRate }}% accepted first time · 7 days</span>
              <span v-if="flowOf(s.id).stopped" class="tag amber">{{ flowOf(s.id).stopped }} stopped</span>
              <span v-if="flowOf(s.id).toReview" class="tag pink">{{ flowOf(s.id).toReview }} to review</span>
              <span v-if="flowOf(s.id).costPerAccepted !== null" class="tag" v-tooltip="costNote(s.id)">{{ formatUsd(flowOf(s.id).costPerAccepted) }} per accepted card</span>
            </div>
            <span class="fill"></span>
            <button v-if="canManage" type="button" class="btn ghost sm" :aria-expanded="String(editing === s.id)" @click="editLead(s.id)">Team lead</button>
            <button type="button" class="btn ghost sm" @click="ctx.go({ view: 'space', space: s.id, tab: 'board' })">Open board</button>
          </div>
          <form v-if="editing === s.id" class="lead-form" :data-testid="`lead-form-${s.id}`" @submit.prevent="saveLead(s.id)">
            <p class="mk-muted">The team lead answers this team’s stopped cards first and passes on only what it cannot decide. Its rules are what it may decide on its own.</p>
            <label class="mk-label" :for="`lead-${s.id}`">Team lead</label>
            <CustomSelect :id="`lead-${s.id}`" v-model="leadDraft.agentId" :options="leadOptions(s.id)" aria-label="Team lead" />
            <label class="mk-label" :for="`rules-${s.id}`">Its rules</label>
            <textarea :id="`rules-${s.id}`" v-model="leadDraft.rules" class="field" rows="3" maxlength="1000" placeholder="e.g. Settle price differences under 15%. Never move money."></textarea>
            <div class="row-gap"><button type="submit" class="primary sm" :disabled="savingLead">Save</button><button type="button" class="btn ghost sm" @click="editing = null">Cancel</button></div>
          </form>
          <div class="cards">
            <div v-for="a in bySpace[s.id] || []" :key="a.id" class="card clickable" :data-agent="a.id" @click="openAgent(s.id, a.id)">
              <div class="card-top">
                <span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
                <div style="min-width: 0; flex: 1"><h4>{{ a.name }}</h4><div class="mk-muted">{{ s.name }}</div></div>
                <span v-if="isLead(s.id, a.id)" class="tag pink">Team lead</span>
              </div>
              <p v-if="isLead(s.id, a.id) && leads[s.id]?.leadRules" class="lead-rules"><b>Rules:</b> {{ leads[s.id].leadRules }}</p>
              <div class="agent-state" :class="'is-' + statusOf(s.id, a.id).tone" data-testid="agent-state">
                <span v-if="statusOf(s.id, a.id).tone === 'working'" class="pulse" aria-hidden="true"></span><span v-else class="state-dot" aria-hidden="true"></span>
                <span class="state-text">{{ statusOf(s.id, a.id).label }}</span>
              </div>
              <div class="card-foot"><span class="tag" :class="a.status === 'published' ? 'green' : ''">{{ a.status === 'published' ? 'Published' : a.status === 'changed' ? 'Changed since publishing' : 'Draft' }}</span><span class="fill"></span><span class="scope sm"><MkIcon name="users" size="sm" />{{ s.name }}</span></div>
            </div>
            <div v-if="loaded && !(bySpace[s.id] || []).length" class="empty">None yet</div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './MkIcon.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { teamApi } from '@/views/One/team/useTeam.js';
import { spaceEmoji, spaceFlow, agentStatus, columnLoad, formatUsd } from '@/views/One/team/teamModel.js';

const ctx = inject('teamCtx');
const store = useStore();
const team = computed(() => ctx.team.value);
const spaces = computed(() => ctx.spaces.value);
const mine = computed(() => store.getters['agents/allAgents'] || []);
const bySpace = ref({});
const leads = ref({});
const loaded = ref(false);
const editing = ref(null);
const savingLead = ref(false);
const leadDraft = reactive({ agentId: '', rules: '' });
const canManage = computed(() => ['owner', 'admin'].includes(ctx.role?.value));

// A team's numbers and its agents' states come from its board (shared team state).
const boardOf = (spaceId) => ctx.boards?.value?.[spaceId] || [];
const flowOf = (spaceId) => spaceFlow(boardOf(spaceId), ctx.limits?.value?.[spaceId] || {});
const statusOf = (spaceId, agentId) => agentStatus(agentId, boardOf(spaceId));
function wipLabel(spaceId) {
  const load = columnLoad(flowOf(spaceId).doing, ctx.limits?.value?.[spaceId]?.doing);
  return load.max ? `${load.label} in progress${load.full ? ' · at limit' : ''}` : `${load.count} in progress`;
}
function costNote(spaceId) {
  const flow = flowOf(spaceId);
  const of = flow.reviewed > flow.pricedCount ? ` ${flow.pricedCount} of ${flow.reviewed} accepted cards could be priced.` : '';
  return `Average model cost of the runs behind each card accepted in the last 7 days, rework included, at list prices before any prompt-cache savings.${of}`;
}
const isLead = (spaceId, agentId) => leads.value[spaceId]?.leadAgentId === String(agentId);
const leadOptions = (spaceId) => [{ label: 'No team lead', value: '' }, ...(bySpace.value[spaceId] || []).map((a) => ({ label: a.name, value: String(a.id) }))];
const openAgent = (spaceId) => ctx.go({ view: 'space', space: spaceId, tab: 'agents' });
function editLead(spaceId) {
  if (editing.value === spaceId) { editing.value = null; return; }
  leadDraft.agentId = leads.value[spaceId]?.leadAgentId || '';
  leadDraft.rules = leads.value[spaceId]?.leadRules || '';
  editing.value = spaceId;
}
async function saveLead(spaceId) {
  savingLead.value = true;
  try {
    leads.value = { ...leads.value, [spaceId]: await teamApi.setLead(spaceId, leadDraft.agentId || null, leadDraft.rules) };
    editing.value = null;
    ctx.toast(leadDraft.agentId ? 'Team lead saved. It answers this team’s stops first.' : 'This team has no team lead now. Stops come straight to a person.');
  } catch (error) {
    ctx.toast(error.message);
  } finally {
    savingLead.value = false;
  }
}

onMounted(async () => {
  if (!team.value) {
    if (!mine.value.length) store.dispatch('agents/fetchAgents').catch(() => {});
    loaded.value = true;
    return;
  }
  ctx.loadBoards?.();
  const entries = await Promise.all(spaces.value.map(async (s) => {
    const [native, lead] = await Promise.all([teamApi.native(s.id).catch(() => []), teamApi.lead(s.id).catch(() => null)]);
    return [s.id, native.filter((x) => x.kind === 'agent'), lead];
  }));
  bySpace.value = Object.fromEntries(entries.map(([id, agents]) => [id, agents]));
  leads.value = Object.fromEntries(entries.filter(([, , lead]) => lead).map(([id, , lead]) => [id, lead]));
  loaded.value = true;
});
</script>

<style scoped>
/* A team of agents: its heading with its numbers, its team lead, and each agent's state. */
.agent-team { margin-top: 26px; }
.team-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin: 0 2px 10px; }
.team-head h3 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-tertiary); }
.team-kpis { display: flex; flex-wrap: wrap; gap: 6px; }
.lead-form { display: grid; gap: 6px; max-width: 560px; margin: 0 0 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--raised); }
.lead-form .mk-muted { margin: 0 0 4px; }
.lead-form .mk-label { margin: 6px 0 0; }
.lead-rules { margin: 0; padding: 7px 9px; border-radius: 8px; background: var(--sunken); font-size: 12px; color: var(--text-secondary); }
.lead-rules b { color: var(--text-primary); font-weight: 600; }
.agent-state { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12.5px; color: var(--text-secondary); }
.state-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.state-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--text-tertiary); }
.agent-state.is-stopped { color: var(--amber-text); font-weight: 500; }
.agent-state.is-stopped .state-dot { background: var(--amber-text); }
.agent-state.is-approval { color: var(--pink); font-weight: 500; }
.agent-state.is-approval .state-dot { background: var(--pink); }
.agent-state.is-paused { color: var(--blue-text); }
.agent-state.is-paused .state-dot { background: var(--blue-text); }
</style>
