<template>
  <section class="learning-board settings-content" aria-label="Learning">
    <header class="content-header learning-header">
      <div><h2 class="content-title">Learning</h2><p class="content-subtitle">What is waiting for you, what went wrong, what is being tested, and what helped.</p></div>
      <button class="btn btn-quiet pause-button" :disabled="busy" @click="$emit('pause', !data.settings.paused)"><span class="live-dot" :class="{paused:data.settings.paused}"></span>{{ data.settings.paused ? 'Resume learning' : 'Pause learning' }}</button>
    </header>
    <div class="learning-summary"><span><b>{{ data.coverage?.work || 0 }}</b> tracked runs</span><span><b>{{ data.coverage?.events || 0 }}</b> evidence records</span><span class="privacy">Local to your account · No automatic permissions</span></div>
    <div v-if="error" class="error-banner" role="alert">{{ error }} <button class="btn btn-quiet" @click="$emit('refresh')">Retry</button></div>
    <nav class="tab-controls" aria-label="Learning views">
      <div class="tab-tabs">
        <button v-for="tab in tabs" :key="tab.id" class="tab-button" :class="{active:view===tab.id}" :aria-pressed="view===tab.id" @click="chooseView(tab.id)">{{ tab.label }} <span class="tab-count">{{ count(tab.id) }}</span></button>
      </div>
      <button class="btn btn-quiet refresh-button" :disabled="busy" @click="$emit('refresh')" aria-label="Refresh learning"><i class="fas fa-sync-alt" aria-hidden="true"></i></button>
    </nav>
    <main class="learning-list">
      <p class="view-caption">{{ captions[view] }}</p>
      <EscalationQueue
        v-if="view==='waiting'"
        :items="waiting"
        :busy="busy"
        :progress="progress"
        :selected-id="selectedKey.startsWith('insight:') ? selectedKey.slice(8) : ''"
        @accept="ids=>$emit('accept-insights',ids)"
        @reject="ids=>$emit('reject-insights',ids)"
        @stop="$emit('stop')"
        @select="item=>select('insight',item)"
      />
      <template v-if="view==='attention'">
        <article v-for="trial in reviewed" :key="trial.id" class="learning-card" :class="{chosen:isSelected('trial',trial)}" @click="select('trial',trial)">
          <div class="card-top"><span class="kind-tag">REVIEW READY</span><span class="outcome-tag" :class="trial.result?.verdict">{{ verdictLabel(trial.result?.verdict) }}</span></div>
          <h3>{{ title(trial.candidate.when.capability,trial.candidate.when.error_kind) }}</h3><p>{{ trial.result?.explanation }}</p>
          <div class="card-metric" v-if="trial.result?.before!=null"><span>{{ percent(trial.result.before) }}</span><span class="arrow">→</span><strong>{{ percent(trial.result.after) }}</strong><small>failure rate · observational</small></div>
          <footer><span>Review the outcome before keeping this change.</span><button @click.stop="select('trial',trial)">Review result →</button></footer>
        </article>
        <article v-for="finding in detected" :key="finding.id" class="learning-card" :class="{chosen:isSelected('finding',finding)}" @click="select('finding',finding)">
          <div class="card-top"><span class="kind-tag">RECURRING PROBLEM</span><span class="outcome-tag">{{ finding.candidate ? 'Fix available' : 'Evidence only' }}</span></div>
          <h3>{{ title(finding.capability,finding.error_kind) }}</h3><p>{{ finding.occurrences }} failures across {{ finding.independent_runs }} independent runs. Repeated evidence is grouped here, not saved as another memory.</p>
          <div class="proposed-fix" v-if="finding.candidate"><span class="fix-symbol">↳</span><div><b>Try one retry after a transient read failure.</b><small>Read-only tools only. No new authority.</small></div></div>
          <footer><span>{{ finding.candidate ? '7-day trial · measurable · reversible' : 'No supported automatic change yet' }}</span><button @click.stop="select('finding',finding)">See evidence →</button></footer>
        </article>
      </template>
      <template v-if="view==='watching'">
        <article v-for="trial in watching" :key="trial.id" class="learning-card" :class="{chosen:isSelected('trial',trial)}" @click="select('trial',trial)">
          <div class="card-top"><span class="kind-tag">TIMED TRIAL</span><span class="outcome-tag watching">{{ daysLeft(trial.review_due_at) }}</span></div>
          <h3>{{ title(trial.candidate.when.capability,trial.candidate.when.error_kind) }}</h3><p>One approved retry for a read-only tool. Continue using AGNT normally; only eligible exposed calls count.</p>
          <div class="trial-progress"><span :style="{width:progressOf(trial)+'%'}"></span></div>
          <div class="trial-meta"><span>Started {{ date(trial.started_at) }}</span><span>Review {{ date(trial.review_due_at) }}</span></div>
          <footer><span>Baseline: {{ trial.baseline.eligible }} calls · {{ trial.observed?.eligible || 0 }} / {{ trial.minimum_samples }} observed</span><button @click.stop="select('trial',trial)">Inspect trial →</button></footer>
        </article>
      </template>
      <template v-if="view==='learned'">
        <article v-for="policy in activePolicies" :key="policy.id" class="learning-card learned-card" :class="{chosen:selectedKey==='trial:'+policy.trial_id}" @click="selectPolicy(policy)">
          <div class="card-top"><span class="kind-tag">ACTIVE POLICY</span><span class="outcome-tag supported">Version {{ policy.version }}</span></div>
          <h3>{{ title(policy.capability,policy.error_kind) }}</h3><p>Supported by a measured trial and kept by you. Future matching calls use this bounded decision.</p>
          <div class="policy-rule"><span>WHEN</span> {{ policy.capability }} reports {{ policy.error_kind }}<br><span>THEN</span> retry once, read-only</div>
          <footer><span>Activated {{ date(policy.activated_at) }}</span><button @click.stop="selectPolicy(policy)">View receipt →</button></footer>
        </article>
        <details class="history" v-if="closed.length"><summary>{{ closed.length }} closed {{ closed.length===1?'trial':'trials' }}</summary><p v-for="trial in closed" :key="trial.id">{{ trial.candidate.when.capability }} · {{ trial.state==='reverted'?'Reverted':verdictLabel(trial.result?.verdict) }}</p></details>
      </template>
      <div v-if="view!=='waiting'&&!visibleCount" class="learning-empty"><span class="empty-mark">✓</span><h3>{{ emptyTitles[view] }}</h3><p>{{ emptyDescriptions[view] }}</p><small>No new suggestions is a healthy result.</small></div>
    </main>
  </section>
