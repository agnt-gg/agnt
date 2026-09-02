<template>
  <!--
    The three panel surfaces, drawn ONCE and never unmounted.

    Every screen renders its own BaseScreen, and BaseScreen owns the three-panel
    frame (left · main · right). So a route change unmounts the whole frame and
    mounts a fresh one — and for the frame or two in between, nothing opaque
    covers .cv-dashboard. With a custom wallpaper that gap is a flash of the
    wallpaper; with panel widths restored in onMounted it is also a snap from
    the CSS default width to the remembered one.

    This layer sits UNDER the slot at the same geometry the frame will take,
    using the same background rules (_core.css custom-bg overrides included),
    so the swap happens on top of surfaces that are already painted. It reads
    widths synchronously from the theme store — the same values BaseScreen
    restores in onMounted — so its first frame is the settled layout.

    It is purely visual: no pointer events, no content, no state of its own.
  -->
  <div class="cv-backdrop" aria-hidden="true">
    <div v-if="showLeft" class="cv-backdrop-left left-panel" :style="{ width: leftWidth + 'px' }"></div>
    <div class="cv-backdrop-main main-panel"></div>
    <div v-if="showRight" class="cv-backdrop-right controls-panel" :style="{ width: rightWidth + 'px' }"></div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import { resolvePanel } from '@/views/Terminal/CenterPanel/screenRegistry.js';

const COLLAPSED_PX = 16;
const HANDLE_PX = 8;

export default {
  name: 'PanelBackdrop',
  props: {
    /** The screen about to render, so per-screen panel enablement is honoured. */
    screenName: { type: String, default: '' },
  },
  setup(props) {
    const store = useStore();
    const g = (k) => store.getters['theme/' + k];

    // A screen with leftPanel:false in the registry (Providers, Plugins…)
    // draws no left surface, so neither do we.
    const leftEnabled = computed(() => resolvePanel(undefined, props.screenName, 'leftPanel') !== false);
    const showLeft = computed(() => leftEnabled.value && g('showLeftPanel') !== false);
    const showRight = computed(() => g('showRightPanel') !== false);

    // Width includes the 8px resize handle beside each panel so the main
    // surface starts exactly where BaseScreen's .main-panel will.
    const leftWidth = computed(() => (g('leftPanelCollapsed') ? COLLAPSED_PX : Number(g('actualLeftPanelWidth')) || 384) + HANDLE_PX);
    const rightWidth = computed(() => (g('rightPanelCollapsed') ? COLLAPSED_PX : Number(g('rightPanelWidth')) || 384) + HANDLE_PX);

    return { showLeft, showRight, leftWidth, rightWidth };
  },
};
</script>

<style scoped>
.cv-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  z-index: 0;
}
/* The surfaces reuse the real panel classes (.left-panel / .main-panel /
   .controls-panel) so the theme's custom-bg rules in _core.css apply to them
   verbatim — one definition of "what a panel looks like". Only geometry and
   chrome are overridden here. */
.cv-backdrop-left,
.cv-backdrop-right,
.cv-backdrop-main {
  height: 100%;
  padding: 0;
  gap: 0;
  overflow: hidden;
  flex-shrink: 0;
  z-index: 0;
}
.cv-backdrop-main {
  flex: 1;
  min-width: 0;
  border: 0;
}
</style>
