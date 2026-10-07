<template>
  <Teleport to="body">
    <div v-if="view && ringStyle" class="coach-ring" :class="{ 'coach-ring-dim': dim }" :style="ringStyle" aria-hidden="true"></div>
    <section
      v-if="view"
      ref="cardRef"
      :key="view.key"
      class="coach-card"
      :class="{ 'coach-docked': docked }"
      :style="cardStyle"
      role="dialog"
      aria-modal="false"
      :aria-labelledby="titleId"
      data-coach-popup
      @keydown.esc.stop="emit('close')"
    >
      <header class="coach-head">
        <span class="coach-eyebrow">
          {{ view.eyebrow }}<template v-if="view.progress"> · {{ view.progress }}</template>
        </span>
        <button type="button" class="coach-close" aria-label="Close" @click="emit('close')">&times;</button>
      </header>
      <h3 :id="titleId" class="coach-title">{{ view.title }}</h3>
      <p class="coach-body">{{ view.content }}</p>

      <img v-if="view.media && view.media.type !== 'video'" :src="view.media.src" class="coach-media" alt="" />
      <video v-else-if="view.media" :src="view.media.src" class="coach-media" autoplay loop muted playsinline></video>

      <div v-if="view.prompts && view.prompts.length" class="coach-prompts">
        <button v-for="prompt in view.prompts" :key="prompt" type="button" class="coach-prompt" @click="emit('prompt', prompt)">
          {{ prompt }}
        </button>
      </div>

      <p v-if="lost" class="coach-lost">
        Not on this page.
        <button type="button" class="coach-link" @click="emit('action', 'return')">Take me there</button>
      </p>

      <footer class="coach-foot">
        <span v-if="view.waiting" class="coach-waiting"><i aria-hidden="true"></i>Your move</span>
        <span class="coach-spacer"></span>
        <button v-if="view.secondary" type="button" class="coach-link" @click="emit('action', view.secondary.id)">
          {{ view.secondary.label }}
        </button>
        <button
          v-for="action in view.actions || []"
          :key="action.id"
          type="button"
          :class="action.primary ? 'coach-primary' : 'coach-ghost'"
          @click="emit('action', action.id)"
        >
          {{ action.label }}
        </button>
      </footer>
      <span v-if="arrowStyle" class="coach-arrow" :class="`coach-arrow-${side}`" :style="arrowStyle" aria-hidden="true"></span>
    </section>
  </Teleport>
</template>

<script setup>
/**
 * CoachMark — one card, optionally anchored to one element. Presentational:
 * the journey (JourneyHost) and the assistant's tours (AIGuidedTourHost) both
 * render through it, so there is one popup with one set of rules.
 *
 * Rules that the old PopupTutorial broke:
 *  - A missing target never skips the step. The card docks in the corner and
 *    keeps looking (pages load late, panels open later); if the step belongs
 *    on another page it offers "Take me there".
 *  - It anchors to the first VISIBLE match: KeepAlive keeps hidden copies of
 *    screens, and the first DOM match was often one of those.
 *  - It never blocks the page. The spotlight is pointer-events: none, so the
 *    person can do the thing the card asks for.
 *  - It never takes focus from what the person is typing into.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { firstVisible } from '@/services/journey/journeyEngine.js';

const props = defineProps({
  /** { key, eyebrow, progress, title, content, target, placement, prompts,
   *    waiting, canReturn, actions[], secondary, media, dim } or null */
  view: { type: Object, default: null },
});
const emit = defineEmits(['action', 'prompt', 'close', 'target-click']);

const GAP = 14;
const MARGIN = 12;
const CARD_WIDTH = 340;
const LOST_AFTER_MS = 1800;
const LOOK_EVERY_MS = 400;
const HUGE_SHARE = 0.45; // a target covering this much of the viewport is "the page": dock beside it

const cardRef = ref(null);
const targetRect = ref(null);
const cardSize = ref({ width: CARD_WIDTH, height: 180 });
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const searching = ref(false);
const titleId = `coach-title-${Math.random().toString(36).slice(2, 8)}`;

