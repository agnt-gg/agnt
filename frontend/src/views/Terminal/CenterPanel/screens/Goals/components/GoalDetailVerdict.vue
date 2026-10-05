<template>
  <!-- The verdict column: what the evaluator decided, every check with its
       proof, and the decision — pinned to the bottom so it is always reachable
       however long the checklist runs. -->
  <aside class="gd-verdict">
    <header class="gd-verdict-head">
      <h3>Review</h3>
      <p v-if="verdict.evaluated && evaluatedAt">{{ formatDate(evaluatedAt) }}</p>
      <p v-else-if="verdict.evaluated">Automatic evaluation</p>
      <p v-else>Not evaluated yet</p>
    </header>

    <!-- Score: the evaluator's overall figure, then its parts. -->
    <div class="gd-score">
      <div class="gd-ring" role="img" :aria-label="`Overall score ${scorePercent === null ? 'not available' : scorePercent + '%'}`">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="gd-ring-track" cx="50" cy="50" r="42" />
          <circle
            class="gd-ring-fill"
            :class="ringTone"
            cx="50"
            cy="50"
            r="42"
            :stroke-dasharray="`${ringLength} 999`"
          />
        </svg>
        <div class="gd-ring-in">
          <span class="gd-ring-num">{{ scorePercent === null ? '—' : scorePercent + '%' }}</span>
          <span class="gd-ring-lbl">overall</span>
        </div>
      </div>
      <dl class="gd-bars">
        <template v-for="bar in bars" :key="bar.label">
          <div class="gd-bar-row">
            <dt>{{ bar.label }}</dt>
            <dd>{{ bar.value === null ? '—' : bar.value + '%' }}</dd>
          </div>
          <div class="gd-bar">
            <span :class="bar.tone" :style="{ width: (bar.value || 0) + '%' }"></span>
          </div>
        </template>
      </dl>
    </div>

    <!-- Checklist: unmet first, because they are what a reviewer decides about. -->
    <section v-if="items.length" class="gd-block">
      <div class="gd-block-head">
        <span>Checklist</span>
        <span class="gd-block-count" :class="{ 'has-missed': missedCount }">
          {{ verdict.evaluated ? verdict.met + ' of ' + verdict.total + ' met' : verdict.total + ' not checked' }}
        </span>
      </div>
      <ul class="gd-checks">
        <li
          v-for="item in items"
          :key="item.id"
          class="gd-check"
          :class="item.met === true ? 'is-met' : item.met === false ? 'is-missed' : 'is-open'"
        >
          <i :class="iconFor(item)" :aria-label="labelFor(item)"></i>
          <div class="gd-check-body">
            <p class="gd-check-text">{{ item.text }}</p>
            <button
              v-if="item.evidence || item.proof.tasks.length || item.proof.files.length || item.proof.section"
              type="button"
              class="gd-proof-toggle"
              :aria-expanded="expanded[item.id] ? 'true' : 'false'"
              @click="expanded[item.id] = !expanded[item.id]"
            >
              <i class="fas fa-link" aria-hidden="true"></i>
              Proof
              <i :class="expanded[item.id] ? 'fas fa-chevron-up' : 'fas fa-chevron-down'" aria-hidden="true"></i>
            </button>
            <p v-if="showEvidence(item)" class="gd-check-evidence">{{ item.evidence }}</p>
            <div v-if="expanded[item.id]" class="gd-proof">
              <button
                v-for="t in item.proof.tasks"
                :key="'t' + t.number"
                type="button"
                class="gd-chip"
                @click="$emit('show-task', t.number)"
              >
                <i class="fas fa-tasks" aria-hidden="true"></i> Task {{ t.number }} · {{ t.title }}
              </button>
              <button
                v-for="f in item.proof.files"
                :key="f"
                type="button"
                class="gd-chip"
                @click="$emit('open-file', f)"
              >
                <i class="fas fa-file-alt" aria-hidden="true"></i> {{ baseName(f) }}
              </button>
              <button
                v-if="item.proof.section"
                type="button"
                class="gd-chip"
                @click="$emit('open-section', item.proof.section.heading)"
              >
                <i class="fas fa-paragraph" aria-hidden="true"></i> {{ item.proof.section.heading }} in the report
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>
    <section v-else class="gd-block gd-empty">
      <i class="far fa-clock" aria-hidden="true"></i>
      <p>No checklist yet. The evaluator writes one when the work is evaluated.</p>
    </section>

    <!-- Decision. Comments are written here, not in a separate modal. -->
    <footer class="gd-actions">
      <div v-if="composerOpen" class="gd-composer">
        <label :for="feedbackId">What should change?</label>
        <textarea
          :id="feedbackId"
          ref="feedbackEl"
          v-model="feedback"
          rows="3"
          placeholder="e.g. The receipts table needs the delta for C4 before this can pass."
          @keydown.ctrl.enter.prevent="sendBack"
          @keydown.meta.enter.prevent="sendBack"
          @keydown.escape.stop="closeComposer"
        ></textarea>
        <div class="gd-action-row">
          <button type="button" class="gd-btn quiet" :disabled="busy" @click="closeComposer">Cancel</button>
          <button type="button" class="gd-btn warn" :disabled="busy || !feedback.trim()" @click="sendBack">
            <i class="fas fa-paper-plane" aria-hidden="true"></i> Send back to queue
          </button>
        </div>
      </div>
      <template v-else>
        <div class="gd-action-row">
          <button
            type="button"
            class="gd-btn primary"
            :disabled="busy || !canSignOff"
            :title="approveLabel"
            @click="$emit('approve')"
          >
            <i class="fas fa-check-circle" aria-hidden="true"></i> {{ approveLabel }}
          </button>
          <button type="button" class="gd-btn ghost" :disabled="busy || !canRevise" @click="openComposer">
            <i class="far fa-comment" aria-hidden="true"></i> Request changes
          </button>
        </div>
        <div class="gd-action-row">
          <button type="button" class="gd-btn quiet" :disabled="busy" @click="$emit('evaluate')">
            <i class="fas fa-sync-alt" aria-hidden="true"></i> Re-evaluate
          </button>
          <button v-if="isPaused" type="button" class="gd-btn quiet" :disabled="busy" @click="$emit('resume')">
            <i class="fas fa-play" aria-hidden="true"></i> Resume
          </button>
          <button v-else-if="canPause" type="button" class="gd-btn quiet" :disabled="busy" @click="$emit('pause')">
            <i class="fas fa-pause" aria-hidden="true"></i> Pause goal
          </button>
        </div>
      </template>
      <button v-if="canRun" type="button" class="gd-btn ghost gd-run" :disabled="busy" @click="$emit('run')"><i class="fas fa-play" aria-hidden="true"></i> Run goal</button>
      <p class="gd-note">
        <i class="fas fa-info-circle" aria-hidden="true"></i>
        {{ approveLabel === 'Approve plan' ? 'Approving this plan starts execution.' : 'Accept the result, or return it with comments for revision. Returning does not start a run.' }}
      </p>
    </footer>
  </aside>
