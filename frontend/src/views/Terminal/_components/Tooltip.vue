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
 *
 * `disabled` is for a trigger whose tooltip is only sometimes worth showing —
 * a control that already displays its own label, say. Blanking `text` would
 * also suppress it, but only for hovers that START while it is blank: a
 * tooltip already on screen keeps the text it was shown with, because nothing
 * re-runs `show` on a prop change. `disabled` retracts that one too.
 */
import { ref, watch, onBeforeUnmount } from 'vue';
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
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const containerRef = ref(null);

    const show = () => {
      if (props.disabled || !containerRef.value) return;
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

    // Becoming disabled while visible must retract it. The pointer is usually
    // still on the trigger at that moment — the control that flipped the
    // condition is often the one being hovered — and `mouseleave` will not
    // fire until it moves away, so the tooltip would otherwise sit there
    // contradicting the UI it just changed.
    watch(
      () => props.disabled,
      (isDisabled) => {
        if (isDisabled) hide();
      },
    );

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
