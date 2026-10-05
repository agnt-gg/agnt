<template>
  <div class="gd-root">
    <header class="gd-head">
      <div class="gd-head-top"><span class="gd-id">{{ shortId }}</span><span class="gd-pill" :class="stageTone">{{ statusLabel }}</span><span v-if="goal.priority" class="gd-pill plain">{{ goal.priority }}</span><span v-if="agentName" class="gd-pill plain"><i class="fas fa-robot" aria-hidden="true"></i>{{ agentName }}</span></div>
      <h2 class="gd-title">{{ goal.title || 'Untitled goal' }}</h2>
      <details v-if="goal.description" class="gd-description"><summary>Goal brief <span>{{ goal.description.split('\n')[0] }}</span></summary><p>{{ goal.description }}</p></details>
      <dl class="gd-meta"><div v-for="item in meta" :key="item.label"><dt><i :class="item.icon" aria-hidden="true"></i>{{ item.label }}</dt><dd>{{ item.value }}</dd></div></dl>
    </header>
    <div v-if="loadError" class="gd-message error" role="alert">{{ loadError }}<button type="button" @click="loadGoal">Retry loading</button></div>
    <p v-if="notice" class="gd-message" :class="notice.type" :role="notice.type === 'error' ? 'alert' : 'status'">{{ notice.message }}</p>
    <p v-if="loading" role="status">Loading goal details…</p>
    <div class="gd-panes">
      <GoalDetailEvidence ref="evidenceRef" :report="report" :sections="sections" :deliverables="deliverables" :other-files="otherFiles" :tasks="reviewTasks" :render-markdown="renderMarkdown" @copy-path="copyPath" @retry-report="loadReport" />
      <GoalDetailVerdict :key="goalId" :verdict="verdict" :items="reviewItems" :scores="scores" :evaluated-at="evaluatedAt" :can-sign-off="canSignOff" :can-revise="canRevise" :approve-label="isPlan ? 'Approve plan' : 'Approve result'" :is-paused="goal.status === 'paused'" :can-pause="goal.status === 'executing' || goal.status === 'queued'" :can-run="canRun" :busy="busy || loading" :submit-feedback="requestChanges" @approve="approveGoal" @evaluate="evaluateGoal" @pause="pauseGoal" @resume="resumeGoal" @run="runGoal" @show-task="showTask" @open-file="previewFile" @open-section="previewSection" />
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import showdown from 'showdown';
import DOMPurify from 'dompurify';
import GoalDetailEvidence from './GoalDetailEvidence.vue';
import GoalDetailVerdict from './GoalDetailVerdict.vue';
import { goalArtifactSource } from '../goalArtifacts.js';
import { reviewChecklist } from '../goalChecklist.js';
import { deliverablesFor, proofFor, reportSections, reviewVerdict } from '../goalReview.js';
import { getGoalStage } from '../goalBoard.js';
import { reviewPercent } from '../goalDetailModel.js';
import { getFile } from '@/services/fileSystemService.js';
const props = defineProps({ goalId: { type: String, required: true }, goals: { type: Array, default: () => [] } });
const emit = defineEmits(['panel-action']);
const store = useStore();
const busy = ref(false), loading = ref(false), loadError = ref(''), notice = ref(null), evidenceRef = ref(null);
const goal = computed(() => store.getters['goals/getGoalById']?.(props.goalId) || props.goals.find(g => g.id === props.goalId) || {});
const shortId = computed(() => 'G-' + props.goalId.slice(0,8));
const statusLabel = computed(() => String(goal.value.status || 'unknown').replace(/_/g,' '));
const stageTone = computed(() => ['validated','completed'].includes(goal.value.status) ? 'good' : goal.value.status === 'needs_review' ? 'warn' : ['failed','error'].includes(goal.value.status) ? 'bad' : 'plain');
const isPlan = computed(() => getGoalStage(goal.value) === 'plan');
const canSignOff = computed(() => ['needs_review','completed'].includes(goal.value.status));
const canRevise = computed(() => ['needs_review','completed','validated','failed','error','stopped','planning'].includes(goal.value.status));
const canRun = computed(() => ['planning','failed','error','stopped'].includes(goal.value.status));
const agentName = computed(() => goal.value.agent_name || goal.value.agent?.name || '');
const reviewTasks = computed(() => Array.isArray(goal.value.tasks) ? goal.value.tasks : []);
const artifactSource = computed(() => goalArtifactSource(reviewTasks.value));
const checklist = computed(() => reviewChecklist(goal.value));
const verdict = computed(() => reviewVerdict(checklist.value));
const scores = computed(() => ({ ...goal.value.evaluation?.evaluation_data?.scores, overall: reviewPercent(goal.value.evaluation?.overall_score ?? goal.value.evaluation?.evaluation_data?.scores?.overall) }));
const evaluatedAt = computed(() => goal.value.evaluation?.evaluated_at || goal.value.evaluation?.created_at || '');
const deliverables = computed(() => deliverablesFor(checklist.value.items, artifactSource.value.files));
const otherFiles = computed(() => artifactSource.value.files.filter(f => !deliverables.value.includes(f)));
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const formatDate = value => { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); };
const meta = computed(() => {
  const g = goal.value, tasks = reviewTasks.value;
  const rows = [{icon:'far fa-calendar',label:'Created',value:formatDate(g.created_at)},{icon:'fas fa-history',label:'Updated',value:formatDate(g.updated_at)}, {icon:'fas fa-tasks',label:'Tasks',value:(tasks.length ? tasks.filter(t=>t.status==='completed').length : g.completed_tasks ?? 0)+' of '+(tasks.length || g.task_count || 0)}];
  for (const [field,label,icon] of [['current_iteration','Iteration','fas fa-sync-alt'],['credits_used','Credits','fas fa-coins'],['total_tokens','Tokens','fas fa-bolt'],['notional_cost','Notional cost','fas fa-chart-bar']]) {
    if (numeric(g[field])) rows.push({icon,label,value:field==='notional_cost' ? '$'+Number(g[field]).toFixed(2) : field==='current_iteration' ? g[field]+' of '+(g.max_iterations ?? '—') : Number(g[field]).toLocaleString()});
  }
  return rows;
});
const converter = new showdown.Converter({tables:true,strikethrough:true,literalMidWordUnderscores:true,ghCodeBlocks:true});
const renderMarkdown = text => DOMPurify.sanitize(converter.makeHtml(String(text || '')), { FORBID_TAGS: ['script','iframe','object','embed','form','input'] });
const report = ref({path:'',text:'',error:'',loading:false,truncated:false});
const reportPath = computed(() => [...deliverables.value,...otherFiles.value].find(f => /\.(md|markdown|txt)$/i.test(f)) || '');
let reportEpoch = 0, loadEpoch = 0;
async function loadReport() {
  const epoch = ++reportEpoch, path = reportPath.value, id = props.goalId;
  report.value = {path,text:'',error:'',loading:!!path,truncated:false};
  if (!path) return;
  try { const result = await getFile(path); if (epoch !== reportEpoch || id !== props.goalId) return;
    const text = String(result?.content ?? ''); report.value = {path,text:text.slice(0,200000),error:'',loading:false,truncated:text.length>200000};
  } catch (error) { if (epoch === reportEpoch && id === props.goalId) { console.warn('[GoalDetail] Report:',error.message); report.value = {path,text:'',error:error.message,loading:false,truncated:false}; } }
}
watch([() => props.goalId, reportPath], loadReport, {immediate:true});
const sections = computed(() => reportSections(report.value.text));
const rank = item => item.met === false ? 0 : item.met === true ? 2 : 1;
const reviewItems = computed(() => checklist.value.items.map((item,order)=>({...item,order,proof:proofFor(item,{tasks:reviewTasks.value,files:artifactSource.value.files,sections:sections.value})})).sort((a,b)=>rank(a)-rank(b)||a.order-b.order));
function previewFile(path) { evidenceRef.value?.previewFile(path); }
function previewSection(heading) { evidenceRef.value?.showSection(heading); }
function showTask(number) { evidenceRef.value?.showTask(number); }
function feedback(type,message) { notice.value={type,message}; emit('panel-action','show-feedback',{type,message}); }
async function copyPath(path) { try { await navigator.clipboard.writeText(path); feedback('success','Path copied'); } catch(error) { feedback('error','Could not copy path: '+error.message); } }
async function loadGoal() {
  const id = props.goalId, epoch = ++loadEpoch; if (!id) return;
  loading.value = true; loadError.value='';
  try {
    await store.dispatch('goals/fetchGoalTasks',id);
    if (id!==props.goalId || epoch!==loadEpoch) return;
    await store.dispatch('goals/fetchGoalEvaluation',id);
  } catch(error) { if (epoch===loadEpoch) loadError.value='Could not load goal: '+error.message; }
  finally { if (epoch===loadEpoch) loading.value=false; }
}
watch(() => props.goalId, () => { notice.value=null; loadGoal(); }, {immediate:true});
onBeforeUnmount(() => { reportEpoch++; loadEpoch++; });
// Gate every mutation against the CURRENT state, and pin the id through async
// completion so a late result cannot report success on a different goal.
async function perform(action,payload,message,allowed=true) {
  if (!allowed || busy.value || loading.value || !props.goalId) return false;
  const id = props.goalId; busy.value=true; notice.value=null;
  try { const result=await store.dispatch(action,payload); if (id===props.goalId) feedback('success',result?.message || message); return true; }
  catch(error) { console.error('[GoalDetail]',action,error); if(id===props.goalId) feedback('error',error.message || 'Action failed'); return false; }
  finally { busy.value=false; }
}
const approveGoal = () => perform('goals/reviewGoal',{goalId:props.goalId,action:'approve'},'Result accepted',canSignOff.value);
const requestChanges = text => perform('goals/reviewGoal',{goalId:props.goalId,action:'reject',feedback:text.trim()},'Returned for revision. Use Run goal when ready.',canRevise.value && !!text.trim());
const evaluateGoal = () => perform('goals/evaluateGoal',{goalId:props.goalId,evaluationType:'automatic'},'Evaluation complete');
const pauseGoal = () => perform('goals/pauseGoal',props.goalId,'Goal paused',['executing','queued'].includes(goal.value.status));
const resumeGoal = () => perform('goals/resumeGoal',props.goalId,'Goal resumed',goal.value.status==='paused');
const runGoal = () => perform('goals/executeGoalAutonomous',{goalId:props.goalId,maxIterations:goal.value.max_iterations || 50},'Goal execution started',canRun.value);
</script>
<style scoped>
.gd-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  gap: 12px;
}
.gd-head {
  flex: 0 0 auto;
}
.gd-head-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.gd-id {
  font-family: var(--font-family-mono);
  font-size: 0.72em;
  color: var(--color-text-muted);
}
.gd-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  font-size: 0.66em;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.gd-pill.good {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.12);
  color: var(--color-green);
}
.gd-pill.warn {
  border-color: rgba(var(--orange-rgb), 0.4);
  background: rgba(var(--orange-rgb), 0.12);
  color: var(--color-orange);
}
.gd-pill.bad {
  border-color: rgba(var(--red-rgb), 0.4);
  background: rgba(var(--red-rgb), 0.12);
  color: var(--color-red);
}
.gd-title {
  margin: 8px 0 6px;
  font-size: 1.5em;
  line-height: 1.15;
  color: var(--color-ultra-light-navy);
}
.gd-desc {
  margin: 0;
  max-width: 90ch;
  font-size: 0.84em;
  line-height: 1.55;
  color: var(--color-text-muted);
}
.gd-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 0;
}
.gd-meta > div {
  flex: 1 1 140px;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}
