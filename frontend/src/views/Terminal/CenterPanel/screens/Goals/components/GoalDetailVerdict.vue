<template>
  <div class="gd-actions">
    <div v-if="composerOpen && canRevise" class="gd-composer" @keydown.esc.stop="closeComposer">
      <label :for="feedbackId">What needs to change?</label>
      <textarea :id="feedbackId" ref="feedbackEl" v-model="feedback" rows="3" maxlength="10000"
        :disabled="busy || sending" placeholder="Tell me what to improve…"
        @keydown.ctrl.enter.prevent="sendBack" @keydown.meta.enter.prevent="sendBack"></textarea>
      <div class="gd-action-row">
        <button type="button" class="gd-btn primary" :disabled="busy || sending || !feedback.trim()" @click="sendBack">{{ sending ? 'Sending…' : 'Send feedback' }}</button>
        <button type="button" class="gd-btn" :disabled="busy || sending" @click="closeComposer">Cancel</button>
      </div>
    </div>
    <div v-else class="gd-action-row">
      <button v-if="canSignOff" type="button" class="gd-btn primary" :disabled="busy" @click="$emit('approve')">{{ approveLabel }}</button>
      <button v-else-if="isPaused" type="button" class="gd-btn primary" :disabled="busy" @click="$emit('resume')">Resume</button>
      <button v-else-if="canPause" type="button" class="gd-btn" :disabled="busy" @click="$emit('pause')">Pause goal</button>
      <button v-else-if="canRun" type="button" class="gd-btn primary" :disabled="busy" @click="$emit('run')">Run goal</button>
      <button v-if="canRevise" ref="changesButton" type="button" class="gd-btn" :disabled="busy" :aria-expanded="composerOpen" :aria-controls="feedbackId" @click="openComposer">Request changes</button>
    </div>
  </div>
</template>

<script>
import { ref, nextTick } from 'vue';
let nextFeedbackId = 0;
export default {
  name: 'GoalDetailVerdict',
  props: {
    canSignOff: Boolean, canRevise: Boolean, canPause: Boolean, canRun: Boolean, isPaused: Boolean, busy: Boolean,
    approveLabel: { type: String, default: 'Approve result' },
    submitFeedback: { type: Function, required: true },
  },
  emits: ['approve', 'pause', 'resume', 'run'],
  setup(props) {
    const composerOpen = ref(false), feedback = ref(''), feedbackEl = ref(null), changesButton = ref(null), sending = ref(false);
    const feedbackId = 'gd-feedback-' + ++nextFeedbackId;
    async function openComposer() {
      if (props.busy || !props.canRevise) return;
      composerOpen.value = true;
      await nextTick();
      feedbackEl.value?.focus();
    }
    async function closeComposer() {
      if (sending.value || props.busy) return;
      composerOpen.value = false;
      feedback.value = '';
      await nextTick();
      changesButton.value?.focus();
    }
    async function sendBack() {
      const text = feedback.value.trim();
      if (!text || props.busy || sending.value || !props.canRevise) return;
      sending.value = true;
      try {
        // The owner reports failures and returns false. Keep the draft until
        // the server confirms it was accepted; rejecting never starts a run.
        if (await props.submitFeedback(text)) {
          composerOpen.value = false;
          feedback.value = '';
        }
      } finally {
        sending.value = false;
      }
    }
    return { composerOpen, feedback, feedbackEl, changesButton, feedbackId, sending, openComposer, closeComposer, sendBack };
  },
};
</script>

<style scoped>
.gd-actions { margin-top: 23px; }
.gd-action-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.gd-btn { min-height: 38px; padding: 8px 15px; border-radius: 6px; border: 1px solid var(--terminal-border-color); background: transparent; color: var(--color-text); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.gd-btn:hover:not(:disabled) { border-color: var(--color-text-muted); background: var(--surface-hover); }
.gd-btn.primary { border-color: var(--fill-accent); background: var(--fill-accent); color: var(--on-fill-accent); }
.gd-btn.primary:hover:not(:disabled) { filter: brightness(.92); }
.gd-btn:disabled { opacity: .5; cursor: not-allowed; }
.gd-composer label { display: block; font-size: 15px; margin-bottom: 8px; }
.gd-composer textarea { display: block; width: 100%; box-sizing: border-box; min-height: 90px; max-height: 300px; resize: vertical; padding: 12px; border: 1px solid var(--terminal-border-color); border-radius: 6px; background: var(--color-darker-0); color: var(--color-text); font: inherit; font-size: 15px; }
.gd-composer .gd-action-row { margin-top: 12px; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@media (max-width: 540px) { .gd-btn { min-height: 44px; } }
</style>
