<template>
  <div class="browser-live-card">
    <div class="live-header" @click="collapsed = !collapsed">
      <span class="live-caret">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="live-dot" :class="{ on: owns }"></span>
      <span class="live-title">{{ owns ? 'Live browser' : 'Browser' }}</span>
      <span v-if="owns && pageUrl" class="live-url">{{ pageUrl }}</span>
    </div>

    <div v-if="!collapsed" class="live-body">
      <!--
        launch=false is the whole difference from the canvas widget. This card
        appears BECAUSE a browser step ran, so it should show the browser that
        step is using — never cause one to be opened. A card that launches
        would open a browser just by being rendered, including when the user
        scrolls back through old messages.
      -->
      <BrowserStreamView v-if="owns" :launch="false" @page="onPage" />
      <div v-else class="live-superseded">
        A newer browser step is streaming further down.
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { lazyComponent } from '@/utils/chunkRecovery.js';
import { claimLiveView, releaseLiveView, activeLiveKey } from './browserLiveRegistry.js';

/**
 * The live browser, inline in the chat transcript.
 *
 * WHY THIS NEEDED NO BACKEND CHANGE. Frames are broadcast to the user's socket
 * room by broadcastToUser(userId, 'browser:frame', ...), not to the canvas,
 * and startViewing is ref-counted — so chat and canvas watching the same
 * browser at once was already supported and tested. This is a second
 * subscriber, nothing more.
 *
 * WHAT DELIBERATELY DOES NOT HAPPEN HERE
 * --------------------------------------
 * Frames never enter the tool result and never enter the message. The model is
 * not shown them (a turn is hundreds of JPEGs; feeding them would cost vision
 * tokens on every glance to say what the tool results already say), and they
 * are not persisted (a saved turn would balloon, and reloading the thread
 * would replay a video). The live view is ephemeral by construction; the
 * transcript keeps the text.
 */

// Lazy: a chat that never browses should not download a streaming client.
const BrowserStreamView = lazyComponent(() => import('@/canvas/widgets/BrowserStreamView.vue'));

const props = defineProps({
  /** Stable identity for this card, unique within the conversation. */
  cardKey: { type: String, required: true },
  /** Monotonic within a conversation; the highest claim owns the stream. */
  order: { type: Number, default: 0 },
});

const collapsed = ref(false);
const pageUrl = ref('');

const owns = computed(() => activeLiveKey.value === props.cardKey);

function onPage({ url }) {
  pageUrl.value = url || '';
}

onMounted(() => claimLiveView(props.cardKey, props.order));
onBeforeUnmount(() => releaseLiveView(props.cardKey));
</script>

<style scoped>
.browser-live-card {
  margin-top: 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-popup);
}

.live-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 11px;
  color: var(--color-text-muted, #556);
  border-bottom: 1px solid var(--terminal-border-color);
}

.live-caret {
  font-size: 10px;
  opacity: 0.8;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-muted, #556);
  flex-shrink: 0;
}

.live-dot.on {
  background: var(--color-green);
  box-shadow: 0 0 0 3px rgba(var(--green-rgb), 0.18);
}

.live-title {
  color: var(--color-text);
  font-weight: 600;
}

.live-url {
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
  opacity: 0.75;
}

/*
  A fixed height, because the stream view fills its container and a canvas with
  no height collapses to nothing. 320px shows a usable slice of a page without
  taking over the transcript.
*/
.live-body {
  height: 320px;
  position: relative;
}

.live-superseded {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 12px;
  color: var(--color-text-muted, #556);
  text-align: center;
  padding: 16px;
}
</style>
