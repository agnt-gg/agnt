<template>
  <InspectorShell
    :caption="caption"
    :title="view.title"
    :sub="view.sub"
    :icon="view.icon"
    :badge="view.badge"
    :badge-tone="view.badgeTone"
    :tone="view.tone"
    :tabs="view.tabs"
    :active-tab="tab"
    @update:tab="tab = $event"
    @close="$emit('close')"
  >
    <!-- ── AGENT ── -->
    <template v-if="kind === 'agent' && agent">
      <template v-if="tab === 'overview'">
        <dl class="kv">
          <dt>model</dt>
          <dd>{{ agent.model || agent.ai_model || 'global default' }}</dd>
          <dt>category</dt>
          <dd>{{ agent.category || '—' }}</dd>
          <dt>status</dt>
          <dd>{{ agent.status || 'active' }}</dd>
          <dt v-if="agent.creditLimit != null">credits</dt>
          <dd v-if="agent.creditLimit != null">{{ agent.creditsUsed || 0 }} / {{ agent.creditLimit }}</dd>
        </dl>
        <InspSection title="Does">
          <p class="muted">{{ agent.description || 'No description yet.' }}</p>
        </InspSection>
        <InspSection :title="`Tools · ${(agent.assignedTools || agent.tools || []).length}`" v-if="(agent.assignedTools || agent.tools || []).length">
          <div v-for="t in (agent.assignedTools || agent.tools || []).slice(0, 12)" :key="String(t.id || t)" class="li">
            <span class="tag">tool</span><span class="nm">{{ t.name || t.title || t }}</span>
          </div>
        </InspSection>
      </template>
      <template v-else-if="tab === 'runs'">
        <div v-if="!agentRuns.length" class="muted">No runs yet.</div>
        <div v-for="r in agentRuns" :key="r.id" class="li" @click="inspectRun(r)">
          <span class="badge" :class="'b-' + statusTone(r.status)">{{ r.status }}</span>
          <span class="nm">{{ runDisplayName(r) }}</span>
          <span class="t">{{ when(runStartedAt(r)) }}</span>
        </div>
      </template>
    </template>

    <!-- ── WORKFLOW ── -->
    <template v-else-if="kind === 'workflow' && workflow">
      <template v-if="tab === 'steps'">
        <div v-if="!wfSteps.length" class="muted">This workflow has no nodes yet.</div>
        <div v-else class="wf">
          <div class="wf-spine"></div>
          <div v-for="(n, i) in wfSteps" :key="n.id" class="wf-node" :class="n.cls">
            <div class="wf-ty">{{ i + 1 }} · {{ n.category || n.type }}</div>
            <div class="wf-nm">{{ n.text || n.title || n.type }}</div>
          </div>
        </div>
      </template>
      <template v-else-if="tab === 'runs'">
        <div v-if="!wfRuns.length" class="muted">No runs yet.</div>
        <div v-for="r in wfRuns" :key="r.id" class="li" @click="inspectRun(r)">
          <span class="badge" :class="'b-' + statusTone(r.status)">{{ r.status }}</span>
          <span class="nm">{{ when(runStartedAt(r)) }}</span>
          <span class="t">{{ dur(r) }}</span>
        </div>
      </template>
      <template v-else>
        <dl class="kv">
          <dt>status</dt>
          <dd>{{ workflow.status || '—' }}</dd>
          <dt>nodes</dt>
          <dd>{{ wfSteps.length }}</dd>
          <dt>updated</dt>
          <dd>{{ when(workflow.updated_at) }}</dd>
        </dl>
        <p class="muted" v-if="workflow.description">{{ workflow.description }}</p>
      </template>
    </template>

    <!-- ── GOAL ── -->
    <template v-else-if="kind === 'goal' && goal">
      <dl class="kv">
        <dt>status</dt>
        <dd>{{ goal.status }}</dd>
        <dt>priority</dt>
        <dd>{{ goal.priority || 'medium' }}</dd>
        <dt>progress</dt>
        <dd>{{ goalProgress }}%</dd>
      </dl>
      <div class="bar"><i :style="{ width: goalProgress + '%' }"></i></div>
      <InspSection :title="`Tasks · ${goalTasks.length}`" v-if="goalTasks.length">
        <div v-for="t in goalTasks" :key="t.id" class="li">
          <span class="nm">{{ t.title || t.description }}</span>
          <span class="badge" :class="'b-' + statusTone(t.status)">{{ t.status }}</span>
        </div>
      </InspSection>
      <InspSection title="Description" v-if="goal.description">
        <p class="muted">{{ goal.description }}</p>
      </InspSection>
    </template>

    <!-- ── TRACE / EXECUTION ── -->
    <template v-else-if="(kind === 'trace' || kind === 'execution') && run">
      <dl class="kv">
        <dt>status</dt>
        <dd>{{ run.status }}</dd>
        <dt>type</dt>
        <dd>{{ run.type || run.execution_type || 'workflow' }}</dd>
        <dt>started</dt>
        <dd>{{ when(runStartedAt(run)) }}</dd>
        <dt>duration</dt>
        <dd>{{ dur(run) }}</dd>
      </dl>
      <InspSection title="Steps" v-if="runSteps.length">
        <div class="tl">
          <div v-for="(s, i) in runSteps" :key="i" class="tlr" :class="statusTone(s.status)">
            <span class="nm">{{ s.name || s.nodeName || s.tool || s.type }}</span>
            <span class="t">{{ s.duration != null ? s.duration + 'ms' : '' }}</span>
          </div>
        </div>
      </InspSection>
      <div v-else-if="runLoading" class="muted">Loading…</div>
      <div v-else-if="run.error" class="err">{{ run.error }}</div>
    </template>

    <!-- ── RUNNING NOW ── -->
    <template v-else-if="kind === 'running'">
      <div v-if="!running.length" class="muted">Nothing is running right now.</div>
      <div v-for="r in running" :key="r.id" class="li" @click="inspectRun(r)">
        <span class="pulse"></span>
        <span class="nm">{{ runDisplayName(r) }}</span>
        <span class="t">{{ when(runStartedAt(r)) }}</span>
      </div>
    </template>

    <!-- ── AUTONOMY QUEUE ── -->
    <template v-else-if="kind === 'autonomy'">
      <div v-if="!escalated.length" class="muted">Nothing is waiting for approval.</div>
      <div v-for="ins in escalated" :key="ins.id" class="card">
        <div class="row">
          <span class="tag warn">{{ ins.insight_type || ins.type }}</span>
          <span class="nm">{{ ins.title || ins.summary }}</span>
        </div>
        <div class="row" style="margin-top: 8px; gap: 6px">
          <button class="btn sm" @click="$emit('action', 'reject-insight', ins)">Reject</button>
          <button class="btn sm pri" @click="$emit('action', 'apply-insight', ins)">Approve</button>
        </div>
      </div>
    </template>

    <!-- ── MEMORY ── -->
    <template v-else-if="kind === 'memory'">
      <div v-if="!memories.length" class="muted">No memories loaded for this agent yet.</div>
      <div v-for="m in memories.slice(0, 20)" :key="m.id" class="li">
        <span class="tag">{{ (m.memory_type || m.type || 'fact').slice(0, 4) }}</span>
        <span class="nm w300">{{ m.content }}</span>
      </div>
    </template>

    <template v-else>
      <div class="muted">Nothing to show for this {{ kind }}.</div>
    </template>

    <template #footer>
      <slot name="footer" :kind="kind" :entity="entity">
        <button v-if="view.openScreen" class="btn sm pri" @click="openScreen">{{ view.openLabel }}</button>
        <button v-if="kind === 'workflow' && workflow" class="btn sm" @click="$emit('action', 'open-forge', workflow)">Open in Forge</button>
        <button v-if="kind === 'agent' && agent" class="btn sm" @click="$emit('action', 'edit-agent', agent)">Edit in Forge</button>
      </slot>
    </template>
  </InspectorShell>
