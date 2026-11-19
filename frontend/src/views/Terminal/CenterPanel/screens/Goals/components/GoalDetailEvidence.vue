<template>
  <section class="gd-result" :aria-label="isPlan ? 'Plan' : 'Goal result'">
    <h3>{{ isPlan ? 'Plan' : isActive ? 'Progress' : 'Result' }}</h3>
    <div v-if="hasAttention" class="gd-attention" role="region" aria-label="What this goal is waiting on">
      <p v-if="stopReason" class="gd-attention-reason">{{ stopReason }}</p>
      <ul v-if="reviewItems.length" class="gd-attention-items">
        <li v-for="item in reviewItems" :key="item.key" :class="item.kind">
          <i :class="item.kind === 'ask' ? 'fas fa-hand-paper' : 'fas fa-exclamation-circle'" aria-hidden="true"></i>
          <div><strong>{{ item.kind === 'ask' ? 'Needs from you' : 'Failed' }}: {{ item.title }}</strong><p>{{ item.text }}</p></div>
        </li>
      </ul>
    </div>
    <div v-if="showResultBody" class="gd-rendered gd-result-body" @click="openOutputLink" v-html="renderMarkdown(resultText)"></div>
    <p v-else-if="!hasAttention" class="gd-result-summary">{{ summary }}</p>
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
    <section class="gd-tasks" aria-label="Tasks">
      <h4 class="gd-tasks-head">Tasks <span>{{ completedTasks }} of {{ tasks.length }} complete</span></h4>
      <div class="gd-task-list">
        <details v-for="(task, index) in tasks" :key="task.id || index" class="gd-task" :class="{ attention: taskNeedsAttention(task) }" :open="isTaskOpen(task, index)" @toggle="openedTasks[task.id || index] = $event.target.open">
          <summary>
            <i :class="taskIcon(task.status)" aria-hidden="true"></i>
            <span class="gd-task-title">{{ task.title || 'Untitled task' }}<small v-if="!isTaskOpen(task, index) && taskPreview(task)" class="gd-task-preview">{{ taskPreview(task) }}</small></span>
            <small class="gd-task-status">{{ task.status || 'pending' }}</small>
          </summary>
          <div v-if="isTaskOpen(task, index)" class="gd-task-work">
            <p v-if="task.error" class="gd-error" role="alert">{{ task.error }}</p>
            <div v-if="taskOutputText(task.output)" class="gd-rendered" @click="openOutputLink" v-html="renderMarkdown(taskOutputText(task.output))"></div>
            <p v-else-if="!task.error" class="gd-hint">No output yet.</p>
            <!-- What the task was asked to do: secondary once there is an error or output to read. -->
            <details v-if="task.description && (task.error || taskOutputText(task.output))" class="gd-task-instructions">
              <summary>Instructions</summary>
              <div class="gd-rendered" v-html="renderMarkdown(task.description)"></div>
            </details>
            <div v-else-if="task.description" class="gd-rendered gd-task-instructions" v-html="renderMarkdown(task.description)"></div>
            <details v-if="task.output"><summary>Recorded output</summary><BoundedJson :value="task.output" :filename="(task.id || 'task') + '-output.json'" /></details>
          </div>
        </details>
        <p v-if="!tasks.length" class="gd-hint">No tasks yet.</p>
      </div>
    </section>
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
import { briefText, goalResultText, goalReviewItems, goalStopReason, taskNeedsAttention, taskOutputText, taskPreview } from '../goalDetailModel.js';

