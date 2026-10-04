<!-- SettingsPanel — the Settings navigation.

     Renders settingsDirectory (mobile/sectionDirectories.js) group by group,
     exactly as declared, so regrouping Settings is an edit to that one file.
     It used to index the directory by position ([0]…[4]) with a hand-written
     block per group; a sixth group was silently invisible on desktop.

     Two kinds of row, one nav:
       • a Settings SECTION  → 'settings-nav'  (Settings.vue swaps its body)
       • a whole SCREEN      → 'settings-goto' (the host screen navigates)
     A screen row (Learning) also renders THIS panel on its left
     (screenRegistry.js), so its host must handle 'settings-nav' too. -->
<template>
  <div class="settings-panel">
    <div class="panel-header">
      <h2 class="title">/ Settings</h2>
    </div>

    <div class="settings-nav">
      <div v-for="group in SETTINGS_GROUPS" :key="group.label" class="nav-section" :data-section="group.label.toLowerCase()">
        <h4>{{ group.label }}</h4>
        <div class="nav-items">
          <button
            v-for="item in group.items"
            :key="item.id"
            class="nav-item"
            :class="{ active: activeSection === item.id }"
            :data-nav="item.id"
            @click="handleNavClick(item)"
          >
            <i :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { settingsDirectory, DEFAULT_SETTINGS_SECTION } from '@/mobile/sectionDirectories.js';
import { toRefs } from 'vue';

const SETTINGS_GROUPS = settingsDirectory;

export default {
  name: 'SettingsPanel',
  props: {
    activeSection: {
      type: String,
      default: DEFAULT_SETTINGS_SECTION,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const { activeSection } = toRefs(props);

    // `screen` present → the row navigates to a whole screen rather than
    // swapping the Settings body. Everything else is a Settings section id,
    // matching the `activeSection === '…'` branches in Settings.vue.
    const handleNavClick = (item) => {
      if (item.screen) emit('panel-action', 'settings-goto', item.screen);
      else emit('panel-action', 'settings-nav', item.id);
    };

    return { activeSection, handleNavClick, SETTINGS_GROUPS };
  },
};
</script>

<style scoped>
.settings-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}

.panel-header .title {
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.settings-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nav-section h4 {
  color: var(--color-primary);
  font-size: 0.9em;
  font-weight: 500;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.8;
}

.nav-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-muted);
  font-size: 0.9em;
  /* Button reset styles */
  background: none;
  border: none;
  font-family: inherit;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
  transform: translateX(4px);
}

.nav-item.active {
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-text);
  border-left: 3px solid var(--color-primary);
  padding-left: 9px;
}

.nav-item i {
  width: 16px;
  text-align: center;
  opacity: 0.8;
}

.nav-item.active i {
  opacity: 1;
  text-shadow: 0 0 3px rgba(var(--primary-rgb), 0.4);
}

.nav-item span,
.nav-item p {
  font-weight: 400;
  flex: 1;
}

</style>
