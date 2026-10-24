<!-- One run in full (Activity > a row): what was asked, what came back, every
     step or tool call with its input, output and error, and what it used. -->
<template>
  <section class="focused-page focused-activity-detail" data-testid="activity-detail">
    <button type="button" class="focused-page-back" data-action="back" @click="nav.go({ page: 'activity' })">
      <i class="fas fa-arrow-left" aria-hidden="true"></i>Activity
    </button>

    <p v-if="loading" class="focused-empty">Loading…</p>
    <p v-else-if="failed" class="focused-empty">This run couldn’t be loaded. It may have been cleared.</p>

    <template v-else>
      <header class="fad-head">
        <span class="focused-row-icon" aria-hidden="true"><i :class="row.icon"></i></span>
        <div class="fad-title">
          <h1>{{ row.title }}</h1>
          <p>{{ [when, view.duration].filter(Boolean).join(' · ') }}</p>
        </div>
        <span class="focused-status-pill" :class="row.status.tone">{{ row.status.label }}</span>
        <button v-if="openLabel" type="button" class="focused-primary" data-action="open" @click="openTarget">{{ openLabel }}</button>
      </header>

      <section v-if="view.asked" class="focused-edit-block" data-section="asked">
        <div class="focused-edit-block-head"><h3>What was asked</h3></div>
        <div class="focused-edit-card"><pre class="fad-text">{{ view.asked }}</pre></div>
      </section>

      <section v-if="view.result || view.error" class="focused-edit-block" data-section="result">
        <div class="focused-edit-block-head"><h3>{{ view.error && !view.result ? 'What went wrong' : 'Result' }}</h3></div>
        <div class="focused-edit-card">
          <pre v-if="view.result" class="fad-text">{{ view.result }}</pre>
          <pre v-if="view.error" class="fad-text bad">{{ view.error }}</pre>
        </div>
      </section>

      <section class="focused-edit-block" data-section="steps">
        <div class="focused-edit-block-head"><h3>{{ stepsTitle }} <span class="focused-count">{{ view.steps.length }}</span></h3></div>
        <p v-if="!view.steps.length" class="focused-empty">{{ row.kind === 'chat' ? 'Annie answered without using any tools.' : 'Nothing ran.' }}</p>
        <ol v-else class="fad-steps">
          <li v-for="(step, i) in view.steps" :key="step.id" :data-step="step.id">
            <details>
              <summary>
                <span class="fad-num">{{ i + 1 }}</span>
                <strong>{{ step.name }}</strong>
                <small v-if="step.duration">{{ step.duration }}</small>
                <span class="focused-status-pill" :class="step.status.tone">{{ step.status.label }}</span>
              </summary>
              <div class="fad-io">
                <template v-if="step.input"><h4>Input</h4><pre class="fad-text">{{ step.input }}</pre></template>
                <template v-if="step.output"><h4>Output</h4><pre class="fad-text">{{ step.output }}</pre></template>
                <template v-if="step.error"><h4>Error</h4><pre class="fad-text bad">{{ step.error }}</pre></template>
                <p v-if="!step.input && !step.output && !step.error" class="focused-empty">Nothing was recorded for this step.</p>
              </div>
            </details>
          </li>
        </ol>
      </section>

      <section v-if="view.usage.length" class="focused-edit-block" data-section="usage">
        <div class="focused-edit-block-head"><h3>Usage</h3></div>
        <dl class="fad-usage">
          <template v-for="u in view.usage" :key="u.label"><dt>{{ u.label }}</dt><dd>{{ u.value }}</dd></template>
        </dl>
      </section>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import { activityRows, activityDetail, kindFromId, statusOf } from './focusedActivity.js';

const props = defineProps({ runId: { type: String, required: true } });
const store = useStore();
const nav = inject('focusedNav');

const loading = ref(true);
const failed = ref(false);
const detail = ref(null);

// The run's list row (title, kind, status, where it opens), or one built from its detail.
const row = computed(() => {
  const all = activityRows(store.getters['executionHistory/getExecutions'] || []);
  const found = all.find((r) => r.id === props.runId);
  if (found) return found;
  const d = detail.value || {};
  const kind = kindFromId(props.runId);
  return { id: props.runId, kind, icon: { routine: 'fas fa-redo', agent: 'fas fa-robot', workflow: 'fas fa-project-diagram' }[kind], title: d.workflowName || d.agentName || 'Run', status: statusOf(d.status), at: d.startTime, target: null };
});
const workflowNodes = computed(() => {
  const id = detail.value?.workflowId;
  const wf = id ? (store.getters['workflows/allWorkflows'] || []).find((w) => String(w.id) === String(id)) : null;
  return wf?.nodes || [];
});
const view = computed(() => activityDetail(detail.value, { workflowNodes: workflowNodes.value }));
const stepsTitle = computed(() => ({ chat: 'Tools Annie used', agent: 'Tools it used', workflow: 'Steps', routine: 'Tasks' })[row.value.kind] || 'Steps');
const when = computed(() => {
  const at = view.value.startedAt || row.value.at;
  return at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
});

// Where this run lives, when it can be opened.
const outputFor = (conversationId) => (store.getters['contentOutputs/outputs'] || []).find((o) => String(o.conversation_id || '') === conversationId || String(o.id) === conversationId);
const openLabel = computed(() => {
  const t = row.value.target;
  if (!t) return '';
  if (t.type === 'conversation') return outputFor(t.id) ? 'Open chat' : '';
  return { agents: 'Open agent', workflows: 'Open workflow' }[t.tab] || (t.type === 'routines' ? 'Open routines' : '');
});
function openTarget() {
  const t = row.value.target;
  if (t.type === 'conversation') nav.openConversation(outputFor(t.id).id);
  else if (t.type === 'library') nav.go({ page: 'library', tab: t.tab, item: t.id });
  else nav.go({ page: 'scheduled' });
}

onMounted(async () => {
  try {
    const runs = store.getters['executionHistory/getExecutions'] || [];
    if (!runs.length) store.dispatch('executionHistory/fetchExecutions', { forceRefresh: true }).catch(() => {});
    detail.value = await store.dispatch('executionHistory/fetchExecutionDetails', props.runId);
    if (!detail.value) failed.value = true;
    const wfId = detail.value?.workflowId;
    if (wfId && !workflowNodes.value.length) store.dispatch('workflows/fetchWorkflowById', wfId).catch(() => {});
  } catch (e) {
    console.warn('[Activity] run detail:', e?.message || e);
    failed.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.fad-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0 20px;
}
.fad-title {
  flex: 1;
  min-width: 0;
}
.fad-title h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.fad-title p {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.fad-text {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-primary);
}
.fad-text.bad {
  color: var(--color-red);
}
.fad-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.fad-steps details {
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
}
.fad-steps summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  list-style: none;
}
.fad-steps summary::-webkit-details-marker {
  display: none;
}
.fad-steps summary strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.fad-steps summary small {
  color: var(--text-secondary);
}
.fad-num {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: var(--surface-active);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}
.fad-io {
  padding: 0 12px 12px;
  border-top: 1px solid var(--terminal-border-color);
}
.fad-io h4 {
  margin: 10px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.fad-usage {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 0;
  font-size: 13px;
}
.fad-usage dt {
  color: var(--text-secondary);
}
.fad-usage dd {
  margin: 0;
}
</style>
