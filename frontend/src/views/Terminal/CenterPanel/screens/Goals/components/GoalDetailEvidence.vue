<template>
  <section ref="root" class="gd-evidence" :class="{ 'expanded-preview': expandedPreview }" aria-label="Goal work and previews" @keydown.esc.stop="closePreview">
    <div class="gd-tabs" role="tablist" aria-label="Goal work">
      <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" class="gd-tab" :class="{ active: tab.id === activeId && !selectedArtifact }" :aria-selected="tab.id === activeId && !selectedArtifact" @click="selectTab(tab.id)"><i :class="tab.icon" aria-hidden="true"></i>{{ tab.label }}<span v-if="tab.count" class="gd-tab-n">{{ tab.count }}</span></button>
    </div>
    <ArtifactInspector v-if="selectedArtifact" :key="selectedArtifact.id" :artifact="selectedArtifact" class="gd-inline-preview" @close="closePreview" @expand="expandedPreview = !expandedPreview" />
    <div v-else class="gd-evidence-body">
      <div v-if="activeTab.kind === 'report'" class="gd-doc">
        <div v-if="report.path" class="gd-doc-head"><i class="fas fa-file-alt" aria-hidden="true"></i><div class="gd-doc-file"><strong>{{ baseName(report.path) }}</strong><small :title="report.path">{{ report.path }}</small></div><div class="gd-doc-tools"><button type="button" class="gd-mini" @click="previewFile(report.path)"><i class="far fa-eye" aria-hidden="true"></i> Preview</button><button type="button" class="gd-mini" @click="$emit('copy-path',report.path)"><i class="far fa-copy" aria-hidden="true"></i> Copy path</button></div></div>
        <p v-if="report.loading" class="gd-hint" role="status">Loading report…</p>
        <div v-else-if="report.error" role="alert"><p>Couldn't read the report: {{ report.error }}</p><button type="button" class="gd-mini" @click="$emit('retry-report')">Retry</button></div>
        <template v-else><h3 v-if="activeTab.id !== 'report'">{{ activeTab.label }}</h3><div v-if="activeTab.markdown" class="gd-rendered" @click="openReportLink" v-html="renderMarkdown(activeTab.markdown)"></div><p v-else class="gd-hint">No written report yet. Check All files or Activity for this goal's work.</p><p v-if="report.truncated" class="gd-hint">Report preview limited to 200,000 characters. The original remains available in Preview.</p></template>
      </div>
      <div v-else-if="activeTab.kind === 'files'" class="gd-files">
        <p v-if="!files.length" class="gd-hint">No files recorded yet. Task outputs remain available under Activity.</p>
        <div v-for="file in files" :key="file" class="gd-file" :class="{ primary: deliverables.includes(file) }"><i class="fas fa-file-alt" aria-hidden="true"></i><div class="gd-file-body"><strong>{{ baseName(file) }}</strong><small :title="file">{{ file }}</small></div><span v-if="deliverables.includes(file)" class="gd-tag">Deliverable</span><button type="button" class="gd-mini" @click="previewFile(file)"><i class="far fa-eye" aria-hidden="true"></i> Preview</button></div>
      </div>
      <div v-else class="gd-activity">
        <article v-for="(task,index) in tasks" :key="task.id || index" class="gd-task" :data-review-task="index + 1">
          <header><span class="gd-task-n">{{ index + 1 }}</span><h4>{{ task.title || 'Untitled task' }}</h4><span class="gd-task-status" :class="task.status">{{ task.status || 'pending' }}</span><button type="button" class="gd-mini" :aria-expanded="!!openedTasks[index]" @click="openedTasks[index] = !openedTasks[index]">{{ openedTasks[index] ? 'Hide work' : 'Show work' }}</button></header>
          <template v-if="openedTasks[index]"><p v-if="task.description" class="gd-hint">{{ task.description }}</p><p v-if="task.error" class="gd-hint" role="alert">{{ task.error }}</p><div v-if="taskOutputText(task.output)" class="gd-rendered" @click="openReportLink" v-html="renderMarkdown(taskOutputText(task.output))"></div><p v-else class="gd-hint">No readable output recorded.</p><details><summary>Full recorded output</summary><BoundedJson :value="task.output" :filename="(task.id || 'task') + '-output.json'" /></details></template>
        </article>
        <p v-if="!tasks.length" class="gd-hint">This goal has no tasks yet.</p>
      </div>
    </div>
  </section>
