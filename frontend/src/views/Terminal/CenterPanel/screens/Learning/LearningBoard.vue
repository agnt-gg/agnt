<template>
  <section class="learning-board settings-content" aria-label="Learning">
    <header class="content-header learning-header">
      <div><h2 class="content-title">Learning</h2><p class="content-subtitle">What went wrong, what is being tested, and what helped.</p></div>
      <button class="btn btn-quiet pause-button" :disabled="busy" @click="$emit('pause', !data.settings.paused)"><span class="live-dot" :class="{paused:data.settings.paused}"></span>{{ data.settings.paused ? 'Resume learning' : 'Pause learning' }}</button>
    </header>
    <div class="learning-summary"><span><b>{{ data.coverage?.work || 0 }}</b> tracked runs</span><span><b>{{ data.coverage?.events || 0 }}</b> evidence records</span><span class="privacy">Local to your account · No automatic permissions</span></div>
    <div v-if="error" class="error-banner" role="alert">{{ error }} <button class="btn btn-quiet" @click="$emit('refresh')">Retry</button></div>
    <nav class="tab-controls" aria-label="Learning views">
      <div class="tab-tabs">
        <button v-for="tab in tabs" :key="tab.id" class="tab-button" :class="{active:view===tab.id}" :aria-pressed="view===tab.id" @click="view=tab.id;selected=null">{{ tab.label }} <span class="tab-count">{{ count(tab.id) }}</span></button>
      </div>
      <button class="btn btn-quiet refresh-button" :disabled="busy" @click="$emit('refresh')" aria-label="Refresh learning"><i class="fas fa-sync-alt" aria-hidden="true"></i></button>
    </nav>
    <div class="learning-content" :class="{inspecting:selected}">
      <main class="learning-list">
        <p class="view-caption">{{ captions[view] }}</p>
        <template v-if="view==='attention'">
          <article v-for="trial in reviewed" :key="trial.id" class="learning-card" :class="{chosen:selected?.id===trial.id}" @click="selected={...trial,kind:'trial'}">
            <div class="card-top"><span class="kind-tag">REVIEW READY</span><span class="outcome-tag" :class="trial.result?.verdict">{{ verdictLabel(trial.result?.verdict) }}</span></div>
            <h3>{{ title(trial.candidate.when.capability,trial.candidate.when.error_kind) }}</h3><p>{{ trial.result?.explanation }}</p>
            <div class="card-metric" v-if="trial.result?.before!=null"><span>{{ percent(trial.result.before) }}</span><span class="arrow">→</span><strong>{{ percent(trial.result.after) }}</strong><small>failure rate · observational</small></div>
            <footer><span>Review the outcome before keeping this change.</span><button @click.stop="selected={...trial,kind:'trial'}">Review result →</button></footer>
          </article>
          <article v-for="finding in detected" :key="finding.id" class="learning-card" :class="{chosen:selected?.id===finding.id}" @click="selected={...finding,kind:'finding'}">
            <div class="card-top"><span class="kind-tag">RECURRING PROBLEM</span><span class="outcome-tag">{{ finding.candidate ? 'Fix available' : 'Evidence only' }}</span></div>
            <h3>{{ title(finding.capability,finding.error_kind) }}</h3><p>{{ finding.occurrences }} failures across {{ finding.independent_runs }} independent runs. Repeated evidence is grouped here, not saved as another memory.</p>
            <div class="proposed-fix" v-if="finding.candidate"><span class="fix-symbol">↳</span><div><b>Try one retry after a transient read failure.</b><small>Read-only tools only. No new authority.</small></div></div>
            <footer><span>{{ finding.candidate ? '7-day trial · measurable · reversible' : 'No supported automatic change yet' }}</span><button @click.stop="selected={...finding,kind:'finding'}">See evidence →</button></footer>
          </article>
        </template>
        <template v-if="view==='watching'">
          <article v-for="trial in watching" :key="trial.id" class="learning-card" :class="{chosen:selected?.id===trial.id}" @click="selected={...trial,kind:'trial'}">
            <div class="card-top"><span class="kind-tag">TIMED TRIAL</span><span class="outcome-tag watching">{{ daysLeft(trial.review_due_at) }}</span></div>
            <h3>{{ title(trial.candidate.when.capability,trial.candidate.when.error_kind) }}</h3><p>One approved retry for a read-only tool. Continue using AGNT normally; only eligible exposed calls count.</p>
            <div class="trial-progress"><span :style="{width:progress(trial)+'%'}"></span></div>
            <div class="trial-meta"><span>Started {{ date(trial.started_at) }}</span><span>Review {{ date(trial.review_due_at) }}</span></div>
            <footer><span>Baseline: {{ trial.baseline.eligible }} calls · {{ trial.observed?.eligible || 0 }} / {{ trial.minimum_samples }} observed</span><button @click.stop="selected={...trial,kind:'trial'}">Inspect trial →</button></footer>
          </article>
        </template>
        <template v-if="view==='learned'">
          <article v-for="policy in activePolicies" :key="policy.id" class="learning-card learned-card" :class="{chosen:selected?.id===policy.id}" @click="selectPolicy(policy)">
            <div class="card-top"><span class="kind-tag">ACTIVE POLICY</span><span class="outcome-tag supported">Version {{ policy.version }}</span></div>
            <h3>{{ title(policy.capability,policy.error_kind) }}</h3><p>Supported by a measured trial and kept by you. Future matching calls use this bounded decision.</p>
            <div class="policy-rule"><span>WHEN</span> {{ policy.capability }} reports {{ policy.error_kind }}<br><span>THEN</span> retry once, read-only</div>
            <footer><span>Activated {{ date(policy.activated_at) }}</span><button @click.stop="selectPolicy(policy)">View receipt →</button></footer>
          </article>
          <details class="history" v-if="closed.length"><summary>{{ closed.length }} closed {{ closed.length===1?'trial':'trials' }}</summary><p v-for="trial in closed" :key="trial.id">{{ trial.candidate.when.capability }} · {{ trial.state==='reverted'?'Reverted':verdictLabel(trial.result?.verdict) }}</p></details>
        </template>
        <div v-if="!visibleCount" class="learning-empty"><span class="empty-mark">✓</span><h3>{{ emptyTitles[view] }}</h3><p>{{ emptyDescriptions[view] }}</p><small>No new suggestions is a healthy result.</small></div>
      </main>
      <aside v-if="selected" class="learning-detail" aria-label="Improvement detail">
        <header><span class="detail-label">Improvement receipt</span><button class="detail-close" @click="selected=null" aria-label="Close detail"><i class="fas fa-times" aria-hidden="true"></i></button></header>
        <h3>{{ title(selected.capability||selected.candidate?.when.capability,selected.error_kind||selected.candidate?.when.error_kind) }}</h3>
        <ol class="lifecycle"><li class="complete">Detected</li><li :class="{complete:selected.candidate}">Candidate</li><li :class="{complete:selected.kind==='trial'}">Trial</li><li :class="{complete:selected.result}">Result</li></ol>
        <template v-if="selected.kind==='finding'">
          <dl><dt>Observed failures</dt><dd>{{ selected.occurrences }}</dd><dt>Independent runs</dt><dd>{{ selected.independent_runs }}</dd><dt>Scope</dt><dd>{{ selected.capability }}</dd><dt>Evidence quality</dt><dd>Reported tool outcomes</dd></dl>
          <div class="detail-section"><h3>What would change?</h3><p>{{ selected.candidate ? 'Retry once when this read-only operation reports a transient failure. Security checks still run for each attempt.' : 'Nothing automatically. This finding needs a supported, measurable candidate before it can become a trial.' }}</p></div>
          <div class="detail-section"><h3>How will we know?</h3><p>Compare this capability’s failure rate against a fixed seven-day baseline. At least 20 known, exposed calls are required. No usage means inconclusive.</p></div>
          <div class="detail-actions"><button v-if="selected.candidate" class="btn btn-primary" :disabled="busy||data.settings.paused" @click="$emit('approve',selected)">Try for 7 days</button><button class="btn btn-quiet" :disabled="busy" @click="$emit('dismiss',selected)">Dismiss</button></div>
        </template>
        <template v-else>
          <dl><dt>Started</dt><dd>{{ date(selected.started_at) }}</dd><dt>Review deadline</dt><dd>{{ date(selected.review_due_at) }}</dd><dt>Baseline calls</dt><dd>{{ selected.baseline.eligible }}</dd><dt>Observed calls</dt><dd>{{ selected.observed?.eligible ?? selected.result?.candidate.eligible ?? 0 }}</dd><dt>Measurement</dt><dd>Failure rate / eligible call</dd></dl>
          <div class="detail-section" v-if="selected.result"><h3>{{ verdictLabel(selected.result.verdict) }}</h3><div class="result-numbers"><span><small>BEFORE</small><b>{{ percent(selected.result.before) }}</b></span><span><small>AFTER</small><b>{{ percent(selected.result.after) }}</b></span></div><p>{{ selected.result.explanation }}</p><small>{{ selected.result.candidate.eligible }} exposed calls · {{ selected.result.method }}</small></div>
          <div class="detail-section" v-else><h3>Watching normal use</h3><p>The deadline survives restarts. The provisional policy stops at review time; keeping it is a separate decision.</p></div>
          <div class="detail-actions"><button v-if="selected.state==='reviewed'&&selected.result?.verdict==='supported'" class="btn btn-primary" :disabled="busy||data.settings.paused" @click="$emit('keep',selected)">Keep this improvement</button><button v-if="['watching','active','reviewed'].includes(selected.state)" class="btn btn-quiet" :disabled="busy" @click="$emit('undo',selected)">{{ selected.state==='watching'||selected.state==='active'?'Undo change':'Close trial' }}</button></div>
        </template>
        <details class="schema-details"><summary>Structured receipt</summary><pre>{{ JSON.stringify(selected,null,2) }}</pre></details>
      </aside>
    </div>
  </section>
