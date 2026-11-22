<template>
  <div class="r clickable" role="button" tabindex="0" @click="open" @keydown.enter="open">
    <span class="unread"></span>
    <TeamAvatar :who="{ kind: 'agent', id: 'annie' }" label="Annie" size="lg" />
    <span class="r-text">
      <strong class="mk-wrap">{{ checkpoint.taskTitle || checkpoint.title }}</strong>
      <small>{{ KIND_SENTENCE[checkpoint.kind] || 'To check' }}: {{ checkpoint.title }} · {{ ago(checkpoint.createdAt) }}</small>
    </span>
    <span class="tag pink">Your OK</span>
    <button type="button" class="primary sm" @click.stop="open">Review</button>
  </div>
</template>

<script setup>
import { inject } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { ago } from './teamModel.js';

// Review, never Approve: the decision is made in the chat, where the whole card is on screen.
const KIND_SENTENCE = Object.freeze({ plan: 'Plan to approve', review: 'Something to check', run: 'Run to approve', final: 'Final review', routine: 'Routine to approve' });
const props = defineProps({ checkpoint: { type: Object, required: true } });
const ctx = inject('teamCtx');
const open = () => ctx.openCheckpoint(props.checkpoint);
</script>