</template>
<script setup>
import {computed,ref,watch} from 'vue';
import EscalationQueue from './EscalationQueue.vue';
import {title,date,percent,daysLeft,trialProgress as progressOf,verdictLabel} from './learningFormat.js';
const props=defineProps({
  data:{type:Object,required:true},
  /** The escalation queue: insights waiting for the user's yes or no. */
  waiting:{type:Array,default:()=>[]},
  busy:Boolean,
  error:{type:String,default:''},
  progress:{type:Object,default:null},
  /** `${kind}:${id}` of the item shown in the right panel, or ''. */
  selectedKey:{type:String,default:''},
  initialView:{type:String,default:''},
});
const emit=defineEmits(['approve','dismiss','keep','undo','pause','refresh','select','accept-insights','reject-insights','stop']);
const tabs=[{id:'waiting',label:'Waiting for you'},{id:'attention',label:'Needs attention'},{id:'watching',label:'Being tested'},{id:'learned',label:'Learned'}];
// Open where there is something to do: the queue when it has anything in it.
// Once the user picks a tab, their choice sticks.
const view=ref(props.initialView||(props.waiting.length?'waiting':'attention'));
let userChoseView=!!props.initialView;
watch(()=>props.waiting.length,n=>{if(!userChoseView&&n>0)view.value='waiting';});
function chooseView(id){userChoseView=true;view.value=id;emit('select',null);}
const detected=computed(()=>props.data.findings.filter(x=>x.state==='detected'&&x.occurrences>=3&&x.independent_runs>=2));
const reviewed=computed(()=>props.data.trials.filter(x=>x.state==='reviewed'));
const watching=computed(()=>props.data.trials.filter(x=>x.state==='watching'));
const activePolicies=computed(()=>props.data.policies.filter(x=>x.state==='active'));
const closed=computed(()=>props.data.trials.filter(x=>['reverted','reviewed'].includes(x.state)));
const count=id=>id==='waiting'?props.waiting.length:id==='attention'?detected.value.length+reviewed.value.length:id==='watching'?watching.value.length:activePolicies.value.length;
const visibleCount=computed(()=>count(view.value));
const captions={waiting:'Changes Annie was not allowed to make on her own. Accept applies one; reject discards it.',attention:'Evidence first. Only supported candidates can become changes.',watching:'Keep working as usual. Every trial has a deadline and an undo.',learned:'Decisions that passed a measured review—not just saved advice.'};
const emptyTitles={attention:'Nothing needs your attention.',watching:'No changes being tested.',learned:'Nothing promoted without evidence.'};
const emptyDescriptions={attention:'Recurring problems will appear here when there is evidence worth reviewing.',watching:'Approve a measurable, reversible candidate to start a timed trial.',learned:'Supported trials kept by you become scoped runtime policies here.'};
const isSelected=(kind,item)=>props.selectedKey===kind+':'+item.id;
function select(kind,item){emit('select',{...item,kind});}
function selectPolicy(policy){const trial=props.data.trials.find(x=>x.id===policy.trial_id);if(trial)select('trial',trial);}
</script>
<style scoped>
/* Learning sits beside the Settings nav, so it IS a Settings page: every rule
   below is copied from an existing Settings surface, not designed here.
     page + header ....... Settings.vue .settings-content / .content-*
     tabs ................ BaseTabControls .tab-controls / .tab-button
     cards ............... Settings.vue .settings-section
     buttons ............. Settings › Data (dataPanel.css) .btn / -primary / -quiet
   The selected item's receipt is in the right panel (LearningPanel), like
   every other list screen's detail. */