</template>
<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import ArtifactInspector from '@/views/_components/one/ArtifactInspector.vue';
import BoundedJson from '@/components/common/BoundedJson.vue';
import { artifactKind } from '@/utils/chatArtifacts.js';
import { absolutePathFromFileUrl } from '@/utils/localFileUrl.js';
import { baseName } from '../goalReview.js';
import { toFileUrl } from '../goalArtifacts.js';
import { taskOutputText } from '../goalDetailModel.js';
const props=defineProps({ report:{type:Object,default:()=>({path:'',text:'',error:''})},sections:{type:Array,default:()=>[]},deliverables:{type:Array,default:()=>[]},otherFiles:{type:Array,default:()=>[]},tasks:{type:Array,default:()=>[]},renderMarkdown:{type:Function,required:true} });
defineEmits(['copy-path','retry-report']);
const root=ref(null), activeId=ref('report'), selectedArtifact=ref(null), expandedPreview=ref(false), openedTasks=ref({});
const sectionIcon=heading=>({headline:'fas fa-bullhorn',metrics:'fas fa-table',receipts:'fas fa-list-ol','proposed change':'far fa-lightbulb',anomalies:'fas fa-exclamation-triangle'}[heading.toLowerCase()] || 'fas fa-paragraph');
const files=computed(()=>[...new Set([...props.deliverables,...props.otherFiles])]);
const tabs=computed(()=>[
  {id:'report',label:'Report',icon:'fas fa-file-alt',kind:'report',markdown:props.report.text},
  ...props.sections.map((section,index)=>({id:'section:'+section.heading,label:section.heading,icon:sectionIcon(section.heading),kind:'report',markdown:section.body})),
  {id:'files',label:'All files',icon:'far fa-folder-open',kind:'files',count:files.value.length},
  {id:'activity',label:'Activity',icon:'fas fa-history',kind:'activity',count:props.tasks.length},
]);
const activeTab=computed(()=>tabs.value.find(t=>t.id===activeId.value) || tabs.value[0]);
watch(tabs,list=>{if(!list.some(t=>t.id===activeId.value))activeId.value='report';});
function selectTab(id) { selectedArtifact.value=null;expandedPreview.value=false;activeId.value=id; }
function closePreview() { selectedArtifact.value=null;expandedPreview.value=false; }
function previewFile(path) { if(!path)return; const name=baseName(path);selectedArtifact.value={id:'goal-file:'+path,name,kind:artifactKind(name),href:toFileUrl(path)}; }
function showSection(heading) { const found=tabs.value.find(t=>t.label===heading && t.kind==='report');if(found)selectTab(found.id); }
async function showTask(number) { const index=Number(number)-1;if(index<0||index>=props.tasks.length)return;selectTab('activity');openedTasks.value[index]=true;await nextTick();root.value?.querySelector('[data-review-task="'+number+'"]')?.scrollIntoView?.({block:'nearest',behavior:'smooth'}); }
function openReportLink(event) { const anchor=event.target.closest('a');if(!anchor)return;const href=anchor.getAttribute('href')||'';if(href.startsWith('file:///')){event.preventDefault();previewFile(absolutePathFromFileUrl(href));} }
defineExpose({ previewFile, showSection, showTask });
</script>
<style scoped>
.gd-evidence {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-popup);
  overflow: hidden;
}
.gd-tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--terminal-border-color);
  overflow-x: auto;
}
.gd-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 6px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.78em;
  white-space: nowrap;
  cursor: pointer;
}
.gd-tab:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}
.gd-tab.active {
  background: var(--surface-active);
  color: var(--color-text);
  font-weight: 600;
}
.gd-tab.active i {
  color: var(--text-green);
}
.gd-tab-n {
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(var(--green-rgb), 0.12);
  color: var(--text-green);
}
.gd-evidence-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 20px;
}
.gd-doc-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
}
.gd-doc-head > i {
  color: var(--text-green);
}
.gd-doc-file {
  min-width: 0;
  flex: 1 1 auto;
}
.gd-doc-file strong {
  display: block;
  color: var(--color-text);
  font-size: 0.85em;
}
.gd-doc-file small {
  display: block;
  font-family: var(--font-family-mono);
  font-size: 0.68em;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gd-doc-tools {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.gd-mini {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.72em;
  cursor: pointer;
}
.gd-mini:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.gd-rendered {
  font-size: 0.82em;
  line-height: 1.6;
  color: var(--color-text);
  overflow-x: auto;
}
.gd-rendered :deep(h1),
.gd-rendered :deep(h2),
.gd-rendered :deep(h3) {
  margin: 14px 0 8px;
  font-size: 1em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-green);
}
.gd-rendered :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 14px;
  font-size: 0.92em;
}
.gd-rendered :deep(th) {
  text-align: left;
  padding: 6px 9px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 0.85em;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.gd-rendered :deep(td) {
  padding: 6px 9px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--text-secondary);
}
.gd-rendered :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.92em;
  color: var(--text-blue);
}
.gd-rendered :deep(pre) {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-black-navy);
  overflow-x: auto;
}
.gd-hint {
  margin: 0;
  font-size: 0.8em;
  color: var(--color-text-muted);
}
.gd-files {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.gd-file {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
}
.gd-file.primary {
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.05);
}
.gd-file > i {
  color: var(--color-text-muted);
}
.gd-file.primary > i {
  color: var(--text-green);
}
.gd-file-body {
  flex: 1 1 auto;
  min-width: 0;
}
.gd-file-body strong {
  display: block;
  font-size: 0.82em;
  color: var(--color-text);
}
.gd-file-body small {
  display: block;
  font-family: var(--font-family-mono);
  font-size: 0.68em;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gd-tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(var(--green-rgb), 0.14);
  color: var(--text-green);
  font-size: 0.64em;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.gd-activity {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gd-task {
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
  overflow: hidden;
}
.gd-task > header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.gd-task-n {
  flex: 0 0 auto;
  font-family: var(--font-family-mono);
  font-size: 0.68em;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-dull-navy);
  color: var(--color-text-muted);
}
.gd-task h4 {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 0.84em;
  font-weight: 600;
  color: var(--color-text);
}
.gd-task-status {
  flex: 0 0 auto;
  font-size: 0.64em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}
.gd-task-status.completed {
  border-color: rgba(var(--green-rgb), 0.35);
  color: var(--text-green);
}
.gd-task-status.failed {
  border-color: rgba(var(--red-rgb), 0.35);
  color: var(--color-red);
}
.gd-task .gd-rendered {
  padding: 10px 12px 12px;
}
.gd-task .gd-hint {
  padding: 10px 12px;
}
.gd-inline-preview { flex: 1; min-height: 0; }
.gd-evidence.expanded-preview { position: absolute; inset: 0; z-index: 8; }
.gd-task details { margin: 10px 12px; }.gd-task summary { cursor: pointer; color: var(--color-text-muted); font-size: .8em; }
.gd-tab:focus-visible,.gd-mini:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
@media (max-width: 900px) { .gd-evidence { min-height: 340px; } .gd-evidence-body { max-height: 65vh; } .gd-inline-preview { height: 65vh; min-height: 340px; flex: none; } .gd-doc-head,.gd-file { flex-wrap: wrap; }.gd-doc-tools { flex-basis: 100%; } .gd-mini { min-height: 40px; } .gd-evidence.expanded-preview { position: fixed; inset: 8px; z-index: 1100; } }
</style>
