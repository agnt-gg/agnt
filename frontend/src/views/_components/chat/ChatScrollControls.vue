<template>
  <div class="chat-scroll-controls" :class="{ 'has-controls': canScrollUp || canScrollDown }">
    <Tooltip v-if="canScrollUp" text="Scroll to top" width="auto">
      <button class="scroll-btn" type="button" @click="scrollToTop" aria-label="Scroll to top">
        <i class="fas fa-chevron-up"></i>
      </button>
    </Tooltip>
    <Tooltip v-if="canScrollDown" text="Scroll to bottom" width="auto">
      <button class="scroll-btn" type="button" @click="scrollToBottom" aria-label="Scroll to bottom">
        <i class="fas fa-chevron-down"></i>
      </button>
    </Tooltip>
  </div>
</template>

<script>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ChatScrollControls',
  components: { Tooltip },
  props: {
    // Function returning the scrollable element. We pass a getter rather than a
    // ref so Chat.vue can hand us its own conversationSpace ref while
    // UnifiedChatContainer hands us its chat-messages ref — no plumbing needed.
    targetGetter: { type: Function, required: true },
    threshold: { type: Number, default: 60 },
  },
  setup(props) {
    const canScrollUp = ref(false);
    const canScrollDown = ref(false);
    let observedEl = null;
    let mutationObserver = null;
    let resizeObserver = null;

    const computeState = () => {
      const el = props.targetGetter();
      if (!el) {
        canScrollUp.value = false;
        canScrollDown.value = false;
        return;
      }
      canScrollUp.value = el.scrollTop > props.threshold;
      canScrollDown.value = el.scrollHeight - el.scrollTop - el.clientHeight > props.threshold;
    };

    const onScroll = () => computeState();

    // Smooth-scroll if available; instant fallback for older webviews.
    const scrollTo = (top) => {
      const el = props.targetGetter();
      if (!el) return;
      try {
        el.scrollTo({ top, behavior: 'smooth' });
      } catch (e) {
        el.scrollTop = top;
      }
    };
    const scrollToTop = () => scrollTo(0);
    const scrollToBottom = () => {
      const el = props.targetGetter();
      if (!el) return;
      scrollTo(el.scrollHeight);
    };

    const attach = () => {
      const el = props.targetGetter();
      if (!el || el === observedEl) return;
      detach();
      observedEl = el;
      el.addEventListener('scroll', onScroll, { passive: true });
      // Recompute when content height changes (new messages, expanded tool calls)
      // and when the container itself resizes (panel resize, fullscreen toggle).
      if (typeof MutationObserver !== 'undefined') {
        mutationObserver = new MutationObserver(() => computeState());
        mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => computeState());
        resizeObserver.observe(el);
      }
      computeState();
    };

    const detach = () => {
      if (observedEl) {
        observedEl.removeEventListener('scroll', onScroll);
        observedEl = null;
      }
      if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    };

    onMounted(() => {
      // Defer to next frame so the parent's mounted-time ref is populated.
      requestAnimationFrame(attach);
    });

    onBeforeUnmount(detach);

    // Re-attach if the parent swaps the target element.
    watch(() => props.targetGetter(), () => {
      requestAnimationFrame(attach);
    });

    return {
      canScrollUp,
      canScrollDown,
      scrollToTop,
      scrollToBottom,
    };
  },
};
</script>

<style scoped>
.chat-scroll-controls {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
}

.scroll-btn {
  pointer-events: auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-light-green, var(--color-text));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1em;
  transition: color 0.15s ease, transform 0.15s ease, opacity 0.2s ease;
  opacity: 0;
  transform: translateY(4px);
  animation: scroll-btn-in 0.18s ease-out forwards;
}

.scroll-btn:hover {
  color: var(--color-green);
  transform: scale(1.15);
}

@keyframes scroll-btn-in {
  to { opacity: 1; transform: translateY(0); }
}
</style>
