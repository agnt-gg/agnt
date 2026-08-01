<!--
  Shown when a lazy chunk could not be loaded AND an automatic recovery reload
  has already been spent. Before this existed the same condition rendered an
  empty div, which is indistinguishable from "the page is still loading" and
  is what made the blank Settings screen so hard to diagnose.
-->
<template>
  <div class="chunk-load-failed">
    <i class="fas fa-exclamation-triangle chunk-load-failed__icon"></i>
    <h2 class="chunk-load-failed__title">This screen couldn't load</h2>
    <p class="chunk-load-failed__body">
      Its code was replaced by a newer build while this window was open, so the file it
      was holding no longer exists. Reloading picks up the current build.
    </p>
    <button type="button" class="chunk-load-failed__action" @click="reload">
      Reload AGNT
    </button>
    <p v-if="detail" class="chunk-load-failed__detail">{{ detail }}</p>
  </div>
</template>

<script>
import { computed } from 'vue';
import { clearReloadMark } from './chunkRecovery.js';

export default {
  name: 'ChunkLoadFailed',
  // defineAsyncComponent passes the rejection through as `error`.
  props: {
    error: { type: [Error, Object, String], default: null },
  },
  setup(props) {
    const detail = computed(() => {
      if (!props.error) return '';
      return typeof props.error === 'string' ? props.error : props.error.message || '';
    });

    const reload = () => {
      // The user asked explicitly, so the automatic-reload cooldown must not
      // veto them — clear the mark before reloading.
      clearReloadMark();
      window.location.reload();
    };

    return { detail, reload };
  },
};
</script>

<style scoped>
.chunk-load-failed {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  padding: 32px;
  text-align: center;
  background: var(--color-background);
  color: var(--color-text);
}

.chunk-load-failed__icon {
  font-size: 28px;
  color: var(--color-warning, #e0a34a);
}

.chunk-load-failed__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.chunk-load-failed__body {
  max-width: 46ch;
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  opacity: 0.75;
}

.chunk-load-failed__action {
  padding: 8px 18px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  background: var(--color-darker-1, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.14));
  border-radius: 6px;
}

.chunk-load-failed__action:hover {
  background: var(--color-darker-0, rgba(255, 255, 255, 0.1));
}

.chunk-load-failed__detail {
  max-width: 60ch;
  margin: 4px 0 0;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  word-break: break-word;
  opacity: 0.45;
}
</style>
