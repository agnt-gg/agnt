<!-- SettingsPanel — the SYSTEM navigation.

     Everything that used to be scattered between the main sidebar (Memory,
     Evolution, Autonomy) and Connectors' inner nav (Default AI Provider) now
     lives here, under two captions. The main rail carries WORK / PLAN / BUILD
     / CONNECT and one gear; twelve configuration rows would have drowned it.

     Two kinds of row, one nav:
       • a Settings SECTION  → 'settings-nav'  (Settings.vue swaps its body)
       • a whole SCREEN      → 'settings-goto' (the host screen navigates)
     Memory / Evolution / Autonomy are full screens, not Settings sections, so
     they take the second path. They also render THIS panel on their left
     (screenRegistry.js), which is what makes SYSTEM feel like one place
     instead of three unrelated destinations you can only reach once. -->
<template>
  <div class="settings-panel">
    <div class="panel-header">
      <h2 class="title">/ System</h2>
    </div>

    <div class="settings-nav">
      <div class="nav-section" data-section="general">
        <h4>General</h4>
        <div class="nav-items">
          <button
            v-for="item in GENERAL_ITEMS"
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

      <!-- The three screens that govern how Annie herself behaves: how much
           she may do alone, what she remembers, how she improves. They are
           full screens rather than sections of this one, so they navigate. -->
      <div class="nav-section" data-section="assistant">
        <h4>Assistant</h4>
        <div class="nav-items">
          <button
            v-for="item in ASSISTANT_ITEMS"
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

      <div class="nav-section" data-section="config">
        <h4>Config</h4>
        <div class="nav-items">
          <button
            v-for="item in CONFIG_ITEMS"
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

      <!-- Logout is an action, not a settings page, so it sits below the
           captions rather than inside one. It kept its 'general' section id
           because that is the Settings view that hosts LoginSection. -->
      <div class="nav-footer">
        <button class="nav-item nav-item-quiet" :class="{ active: activeSection === 'general' }" data-nav="general" @click="handleNavClick(LOGOUT_ITEM)">
          <i class="fas fa-sign-out-alt"></i>
          <span>Logout</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { toRefs } from 'vue';

// `screen` present → the row navigates to a whole screen rather than swapping
// the Settings body. Everything else is a Settings section id, matching the
// `activeSection === '…'` branches in Settings.vue.
const GENERAL_ITEMS = Object.freeze([
  { id: 'providers', icon: 'fas fa-robot', label: 'AI Provider' },
  { id: 'billing', icon: 'fas fa-wallet', label: 'Billing' },
  { id: 'profile', icon: 'fas fa-user', label: 'Profile' },
  { id: 'referrals', icon: 'fas fa-users', label: 'Referrals' },
]);

const ASSISTANT_ITEMS = Object.freeze([
  { id: 'autonomy', icon: 'fas fa-user-shield', label: 'Autonomy', screen: 'AutonomyScreen' },
  { id: 'evolution', icon: 'fas fa-dna', label: 'Evolution', screen: 'ExperimentsScreen' },
  { id: 'memory', icon: 'fas fa-brain', label: 'Memory', screen: 'MemoryScreen' },
]);

const CONFIG_ITEMS = Object.freeze([
  { id: 'phone-access', icon: 'fas fa-mobile-alt', label: 'Remote Access' },
  { id: 'connection', icon: 'fas fa-server', label: 'Remote Backend' },
  { id: 'security', icon: 'fas fa-shield-alt', label: 'Security' },
  { id: 'theme', icon: 'fas fa-palette', label: 'Theme' },
  { id: 'tours', icon: 'fas fa-route', label: 'Tours' },
]);

const LOGOUT_ITEM = Object.freeze({ id: 'general', icon: 'fas fa-sign-out-alt', label: 'Logout' });

export default {
  name: 'SettingsPanel',
  props: {
    activeSection: {
      type: String,
      default: 'profile',
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const { activeSection } = toRefs(props);

    const handleNavClick = (item) => {
      if (item.screen) emit('panel-action', 'settings-goto', item.screen);
      else emit('panel-action', 'settings-nav', item.id);
    };

    return {
      activeSection,
      handleNavClick,
      GENERAL_ITEMS,
      ASSISTANT_ITEMS,
      CONFIG_ITEMS,
      LOGOUT_ITEM,
    };
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

/* Pushed to the bottom and separated: an action, not a destination. */
.nav-footer {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color-light);
}

.nav-item-quiet {
  opacity: 0.75;
}
</style>
