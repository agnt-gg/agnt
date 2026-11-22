<template>
  <div class="one-wrapped" data-testid="wrapped" @keydown="onKeydown">
    <div class="wr-scrim" @click="emit('close')"></div>
    <div class="wr-stage">
      <button v-if="cards.length > 1" type="button" class="wr-side" :disabled="index === 0" aria-label="Previous card" data-action="prev" @click="go(index - 1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>

      <div ref="storyEl" class="wr-story" :class="{ 'is-paused': paused }" :style="{ '--chrome': chrome }" role="dialog" aria-modal="true" :aria-label="`Your ${year} in AGNT`" tabindex="-1">
        <div class="wr-cards" @pointerdown="onPointerDown">
          <template v-if="status === 'ready'">
            <WrappedCard v-for="(card, i) in cards" :key="card.id" :card="card" :active="i === index" :still="still" @share="openSheet" @replay="go(0)" />
          </template>
          <section v-else class="wr-card wr-state is-active" :data-state="status">
            <svg class="wr-intro-mark" :class="{ 'is-waiting': status === 'loading' }" viewBox="0 0 37 36" aria-hidden="true">
              <circle v-for="([cx, cy], k) in MARK_DOTS" :key="k" :cx="cx" :cy="cy" r="4.5" :style="{ '--i': k }" />
            </svg>
            <div class="wr-grow"></div>
            <template v-if="status === 'loading'">
              <p class="wr-kicker">AGNT · Year in review</p>
              <p class="wr-title is-big">Counting your {{ year }}…</p>
            </template>
            <template v-else-if="status === 'empty'">
              <p class="wr-kicker">AGNT · Year in review</p>
              <p class="wr-title is-big">Your {{ year }} is just getting started.</p>
              <p class="wr-lead">A few more days with Annie and your assistants, and there will be a year to tell. Come back in December.</p>
            </template>
            <template v-else>
              <p class="wr-kicker">AGNT · Year in review</p>
              <p class="wr-title is-big">Your year didn’t load.</p>
              <p class="wr-lead">{{ error || 'Something went wrong.' }}</p>
              <div class="wr-actions"><button type="button" class="wr-cta is-light" data-action="retry" @click="emit('retry')">Try again</button></div>
            </template>
          </section>
        </div>

        <div class="wr-grain" aria-hidden="true"></div>

        <div class="wr-chrome-top">
          <div v-if="cards.length" class="wr-bars" aria-hidden="true">
            <span v-for="(card, i) in cards" :key="card.id" class="wr-bar"><i :style="{ transform: `scaleX(${fillOf(i)})` }"></i></span>
          </div>
          <div class="wr-head">
            <svg class="wr-head-mark" viewBox="0 0 37 36" aria-hidden="true"><circle v-for="([cx, cy], k) in MARK_DOTS" :key="k" :cx="cx" :cy="cy" r="4.5" /></svg>
            <span class="wr-head-title">{{ year }} Wrapped</span>
            <span class="wr-fill"></span>
            <button v-if="status === 'ready' && !still" type="button" class="wr-head-btn" :aria-label="pausedBy.user ? 'Play' : 'Pause'" data-action="pause" @click="pausedBy.user = !pausedBy.user">
              <svg v-if="pausedBy.user" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>
            </button>
            <button type="button" class="wr-head-btn" aria-label="Close" data-action="close" @click="emit('close')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>

        <div v-if="status === 'ready' && !onLast" class="wr-chrome-bottom">
          <button type="button" class="wr-pill" data-action="share" @click="openSheet">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" /></svg><span>Share</span>
          </button>
          <span class="wr-hint">{{ index === 0 ? 'Tap to start' : 'Tap for next' }}</span>
        </div>

        <div v-if="sheetOpen" class="wr-sheet" data-testid="wrapped-share" @click.self="closeSheet">
          <div class="wr-sheet-card" role="dialog" aria-label="Share your year">
            <p class="wr-sheet-title">Share your year</p>
            <p class="wr-sheet-sub">Your summary card, sized for posts and stories.</p>
            <div class="wr-sheet-row">
              <button type="button" class="wr-sheet-opt" data-action="post" @click="postToX">
                <svg class="is-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>Post to X
              </button>
              <button type="button" class="wr-sheet-opt" data-action="copy" @click="copyImage">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>Copy image
              </button>
              <button type="button" class="wr-sheet-opt" data-action="save" @click="saveImage">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" /><path d="M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></svg>Save image
              </button>
            </div>
            <div class="wr-toggle">
              <button type="button" class="wr-switch" role="switch" :aria-checked="hidePrivate ? 'true' : 'false'" aria-labelledby="wr-hide-private" data-testid="wrapped-hide-private" @click="hidePrivate = !hidePrivate">
                <span class="wr-switch-knob" aria-hidden="true"></span>
              </button>
              <span id="wr-hide-private">Hide spend and goal names</span>
            </div>
            <p v-if="shareStatus" class="wr-sheet-status" role="status">{{ shareStatus }}</p>
            <button type="button" class="wr-sheet-done" data-action="done" @click="closeSheet">Done</button>
          </div>
        </div>

        <p class="wr-vh" aria-live="polite">{{ announcement }}</p>
      </div>

      <button v-if="cards.length > 1" type="button" class="wr-side" :disabled="onLast" aria-label="Next card" data-action="next" @click="go(index + 1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
    <p class="wr-keys" aria-hidden="true">← → move · space pauses · hold to pause · esc closes</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { openExternal } from '@/services/agntFlash.js';
import WrappedCard from './WrappedCard.vue';
import { MARK_DOTS, buildCards } from './wrappedModel.js';
import { copyShareImage, saveShareImage, shareIntentUrl, shareText } from './wrappedShare.js';