.gd-meta dt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.62em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.gd-meta dd {
  margin: 3px 0 0;
  font-size: 0.88em;
  font-weight: 600;
  color: var(--color-text);
}
.gd-panes {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  position: relative;
  grid-template-columns: minmax(0, 1.4fr) minmax(360px, 1fr);
  gap: 12px;
}
.gd-description { margin: 4px 0 0; color: var(--color-text-muted); font-size: .84em; }
.gd-description summary { display: flex; align-items: baseline; gap: 12px; cursor: pointer; }
.gd-description summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.gd-description p { white-space: pre-wrap; max-height: 160px; overflow: auto; }
.gd-message { padding: 9px 12px; margin: 0; border: 1px solid var(--terminal-border-color); border-radius: 7px; font-size: .85em; }
.gd-message.error { color: var(--color-red); }
.gd-message.success { color: var(--color-green); }
.gd-message button { margin-left: 12px; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 4px; cursor: pointer; }
@media (max-width: 900px) {
  .gd-root { flex: 0 0 auto; width: 100%; }
  .gd-panes { display: flex; flex-direction: column; flex: none; }
  .gd-panes > * { flex: none; }
  .gd-title { font-size: 1.3em; overflow-wrap: anywhere; }
  .gd-meta > div { flex-basis: 110px; }
}
</style>
