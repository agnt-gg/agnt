<!-- LearningPanel (right) — the Learning page's inspector. Nothing selected:
     what is on the page, in numbers. Something selected: its receipt and the
     verbs that apply to it. Every verb is a `learning` panel-action; the
     screen (Learning.vue) performs it, so this panel holds no state of its own. -->
<template>
  <InspectorShell
    v-if="selected"
    caption="Learning"
    :title="heading"
    :sub="sub"
    :icon="icon"
    :badge="badge"
    @close="act('close')"
  >
    <!-- An insight waiting for the user's yes or no. -->
    <template v-if="selected.kind === 'insight'">
      <InspSection v-if="selected.description" title="What would change">
        <p class="lp-text">{{ selected.description }}</p>
      </InspSection>
      <InspSection v-if="selected.autonomy_reason" title="Why it is waiting for you">
        <p class="lp-text">{{ selected.autonomy_reason }}</p>
      </InspSection>
      <InspSection title="Details">
        <dl class="lp-dl">
          <dt>Applies to</dt><dd>{{ selected.target_type || '—' }}<template v-if="selected.target_id"> · {{ selected.target_id }}</template></dd>
          <dt>Category</dt><dd>{{ selected.category || '—' }}</dd>
          <dt>Confidence</dt><dd>{{ selected.confidence != null ? Math.round(selected.confidence * 100) + '%' : '—' }}</dd>
          <dt>Seen</dt><dd>{{ selected.occurrence_count || 1 }}×</dd>
          <dt>Raised</dt><dd>{{ date(selected.escalated_at || selected.created_at) }}</dd>
        </dl>
      </InspSection>
      <InspSection v-if="selected.evidence" title="Evidence">
        <pre class="lp-pre">{{ JSON.stringify(selected.evidence, null, 2) }}</pre>
      </InspSection>
    </template>

    <!-- A recurring problem the learning loop detected. -->
    <template v-else-if="selected.kind === 'finding'">
      <InspSection title="Lifecycle"><Lifecycle :item="selected" /></InspSection>
      <InspSection title="Evidence">
        <dl class="lp-dl">
          <dt>Observed failures</dt><dd>{{ selected.occurrences }}</dd>
          <dt>Independent runs</dt><dd>{{ selected.independent_runs }}</dd>
          <dt>Scope</dt><dd>{{ selected.capability }}</dd>
          <dt>Evidence quality</dt><dd>Reported tool outcomes</dd>
        </dl>
      </InspSection>
      <InspSection title="What would change?">
        <p class="lp-text">{{ selected.candidate ? 'Retry once when this read-only operation reports a transient failure. Security checks still run for each attempt.' : 'Nothing automatically. This finding needs a supported, measurable candidate before it can become a trial.' }}</p>
      </InspSection>
      <InspSection title="How will we know?">
        <p class="lp-text">Compare this capability’s failure rate against a fixed seven-day baseline. At least 20 known, exposed calls are required. No usage means inconclusive.</p>
      </InspSection>
    </template>

    <!-- A timed trial, running or reviewed. -->
    <template v-else>
      <InspSection title="Lifecycle"><Lifecycle :item="selected" /></InspSection>
      <InspSection title="Trial">
        <dl class="lp-dl">
          <dt>Started</dt><dd>{{ date(selected.started_at) }}</dd>
          <dt>Review deadline</dt><dd>{{ date(selected.review_due_at) }}</dd>
          <dt>Baseline calls</dt><dd>{{ selected.baseline?.eligible ?? 0 }}</dd>
          <dt>Observed calls</dt><dd>{{ selected.observed?.eligible ?? selected.result?.candidate?.eligible ?? 0 }}</dd>
          <dt>Measurement</dt><dd>Failure rate / eligible call</dd>
        </dl>
      </InspSection>
      <InspSection v-if="selected.result" :title="verdictLabel(selected.result.verdict)">
        <div class="lp-result">
          <span><small>BEFORE</small><b>{{ percent(selected.result.before) }}</b></span>
          <span><small>AFTER</small><b>{{ percent(selected.result.after) }}</b></span>
        </div>
        <p class="lp-text">{{ selected.result.explanation }}</p>
        <p class="lp-muted">{{ selected.result.candidate?.eligible ?? 0 }} exposed calls · {{ selected.result.method }}</p>
      </InspSection>
      <InspSection v-else title="Watching normal use">
        <p class="lp-text">The deadline survives restarts. The provisional policy stops at review time; keeping it is a separate decision.</p>
      </InspSection>
    </template>

    <details v-if="selected.kind !== 'insight'" class="lp-receipt">
      <summary>Structured receipt</summary>
      <pre class="lp-pre">{{ JSON.stringify(receipt, null, 2) }}</pre>
    </details>

    <template #footer>
      <template v-if="selected.kind === 'insight'">
        <button type="button" class="lp-btn" :disabled="busy" @click="act('reject')">Reject</button>
        <button type="button" class="lp-btn pri" :disabled="busy" @click="act('accept')">Accept</button>
      </template>
      <template v-else-if="selected.kind === 'finding'">
        <button type="button" class="lp-btn" :disabled="busy" @click="act('dismiss')">Dismiss</button>
        <button v-if="selected.candidate" type="button" class="lp-btn pri" :disabled="busy || paused" @click="act('approve')">Try for 7 days</button>
      </template>
      <template v-else>
        <button v-if="['watching', 'active', 'reviewed'].includes(selected.state)" type="button" class="lp-btn" :disabled="busy" @click="act('undo')">
          {{ selected.state === 'reviewed' ? 'Close trial' : 'Undo change' }}
        </button>
        <button
          v-if="selected.state === 'reviewed' && selected.result?.verdict === 'supported'"
          type="button"
          class="lp-btn pri"
          :disabled="busy || paused"
          @click="act('keep')"
        >Keep this improvement</button>
      </template>
    </template>
  </InspectorShell>

  <ListSummaryPanel
    v-else
    caption="Learning"
    :stats="stats"
    hint="Select anything on the page to see its evidence and decide here."
  />
