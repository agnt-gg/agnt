<template>
  <section class="gd-result" :aria-label="isPlan ? 'Plan' : 'Goal result'">
    <h3>{{ isPlan ? 'Plan' : isActive ? 'Progress' : 'Result' }}</h3>
    <p class="gd-result-summary">{{ summary }}</p>
    <div v-if="artifacts.length" class="gd-files">
      <button v-for="artifact in artifacts.slice(0, 3)" :key="artifact.id" type="button" class="gd-file" @click="preview(artifact, $event)">
        <i class="far fa-file-alt" aria-hidden="true"></i><span>{{ artifact.name }}</span><small>Open <i class="fas fa-chevron-right" aria-hidden="true"></i></small>
      </button>
      <details v-if="artifacts.length > 3" class="gd-more-files">
        <summary>{{ artifacts.length - 3 }} more files</summary>
        <button v-for="artifact in artifacts.slice(3)" :key="artifact.id" type="button" class="gd-file" @click="preview(artifact, $event)">
          <i class="far fa-file-alt" aria-hidden="true"></i><span>{{ artifact.name }}</span><small>Open <i class="fas fa-chevron-right" aria-hidden="true"></i></small>
        </button>
      </details>
    </div>
    <slot></slot>
    <details class="gd-tasks" @toggle="tasksOpen = $event.target.open">
      <summary><i class="fas fa-chevron-right" aria-hidden="true"></i> Tasks <span>{{ completedTasks }} of {{ tasks.length }} complete</span></summary>
      <div v-if="tasksOpen" class="gd-task-list">
        <details v-for="(task, index) in tasks" :key="task.id || index" class="gd-task" @toggle="openedTasks[task.id || index] = $event.target.open">
          <summary><i :class="taskIcon(task.status)" aria-hidden="true"></i><span>{{ task.title || 'Untitled task' }}</span><small>{{ task.status || 'pending' }}</small></summary>
          <div v-if="openedTasks[task.id || index]" class="gd-task-work">
            <p v-if="task.description" class="gd-hint">{{ task.description }}</p>
            <p v-if="task.error" class="gd-error" role="alert">{{ task.error }}</p>
            <div v-if="taskOutputText(task.output)" class="gd-rendered" @click="openOutputLink" v-html="renderMarkdown(taskOutputText(task.output))"></div>
            <p v-else class="gd-hint">No output yet.</p>
            <details v-if="task.output"><summary>Recorded output</summary><BoundedJson :value="task.output" :filename="(task.id || 'task') + '-output.json'" /></details>
          </div>
        </details>
        <p v-if="!tasks.length" class="gd-hint">No tasks yet.</p>
      </div>
    </details>
    <dialog v-if="selectedArtifact" ref="previewDialog" class="gd-preview" :class="{ expanded: expandedPreview }" :aria-label="selectedArtifact.name" @cancel.prevent="closePreview" @keydown.esc.stop @click.self="closePreview">
      <ArtifactInspector :key="selectedArtifact.id" :artifact="selectedArtifact" @close="closePreview" @expand="expandedPreview = !expandedPreview" />
    </dialog>
  </section>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import showdown from 'showdown';
import DOMPurify from 'dompurify';
import ArtifactInspector from '@/views/_components/one/ArtifactInspector.vue';
import BoundedJson from '@/components/common/BoundedJson.vue';
import { collectChatArtifacts, artifactKind } from '@/utils/chatArtifacts.js';
import { absolutePathFromFileUrl } from '@/utils/localFileUrl.js';
import { baseName } from '../goalReview.js';
import { goalArtifactSource, toFileUrl } from '../goalArtifacts.js';
import { briefText, goalResultText, taskOutputText } from '../goalDetailModel.js';

