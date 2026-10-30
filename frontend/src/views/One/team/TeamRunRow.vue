<template>
  <button type="button" class="ot-r" @click="ctx.openRun(run)">
    <span class="ot-col-dot" :style="{ background: tone.color }" aria-hidden="true"></span>
    <span class="ot-r-text">
      <strong>{{ run.routineName }}</strong>
      <small>{{ tone.label }} · {{ ago(run.fired_at) }}</small>
    </span>
    <span v-if="run.status === 'needs_review'" class="ot-tag is-pink">Your OK</span>
    <span class="ot-r-go">Open</span>
  </button>
</template>

<script setup>
import { computed, inject } from 'vue';
import { ago, runTone } from './teamModel.js';

const props = defineProps({ run: { type: Object, required: true } });
const ctx = inject('teamCtx');
const tone = computed(() => runTone(props.run.status));
</script>