</template>

<script>
import { ref, computed, nextTick } from 'vue';
import { baseName } from '../goalReview.js';
import { reviewPercent } from '../goalDetailModel.js';
let nextFeedbackId = 0;
export default {
  name: 'GoalDetailVerdict',
  props: {
    verdict: { type: Object, required: true },
    items: { type: Array, default: () => [] },
    scores: { type: Object, default: () => ({}) },
    evaluatedAt: { type: String, default: '' },
    canSignOff: Boolean, canRevise: Boolean, canPause: Boolean, canRun: Boolean, isPaused: Boolean, busy: Boolean,
    approveLabel: { type: String, default: 'Approve result' },
    submitFeedback: { type: Function, required: true },
  },
  emits: ['approve', 'evaluate', 'pause', 'resume', 'run', 'show-task', 'open-file', 'open-section'],
  setup(props) {
    const expanded = ref({}), composerOpen = ref(false), feedback = ref(''), feedbackEl = ref(null), sending = ref(false);
    const feedbackId = 'gd-feedback-' + ++nextFeedbackId;
    const scorePercent = computed(() => reviewPercent(props.scores.overall));
    const missedCount = computed(() => props.items.filter(i => i.met === false).length);
    const ringLength = computed(() => ((scorePercent.value ?? 0) / 100) * 2 * Math.PI * 42);
    const tone = value => value === null ? 'is-unknown' : value >= 90 ? 'is-good' : value >= 80 ? 'is-fair' : 'is-poor';
    const ringTone = computed(() => tone(scorePercent.value));
    const bars = computed(() => [['Completeness','completeness'],['Quality','quality'],['Task average','taskAverage']].map(([label,key]) => {
      const value = reviewPercent(props.scores[key]); return { label, value, tone: tone(value) };
    }));
    const iconFor = item => item.met === true ? 'fas fa-check-circle' : item.met === false ? 'fas fa-times-circle' : 'far fa-circle';
    const labelFor = item => item.met === true ? 'Met' : item.met === false ? 'Not met' : 'Not checked';
    const showEvidence = item => !!item.evidence && item.evidence !== 'Not assessed' && (item.met === false || expanded.value[item.id]);
    const formatDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(); };
    const openComposer = async () => { composerOpen.value = true; await nextTick(); feedbackEl.value?.focus(); };
    const closeComposer = () => { if (sending.value) return; composerOpen.value = false; feedback.value = ''; };
    const sendBack = async () => {
      const text = feedback.value.trim(); if (!text || props.busy || sending.value || !props.canRevise) return;
      sending.value = true;
      try { if (await props.submitFeedback(text)) { composerOpen.value = false; feedback.value = ''; } }
      finally { sending.value = false; }
    };
    return { expanded, composerOpen, feedback, feedbackEl, feedbackId, scorePercent, missedCount, ringLength, ringTone, bars, iconFor, labelFor, showEvidence, formatDate, openComposer, closeComposer, sendBack, baseName };
  },
};
</script>