</template>

<script>
/**
 * EntityInspector — the "selected" state of a right panel for any entity the
 * stores already hold. Every screen's panel can render one of these for an
 * inspect request it cannot answer with its own detail component, so a
 * workflow clicked in Chat, on the Dashboard, or in a Trace reads the same.
 */
import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import InspectorShell from './InspectorShell.vue';
import InspSection from './InspSection.vue';
import { ENTITY_SCREENS } from '@/utils/entityRefs.js';
import { RUNNING_STATUSES as RUNNING, isRunning, runDisplayName, runStartedAt, runEndedAt } from '@/utils/runDisplay.js';

export default {
  name: 'EntityInspector',
  components: { InspectorShell, InspSection },
  props: {
    kind: { type: String, required: true },
    id: { type: [String, Number], default: null },
    caption: { type: String, default: 'Inspector' },
  },
  emits: ['close', 'action', 'navigate'],
  setup(props, { emit }) {
    const store = useStore();
    const tab = ref('');

    const agent = computed(() => (props.kind === 'agent' ? store.getters['agents/getAgentById']?.(props.id) : null));
    const workflow = computed(() => (props.kind === 'workflow' ? (store.getters['workflows/allWorkflows'] || []).find((w) => String(w.id) === String(props.id)) : null));
    const goal = computed(() => (props.kind === 'goal' ? store.getters['goals/getGoalById']?.(props.id) : null));
    const executions = computed(() => store.getters['executionHistory/getExecutions'] || []);
    const run = computed(() => {
      if (props.kind !== 'trace' && props.kind !== 'execution') return null;
      return store.getters['executionHistory/getDetailedExecution']?.(props.id) || executions.value.find((e) => String(e.id) === String(props.id)) || null;
    });
    const runLoading = ref(false);
    watch(
      () => [props.kind, props.id],
      async () => {
        tab.value = '';
        if ((props.kind === 'trace' || props.kind === 'execution') && props.id && !store.getters['executionHistory/getDetailedExecution']?.(props.id)) {
          runLoading.value = true;
          try {
            await store.dispatch('executionHistory/fetchExecutionDetails', props.id);
          } catch (e) {
            /* shown via run.error if present */
          } finally {
            runLoading.value = false;
          }
        }
        if (props.kind === 'memory' && props.id) store.dispatch('memory/fetchAgentMemories', props.id).catch(() => {});
      },
      { immediate: true },
    );

    const running = computed(() => executions.value.filter((e) => isRunning(e.status)));
    const escalated = computed(() => store.getters['insights/escalatedInsights'] || []);
    const memories = computed(() => store.getters['memory/agentMemories'] || []);
    const agentRuns = computed(() => (agent.value ? (store.getters['executionHistory/getAgentExecutions'] || []).filter((e) => String(e.agent_id || e.agentId) === String(agent.value.id)).slice(0, 10) : []));
    const wfSteps = computed(() => {
      const nodes = workflow.value?.nodes || workflow.value?.canvas?.nodes || [];
      return nodes.map((n) => ({ ...n, cls: n.category === 'trigger' ? 'is-trig' : n.category === 'control' ? 'is-cond' : 'is-act' }));
    });
    const wfRuns = computed(() => (workflow.value ? (store.getters['executionHistory/getExecutionsByWorkflowId']?.(workflow.value.id) || []).slice(0, 10) : []));
    const goalTasks = computed(() => goal.value?.tasks || []);
    const goalProgress = computed(() => Math.round(store.getters['goals/getGoalProgress']?.(goal.value) || 0));
    const runSteps = computed(() => run.value?.steps || run.value?.nodes || run.value?.tool_calls || []);

    const entity = computed(() => agent.value || workflow.value || goal.value || run.value || null);

    const view = computed(() => {
      const k = props.kind;
      const base = { tabs: [], openScreen: ENTITY_SCREENS[k] || '', openLabel: 'Open' };
      if (k === 'agent') {
        const a = agent.value;
        return { ...base, title: a?.name || 'Agent', sub: `agent · ${a?.category || ''} · ${a?.status || 'active'}`.replace(/ ·  ·/, ' ·'), icon: 'fas fa-robot', tone: 'green', badge: a?.status || 'active', tabs: [{ id: 'overview', label: 'Overview' }, { id: 'runs', label: 'Runs' }], openLabel: 'Open in Agents' };
      }
      if (k === 'workflow') {
        const w = workflow.value;
        return { ...base, title: w?.name || 'Workflow', sub: `workflow · ${w?.status || ''}`, icon: 'fas fa-project-diagram', tone: 'blue', badge: w?.status || '', tabs: [{ id: 'steps', label: 'Steps' }, { id: 'runs', label: 'Runs' }, { id: 'about', label: 'About' }], openLabel: 'Open in Workflows' };
      }
      if (k === 'goal') {
        const g = goal.value;
        return { ...base, title: g?.title || g?.text || 'Goal', sub: `goal · ${g?.priority || 'medium'} · ${g?.status || ''}`, icon: 'fas fa-bullseye', tone: 'yellow', badge: `${goalProgress.value}%`, openLabel: 'Open in Goals' };
      }
      if (k === 'trace' || k === 'execution') {
        const r = run.value;
        return { ...base, title: r ? runDisplayName(r) : `run ${String(props.id || '').slice(0, 8)}`, sub: `run · ${r?.status || ''}`, icon: 'fas fa-stream', tone: 'indigo', badge: r?.status || '', badgeTone: statusTone(r?.status), openLabel: 'Open in Runs' };
      }
      if (k === 'running') return { ...base, title: 'Running now', sub: `${running.value.length} running`, icon: 'fas fa-stream', tone: 'blue', badge: String(running.value.length), openScreen: 'TracesScreen', openLabel: 'Open Runs' };
      if (k === 'autonomy') return { ...base, title: 'Awaiting approval', sub: `${escalated.value.length} actions`, icon: 'fas fa-user-shield', tone: 'yellow', badge: String(escalated.value.length), openScreen: 'LearningScreen', openLabel: 'Open Learning' };
      if (k === 'memory') return { ...base, title: 'Memory', sub: `${memories.value.length} entries`, icon: 'fas fa-brain', tone: 'pink', openScreen: 'MemoryScreen', openLabel: 'Open Memory' };
      return { ...base, title: String(k), sub: '' };
    });
    watch(view, (v) => {
      if (!tab.value && v.tabs.length) tab.value = v.tabs[0].id;
    }, { immediate: true });

    function statusTone(s) {
      const v = String(s || '').toLowerCase();
      if (RUNNING.has(v)) return 'blue';
      if (['completed', 'success', 'ok', 'done', 'applied', 'active'].includes(v)) return 'green';
      if (['failed', 'error', 'rejected'].includes(v)) return 'red';
      if (['pending', 'queued', 'paused', 'stopped'].includes(v)) return 'yellow';
      return 'neutral';
    }
    function when(d) {
      if (!d) return '—';
      const t = new Date(d);
      if (Number.isNaN(t.getTime())) return String(d);
      const diff = (Date.now() - t.getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return t.toLocaleDateString();
    }
    function dur(r) {
      if (!r) return '—';
      const a = runStartedAt(r);
      const b = runEndedAt(r);
      if (!a) return '—';
      const ms = (b ? new Date(b) : Date.now()) - new Date(a);
      if (!Number.isFinite(ms) || ms < 0) return '—';
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
      return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
    }
    function inspectRun(r) {
      store.dispatch('shell/inspect', { kind: 'trace', id: r.id, screen: 'TracesScreen' });
    }
    function openScreen() {
      emit('navigate', view.value.openScreen, props.id ? { select: { kind: props.kind, id: props.id } } : {});
      window.dispatchEvent(new CustomEvent('agnt:navigate', { detail: { screen: view.value.openScreen, opts: props.id ? { select: { kind: props.kind, id: props.id } } : {} } }));
    }

    return { tab, view, agent, workflow, goal, run, runLoading, running, escalated, memories, agentRuns, wfSteps, wfRuns, goalTasks, goalProgress, runSteps, entity, statusTone, when, dur, inspectRun, openScreen, runDisplayName, runStartedAt };
  },
};
</script>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 6px 10px;
  font-size: 12px;
  margin-bottom: 10px;
}
.kv dt {
  color: var(--color-text-dull, #767888);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding-top: 2px;
}
.kv dd {
  color: var(--color-text);
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.muted {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.err {
  color: var(--color-red);
  font-size: 11.5px;
  background: rgba(var(--red-rgb), 0.07);
  border: 1px solid rgba(254, 78, 78, 0.22);
  border-radius: 7px;
  padding: 6px 8px;
}
.li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 0;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 12.5px;
  cursor: pointer;
  min-width: 0;
}
.li:last-child {
  border-bottom: 0;
}
.li .nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.li .nm.w300 {
  font-weight: 300;
  white-space: normal;
}
.li .t {
  font-size: 10px;
  color: var(--color-text-dull, #767888);
  white-space: nowrap;
}
.tag {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-darker-0);
  color: var(--color-text-muted);
  flex: 0 0 auto;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.tag.warn {
  color: var(--text-yellow);
}
.badge {
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding: 0 7px;
  height: 18px;
  line-height: 18px;
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  flex: 0 0 auto;
}
.b-green {
  color: var(--text-green);
  border-color: rgba(var(--green-rgb), 0.3);
}
.b-blue {
  color: var(--text-blue);
  border-color: rgba(18, 224, 255, 0.3);
}
.b-red {
  color: var(--color-red);
  border-color: rgba(254, 78, 78, 0.3);
}
.b-yellow {
  color: var(--text-yellow);
  border-color: rgba(255, 215, 0, 0.3);
}
.bar {
  height: 6px;
  border-radius: 4px;
  background: var(--color-darker-1);
  overflow: hidden;
  margin: 0 0 12px;
}
.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--color-green), var(--color-blue, var(--color-blue)));
}
.card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.row .nm {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
}
.btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  color: var(--color-text);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.btn.pri {
  background: var(--color-green);
  color: var(--on-fill-accent);
  border-color: var(--color-green);
  font-weight: 600;
}
.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-blue, var(--color-blue));
  box-shadow: 0 0 6px var(--color-blue, #12e0ff);
  flex: 0 0 auto;
}
/* steps */
.wf {
  position: relative;
  padding-left: 26px;
}
.wf-spine {
  position: absolute;
  left: 10px;
  top: 12px;
  bottom: 18px;
  width: 2px;
  background: linear-gradient(180deg, var(--color-green), rgba(var(--blue-rgb), 0.55));
  border-radius: 2px;
}
.wf-node {
  position: relative;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  padding: 6px 10px;
  margin-bottom: 8px;
}
.wf-node::before {
  content: '';
  position: absolute;
  left: -21px;
  top: 12px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-background);
  border: 2px solid var(--color-text-muted);
}
.wf-node.is-trig::before {
  border-color: var(--color-green);
  background: var(--color-green);
}
.wf-node.is-act::before {
  border-color: var(--color-blue, #12e0ff);
}
.wf-node.is-cond::before {
  border-color: var(--color-yellow, #ffd700);
}
.wf-ty {
  font-size: 8.5px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.wf-nm {
  font-size: 12.5px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.tl {
  position: relative;
  padding-left: 16px;
}
.tl::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--terminal-border-color);
}
.tlr {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 12px;
  color: var(--color-text-muted);
}
.tlr::before {
  content: '';
  position: absolute;
  left: -15px;
  top: 10px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-green);
}
.tlr.red::before {
  background: var(--color-red);
}
.tlr.blue::before {
  background: var(--color-blue, var(--color-blue));
}
.tlr .nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tlr .t {
  font-size: 10px;
  color: var(--color-text-dull, #767888);
}
</style>