</template>
<script setup>
import {computed,ref,watch} from 'vue';
const props=defineProps({data:{type:Object,required:true},busy:Boolean,error:{type:String,default:''},initialView:{type:String,default:'attention'}});
defineEmits(['approve','dismiss','keep','undo','pause','refresh']);
const view=ref(props.initialView),selected=ref(null);
const tabs=[{id:'attention',label:'Needs attention'},{id:'watching',label:'Being tested'},{id:'learned',label:'Learned'}];
const detected=computed(()=>props.data.findings.filter(x=>x.state==='detected'&&x.occurrences>=3&&x.independent_runs>=2));
const reviewed=computed(()=>props.data.trials.filter(x=>x.state==='reviewed'));
const watching=computed(()=>props.data.trials.filter(x=>x.state==='watching'));
const activePolicies=computed(()=>props.data.policies.filter(x=>x.state==='active'));
const closed=computed(()=>props.data.trials.filter(x=>['reverted','reviewed'].includes(x.state)));
const count=id=>id==='attention'?detected.value.length+reviewed.value.length:id==='watching'?watching.value.length:activePolicies.value.length;
const visibleCount=computed(()=>count(view.value));
const captions={attention:'Evidence first. Only supported candidates can become changes.',watching:'Keep working as usual. Every trial has a deadline and an undo.',learned:'Decisions that passed a measured review—not just saved advice.'};
const emptyTitles={attention:'Nothing needs your attention.',watching:'No changes being tested.',learned:'Nothing promoted without evidence.'};
const emptyDescriptions={attention:'Recurring problems will appear here when there is evidence worth reviewing.',watching:'Approve a measurable, reversible candidate to start a timed trial.',learned:'Supported trials kept by you become scoped runtime policies here.'};
const title=(capability,kind)=>`${capability||'Operation'} · ${String(kind||'outcome').replaceAll('_',' ')}`;
const date=value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const percent=value=>value==null?'Unknown':Math.round(value*100)+'%';
const daysLeft=value=>Math.max(0,Math.ceil((value-Date.now())/86400000))+' days to review';
const progress=trial=>Math.max(0,Math.min(100,100*(Date.now()-trial.started_at)/(trial.review_due_at-trial.started_at)));
const verdictLabel=value=>({supported:'Improvement observed',regressed:'Regression observed',inconclusive:'Not enough evidence',no_clear_benefit:'No clear benefit'}[value]||'Review pending');
function selectPolicy(policy){const trial=props.data.trials.find(x=>x.id===policy.trial_id);if(trial)selected.value={...trial,kind:'trial'};}
watch(()=>props.data,()=>{if(selected.value){const rows=selected.value.kind==='finding'?props.data.findings:props.data.trials;const updated=rows.find(x=>x.id===selected.value.id);selected.value=updated?{...updated,kind:selected.value.kind}:null;}});
</script>
<style scoped>
/* Learning sits beside the Settings nav, so it IS a Settings page: every rule
   below is copied from an existing Settings surface, not designed here.
     page + header ....... Settings.vue .settings-content / .content-*
     tabs ................ BaseTabControls .tab-controls / .tab-button
     cards ............... Settings.vue .settings-section
     buttons ............. Settings › Data (dataPanel.css) .btn / -primary / -quiet */

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
.btn-primary { background: var(--color-primary); color: var(--on-fill-accent); font-weight: 600; }
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
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
.tab-tabs { display: flex; gap: 2px; margin-bottom: 1px; }
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
.tab-button:hover:not(.active) { color: var(--color-green); background: rgba(var(--green-rgb), 0.05); opacity: 1; }
.tab-button.active {
  background: rgba(var(--green-rgb), 0.2);
  border-bottom: 1px solid var(--color-green);
  color: var(--color-text);
  opacity: 1;
}
.tab-count { font-size: 0.85em; opacity: 0.7; }
.refresh-button { padding: 6px 12px; margin-bottom: 4px; }