/* ── Page (Settings.vue) ── */
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  align-items: flex-start;
  color: var(--color-text);
}
.content-header {
  padding: 0;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 16px;
  width: 100%;
  max-width: 1048px;
}
.content-title {
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 8px 0;
}
.content-subtitle {
  color: var(--color-light-med-navy);
  font-size: 1em;
  margin: 0;
  opacity: 0.8;
  line-height: 1.4;
}
.learning-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

/* ── Buttons (Settings › Data, dataPanel.css) ── */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 18px; border: 1px solid transparent; border-radius: 9px; font: inherit; font-size: 0.92em; cursor: pointer; transition: opacity 0.15s ease, background 0.15s ease; }
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-quiet { background: transparent; border-color: var(--terminal-border-color); color: var(--color-text); }
.btn-quiet:hover:not(:disabled) { border-color: rgba(var(--primary-rgb), 0.55); }

.pause-button { white-space: nowrap; flex: 0 0 auto; }
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-green); }
.live-dot.paused { background: var(--color-yellow); }

.learning-summary {
  display: flex;
  gap: 24px;
  width: 100%;
  font-size: 0.85em;
  color: var(--color-light-med-navy);
}
.learning-summary b { color: var(--color-text); font-weight: 600; }
.privacy { margin-left: auto; }
.error-banner {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  color: var(--color-red);
}

/* ── Tabs (BaseTabControls) ── */
.tab-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  border-bottom: 1px solid var(--terminal-border-color);
}
.tab-tabs { display: flex; gap: 2px; margin-bottom: 1px; flex-wrap: wrap; }
button.tab-button:first-child { border-radius: 8px 0 0 0; }
button.tab-button:last-child { border-radius: 0 8px 0 0; }
.tab-button {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  padding: 8px 16px;
  cursor: pointer;
  border-radius: 0;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.9;
  font: inherit;
}
.tab-button:hover { background: rgba(var(--green-rgb), 0.1); }
.tab-button:hover:not(.active) { color: var(--text-green); background: rgba(var(--green-rgb), 0.05); opacity: 1; }
.tab-button.active {
  background: rgba(var(--green-rgb), 0.2);
  border-bottom: 1px solid var(--color-green);
  color: var(--color-text);
  opacity: 1;
}
.tab-count { font-size: 0.85em; opacity: 0.7; }
.refresh-button { padding: 6px 12px; margin-bottom: 4px; }

