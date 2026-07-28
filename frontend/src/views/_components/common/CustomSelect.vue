<template>
  <div
    class="custom-select"
    :class="{ 'is-disabled': disabled }"
    :tabindex="disabled ? -1 : 0"
    ref="selectContainer"
    role="combobox"
    :aria-expanded="isOpen"
    :aria-disabled="disabled"
  >
    <div class="selected" :class="{ open: isOpen, placeholder: !currentOption }" @click="toggleDropdown(!isOpen)" v-tooltip="displayValue">
      <!-- The label needs its own box: text-overflow does not apply to a flex
           container, so truncation has to happen on a flex CHILD or a long
           option just runs through the border. -->
      <span class="selected-label">{{ displayValue }}</span>
    </div>
    <Teleport to="body">
      <div v-if="isOpen" class="options-container" :style="dropdownStyle" ref="optionsContainer" @click.stop>
        <div
          v-for="(option, index) in options"
          :key="index"
          class="option"
          :class="[{ highlighted: index === selectedIndex }, { selected: isCurrent(option) }, { disabled: option.disabled }, option.class]"
          tabindex="0"
          role="option"
          :aria-selected="isCurrent(option)"
          @click="selectOption(option)"
          @keydown.enter="selectOption(option)"
        >
          <div class="option-inner" v-tooltip="option.label">
            {{ option.label }}
            <span v-if="option.disabled" class="not-connected"></span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
