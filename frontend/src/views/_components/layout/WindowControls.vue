<template>
  <div v-if="isElectron" class="window-controls">
    <!-- <div class="current-route">/ {{ currentRouteName }}</div> -->
    <div class="drag-region"></div>
    <button @click="minimize" class="window-control minimize-window">
      <svg width="8" height="1" viewBox="0 0 8 0.5">
        <path d="M0 0h8v0.75H0z" fill="#7f8193" />
      </svg>
    </button>
    <button @click="maximize" class="window-control maximize-window">
      <svg width="8" height="8" viewBox="0 0 8 8" style="opacity: 0.75">
        <path d="M0 0v8h8V0H0zm1 1h6v6H1V1z" fill="#7f8193" />
      </svg>
    </button>
    <button @click="close" class="window-control close-window">
      <svg width="8" height="8" viewBox="0 0 8 8">
        <path d="M0.8 0L0 0.8 3.2 4 0 7.2 0.8 8 4 4.8 7.2 8 8 7.2 4.8 4 8 0.8 7.2 0 4 3.2 0.8 0z" fill="#7f8193" />
      </svg>
    </button>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useElectron, electronUtils } from '@/composables/useElectron';

export default {
  name: 'WindowControls',
  setup() {
    const { isElectron } = useElectron();
    const route = useRoute();

    const currentRouteName = computed(() => {
      return route.name || 'Unknown';
    });

    return {
      isElectron,
      currentRouteName,
    };
  },
  methods: {
    minimize() {
      electronUtils.window.minimize();
    },
    maximize() {
      electronUtils.window.maximize();
    },
    close() {
      electronUtils.window.close();
    },
  },
};
</script>

<style scoped>
.window-controls {
  opacity: 0.25;
  display: flex;
  position: relative;
  top: 2px;
  right: 24px;
  z-index: 9999;
  /* background-color: var(--color-dull-white);
  border-bottom: 1px solid var(--color-light-navy); */
  /* padding: 4px; */
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: center;
  align-items: center;
}

/* body.dark .window-controls {
  background-color: var(--color-ultra-dark-navy);
  border-bottom: 1px solid var(--color-dull-navy);
} */

.drag-region {
  -webkit-app-region: drag;
  width: 100%;
  height: 16px;
  flex-shrink: 0;
}

.window-control {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--color-med-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
}

.window-control:hover {
  opacity: 1;
}

.close-window:hover {
  background-color: #e81123;
  color: white;
}

.window-control svg {
  width: 8px;
  height: 8px;
}

.current-route {
  flex-grow: 1;
  text-align: left;
  padding-left: 8px;
  font-size: 14px;
  color: var(--color-med-navy);
  display: block;
  align-items: center;
  opacity: 0.25;
  white-space: nowrap;
  user-select: none;
}

body.dark .current-route {
  color: var(--color-dull-white);
}
</style>
