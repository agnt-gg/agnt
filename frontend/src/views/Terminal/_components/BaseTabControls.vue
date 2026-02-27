<template>
  <div class="tab-controls">
    <!-- Tabs -->
    <div class="tab-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-button"
        :class="{ active: activeTab === tab.id }"
        @click="$emit('select-tab', tab.id)"
        data-sound="typewriterKeyPress"
      >
        <i :class="tab.icon"></i> {{ tab.name }}
      </button>
    </div>

    <!-- Layout Toggle -->
    <div class="layout-toggle">
      <Tooltip v-if="showGridToggle" text="Grid View" width="auto" position="bottom">
        <button class="toggle-button" :class="{ active: currentLayout === 'grid' }" @click="$emit('set-layout', 'grid')">
          <i class="fas fa-th-large"></i>
        </button>
      </Tooltip>
      <Tooltip v-if="showTableToggle !== false" text="Table View" width="auto" position="bottom">
        <button class="toggle-button" :class="{ active: currentLayout === 'table' }" @click="$emit('set-layout', 'table')">
          <i class="fas fa-table"></i>
        </button>
      </Tooltip>
    </div>
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'BaseTabControls',
  components: { Tooltip },
  props: {
    tabs: {
      type: Array,
      required: true,
    },
    activeTab: {
      type: String,
      required: true,
    },
    currentLayout: {
      type: String,
      required: true,
      validator: function (value) {
        return ['grid', 'table'].includes(value);
      },
    },
    showGridToggle: {
      type: Boolean,
      default: true,
    },
    showTableToggle: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['select-tab', 'set-layout'],
};
</script>

<style scoped>
/* Tab controls (tabs + layout toggle) */
.tab-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  border-bottom: 1px solid var(--terminal-border-color);
  /* margin-bottom: 16px; */ /* Style might be specific to Missions.vue context, let's keep it out for now or make it configurable */
}

.tab-tabs[data-v-022aae85] {
  /* This data attribute is likely auto-generated and scoped. We should remove it or ensure it's handled correctly if it's vital */
  border-bottom: none;
}

.layout-toggle {
  display: flex;
  gap: 2px;
  margin-bottom: 1px; /* This aligns buttons with the bottom border of .tab-controls */
}

.layout-toggle .toggle-button:first-child {
  border-radius: 8px 0 0 0;
}

.layout-toggle .toggle-button:last-child {
  border-radius: 0 8px 0 0;
}

.layout-toggle .toggle-button:only-child {
  border-radius: 8px 8px 0 0;
}

.toggle-button {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  padding: 8px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 0;
  opacity: 0.9;
}

.toggle-button:hover {
  background: rgba(var(--green-rgb), 0.1);
}

.toggle-button:hover:not(.active) {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
  opacity: 1;
}

.toggle-button.active {
  background: rgba(var(--green-rgb), 0.2);
  color: var(--color-text);
}

.tab-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 1px;
  /* border-bottom: 1px solid rgba(18, 224, 255, 0.1); */ /* Covered by .tab-controls */
  /* padding-bottom: 1px; */ /* This might create a double border effect or visual inconsistency, review if needed */
}

button.tab-button:first-child {
  border-radius: 8px 0 0 0;
}

button.tab-button:last-child {
  border-radius: 0 8px 0 0;
}

.tab-button {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  padding: 8px 16px;
  cursor: pointer !important;
  border-radius: 0;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.9;
}

.tab-button i {
  font-size: 0.9em;
}

.tab-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  cursor: pointer;
}

.tab-button:hover:not(.active) {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
  opacity: 1;
}

.tab-button.active {
  background: rgba(var(--green-rgb), 0.2);
  border-bottom: 1px solid var(--color-green); /* This creates the active tab underline that sits on top of the .tab-controls border */
  color: var(--color-text);
  opacity: 1;
}
</style>