/** Breathing room kept between the open menu and the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

// Global event bus for coordinating dropdown state across all CustomSelect instances
const dropdownEventBus = {
  listeners: new Set(),
  emit(instanceId) {
    this.listeners.forEach((listener) => listener(instanceId));
  },
  on(callback) {
    this.listeners.add(callback);
  },
  off(callback) {
    this.listeners.delete(callback);
  },
};

export default {
  name: 'CustomSelect',
  props: {
    options: {
      type: Array,
      required: true,
    },
    /**
     * v-model. When bound, the displayed option is DERIVED from this value on
     * every render rather than copied into internal state, so the trigger can
     * never disagree with the source of truth and there is no post-mount frame
     * showing the placeholder. Leave it unbound to keep the legacy
     * `ref.setSelectedOption()` behaviour.
     */
    modelValue: {
      type: [String, Number, Boolean, Object, Array],
      default: undefined,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    placeholder: {
      type: String,
      default: 'Select an Option',
    },
    zIndex: {
      type: [Number, String],
      default: 9999,
    },
    maxHeight: {
      type: String,
      default: '300px',
    },
  },
  data() {
    return {
      selectedOption: null,
      selectedIndex: -1,
      isOpen: false,
      dropdownStyle: {
        position: 'fixed',
        top: '0px',
        left: '0px',
        width: 'auto',
        zIndex: this.zIndex,
      },
      instanceId: Math.random().toString(36).substr(2, 9), // Unique ID for this instance
      scrollParents: [], // Track scrollable parent elements
      animationFrameId: null, // For position updates
    };
  },
  computed: {
    // Unbound modelValue means the parent drives selection through the ref.
    isControlled() {
      return this.modelValue !== undefined;
    },
    currentOption() {
      if (this.isControlled) {
        return this.options.find((option) => option.value === this.modelValue) ?? null;
      }
      return this.selectedOption;
    },
    displayValue() {
      return this.currentOption ? this.currentOption.label : this.placeholder;
    },
  },
  emits: ['option-selected', 'update:modelValue'],
  methods: {
    isCurrent(option) {
      return !!this.currentOption && this.currentOption.value === option.value;
    },
    initDropdown() {
      const customSelect = this.$refs.selectContainer;
      customSelect.addEventListener('keydown', this.handleKeydown);
      document.addEventListener('click', this.handleOutsideClick);
      window.addEventListener('resize', this.updatePosition);

      // Find and track all scrollable parent elements
      this.findScrollParents();
    },
    findScrollParents() {
      // Find all scrollable parent elements
      this.scrollParents = [];
      let element = this.$refs.selectContainer?.parentElement;

      while (element && element !== document.body) {
        const overflowY = window.getComputedStyle(element).overflowY;
        const overflowX = window.getComputedStyle(element).overflowX;

        if (overflowY === 'auto' || overflowY === 'scroll' || overflowX === 'auto' || overflowX === 'scroll') {
          this.scrollParents.push(element);
          // Add scroll listener to update dropdown position when parent scrolls
          element.addEventListener('scroll', this.handleParentScroll);
        }
        element = element.parentElement;
      }

      // Also listen to window scroll
      window.addEventListener('scroll', this.handleParentScroll, true);
    },
    handleParentScroll() {
      if (!this.isOpen) return;

      // Check if trigger element is still visible in its scrolling container
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = requestAnimationFrame(() => {
        if (this.isTriggerVisible()) {
          // Trigger is visible, update position to follow it
          this.updatePosition();
        } else {
          // Trigger has scrolled out of view, close dropdown
          this.toggleDropdown(false);
        }
      });
    },
    isTriggerVisible() {
      if (!this.$refs.selectContainer) return false;

      const triggerRect = this.$refs.selectContainer.getBoundingClientRect();

      // Check if trigger is visible in viewport
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

      // Check each scrollable parent to see if trigger is visible within it
      for (const parent of this.scrollParents) {
        const parentRect = parent.getBoundingClientRect();

        // Check if trigger is within parent's visible bounds
        const isAboveParent = triggerRect.bottom < parentRect.top;
        const isBelowParent = triggerRect.top > parentRect.bottom;
        const isLeftOfParent = triggerRect.right < parentRect.left;
        const isRightOfParent = triggerRect.left > parentRect.right;

        if (isAboveParent || isBelowParent || isLeftOfParent || isRightOfParent) {
          return false; // Trigger is outside this parent's visible area
        }
      }

      // Also check if trigger is within viewport
      const isInViewport = triggerRect.top < viewportHeight && triggerRect.bottom > 0 && triggerRect.left < viewportWidth && triggerRect.right > 0;

      return isInViewport;
    },
    updatePosition() {
      if (!this.isOpen || !this.$refs.selectContainer) return;

      const trigger = this.$refs.selectContainer;
      const rect = trigger.getBoundingClientRect();

      // The menu is teleported to <body>, so it inherits nothing from the
      // consumer. Carry the trigger's own type scale across or the menu renders
      // at a different size than the control it belongs to.
      const { fontSize, fontFamily } = window.getComputedStyle(trigger);

      // The menu floats free, so it does not have to inherit the trigger's
      // width. Locking it there means a long option is unreadable ANYWHERE in
      // the UI — truncating in an 80px toolbar control is defensible, but the
      // menu is the one place the full label can always be shown. It grows to
      // content, never shrinks below the trigger, and is clamped so it cannot
      // run off the right edge of the viewport.
      const room = window.innerWidth - rect.left - VIEWPORT_MARGIN_PX;
      const maxWidth = Math.max(rect.width, room);

      this.dropdownStyle = {
        position: 'fixed',
        top: `${rect.bottom}px`,
        left: `${rect.left}px`,
        width: 'max-content',
        minWidth: `${rect.width}px`,
        maxWidth: `${maxWidth}px`,
        zIndex: this.zIndex,
        maxHeight: this.maxHeight,
        fontSize,
        fontFamily,
      };
    },
    toggleDropdown(show) {
      if (this.disabled) {
        this.isOpen = false;
        return;
      }

      if (show === undefined) {
        this.isOpen = !this.isOpen;
      } else {
        this.isOpen = show;
      }

      if (this.isOpen) {
        // Open on the current choice so keyboard navigation starts where the
        // user actually is, not at the top of the list.
        this.selectedIndex = this.options.findIndex((option) => this.isCurrent(option));
        // Notify other dropdowns to close when this one opens
        dropdownEventBus.emit(this.instanceId);
        this.$nextTick(() => {
          this.updatePosition();
        });
      }
    },
    handleDropdownOpen(instanceId) {
      // Close this dropdown if another one opened (unless it's this instance)
      if (instanceId !== this.instanceId && this.isOpen) {
        this.toggleDropdown(false);
      }
    },
    handleKeydown(event) {
      if (this.disabled) return;
      if (!this.isOpen && event.key !== 'Enter' && event.key !== ' ') return;

      const options = this.options; // Use props directly as we don't query DOM for options anymore

      switch (event.key) {
        case 'Enter':
        case ' ':
          if (this.isOpen && this.selectedIndex >= 0) {
            this.selectOption(this.options[this.selectedIndex]);
          } else {
            this.toggleDropdown(!this.isOpen);
          }
          event.preventDefault();
          break;
        case 'ArrowDown':
          if (!this.isOpen) {
            this.toggleDropdown(true);
            this.selectedIndex = 0;
          } else {
            this.selectedIndex = (this.selectedIndex + 1) % options.length;
          }
          event.preventDefault();
          break;
        case 'ArrowUp':
          if (!this.isOpen) {
            this.toggleDropdown(true);
            this.selectedIndex = options.length - 1;
          } else {
            this.selectedIndex = (this.selectedIndex - 1 + options.length) % options.length;
          }
          event.preventDefault();
          break;
        case 'Escape':
          this.toggleDropdown(false);
          this.selectedIndex = -1;
          break;
      }
    },
    handleOutsideClick(event) {
      if (this.$refs.selectContainer && !this.$refs.selectContainer.contains(event.target)) {
        // Also check if click is inside the teleported dropdown
        if (this.$refs.optionsContainer && this.$refs.optionsContainer.contains(event.target)) {
          return;
        }
        this.toggleDropdown(false);
      }
    },
    selectOption(option) {
      if (option.disabled || this.disabled) return;

      // Kept for uncontrolled consumers; ignored when v-model is bound.
      this.selectedOption = option;
      this.$emit('update:modelValue', option.value);
      this.$emit('option-selected', option);

      // Add a small delay before closing the dropdown
      setTimeout(() => {
        this.toggleDropdown(false);
      }, 50);
    },
    setSelectedOption(option) {
      this.selectedOption = option;
      // Don't emit event when setting programmatically
    },
  },
  mounted() {
    this.initDropdown();
    // Listen for other dropdowns opening
    dropdownEventBus.on(this.handleDropdownOpen);
  },
  beforeUnmount() {
    const customSelect = this.$refs.selectContainer;
    if (customSelect) {
      customSelect.removeEventListener('keydown', this.handleKeydown);
    }
    document.removeEventListener('click', this.handleOutsideClick);
    window.removeEventListener('resize', this.updatePosition);
    window.removeEventListener('scroll', this.handleParentScroll, true);

    // Remove scroll listeners from all parent elements
    this.scrollParents.forEach((parent) => {
      parent.removeEventListener('scroll', this.handleParentScroll);
    });

    // Cancel any pending animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Remove listener from event bus
    dropdownEventBus.off(this.handleDropdownOpen);
  },
};
</script>

