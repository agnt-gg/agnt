<template>
  <!-- One handoff (Main chat -> a new chat) or handback (its result coming
       back), with a link to open that chat. -->
  <div class="sub-chat-card" :class="[`is-${kind}`, `status-${status}`]" :data-testid="`sub-chat-${kind}`">
    <span class="scc-icon" aria-hidden="true"><i :class="icon"></i></span>
    <span class="scc-body">
      <span class="scc-label">{{ label }}</span>
      <span class="scc-title">{{ title }}</span>
    </span>
    <button v-if="outputId" type="button" class="scc-open" @click="open">
      Open chat <i class="fas fa-arrow-right" aria-hidden="true"></i>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
  kind: { type: String, required: true }, // 'handoff' | 'handback'
  title: { type: String, default: 'Task' },
  outputId: { type: String, default: null },
  // handoff: working | started | done | problem | failed ; handback: done | problem
  status: { type: String, default: 'started' },
});

const router = useRouter();
const open = () => router.push({ path: '/chat', query: { 'content-id': props.outputId } }).catch(() => {});

const LABELS = {
  // The outcome is the handback's to say; the handoff only says where the work went.
  handoff: { working: 'Working in a new chat', started: 'Handed off to a new chat', done: 'Handed off to a new chat', problem: 'Handed off to a new chat', failed: "Couldn't start a new chat" },
  handback: { done: 'Back from', problem: 'Hit a problem in' },
};
const label = computed(() => LABELS[props.kind]?.[props.status] || LABELS[props.kind]?.started || '');
// A handoff's icon says only where the work went; its outcome is the
// handback's to show, so it is never said twice.
const icon = computed(() => {
  if (props.kind === 'handoff' && props.status !== 'working' && props.status !== 'failed') return 'fas fa-share';
  if (props.status === 'problem' || props.status === 'failed') return 'fas fa-exclamation-circle';
  if (props.kind === 'handback') return 'fas fa-reply';
  if (props.status === 'working') return 'fas fa-circle-notch fa-spin';
  if (props.status === 'done') return 'fas fa-check-circle';
  return 'fas fa-share';
});
</script>

<style scoped>
.sub-chat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 520px;
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  background: var(--color-darker-0);
  color: var(--color-text);
  font-size: 13px;
}
.scc-icon {
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--color-primary);
}
.is-handback.status-done .scc-icon { background: rgba(var(--green-rgb), 0.14); color: var(--text-green); }
.is-handback.status-problem .scc-icon,
.status-failed .scc-icon { background: rgba(var(--red-rgb), 0.12); color: var(--color-red); }
.scc-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-right: 8px; }
.scc-label { font-size: 11.5px; color: var(--color-text-secondary); }
.scc-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scc-open {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.scc-open:hover { border-color: var(--color-primary); color: var(--color-primary); }
.scc-open:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.scc-label { color: var(--text-secondary); }

/* Handback: a slim, centred system line ("↩ Back from <title> · Open chat"),
   so it never reads as a second copy of the handoff card above it. */
.sub-chat-card.is-handback {
  max-width: 100%;
  gap: 8px;
  padding: 4px 6px 4px 10px;
  margin: 6px 0;
  border-radius: 999px;
  background: transparent;
  font-size: 12.5px;
}
.is-handback .scc-icon { flex-basis: 20px; width: 20px; height: 20px; border-radius: 50%; font-size: 10px; }
.is-handback .scc-body { flex-direction: row; align-items: baseline; gap: 6px; }
.is-handback .scc-label { font-size: 12.5px; }
.is-handback .scc-title { max-width: 360px; }
.is-handback .scc-open { padding: 2px 4px; border: 0; font-size: 12px; color: var(--color-primary); }
.is-handback .scc-open:hover { text-decoration: underline; }
</style>
