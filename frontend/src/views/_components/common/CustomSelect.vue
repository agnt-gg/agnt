<template>
  <div class="custom-select" tabindex="0" ref="selectContainer">
    <div class="selected" :class="{ open: isOpen }" @click="toggleDropdown(!isOpen)">{{ displayValue }}</div>
    <Teleport to="body">
      <div v-if="isOpen" class="options-container" :style="dropdownStyle" ref="optionsContainer" @click.stop>
        <div
          v-for="(option, index) in options"
          :key="index"
          class="option"
          :class="[{ highlighted: index === selectedIndex }, { disabled: option.disabled }, option.class]"
          tabindex="0"
          @click="selectOption(option)"
          @keydown.enter="selectOption(option)"
        >
          <div class="option-inner">
            {{ option.label }}
            <span v-if="option.disabled" class="not-connected"></span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
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
    displayValue() {
      return this.selectedOption ? this.selectedOption.label : this.placeholder;
    },
  },
  emits: ['option-selected'],
  methods: {
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

      const rect = this.$refs.selectContainer.getBoundingClientRect();
      this.dropdownStyle = {
        position: 'fixed',
        top: `${rect.bottom}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: this.zIndex,
        maxHeight: this.maxHeight,
      };
    },
    toggleDropdown(show) {
      if (show === undefined) {
        this.isOpen = !this.isOpen;
      } else {
        this.isOpen = show;
      }

      if (this.isOpen) {
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
      if (option.disabled) return;

      this.selectedOption = option;
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

/* Base Custom Select Styles */
.custom-select {
  position: relative;
  display: flex;
  width: calc(100% - 2px);
  height: 30px;
  flex-direction: row;
  font-weight: 400;
  flex-wrap: nowrap;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  user-select: none;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

select.custom-select {
  height: 32px;
  padding: 4px;
  font-family: 'League Spartan', sans-serif;
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
  height: 32px;
  transform: translateY(2px);
  flex-direction: row;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  text-wrap: nowrap;
  overflow-x: hidden;
  margin-top: -2px;
}

.option {
  position: relative;
  display: flex;
  width: auto;
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
  top: 38%;
  margin: 0 !important;
  border: 5px solid transparent;
  border-top-color: var(--terminal-border-color);
}

.custom-select .selected.open {
  opacity: 0.5;
}

.custom-select .selected.open::after {
  transform: translateY(-60%) rotate(180deg);
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
}

.option.highlight {
  color: var(--color-pink);
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