<style scoped>
/* CUSTOM SELECT STYLES - MOVED FROM GLOBAL CSS FILES */

/*
 * The default width has to LOSE to any call-site width, so it is declared at
 * zero specificity. `.custom-select` and a caller's `.sort-select` are both a
 * single class, so a normal rule here would tie and be settled by bundle order
 * — which is how an 80px toolbar control silently became full-width.
 */
:where(.custom-select) {
  width: calc(100% - 2px);
}

/* Base Custom Select Styles */
.custom-select {
  position: relative;
  display: flex;
  flex-direction: row;
  font-weight: 400;
  flex-wrap: nowrap;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  user-select: none;
}

/*
 * Chrome, doubled on purpose.
 *
 * Call sites carry classes that were written for a native <select> and mix
 * layout (width/margin/height) with chrome (border/background/padding). Layout
 * must survive the swap; chrome must not, or the control renders a border
 * inside a border. A single-class consumer rule and a single-class rule here
 * have identical specificity, so source order would decide it — repeating the
 * class makes this deterministically win without reaching for !important.
 * Height and width are deliberately absent: those belong to the caller.
 */
.custom-select.custom-select {
  box-sizing: border-box;
  min-height: 32px;
  padding: 0;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

.custom-select.is-disabled {
  opacity: 0.5;
}

.custom-select.is-disabled .selected {
  cursor: not-allowed;
}

select.custom-select {
  height: 32px;
  padding: 4px;
  font-family: var(--font-family-primary);
  font-size: var(--base-font-size);
  font-weight: 300;
  color: var(--color-text);
}

.custom-select .selected {
  position: relative;
  display: flex;
  width: 100%;
  width: -webkit-fill-available;
  padding: 0 8px;
  cursor: pointer;
  color: var(--color-text);
  height: 100%;
  min-height: 30px;
  padding-right: 24px;
  box-sizing: border-box;
  flex-direction: row;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  text-wrap: nowrap;
  overflow-x: hidden;
  text-overflow: ellipsis;
}

.custom-select .selected-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-select .selected.placeholder {
  color: var(--color-text-muted);
}

.option {
  position: relative;
  display: flex;
  /* The menu now sizes to its widest option, so a narrower row must still
     stretch or its hover and selection fills come out ragged. */
  width: 100%;
  box-sizing: border-box;
  padding: 0 8px;
  border-top: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  cursor: pointer;
  height: 31px;
  flex-direction: row;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  text-wrap: nowrap;
  overflow-x: hidden;
}

.custom-select .selected::after {
  content: '';
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-25%);
  margin: 0 !important;
  border: 5px solid transparent;
  /* Was --terminal-border-color: #1f1f2f on a #10101f surface is about 1.3:1,
     i.e. an affordance nobody can see. The muted text token is the app's
     standard secondary chrome and clears 4.5:1 here. */
  border-top-color: var(--color-text-muted);
}