/* ── Content ── */
.learning-content { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; width: 100%; }
.learning-content.inspecting { grid-template-columns: minmax(0, 1fr) 340px; }
.learning-list { min-width: 0; }
.view-caption { color: var(--color-light-med-navy); font-size: 0.9em; margin: 0 0 16px; opacity: 0.9; }

/* ── Cards (Settings.vue .settings-section) ── */
.learning-card,
.learning-detail {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  padding: 24px;
  transition: all 0.3s ease;
}
.learning-card { margin-bottom: 16px; cursor: pointer; }
.learning-card:hover,
.learning-card.chosen { border-color: rgba(var(--green-rgb), 0.45); }
.card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.kind-tag { font-size: 0.75em; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--color-light-med-navy); }
.outcome-tag { font-size: 0.75em; border: 1px solid var(--terminal-border-color); padding: 4px 10px; border-radius: 999px; color: var(--color-light-med-navy); }
.outcome-tag.supported { color: var(--color-green); border-color: rgba(var(--green-rgb), 0.35); }
.outcome-tag.watching { color: var(--status-blue-text); }
.outcome-tag.inconclusive,
.outcome-tag.regressed { color: var(--status-amber-text); }
.learning-card h3,
.learning-detail h3 { color: var(--color-light-green); font-size: 1.2em; font-weight: 500; margin: 16px 0 8px; overflow-wrap: anywhere; }
.learning-card p,
.detail-section p { color: var(--color-light-med-navy); font-size: 0.95em; line-height: 1.5; margin: 0 0 16px; opacity: 0.9; }
.proposed-fix { display: flex; gap: 12px; padding: 14px 16px; border: 1px solid var(--terminal-border-color); border-radius: 12px; margin: 0 0 16px; }
.fix-symbol { color: var(--color-green); font-size: 1.2em; }
.proposed-fix b { font-weight: 500; }
.proposed-fix small { display: block; margin-top: 4px; color: var(--color-light-med-navy); }
.learning-card footer { border-top: 1px solid var(--terminal-border-color); padding-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.learning-card footer > span { font-size: 0.85em; color: var(--color-light-med-navy); }
.learning-card footer button { background: none; border: 0; padding: 4px 0; color: var(--color-green); font: inherit; font-size: 0.9em; cursor: pointer; white-space: nowrap; }
.card-metric { display: flex; align-items: center; gap: 14px; font-size: 1.5em; margin: 0 0 16px; }
.card-metric strong { color: var(--color-green); font-weight: 500; }
.card-metric .arrow,
.card-metric small { font-size: 0.55em; color: var(--color-light-med-navy); }
.trial-progress { height: 4px; background: var(--terminal-border-color); border-radius: 4px; margin: 16px 0 8px; overflow: hidden; }
.trial-progress span { display: block; height: 100%; background: var(--color-green); }
.trial-meta { display: flex; justify-content: space-between; font-size: 0.85em; color: var(--color-light-med-navy); margin-bottom: 16px; }
.policy-rule { font-family: var(--font-family-mono, monospace); font-size: 0.85em; line-height: 2; margin: 0 0 16px; }
.policy-rule span { color: var(--color-green); margin-right: 12px; }

/* ── Detail ── */
.learning-detail { align-self: start; position: sticky; top: 0; }
.learning-detail header { display: flex; justify-content: space-between; align-items: center; }
.detail-label { font-size: 0.75em; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--color-light-med-navy); }
.detail-close { background: none; border: 0; color: var(--color-light-med-navy); cursor: pointer; padding: 4px; }
.detail-close:hover { color: var(--color-text); }
.lifecycle { display: flex; list-style: none; padding: 0; gap: 12px; font-size: 0.8em; color: var(--color-light-med-navy); margin: 0 0 20px; }
.lifecycle li { padding-bottom: 6px; border-bottom: 2px solid var(--terminal-border-color); }
.lifecycle .complete { border-color: var(--color-green); color: var(--color-text); }
dl { display: grid; grid-template-columns: 1fr auto; gap: 10px; font-size: 0.85em; margin: 0; }
dt { color: var(--color-light-med-navy); }
dd { margin: 0; max-width: 170px; text-align: right; overflow-wrap: anywhere; }
.detail-section { border-top: 1px solid var(--terminal-border-color); margin-top: 20px; padding-top: 16px; }
.detail-section h3 { font-size: 1em; margin-top: 0; }
.detail-section small { font-size: 0.8em; color: var(--color-light-med-navy); overflow-wrap: anywhere; }
.detail-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
.result-numbers { display: flex; gap: 32px; margin: 16px 0; }
.result-numbers small { display: block; font-size: 0.75em; letter-spacing: 0.5px; color: var(--color-light-med-navy); }
.result-numbers b { display: block; font-size: 1.8em; font-weight: 500; margin-top: 6px; }
.schema-details,
.history { font-size: 0.85em; color: var(--color-light-med-navy); line-height: 1.7; }
.schema-details summary,
.history summary { cursor: pointer; }
.schema-details pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.9em; max-height: 260px; overflow: auto; }

/* ── Empty ── */
.learning-empty { text-align: center; padding: 56px 24px; }
.empty-mark { display: inline-grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--terminal-border-color); border-radius: 50%; color: var(--color-green); }
.learning-empty h3 { font-size: 1.2em; font-weight: 500; margin: 20px 0 8px; }
.learning-empty p { color: var(--color-light-med-navy); line-height: 1.5; margin: 0; }
.learning-empty small { display: block; margin-top: 16px; color: var(--color-light-med-navy); }

@media (max-width: 1000px) {
  .learning-content.inspecting { grid-template-columns: minmax(0, 1fr) 300px; }
  .privacy { display: none; }
}
@media (max-width: 700px) {
  .learning-header { flex-direction: column; }
  .learning-summary { gap: 16px; }
  .tab-button { padding: 8px 10px; font-size: 0.9em; }
  .refresh-button { display: none; }
  .learning-content.inspecting { display: flex; flex-direction: column; }
  .learning-content.inspecting .learning-list { display: none; }
  .learning-detail { position: static; }
  .learning-card { padding: 18px; }
  .btn { min-height: 44px; }
  .learning-card footer button { padding: 10px 4px; }
}
</style>
