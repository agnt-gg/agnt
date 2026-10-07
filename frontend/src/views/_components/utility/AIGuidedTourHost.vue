<template>
  <CoachMark :view="stepView" @action="onAction" @close="onClose" @target-click="onTargetClick" />
</template>

<script setup>
/**
 * Renders the assistant's guided tours (start_guided_tour / highlight_element)
 * through the same CoachMark as the journey's missions.
 *
 * A step's `route` navigates and the tour CONTINUES on the new page. The old
 * host closed the whole tour on the first route step, so any tour spanning
 * two pages ended after its first hop — and it pushed the path as a route
 * NAME, which matched no route at all.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import CoachMark from '@/views/_components/utility/CoachMark.vue';
import { useAITour } from '@/composables/useAITour';
import { firstVisible } from '@/services/journey/journeyEngine.js';

const router = useRouter();
const { tourId, config, isActive, meta, start, end } = useAITour();
const index = ref(0);
let autoTimer = null;

const steps = computed(() => (isActive.value && Array.isArray(config.value) ? config.value : []));
const step = computed(() => steps.value[index.value] || null);

const stepView = computed(() => {
  const current = step.value;
  if (!current) return null;
  const total = steps.value.length;
  const last = index.value === total - 1;
  return {
    key: `${tourId.value}:${index.value}`,
    eyebrow: meta.value?.title || 'Guided tour',
    progress: total > 1 ? `${index.value + 1} of ${total}` : null,
    title: current.title,
    content: current.content,
    target: current.target || null,
    placement: current.position === 'center' ? null : current.position,
    media: current.media || null,
    waiting: !!current.waitForClick,
    canReturn: !!current.navigateToScreen,
    actions: [
      ...(index.value > 0 ? [{ id: 'back', label: 'Back' }] : []),
      ...(current.waitForClick ? [] : [{ id: 'next', label: current.buttonText || (last ? 'Got it' : 'Next'), primary: true }]),
    ],
    secondary: current.waitForClick ? { id: 'next', label: last ? 'Skip' : 'Skip step' } : null,
  };
});

function navigateTo(route) {
  if (!route) return;
  const location = String(route).startsWith('/') ? route : { name: route };
  router.push(location).catch((error) => {
    console.warn('[AIGuidedTourHost] navigation failed:', error?.message || error);
  });
}

function enter() {
  clearTimeout(autoTimer);
  const current = step.value;
  if (!current) return;
  if (current.navigateToScreen && router.currentRoute.value?.path !== current.navigateToScreen) navigateTo(current.navigateToScreen);
  if (current.autoProgress) autoTimer = setTimeout(next, current.autoProgress);
}

function next() {
  const current = step.value;
  if (!current) return;
  if (current.simulateClick) firstVisible(current.target)?.click();
  if (index.value + 1 >= steps.value.length) {
    clearTimeout(autoTimer);
    end('completed');
    return;
  }
  index.value += 1;
  enter();
}

function back() {
  if (index.value === 0) return;
  index.value -= 1;
  enter();
}

function onAction(id) {
  if (id === 'next') next();
  else if (id === 'back') back();
  else if (id === 'return') navigateTo(step.value?.navigateToScreen);
}

function onTargetClick() {
  if (step.value?.waitForClick) next();
}

function onClose() {
  clearTimeout(autoTimer);
  end('user_dismissed');
}

// A new tour (or the same id started again) begins at its first step.
watch(
  () => [tourId.value, isActive.value],
  ([, active]) => {
    index.value = 0;
    if (active) enter();
    else clearTimeout(autoTimer);
  },
);

// Window events dispatched by chatUnified.js or useRealtimeSync.js.
function handleTutorialStart(event) {
  const detail = event?.detail ?? event;
  if (!detail || !Array.isArray(detail.steps) || detail.steps.length === 0) {
    console.warn('[AIGuidedTourHost] ai-tour:start without steps, ignored', detail);
    return;
  }
  start(detail);
}

function handleTutorialEnd(event) {
  end(event?.detail?.reason || 'assistant_request');
}

onMounted(() => {
  window.addEventListener('ai-tour:start', handleTutorialStart);
  window.addEventListener('ai-tour:end', handleTutorialEnd);
  // Manual testing from DevTools:
  //   window.__aiTour.start({ tourId: 't1', steps: [{ title: 'Hi', content: 'There', targetSelector: '[data-tour-id="sidebar.workflows"]', position: 'right' }] })
  window.__aiTour = { start, end };
});

onUnmounted(() => {
  clearTimeout(autoTimer);
  window.removeEventListener('ai-tour:start', handleTutorialStart);
  window.removeEventListener('ai-tour:end', handleTutorialEnd);
});
</script>