</template>

<script setup>
import { computed, h } from 'vue';
import InspectorShell from '@/views/_components/one/InspectorShell.vue';
import InspSection from '@/views/_components/one/InspSection.vue';
import ListSummaryPanel from '@/views/_components/one/ListSummaryPanel.vue';
import { title, date, percent, verdictLabel } from '@/views/Terminal/CenterPanel/screens/Learning/learningFormat.js';

const props = defineProps({
  selected: { type: Object, default: null },
  /** { waiting, attention, watching, learned } counts from the page. */
  summary: { type: Object, default: () => ({}) },
  busy: Boolean,
  paused: Boolean,
});
const emit = defineEmits(['panel-action']);

const act = (verb) => emit('panel-action', 'learning', { verb, item: props.selected });

const heading = computed(() => {
  const item = props.selected;
  if (item.kind === 'insight') return item.title || 'Untitled change';
  return title(item.capability || item.candidate?.when.capability, item.error_kind || item.candidate?.when.error_kind);
});
const sub = computed(() => ({ insight: 'Waiting for you', finding: 'Recurring problem', trial: 'Timed trial' })[props.selected.kind] || '');
const icon = computed(() => ({ insight: 'fas fa-user-shield', finding: 'fas fa-exclamation-circle', trial: 'fas fa-flask' })[props.selected.kind] || 'fas fa-lightbulb');
const badge = computed(() => (props.selected.kind === 'trial' ? verdictLabel(props.selected.result?.verdict) : ''));
// The receipt is the record itself, minus the panel's own bookkeeping.
const receipt = computed(() => {
  const { kind, ...rest } = props.selected;
  return rest;
});

const stats = computed(() => [
  { label: 'Waiting for you', value: props.summary.waiting ?? 0, live: (props.summary.waiting ?? 0) > 0 },
  { label: 'Needs attention', value: props.summary.attention ?? 0 },
  { label: 'Being tested', value: props.summary.watching ?? 0 },
  { label: 'Learned', value: props.summary.learned ?? 0 },
]);

// Detected → Candidate → Trial → Result, lit up to where this item has got.
const Lifecycle = (p) => {
  const item = p.item;
  const steps = [
    ['Detected', true],
    ['Candidate', !!item.candidate],
    ['Trial', item.kind === 'trial'],
    ['Result', !!item.result],
  ];
  return h('ol', { class: 'lp-life' }, steps.map(([label, done]) => h('li', { class: { done } }, label)));
};
Lifecycle.props = ['item'];
</script>

<style scoped>
.lp-text { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--color-text); overflow-wrap: anywhere; }
.lp-muted { margin: 8px 0 0; font-size: 11.5px; color: var(--color-text-muted); overflow-wrap: anywhere; }
.lp-dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; margin: 0; font-size: 12px; }
.lp-dl dt { color: var(--color-text-muted); }
.lp-dl dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.lp-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; max-height: 260px; overflow: auto; color: var(--color-text-muted); }
.lp-receipt { font-size: 12px; color: var(--color-text-muted); margin-bottom: 14px; }
.lp-receipt summary { cursor: pointer; margin-bottom: 8px; }
.lp-result { display: flex; gap: 28px; margin-bottom: 10px; }
.lp-result small { display: block; font-size: 9px; letter-spacing: 0.12em; color: var(--color-text-muted); }
.lp-result b { display: block; font-size: 22px; font-weight: 500; margin-top: 4px; }
:deep(.lp-life) { display: flex; gap: 10px; list-style: none; padding: 0; margin: 0; font-size: 11px; color: var(--color-text-muted); }
:deep(.lp-life li) { padding-bottom: 5px; border-bottom: 2px solid var(--terminal-border-color); }
:deep(.lp-life li.done) { border-color: var(--color-green); color: var(--color-text); }
/* Footer verbs: ListSummaryPanel's .ls-btn, so every inspector's buttons match. */
.lp-btn {
  height: 28px;
  padding: 0 11px;
  border-radius: 7px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  color: var(--color-text);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
}
.lp-btn:disabled { opacity: 0.5; cursor: default; }
.lp-btn.pri { background: var(--color-green); color: var(--on-fill-accent); border-color: var(--color-green); font-weight: 600; }
</style>