/* ── Content ── */
.learning-list { min-width: 0; width: 100%; }
.view-caption { color: var(--color-light-med-navy); font-size: 0.9em; margin: 0 0 16px; opacity: 0.9; }

/* ── Cards (Settings.vue .settings-section) ── */
.learning-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  padding: 24px;
  transition: all 0.3s ease;
  margin-bottom: 16px;
  cursor: pointer;
}
.learning-card:hover,
.learning-card.chosen { border-color: rgba(var(--green-rgb), 0.45); }
.card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.kind-tag { font-size: 0.75em; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--color-light-med-navy); }
.outcome-tag { font-size: 0.75em; border: 1px solid var(--terminal-border-color); padding: 4px 10px; border-radius: 999px; color: var(--color-light-med-navy); }
.outcome-tag.supported { color: var(--text-green); border-color: rgba(var(--green-rgb), 0.35); }
.outcome-tag.watching { color: var(--status-blue-text); }
.outcome-tag.inconclusive,
.outcome-tag.regressed { color: var(--status-amber-text); }
.learning-card h3 { color: var(--color-light-green); font-size: 1.2em; font-weight: 500; margin: 16px 0 8px; overflow-wrap: anywhere; }
.learning-card p { color: var(--color-light-med-navy); font-size: 0.95em; line-height: 1.5; margin: 0 0 16px; opacity: 0.9; }
.proposed-fix { display: flex; gap: 12px; padding: 14px 16px; border: 1px solid var(--terminal-border-color); border-radius: 12px; margin: 0 0 16px; }
.fix-symbol { color: var(--text-green); font-size: 1.2em; }
.proposed-fix b { font-weight: 500; }
.proposed-fix small { display: block; margin-top: 4px; color: var(--color-light-med-navy); }
.learning-card footer { border-top: 1px solid var(--terminal-border-color); padding-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.learning-card footer > span { font-size: 0.85em; color: var(--color-light-med-navy); }
.learning-card footer button { background: none; border: 0; padding: 4px 0; color: var(--text-green); font: inherit; font-size: 0.9em; cursor: pointer; white-space: nowrap; }
.card-metric { display: flex; align-items: center; gap: 14px; font-size: 1.5em; margin: 0 0 16px; }
.card-metric strong { color: var(--text-green); font-weight: 500; }
.card-metric .arrow,
.card-metric small { font-size: 0.55em; color: var(--color-light-med-navy); }
.trial-progress { height: 4px; background: var(--terminal-border-color); border-radius: 4px; margin: 16px 0 8px; overflow: hidden; }
.trial-progress span { display: block; height: 100%; background: var(--color-green); }
.trial-meta { display: flex; justify-content: space-between; font-size: 0.85em; color: var(--color-light-med-navy); margin-bottom: 16px; }
.policy-rule { font-family: var(--font-family-mono, monospace); font-size: 0.85em; line-height: 2; margin: 0 0 16px; }
.policy-rule span { color: var(--text-green); margin-right: 12px; }
.history { font-size: 0.85em; color: var(--color-light-med-navy); line-height: 1.7; }
.history summary { cursor: pointer; }

/* ── Empty ── */
.learning-empty { text-align: center; padding: 56px 24px; }
.empty-mark { display: inline-grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--terminal-border-color); border-radius: 50%; color: var(--text-green); }
.learning-empty h3 { font-size: 1.2em; font-weight: 500; margin: 20px 0 8px; }
.learning-empty p { color: var(--color-light-med-navy); line-height: 1.5; margin: 0; }
.learning-empty small { display: block; margin-top: 16px; color: var(--color-light-med-navy); }

@media (max-width: 1000px) {
  .privacy { display: none; }
}
@media (max-width: 700px) {
  .learning-header { flex-direction: column; }
  .learning-summary { gap: 16px; }
  .tab-button { padding: 8px 10px; font-size: 0.9em; }
  .refresh-button { display: none; }
  .learning-card { padding: 18px; }
  .btn { min-height: 44px; }
  .learning-card footer button { padding: 10px 4px; }
}
</style>
