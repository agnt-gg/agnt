<template>
  <!--
    v-if="owns" on the ROOT, so a superseded card renders nothing whatsoever.

    The first version showed a placeholder in a full-height body, and a turn
    that made six browser calls left five dead grey panes stacked down the
    transcript — over two thousand pixels of nothing, each announcing that the
    interesting one was somewhere further down. The live browser is ONE thing;
    it belongs in one place, at the newest step.

    The component still mounts either way, so it still registers its order with
    the registry and can take the stream over when a newer card unmounts. Only
    the DOM is empty.
  -->
  <!--
    Fullscreen MOVES this card rather than opening a second viewer. A disabled
    Teleport keeps the same component instance, so the stream lease, the page
    and anything half-typed survive the toggle; a modal holding a fresh
    BrowserStreamView would re-subscribe and flash "Opening…".

    It moves into the screen's fullscreen HOST (CanvasScreen's content box),
    not <body>. That box is below the top bar and beside the sidebar, so the
    expanded browser cannot cover either, whatever the layout does. If the
    surface has no host, keep the browser inline rather than cover app chrome.
  -->
  <Teleport :to="fullscreenHost || 'body'" :disabled="!fullscreen">
  <div
    v-if="owns"
    v-show="live || showing"
    ref="cardRef"
    class="browser-live-card"
    :class="{ 'is-fullscreen': fullscreen }"
    :role="fullscreen ? 'dialog' : undefined"
    :aria-modal="fullscreen ? 'true' : undefined"
    aria-label="Live browser"
  >
    <div class="live-header" @click="!fullscreen && (collapsed = !collapsed)">
      <span v-if="!fullscreen" class="live-caret">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="live-dot on"></span>
      <span class="live-title">Live browser</span>
      <span v-if="pageUrl" class="live-url">{{ pageUrl }}</span>
      <button
        type="button"
        class="live-fullscreen"
        :aria-label="fullscreen ? 'Exit fullscreen' : 'Fullscreen'"
        :aria-pressed="fullscreen"
        v-tooltip="fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'"
        @click.stop="toggleFullscreen"
      >
        <i :class="fullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
      </button>
    </div>

    <!-- data-keeps-focus: clicks in here belong to the page, not the chat input. -->
    <div v-if="!collapsed || fullscreen" class="live-body" data-keeps-focus>
      <!--
        The LIVE turn opens a browser if none exists: the card is there because
        the agent is browsing right now, and a card that waits for a browser
        that never comes is the blank pane this used to be. An OLD message
        never launches (scrolling back must not open browsers); it stays
        hidden (v-show above) until it actually has pixels to show.
      -->
      <BrowserStreamView
        :launch="live"
        :high-quality="fullscreen"
        :conversation-id="conversationId"
        @page="onPage"
        @showing="onShowing"
      />
    </div>
  </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onDeactivated } from 'vue';
import { lazyComponent } from '@/utils/chunkRecovery.js';
import { claimLiveView, releaseLiveView, ownsLiveView } from './browserLiveRegistry.js';

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
  /** This card belongs to the turn happening now, not one being re-read. */
  live: { type: Boolean, default: false },
  /**
   * The conversation this card belongs to. Each conversation has its own
   * browser tab, so the card shows THIS conversation's browser and competes
   * for the stream only with cards of the same conversation. Empty for
   * surfaces that have no conversation id; those share the default browser.
   */
  conversationId: { type: String, default: '' },
});

const showing = ref(false);
function onShowing(value) { showing.value = Boolean(value); }

const collapsed = ref(false);
const pageUrl = ref('');

const owns = computed(() => ownsLiveView(props.cardKey));

function onPage({ url }) {
  pageUrl.value = url || '';
}

const cardRef = ref(null);
const fullscreen = ref(false);

/**
 * The box fullscreen fills: the nearest [data-fullscreen-host] around THIS
 * card, resolved while the card is still in the transcript (once teleported,
 * its ancestry is the host itself). Structural rather than measured: a top
 * offset read once from the top bar went stale on every layout change, and
 * when it read 0 the browser sat under the bar's window-drag region, where
 * Electron swallows clicks — the exit button stopped working.
 */
