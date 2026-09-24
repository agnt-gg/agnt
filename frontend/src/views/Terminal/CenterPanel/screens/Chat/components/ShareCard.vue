<template>
  <!-- One line under the tool row that made it: a step in the run, not a banner. -->
  <div class="share-card">
    <i class="fas fa-share-alt share-card-icon" aria-hidden="true"></i>
    <span class="share-card-name">{{ target.name }}</span>
    <span class="share-card-offer">Share it: anyone new who joins through your link gets a free month.</span>
    <button type="button" class="share-card-button" @click="share">Share</button>
  </div>
</template>

<script setup>
import { openShare } from '@/composables/useShare.js';

const props = defineProps({
  /** { kind, id, name } from shareCards.shareTarget */
  target: { type: Object, required: true },
});

function share() {
  openShare({ kind: props.target.kind, id: props.target.id, name: props.target.name, tab: 'link' });
}
</script>

<style scoped>
.share-card {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 2px;
  padding: 5px 8px 5px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: var(--color-darker-0);
  font-size: var(--font-size-xs);
  width: fit-content;
  max-width: 100%;
}
.share-card-icon {
  color: var(--color-primary);
  font-size: 11px;
}
.share-card-name {
  color: var(--color-text);
  font-weight: 600;
}
.share-card-offer {
  color: var(--color-text-muted);
}
.share-card-button {
  margin-left: 6px;
  padding: 3px 10px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.share-card-button:hover {
  background: var(--color-primary);
  color: var(--color-darker-0);
}
</style>