const props = defineProps({
  year: { type: Number, required: true },
  status: { type: String, required: true }, // 'loading' | 'ready' | 'empty' | 'error'
  data: { type: Object, default: null },
  error: { type: String, default: '' },
});
const emit = defineEmits(['close', 'retry']);

const HOLD_MS = 220;
const MAX_STEP_MS = 100; // a frame after a stall advances at most this much
const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const storyEl = ref(null);
const cards = computed(() => (props.status === 'ready' ? buildCards(props.data) : []));
const index = ref(0);
const progress = ref(0);
const onLast = computed(() => index.value >= cards.value.length - 1);
const current = computed(() => cards.value[index.value] || null);
const chrome = computed(() => (current.value?.tone === 'light' ? '#070710' : '#ffffff'));
const announcement = computed(() => (current.value ? `${index.value + 1} of ${cards.value.length}. ${current.value.label}` : ''));

// Each reason to pause is kept apart, so letting go of a hold never resumes a story the person paused.
const pausedBy = reactive({ user: false, hold: false, sheet: false, hidden: false });
const paused = computed(() => Object.values(pausedBy).some(Boolean));

function fillOf(i) {
  if (i < index.value) return 1;
  if (i > index.value) return 0;
  return !current.value?.duration || still ? 1 : progress.value;
}

function go(i) {
  const target = Math.max(0, Math.min(cards.value.length - 1, i));
  if (target === index.value) return;
  index.value = target;
  progress.value = 0;
}
watch(cards, () => {
  index.value = 0;
  progress.value = 0;
});

// ── The clock ──
const nextFrame = globalThis.requestAnimationFrame?.bind(globalThis) || ((cb) => setTimeout(() => cb(performance.now()), 16));
const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout;
let frame = 0;
let last = 0;
function tick(now) {
  const step = Math.min(MAX_STEP_MS, now - last);
  last = now;
  const card = current.value;
  if (card?.duration && !paused.value && !still) {
    progress.value = Math.min(1, progress.value + step / card.duration);
    if (progress.value >= 1 && !onLast.value) go(index.value + 1);
  }
  frame = nextFrame(tick);
}

// ── Tap and hold ──
let press = null;
function onPointerDown(event) {
  if (props.status !== 'ready' || event.button !== 0 || event.target.closest('button, a, input, label')) return;
  const p = { x: event.clientX, held: false, timer: 0 };
  p.timer = setTimeout(() => {
    p.held = true;
    pausedBy.hold = true;
  }, HOLD_MS);
  press = p;
}
function onPointerEnd(event) {
  if (!press) return;
  clearTimeout(press.timer);
  if (press.held) pausedBy.hold = false;
  else if (event.type === 'pointerup' && storyEl.value) {
    const box = storyEl.value.getBoundingClientRect();
    go(index.value + (press.x - box.left < box.width / 3 ? -1 : 1));
  }
  press = null;
}

// ── Keys, and keeping focus inside ──
function trapFocus(event) {
  const items = [...(storyEl.value?.closest('.one-wrapped')?.querySelectorAll('button:not([disabled]), input, [tabindex="-1"]') || [])].filter((el) => !el.closest('[inert]'));
  if (!items.length) return;
  const first = items[0];
  const lastItem = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    lastItem.focus();
  } else if (!event.shiftKey && document.activeElement === lastItem) {
    event.preventDefault();
    first.focus();
  }
}
function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (sheetOpen.value) closeSheet();
    else emit('close');
    return;
  }
  if (event.key === 'Tab') return trapFocus(event);
  if (sheetOpen.value || props.status !== 'ready') return;
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    go(index.value + 1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    go(index.value - 1);
  } else if (event.key === ' ' && !event.target.closest('button, input, label')) {
    event.preventDefault();
    pausedBy.user = !pausedBy.user;
  }
}
const onVisibility = () => {
  pausedBy.hidden = document.hidden;
};

// ── Sharing ──
const sheetOpen = ref(false);
const hidePrivate = ref(true);
const shareStatus = ref('');
const summary = computed(() => cards.value.find((c) => c.id === 'summary') || null);
const shareOptions = () => ({ includePrivate: !hidePrivate.value });
function openSheet() {
  shareStatus.value = '';
  sheetOpen.value = true;
  pausedBy.sheet = true;
  nextTick(() => storyEl.value?.querySelector('.wr-sheet button')?.focus({ preventScroll: true }));
}
function closeSheet() {
  sheetOpen.value = false;
  pausedBy.sheet = false;
  storyEl.value?.focus({ preventScroll: true });
}
function postToX() {
  if (!summary.value) return;
  openExternal(shareIntentUrl(shareText(summary.value, shareOptions())));
  shareStatus.value = 'Opened X. Save the image to attach it.';
}
async function copyImage() {
  if (!summary.value) return;
  try {
    await copyShareImage(summary.value, shareOptions());
    shareStatus.value = 'Image copied.';
  } catch (error) {
    shareStatus.value = error.message;
  }
}
async function saveImage() {
  if (!summary.value) return;
  try {
    shareStatus.value = `Saved ${await saveShareImage(summary.value, shareOptions())}.`;
  } catch (error) {
    shareStatus.value = error.message;
  }
}

onMounted(() => {
  last = performance.now();
  frame = nextFrame(tick);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  document.addEventListener('visibilitychange', onVisibility);
  storyEl.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  cancelFrame(frame);
  if (press) clearTimeout(press.timer);
  window.removeEventListener('pointerup', onPointerEnd);
  window.removeEventListener('pointercancel', onPointerEnd);
  document.removeEventListener('visibilitychange', onVisibility);
});

defineExpose({ go, index });
</script>