let element = null;
let lookTimer = null;
let lostTimer = null;
let frame = 0;

const huge = computed(() => {
  const rect = targetRect.value;
  if (!rect) return false;
  return (rect.width * rect.height) / (viewport.value.width * viewport.value.height) > HUGE_SHARE;
});

const lost = computed(() => !!props.view?.target && !targetRect.value && !searching.value && !!props.view?.canReturn);
const dim = computed(() => !!targetRect.value && !huge.value && props.view?.dim !== false);

const ringStyle = computed(() => {
  const rect = targetRect.value;
  if (!rect) return null;
  return { top: `${rect.top - 6}px`, left: `${rect.left - 6}px`, width: `${rect.width + 12}px`, height: `${rect.height + 12}px` };
});

/** Which side of the target the card sits on, or null to dock. */
const side = computed(() => {
  const rect = targetRect.value;
  if (!rect || huge.value) return null;
  const { width: vw, height: vh } = viewport.value;
  const { width: w, height: h } = cardSize.value;
  const fits = {
    bottom: rect.bottom + GAP + h <= vh - MARGIN,
    top: rect.top - GAP - h >= MARGIN,
    right: rect.right + GAP + w <= vw - MARGIN,
    left: rect.left - GAP - w >= MARGIN,
  };
  const order = [props.view?.placement, 'bottom', 'top', 'right', 'left'].filter(Boolean);
  return order.find((candidate) => fits[candidate]) || null;
});

const docked = computed(() => !side.value);

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

const cardStyle = computed(() => {
  if (docked.value) return {};
  const rect = targetRect.value;
  const { width: vw, height: vh } = viewport.value;
  const { width: w, height: h } = cardSize.value;
  let top;
  let left;
  if (side.value === 'bottom' || side.value === 'top') {
    left = clamp(rect.left + rect.width / 2 - w / 2, MARGIN, vw - w - MARGIN);
    top = side.value === 'bottom' ? rect.bottom + GAP : rect.top - GAP - h;
  } else {
    top = clamp(rect.top + rect.height / 2 - h / 2, MARGIN, vh - h - MARGIN);
    left = side.value === 'right' ? rect.right + GAP : rect.left - GAP - w;
  }
  return { top: `${top}px`, left: `${left}px` };
});

/** The arrow points at the target's centre, wherever clamping put the card. */
const arrowStyle = computed(() => {
  if (docked.value) return null;
  const rect = targetRect.value;
  const style = cardStyle.value;
  const left = parseFloat(style.left);
  const top = parseFloat(style.top);
  const { width: w, height: h } = cardSize.value;
  if (side.value === 'bottom' || side.value === 'top') {
    return { left: `${clamp(rect.left + rect.width / 2 - left, 18, w - 18)}px` };
  }
  return { top: `${clamp(rect.top + rect.height / 2 - top, 18, h - 18)}px` };
});

function measureCard() {
  const card = cardRef.value;
  if (card) cardSize.value = { width: card.offsetWidth || CARD_WIDTH, height: card.offsetHeight || 180 };
}

function measure() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  if (element && !element.isConnected) detach();
  const rect = element?.getBoundingClientRect();
  targetRect.value = rect && rect.width > 0 && rect.height > 0 ? rect : null;
  measureCard();
}

function scheduleMeasure() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    measure();
  });
}

function onTargetClick() {
  emit('target-click');
}

function detach() {
  element?.removeEventListener('click', onTargetClick, true);
  element = null;
}

function look() {
  const found = firstVisible(props.view?.target);
  if (found !== element) {
    detach();
    element = found;
    element?.addEventListener('click', onTargetClick, true);
  }
  measure();
}

function stopLooking() {
  clearInterval(lookTimer);
  clearTimeout(lostTimer);
  lookTimer = null;
  detach();
  targetRect.value = null;
}