/* The open state is already signalled by the flipped caret and the menu
   itself. Dimming the whole trigger made a real selected value look disabled,
   and recolouring it made the trigger read as another list item — so the value
   simply keeps its normal treatment. */

.custom-select .selected.open::after {
  transform: translateY(-75%) rotate(180deg);
}

/* Two cues, not one: colour alone is a poor signal and a colour-blind user
   would have nothing else to go on. */
.option.selected {
  color: var(--color-primary);
  background-color: rgba(var(--primary-rgb), 0.08);
}

.options-container {
  box-shadow: 0px 8px 8px 0px rgba(0, 0, 0, 0.15);
  -webkit-box-shadow: 0px 8px 8px 0px rgba(0, 0, 0, 0.15);
  -moz-box-shadow: 0px 8px 8px 0px rgba(0, 0, 0, 0.15);
  /* display: none; - Removed because v-if handles it */
  /* position: absolute; - Handled by inline style */
  /* top: calc(100%); - Handled by inline style */
  /* left: -1px; - Handled by inline style */
  /* right: 0; - Handled by inline style */
  /* width: 100%; - Handled by inline style */
  z-index: 9999; /* Increased z-index */
  background-color: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-top: none;
  padding-top: 0px;
  border-radius: 8px;
  overflow-y: auto;
  max-height: 300px;
  /* Clip dropdown at viewport edges to prevent it from bleeding outside scrollable containers */
  clip-path: inset(0 -100vw -100vh -100vw);
}

.option:hover {
  opacity: 0.75;
}

.options-container .option:first-child {
  border-top: 1px solid var(--terminal-border-color);
  border-bottom: none;
}

.options-container .option:last-child {
  border-bottom: none;
}

.option.disabled {
  opacity: 0.5;
  cursor: default;
}

.option-inner {
  height: fit-content;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * The template applies `highlighted`; this rule used to say `highlight`, so
 * keyboard navigation moved an invisible cursor — no error, nothing on screen.
 */
/* A tint of the accent rather than another dark layer: on a dark panel a
   darker row recedes, so the keyboard cursor read as a hole in the list.
   Tinting works on both the light and dark themes; a white overlay would not. */
.option.highlighted {
  background-color: rgba(var(--primary-rgb), 0.14);
  box-shadow: inset 2px 0 0 var(--color-primary);
}

.option.disabled:hover {
  background-color: var(--color-darker-0);
}

.option:hover {
  background-color: var(--color-darker-0);
}

/* Special option styles */
.option.create-new-option {
  color: var(--color-green);
  font-weight: 500;
}

/* Dark Theme Styles */
:deep(body.dark) .custom-select {
  background-color: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--terminal-border-color);
  font-weight: 300;
}

:deep(body.dark) .options-container {
  background-color: var(--color-darker-3);
  border: 1px solid var(--terminal-border-color);
  border-top: none;
}

:deep(body.dark) .option {
  border: 1px solid var(--terminal-border-color);
}

:deep(body.dark) .options-container .option:first-child {
  border: 1px solid var(--terminal-border-color);
}

:deep(body.dark) .option:hover {
  background-color: var(--color-darker-3);
}

:deep(body.dark) .option.create-new-option {
  color: var(--color-green);
  font-weight: 400;
}
</style>