const props = defineProps({ goal: { type: Object, required: true }, tasks: { type: Array, default: () => [] }, isPlan: Boolean });
const tasksOpen = ref(false), openedTasks = ref({}), selectedArtifact = ref(null), expandedPreview = ref(false), previewDialog = ref(null);
let previewTrigger = null;
const artifacts = computed(() => collectChatArtifacts(goalArtifactSource(props.tasks).content, props.goal.id));
const completedTasks = computed(() => props.tasks.filter(task => task.status === 'completed').length);
const isActive = computed(() => ['executing', 'queued', 'paused'].includes(props.goal.status));
const summary = computed(() => {
  if (props.isPlan) return props.tasks.length ? 'The plan is ready. Open Tasks to review the approach.' : 'No tasks planned yet.';
  if (props.goal.status === 'executing') {
    const running = props.tasks.find(task => ['running', 'executing'].includes(task.status));
    return running ? 'Working on: ' + briefText(running.title, 240) : 'Working on this goal.';
  }
  if (props.goal.status === 'queued') return 'Waiting to start.';
  if (props.goal.status === 'paused') return 'Execution is paused.';
  if (['failed', 'error'].includes(props.goal.status)) return 'Execution failed. Open Tasks to see what happened.';
  if (props.goal.status === 'stopped') return 'Execution stopped. Completed work is available below.';
  const text = goalResultText(props.tasks);
  return briefText(text, 280) || (artifacts.value.length ? 'Open the files below to review the work.' : 'No result yet.');
});
const converter = new showdown.Converter({ tables: true, strikethrough: true, literalMidWordUnderscores: true, ghCodeBlocks: true });
const renderMarkdown = text => DOMPurify.sanitize(converter.makeHtml(String(text || '')), { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'] });
const taskIcon = status => status === 'completed' ? 'fas fa-check gd-complete' : ['running', 'executing'].includes(status) ? 'fas fa-circle-notch' : status === 'failed' ? 'fas fa-exclamation-circle gd-error' : 'far fa-circle';
async function preview(artifact, event) {
  previewTrigger = event?.currentTarget || null;
  selectedArtifact.value = artifact;
  await nextTick();
  // Native dialog contains focus and makes the goal behind it inert.
  previewDialog.value?.showModal?.();
  previewDialog.value?.querySelector('[aria-label="Close artifact preview"]')?.focus();
}
async function closePreview() {
  previewDialog.value?.close?.();
  selectedArtifact.value = null;
  expandedPreview.value = false;
  await nextTick();
  if (previewTrigger?.isConnected) previewTrigger.focus();
}
function openOutputLink(event) {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href') || '';
  if (!href.startsWith('file:///')) return;
  event.preventDefault();
  const path = absolutePathFromFileUrl(href);
  if (path) preview({ id: 'goal-file:' + path, name: baseName(path), kind: artifactKind(path), href: toFileUrl(path) }, { currentTarget: anchor });
}
</script>

<style scoped>
.gd-result { margin-top: 30px; padding-top: 23px; border-top: 1px solid var(--terminal-border-color); min-width: 0; }
.gd-result h3 { font-size: 17px; font-weight: 600; margin: 0 0 10px; }
.gd-result-summary { margin: 0; font-size: 16px; line-height: 1.55; color: var(--text-secondary); overflow-wrap: anywhere; }
.gd-files { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
.gd-file { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 49px; padding: 14px 15px; text-align: left; border: 1px solid var(--terminal-border-color); border-radius: 7px; background: var(--color-darker-0); color: var(--color-text); cursor: pointer; font: inherit; }
.gd-file:hover { background: var(--surface-hover); border-color: var(--color-text-muted); }
.gd-file > i { color: var(--color-text-muted); }
.gd-file > span { flex: 1; min-width: 0; font-size: 15px; overflow-wrap: anywhere; }
.gd-file small { font-size: 13px; color: var(--color-text-muted); white-space: nowrap; }
.gd-file small i { margin-left: 7px; font-size: 10px; }
.gd-more-files summary, .gd-task-work summary { color: var(--color-text-muted); font-size: 14px; cursor: pointer; padding: 6px 0; }
.gd-more-files .gd-file { margin-top: 8px; }
.gd-tasks { margin-top: 29px; border-top: 1px solid var(--terminal-border-color); padding-top: 16px; }
.gd-tasks > summary, .gd-task > summary { list-style: none; display: flex; align-items: center; gap: 9px; min-height: 32px; color: var(--color-text-muted); font-size: 14px; cursor: pointer; }
.gd-tasks > summary::-webkit-details-marker, .gd-task > summary::-webkit-details-marker { display: none; }
.gd-tasks > summary > i { font-size: 10px; }
.gd-tasks[open] > summary > i { transform: rotate(90deg); }
.gd-tasks > summary span { margin-left: auto; font-size: 13px; }
.gd-task-list { margin-top: 12px; }
.gd-task > summary { padding: 9px 0; color: var(--text-secondary); }
.gd-task > summary span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.gd-task small { color: var(--color-text-muted); font-size: 12px; }
.gd-complete { color: var(--text-green); }
.gd-error { color: var(--color-red); }
.gd-task-work { padding: 6px 0 16px 24px; font-size: 14px; overflow-wrap: anywhere; }
.gd-hint { color: var(--color-text-muted); margin: 6px 0; }
.gd-rendered { line-height: 1.6; overflow-x: auto; }
.gd-rendered :deep(img) { max-width: 100%; }
.gd-rendered :deep(pre) { overflow-x: auto; }
.gd-rendered :deep(table) { border-collapse: collapse; }
.gd-rendered :deep(td), .gd-rendered :deep(th) { border: 1px solid var(--terminal-border-color); padding: 6px 9px; }
.gd-preview { position: fixed; inset: 0; margin: auto; padding: 0; width: min(960px, calc(100vw - 48px)); height: min(760px, calc(100dvh - 48px)); max-width: none; max-height: none; background: var(--color-background); color: var(--color-text); border: 1px solid var(--terminal-border-color); border-radius: 8px; overflow: hidden; }
.gd-preview::backdrop { background: var(--scrim); }
.gd-preview.expanded { width: calc(100vw - 24px); height: calc(100dvh - 24px); }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@media (max-width: 900px) { .gd-preview { width: calc(100vw - 24px); height: calc(100dvh - 24px); } }
@media (max-width: 540px) { .gd-result { margin-top: 25px; } .gd-result-summary { font-size: 15px; } .gd-task > summary, .gd-tasks > summary { min-height: 44px; } .gd-file { padding: 13px 12px; } }
</style>
