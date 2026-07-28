<template>
  <div ref="containerRef" class="tooltip-container" @mouseenter="show" @mouseleave="hide" @focusin="show" @focusout="hide">
    <slot></slot>
  </div>
</template>

<script>
/**
 * Tooltip — the wrapper form.
 *
 * The public API (props text/title/position/width + default slot) is unchanged;
 * the rendering, positioning and lifetime now come from the shared engine in
 * `@/directives/tooltipEngine`, so this and `v-tooltip` cannot drift apart.
 *
 * Two behaviours changed, both of them bugs:
 *
 *   - Keyboard focus now shows the tooltip. This listened for `focus`/`blur`,
 *     which do not bubble, so focusing the wrapped control never fired them and
 *     no keyboard user had ever seen one of these. `focusin`/`focusout` do.
 *   - Blank text no longer renders an empty bordered box. `:text="item.reason"`
 *     going empty used to pop a small empty rectangle on hover.
 *
 * Use `v-tooltip` instead wherever a wrapper div would disturb layout — flex
 * and grid children, percentage-width elements, and anything targeted by a
 * `>`, `+` or `:first-child` selector.
 */
import { ref, onBeforeUnmount } from 'vue';
import { showTooltip, hideTooltip } from '@/directives/tooltipEngine.js';

export default {
  name: 'Tooltip',
  props: {
    text: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      default: '',
    },
    position: {
      type: String,
      default: 'top',
      validator: (value) => ['top', 'bottom', 'left', 'right'].includes(value),
    },
    width: {
      type: String,
      default: 'auto',
    },
  },
  setup(props) {
    const containerRef = ref(null);

    const show = () => {
      if (!containerRef.value) return;
      showTooltip(containerRef.value, {
        text: props.text,
        title: props.title,
        position: props.position,
        width: props.width,
      });
    };

    const hide = () => {
      if (containerRef.value) hideTooltip(containerRef.value);
    };

    // A tooltip is teleported, so it outlives its trigger unless this runs.
    onBeforeUnmount(hide);

    return { containerRef, show, hide };
  },
};
</script>

<style scoped>
.tooltip-container {
  position: initial;
  vertical-align: middle;
  width: fit-content;
  word-break: inherit;
}
</style>