<style scoped>
.gd-verdict {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-popup);
  overflow: hidden;
}
.gd-verdict-head {
  flex: 0 0 auto;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.gd-verdict-head h3 {
  margin: 0;
  font-size: 1em;
  color: var(--color-text);
}
.gd-verdict-head p {
  margin: 3px 0 0;
  font-size: 0.72em;
  color: var(--color-text-muted);
}

.gd-score {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.gd-ring {
  position: relative;
  width: 88px;
  height: 88px;
  flex: 0 0 auto;
}
.gd-ring svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.gd-ring-track,
.gd-ring-fill {
  fill: none;
  stroke-width: 8;
}
.gd-ring-track {
  stroke: var(--color-dull-navy);
}
.gd-ring-fill {
  stroke-linecap: round;
}
.gd-ring-fill.is-good {
  stroke: var(--color-green);
}
.gd-ring-fill.is-fair {
  stroke: var(--color-blue);
}
.gd-ring-fill.is-poor {
  stroke: var(--color-orange);
}
.gd-ring-in {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.gd-ring-num {
  font-size: 1.35em;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1;
}
.gd-ring-lbl {
  margin-top: 3px;
  font-size: 0.62em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.gd-bars {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
.gd-bar-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.75em;
}
.gd-bar-row dt {
  color: var(--color-text-muted);
}
.gd-bar-row dd {
  margin: 0;
  font-family: var(--font-family-mono);
  color: var(--color-text);
}
.gd-bar {
  height: 5px;
  margin: 4px 0 9px;
  border-radius: 3px;
  background: var(--color-dull-navy);
  overflow: hidden;
}
.gd-bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.gd-bar span.is-good {
  background: var(--color-green);
}
.gd-bar span.is-fair {
  background: var(--color-blue);
}
.gd-bar span.is-poor {
  background: var(--color-orange);
}

.gd-block {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.gd-block-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px 6px;
  font-size: 0.68em;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.gd-block-count {
  font-family: var(--font-family-mono);
  letter-spacing: 0;
  color: var(--color-green);
}
.gd-block-count.has-missed {
  color: var(--color-orange);
}
.gd-checks {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0 10px 6px;
  list-style: none;
  overflow-y: auto;
}
.gd-check {
  display: flex;
  gap: 9px;
  padding: 7px 6px;
  border-radius: 7px;
}
.gd-check.is-missed {
  background: rgba(var(--red-rgb), 0.06);
}
.gd-check > i {
  flex: 0 0 auto;
  margin-top: 2px;
  font-size: 0.85em;
}
.gd-check.is-met > i {
  color: var(--color-green);
}
.gd-check.is-missed > i {
  color: var(--color-red);
}
.gd-check.is-open > i {
  color: var(--color-text-muted);
}
.gd-check-body {
  min-width: 0;
  flex: 1 1 auto;
}
.gd-check-text {
  margin: 0;
  font-size: 0.8em;
  line-height: 1.45;
  color: var(--color-text);
}
.gd-check.is-missed .gd-check-text {
  color: var(--color-light-navy);
}
.gd-proof-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  padding: 2px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.7em;
  cursor: pointer;
}
.gd-proof-toggle:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}
.gd-check-evidence {
  margin: 6px 0 0;
  padding-left: 8px;
  border-left: 2px solid var(--terminal-border-color);
  font-size: 0.74em;
  line-height: 1.5;
  color: var(--color-text-muted);
}
.gd-proof {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
.gd-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.7em;
  cursor: pointer;
}
.gd-chip:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.gd-empty {
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.78em;
}
.gd-empty p {
  margin: 0;
}

.gd-actions {
  flex: 0 0 auto;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--terminal-border-color);
  background: rgba(0, 0, 0, 0.18);
}
.gd-action-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.gd-btn {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  font: inherit;
  font-size: 0.8em;
  font-weight: 600;
  cursor: pointer;
}
.gd-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.gd-btn.primary {
  background: var(--color-green);
  color: var(--ink-on-fill);
}
.gd-btn.ghost {
  background: var(--surface-hover);
  border-color: var(--terminal-border-color);
  color: var(--color-text);
}
.gd-btn.quiet {
  background: transparent;
  border-color: var(--terminal-border-color);
  color: var(--color-text-muted);
  font-weight: 500;
  min-height: 32px;
}
.gd-btn.warn {
  background: var(--color-orange);
  color: var(--ink-on-fill);
}
.gd-composer label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.74em;
  color: var(--color-text-muted);
}
.gd-composer textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-dark-navy);
  color: var(--color-text);
  font: inherit;
  font-size: 0.8em;
  resize: vertical;
}
.gd-composer textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}
.gd-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 4px 0 0;
  font-size: 0.68em;
  line-height: 1.4;
  color: var(--color-text-muted);
}
.gd-run { width: 100%; margin-bottom: 8px; }
.gd-btn:focus-visible,.gd-chip:focus-visible,.gd-proof-toggle:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.gd-ring-fill.is-unknown { stroke: transparent; }
@media (max-width: 900px) { .gd-checks { overflow: visible; } .gd-verdict { overflow: visible; } .gd-btn { min-height: 44px; } }
.gd-checks { scrollbar-width: thin; scrollbar-color: var(--color-text-muted) transparent; }
.gd-check-evidence { font-size: .8em; color: var(--color-text); opacity: .86; }
.gd-proof-toggle,.gd-chip { font-size: .76em; }
.gd-note { font-size: .74em; }
@media (max-width: 900px) { .gd-proof-toggle,.gd-chip { min-height: 36px; } }
</style>
