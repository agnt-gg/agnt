<template>
  <div ref="containerRef" class="tooltip-container" @mouseenter="show" @mouseleave="hide" @focus="show" @blur="hide">
    <slot></slot>
    <Teleport to="body">
      <Transition name="tooltip">
        <div v-if="isVisible" ref="tooltipRef" class="tooltip" :class="[position]" :style="[tooltipStyle, dynamicStyle]">
          <div class="tooltip-content">
            <div v-if="title" class="tooltip-title">{{ title }}</div>
            <div class="tooltip-text">{{ text }}</div>
          </div>
          <div class="tooltip-arrow" :style="arrowStyle"></div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script>
import { ref, computed, nextTick } from 'vue';

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
      default: '300px',
    },
  },
  setup(props) {
    const isVisible = ref(false);
    const tooltipRef = ref(null);
    const containerRef = ref(null);
    const dynamicStyle = ref({});
    const arrowStyle = ref({});

    const tooltipStyle = computed(() => ({
      width: props.width,
    }));

    const show = () => {
      isVisible.value = true;
      dynamicStyle.value = {};
      arrowStyle.value = {};

      nextTick(() => {
        if (!tooltipRef.value || !containerRef.value) return;

        const containerRect = containerRef.value.getBoundingClientRect();
        const tooltipRect = tooltipRef.value.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 10;
        const gap = 12;

        let top, left;

        // Calculate initial position based on preferred position
        switch (props.position) {
          case 'top':
            top = containerRect.top - tooltipRect.height - gap;
            left = containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
            break;
          case 'bottom':
            top = containerRect.bottom + gap;
            left = containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
            break;
          case 'left':
            top = containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
            left = containerRect.left - tooltipRect.width - gap;
            break;
          case 'right':
            top = containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
            left = containerRect.right + gap;
            break;
        }

        // Calculate arrow offset for when tooltip is adjusted
        let arrowOffset = 0;

        // Clamp to viewport bounds
        if (left < margin) {
          arrowOffset = left - margin;
          left = margin;
        } else if (left + tooltipRect.width > vw - margin) {
          arrowOffset = left + tooltipRect.width - (vw - margin);
          left = vw - margin - tooltipRect.width;
        }

        if (top < margin) {
          top = margin;
        } else if (top + tooltipRect.height > vh - margin) {
          top = vh - margin - tooltipRect.height;
        }

        dynamicStyle.value = {
          top: `${top}px`,
          left: `${left}px`,
        };

        // Adjust arrow position if tooltip was shifted horizontally
        if (arrowOffset !== 0 && (props.position === 'top' || props.position === 'bottom')) {
          arrowStyle.value = {
            left: `calc(50% + ${arrowOffset}px)`,
          };
        }
      });
    };

    const hide = () => {
      isVisible.value = false;
    };

    return {
      isVisible,
      tooltipStyle,
      tooltipRef,
      containerRef,
      dynamicStyle,
      arrowStyle,
      show,
      hide,
    };
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

<style>
.tooltip {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  white-space: normal;
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tooltip-content {
  background: rgba(14, 22, 33, 0.95);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 8px;
  padding: 12px 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), 0 0 15px rgba(25, 239, 131, 0.2);
  backdrop-filter: blur(10px);
  position: relative;
}

.tooltip-title {
  color: var(--color-green);
  font-weight: bold;
  font-size: 1.1em;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
  padding-bottom: 6px;
}

.tooltip-text {
  color: var(--color-grey-light);
  font-size: 0.95em;
  line-height: 1.5;
}

.tooltip-arrow {
  position: absolute;
  width: 12px;
  height: 12px;
  background: rgba(14, 22, 33, 0.95);
  border: 1px solid rgba(25, 239, 131, 0.3);
  transform: rotate(45deg);
  z-index: -1;
}

/* Position Variants - positions are calculated in JS */
.tooltip.top,
.tooltip.bottom,
.tooltip.left,
.tooltip.right {
  /* Position set dynamically via inline styles */
}

/* Arrow Positions */
.tooltip.top .tooltip-arrow {
  bottom: -6px;
  left: 50.75%;
  transform: translateX(-50%) rotate(45deg);
  border-top: none;
  border-left: none;
  box-shadow: 3px 3px 3px rgba(0, 0, 0, 0.1);
}

.tooltip.bottom .tooltip-arrow {
  top: -6px;
  left: 50.75%;
  transform: translateX(-50%) rotate(45deg);
  border-bottom: none;
  border-right: none;
  box-shadow: -3px -3px 3px rgba(0, 0, 0, 0.1);
}

.tooltip.left .tooltip-arrow {
  right: -6px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  border-left: none;
  border-bottom: none;
  box-shadow: 3px -3px 3px rgba(0, 0, 0, 0.1);
}

.tooltip.right .tooltip-arrow {
  left: -6px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  border-right: none;
  border-top: none;
  box-shadow: -3px 3px 3px rgba(0, 0, 0, 0.1);
}

/* Animations */
.tooltip-enter-active,
.tooltip-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
}
</style>