const props = defineProps({ goal: { type: Object, required: true }, tasks: { type: Array, default: () => [] }, isPlan: Boolean });
const openedTasks = ref({}), selectedArtifact = ref(null), expandedPreview = ref(false), previewDialog = ref(null);
let previewTrigger = null;
const artifacts = computed(() => collectChatArtifacts(goalArtifactSource(props.tasks).content, props.goal.id));
const completedTasks = computed(() => props.tasks.filter(task => task.status === 'completed').length);
const isActive = computed(() => ['executing', 'queued', 'paused'].includes(props.goal.status));
const stopReason = computed(() => goalStopReason(props.goal));
const reviewItems = computed(() => goalReviewItems(props.goal, props.tasks));
const hasAttention = computed(() => !props.isPlan && (!!stopReason.value || reviewItems.value.length > 0));
const resultText = computed(() => goalResultText(props.tasks));
// The finished work itself, rendered in full, rather than an excerpt.
const showResultBody = computed(() => !props.isPlan && !isActive.value && !!resultText.value.trim());
// A task the reviewer must read opens by itself; any task can be toggled.
const isTaskOpen = (task, index) => openedTasks.value[task.id || index] ?? taskNeedsAttention(task);
const summary = computed(() => {
  if (props.isPlan) return props.tasks.length ? 'The plan is ready. Review the tasks below.' : 'No tasks planned yet.';
  if (props.goal.status === 'executing') {
    const running = props.tasks.find(task => ['running', 'executing'].includes(task.status));
    return running ? 'Working on: ' + briefText(running.title, 240) : 'Working on this goal.';
  }
  if (props.goal.status === 'queued') return 'Waiting to start.';
  if (props.goal.status === 'paused') return 'Execution is paused.';
  if (['failed', 'error'].includes(props.goal.status)) return 'Execution failed.';
  if (props.goal.status === 'stopped') return 'Execution stopped. Completed work is available below.';
  return briefText(resultText.value, 280) || (artifacts.value.length ? 'Open the files below to review the work.' : 'No result yet.');
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
.gd-attention { margin: 0 0 16px; padding: 14px 16px; border: 1px solid rgba(var(--yellow-rgb), 0.45); border-radius: 7px; background: rgba(var(--yellow-rgb), 0.08); }
.gd-attention-reason { margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-orange); font-weight: 600; }
.gd-attention-items { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.gd-attention-reason + .gd-attention-items { margin-top: 12px; }
.gd-attention-items:first-child { margin-top: 0; }
.gd-attention-items li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.gd-attention-items li > i { margin-top: 4px; color: var(--text-orange); }
.gd-attention-items li.failed > i { color: var(--color-red); }
.gd-attention-items strong { color: var(--color-text); font-weight: 600; }
.gd-attention-items p { margin: 2px 0 0; color: var(--text-secondary); }
.gd-result-body { padding: 4px 16px; border: 1px solid var(--terminal-border-color); border-radius: 7px; background: var(--color-darker-0); font-size: 15px; }
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
.gd-tasks-head { display: flex; align-items: baseline; gap: 9px; margin: 0; font-size: 15px; font-weight: 600; color: var(--color-text); }
.gd-tasks-head span { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--color-text-muted); }
.gd-task-list { margin-top: 8px; }
.gd-task { border-bottom: 1px solid var(--terminal-border-color); }
.gd-task:last-child { border-bottom: 0; }
.gd-task > summary { list-style: none; display: flex; align-items: flex-start; gap: 10px; min-height: 32px; padding: 11px 0; color: var(--text-secondary); font-size: 14px; cursor: pointer; }
.gd-task > summary::-webkit-details-marker { display: none; }
.gd-task > summary > i { margin-top: 3px; }
.gd-task-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; color: var(--color-text); overflow-wrap: anywhere; }
.gd-task-preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--color-text-muted); font-size: 13px; line-height: 1.45; }
.gd-task-status { color: var(--color-text-muted); font-size: 12px; white-space: nowrap; }
.gd-task.attention > summary .gd-task-status { color: var(--color-red); }
.gd-complete { color: var(--text-green); }
.gd-error { color: var(--color-red); }
.gd-task-work { padding: 0 0 14px 24px; font-size: 14px; overflow-wrap: anywhere; }
.gd-task-work > :first-child { margin-top: 0; }
.gd-task-work .gd-error { margin: 0 0 8px; line-height: 1.5; }
.gd-task-instructions { margin-top: 8px; color: var(--text-secondary); }
.gd-task-instructions > summary { color: var(--color-text-muted); font-size: 13px; cursor: pointer; padding: 4px 0; }
.gd-hint { color: var(--color-text-muted); margin: 6px 0; }
.gd-rendered { line-height: 1.6; overflow-x: auto; }
.gd-rendered :deep(img) { max-width: 100%; }
.gd-rendered :deep(pre) { overflow-x: auto; }
.gd-rendered :deep(table) { border-collapse: collapse; font-size: inherit; margin: 12px 0; }
.gd-rendered :deep(th) { text-align: left; }
.gd-rendered :deep(td), .gd-rendered :deep(th) { border: 1px solid var(--terminal-border-color); padding: 6px 9px; }
.gd-preview { position: fixed; inset: 0; margin: auto; padding: 0; width: min(960px, calc(100vw - 48px)); height: min(760px, calc(100dvh - 48px)); max-width: none; max-height: none; background: var(--color-background); color: var(--color-text); border: 1px solid var(--terminal-border-color); border-radius: 8px; overflow: hidden; }
.gd-preview::backdrop { background: var(--scrim); }
.gd-preview.expanded { width: calc(100vw - 24px); height: calc(100dvh - 24px); }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@media (max-width: 900px) { .gd-preview { width: calc(100vw - 24px); height: calc(100dvh - 24px); } }
@media (max-width: 540px) { .gd-result { margin-top: 25px; } .gd-result-summary { font-size: 15px; } .gd-task > summary { min-height: 44px; } .gd-file { padding: 13px 12px; } }
</style>
