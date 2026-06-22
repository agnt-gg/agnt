<template>
  <Teleport to="body">
    <PopupTutorial
      v-if="isActive && config"
      :key="tourId"
      :config="config"
      :startTutorial="true"
      :tutorialId="`ai-tour-${tourId}`"
      :tourMode="true"
      @close="onClose"
      @navigate="onNavigate"
    />
  </Teleport>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import { useAITour } from '@/composables/useAITour';

const router = useRouter();
const { tourId, config, isActive, start, end } = useAITour();

// Listen for window events dispatched by chatUnified.js (Option A in the
// design) or by useRealtimeSync.js (optional socket bridge — Option B).
function handleTutorialStart(event) {
  const detail = event?.detail ?? event;
  console.log('[AIGuidedTourHost] ai-tour:start received', detail);
  if (!detail || !Array.isArray(detail.steps) || detail.steps.length === 0) {
    console.warn('[AIGuidedTourHost] event missing steps — ignoring', detail);
    return;
  }
  start(detail);
  console.log('[AIGuidedTourHost] state after start →', { tourId: tourId.value, isActive: isActive.value, config: config.value });
}
function handleTutorialEnd(event) {
  console.log('[AIGuidedTourHost] ai-tour:end received', event?.detail);
  end(event?.detail?.reason || 'assistant_request');
}

function onClose() {
  end('user_dismissed');
}

function onNavigate(screenName) {
  if (!screenName) return;
  try {
    router.push({ name: screenName });
  } catch (e) {
    console.warn('[AIGuidedTourHost] router.push failed:', e?.message || e);
  }
}

onMounted(() => {
  window.addEventListener('ai-tour:start', handleTutorialStart);
  window.addEventListener('ai-tour:end', handleTutorialEnd);
  // Expose for manual testing from DevTools:
  //   window.__aiTour.start({ tourId: 't1', mode: 'pointTo', steps: [{ title: 'Hi', content: 'There', targetSelector: '[data-tour-id=\"sidebar.workflows\"]', position: 'right' }] })
  window.__aiTour = { start, end };
  console.log('[AIGuidedTourHost] mounted. Test via window.__aiTour.start({...})');
});

onUnmounted(() => {
  window.removeEventListener('ai-tour:start', handleTutorialStart);
  window.removeEventListener('ai-tour:end', handleTutorialEnd);
});
</script>