const fullscreenHost = ref(null);

function enterFullscreen() {
  const host = cardRef.value?.closest?.('[data-fullscreen-host]');
  if (!host) {
    console.warn('[BrowserLiveCard] No fullscreen host; keeping the browser inline.');
    return;
  }
  fullscreenHost.value = host;
  fullscreen.value = true;
}
function exitFullscreen() { fullscreen.value = false; }
function toggleFullscreen() { if (fullscreen.value) exitFullscreen(); else enterFullscreen(); }

/**
 * Escape ALWAYS leaves fullscreen, so there is never a state you cannot get
 * out of. Capture phase, because the stream canvas stops propagation of every
 * key it forwards to the page — a bubbling listener never saw Escape once the
 * user had clicked into the page. Fullscreen owns Escape the way a browser's
 * own fullscreen does; outside fullscreen it still reaches the page.
 */
function onEscapeCapture(event) {
  if (event.key !== 'Escape' || !fullscreen.value) return;
  event.preventDefault();
  event.stopPropagation();
  exitFullscreen();
}
watch(fullscreen, (on) => {
  if (on) window.addEventListener('keydown', onEscapeCapture, true);
  else window.removeEventListener('keydown', onEscapeCapture, true);
});
// A newer turn taking the stream over unrenders this card; leave no
// listener and no fullscreen state behind for when it comes back.
watch(owns, (isOwner) => { if (!isOwner) exitFullscreen(); });

// Chat lives inside <KeepAlive>. Navigating away DEACTIVATES it, and Vue does
// not move teleported content on deactivation — a fullscreen browser would
// stay on top of whatever screen the user went to, with no way back short of
// a restart. Leaving the screen therefore leaves fullscreen.
onDeactivated(exitFullscreen);

onMounted(() => claimLiveView(props.cardKey, props.order, props.conversationId));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEscapeCapture, true);
  releaseLiveView(props.cardKey);
});
</script>

<style scoped>
.browser-live-card {
  /* Full width, like an image attachment: the point of this card is
     watching a page, and a page rendered into a narrow column is a page
     you cannot read. align-self overrides the tool-call item's
     align-items: flex-start, which would otherwise shrink it to fit. */
  width: 100%;
  align-self: stretch;
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

.live-fullscreen {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted, #556);
  font-size: 11px;
  cursor: pointer;
}

.live-fullscreen:hover,
.live-fullscreen:focus-visible {
  color: var(--color-text);
  border-color: var(--terminal-border-color);
  outline: none;
}

/* With a URL, its auto margin already pushes the button right; without one,
   the button takes the slack itself. */
.live-header .live-title + .live-fullscreen {
  margin-left: auto;
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
  height: 420px;
  position: relative;
}

/* Fills the screen's content box (the fullscreen host), never the window.
   z-index stays BELOW the top bar (100): the bar's own popovers — Jump, the
   model picker — must open over the browser, not under it. */
.browser-live-card.is-fullscreen {
  position: absolute;
  inset: 0;
  z-index: 99;
  margin: 0;
  border: none;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  /* This covers live UI, not wallpaper. --color-darkest is a translucent
     tint (10% in dark, 2.4% in light), and --color-background can inherit
     wallpaper opacity. RGB channels retain the theme without its alpha. */
  background: rgb(var(--color-background-rgb, 21, 21, 31));
  -webkit-app-region: no-drag;
}

/* Exit sits at the far LEFT in fullscreen, the opposite end of the window
   from the app's close button. */
.browser-live-card.is-fullscreen .live-fullscreen {
  order: -1;
  margin-left: 0;
  margin-right: 4px;
}

.browser-live-card.is-fullscreen .live-header {
  cursor: default;
  padding: 10px 16px;
  font-size: 12px;
}

.browser-live-card.is-fullscreen .live-body {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}

</style>