watch(
  () => [props.view?.key, props.view?.target],
  async () => {
    stopLooking();
    if (!props.view) return;
    await nextTick();
    measureCard();
    if (!props.view.target) return;
    // Keep looking for as long as the step is up: the element may arrive late
    // (lazy screen, panel opened by the person) or be replaced by a re-render.
    searching.value = true;
    lostTimer = setTimeout(() => { searching.value = false; }, LOST_AFTER_MS);
    look();
    lookTimer = setInterval(look, LOOK_EVERY_MS);
  },
  { immediate: true },
);

// The card's own height changes with its content (prompts, "Take me there").
watch([() => props.view, lost], () => nextTick(measureCard), { deep: true });

window.addEventListener('scroll', scheduleMeasure, true);
window.addEventListener('resize', scheduleMeasure);

onBeforeUnmount(() => {
  stopLooking();
  cancelAnimationFrame(frame);
  window.removeEventListener('scroll', scheduleMeasure, true);
  window.removeEventListener('resize', scheduleMeasure);
});
</script>

<style scoped>
.coach-ring {
  position: fixed;
  z-index: 10000;
  border: 2px solid var(--color-primary);
  border-radius: 14px;
  pointer-events: none;
  transition: top 0.18s ease, left 0.18s ease, width 0.18s ease, height 0.18s ease;
  animation: coach-pulse 1.8s ease-in-out infinite;
}

.coach-ring-dim {
  box-shadow: 0 0 0 9999px var(--scrim);
}

.coach-card {
  position: fixed;
  z-index: 10001;
  width: min(340px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 16px 16px 14px;
  border-radius: 14px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-popup);
  color: var(--text-primary);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  font-size: 14px;
  line-height: 1.5;
  animation: coach-in 0.18s ease-out;
}

.coach-docked {
  right: 24px;
  bottom: 24px;
}

.coach-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.coach-eyebrow {
  flex: 1;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.coach-close {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}

.coach-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
}

.coach-body {
  margin: 0;
  color: var(--text-secondary);
}

.coach-media {
  width: 100%;
  margin-top: 10px;
  border-radius: 8px;
}

.coach-prompts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.coach-prompt {
  text-align: left;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-1);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

.coach-prompt:hover,
.coach-prompt:focus-visible {
  border-color: var(--color-primary);
}

.coach-lost {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.coach-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.coach-spacer {
  flex: 1;
}

.coach-waiting {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.coach-waiting i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: coach-blink 1.2s ease-in-out infinite;
}

.coach-primary,
.coach-ghost {
  padding: 7px 14px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.coach-primary {
  border: none;
  background: var(--color-primary);
  color: var(--on-fill-accent);
}

.coach-ghost {
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-primary);
}

.coach-link {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--text-secondary);
  font-size: 13px;
  text-decoration: underline;
  cursor: pointer;
}

.coach-arrow {
  position: absolute;
  width: 12px;
  height: 12px;
  background: inherit;
  border: inherit;
  transform: rotate(45deg);
}

.coach-arrow-bottom {
  top: -7px;
  margin-left: -6px;
  border-right: none;
  border-bottom: none;
}

.coach-arrow-top {
  bottom: -7px;
  margin-left: -6px;
  border-left: none;
  border-top: none;
}

.coach-arrow-right {
  left: -7px;
  margin-top: -6px;
  border-top: none;
  border-right: none;
}

.coach-arrow-left {
  right: -7px;
  margin-top: -6px;
  border-bottom: none;
  border-left: none;
}

@media (max-width: 600px) {
  .coach-docked {
    left: 12px;
    right: 12px;
    bottom: 12px;
    width: auto;
  }
}

@keyframes coach-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

@keyframes coach-pulse {
  0%, 100% { outline: 0 solid transparent; }
  50% { outline: 4px solid rgba(var(--primary-rgb), 0.25); }
}

@keyframes coach-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@media (prefers-reduced-motion: reduce) {
  .coach-card,
  .coach-ring,
  .coach-waiting i {
    animation: none;
    transition: none;
  }
}
</style>
