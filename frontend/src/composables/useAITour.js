import { ref, readonly } from 'vue';
import { revealSidebarTargets } from '@/services/tourReveal.js';

// Singleton state — the host component is mounted once at App root and
// every chat surface dispatches into this same instance.
const tourId = ref(null);
const config = ref(null);
const isActive = ref(false);
const mode = ref('tour');
const meta = ref({});

export function useAITour() {
  function start({ tourId: id, steps, mode: m = 'tour', title } = {}) {
    if (!Array.isArray(steps) || steps.length === 0) return;
    // A step may name a rail row this account has not unlocked yet; put it on
    // the rail first, or the popup points at nothing (see tourReveal.js). The
    // popup measures its target after a delay, so the row has rendered by then.
    try {
      revealSidebarTargets(steps);
    } catch (error) {
      console.warn('[useAITour] could not reveal tour targets:', error?.message || error);
    }
    config.value = stepsToPopupConfig(steps);
    tourId.value = id || `ai-${Date.now()}`;
    mode.value = m;
    meta.value = { title };
    isActive.value = true;
  }

  function end(reason = 'user') {
    const endingTourId = tourId.value;
    isActive.value = false;
    config.value = null;
    tourId.value = null;
    meta.value = {};
    // Fire-and-forget beacon so the orchestrator can pick up the outcome
    // on the next chat turn. The /api/tutorial/event endpoint is optional;
    // if it isn't mounted yet the beacon silently no-ops.
    try {
      navigator.sendBeacon?.(
        '/api/tutorial/event',
        new Blob(
          [JSON.stringify({ event: 'tour_ended', tourId: endingTourId, reason })],
          { type: 'application/json' }
        )
      );
    } catch {
      /* fire-and-forget */
    }
  }

  return {
    tourId: readonly(tourId),
    config: readonly(config),
    isActive: readonly(isActive),
    mode: readonly(mode),
    meta: readonly(meta),
    start,
    end,
  };
}

// Translate the backend step shape (tutorialTools.js start_guided_tour) into
// the step AIGuidedTourHost renders through CoachMark. A missing target no
// longer skips the step: CoachMark docks the card and keeps looking, so a
// late-rendering element still gets its highlight.
export function stepsToPopupConfig(steps) {
  return steps.map((s, index) => {
    const hasTarget = !!s.targetSelector;
    const isLast = index === steps.length - 1;
    return {
      title: s.title,
      content: s.content,
      // A one-step highlight read "Next" beside a full progress bar.
      buttonText: s.buttonText || (isLast ? 'Got it' : undefined),
      target: s.targetSelector || undefined,
      position: hasTarget ? (s.position || 'bottom') : 'center',
      autoProgress: s.autoAdvanceMs,
      simulateClick: s.action === 'simulateClick',
      // The tool has always offered waitForClick; nothing honoured it, so the
      // assistant's "click it yourself" steps advanced on Next like any other.
      waitForClick: s.action === 'waitForClick',
      media: s.mediaUrl
        ? { type: /\.mp4($|\?)/i.test(s.mediaUrl) ? 'video' : 'gif', src: s.mediaUrl }
        : undefined,
      navigateToScreen: s.route,
    };
  });
}
