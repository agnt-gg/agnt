import { ref, readonly } from 'vue';

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

// Translate the backend step shape into the PopupTutorial step shape.
// PopupTutorial uses `target` (CSS selector), `position`, `autoProgress`,
// `enforceStep`, `simulateClick`, `media`, `navigateToScreen`, and an
// `onBefore` async hook.
function stepsToPopupConfig(steps) {
  return steps.map((s) => {
    const hasTarget = !!s.targetSelector;
    return {
      title: s.title,
      content: s.content,
      target: s.targetSelector || undefined,
      position: hasTarget ? (s.position || 'bottom') : 'center',
      autoProgress: s.autoAdvanceMs,
      enforceStep: s.enforce === true,
      simulateClick: s.action === 'simulateClick',
      showSkipButton: true,
      media: s.mediaUrl
        ? { type: /\.mp4($|\?)/i.test(s.mediaUrl) ? 'video' : 'gif', src: s.mediaUrl }
        : undefined,
      // PopupTutorial supports per-step audio URLs. If a real TTS URL is
      // provided, use it; otherwise leave undefined.
      audioContent: s.audioUrl || undefined,
      navigateToScreen: s.route,
      onBefore: s.route
        ? async () => {
            // Give the SPA route a beat to settle before the popup measures.
            await new Promise((r) => setTimeout(r, 200));
          }
        : undefined,
    };
  });
}
