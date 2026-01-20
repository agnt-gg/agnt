<template>
  <div class="settings-panel">
    <!-- <div class="panel-header">
      <h3 class="panel-title">Settings</h3>
      <p class="panel-subtitle">System Configuration</p>
    </div> -->

    <div class="panel-header">
      <h2 class="title">/ Account</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-tools"></i>
          {{ totalTools }}
        </span>
      </div>
    </div>

    <div class="settings-nav">
      <div class="nav-section" data-section="account">
        <h4>General</h4>
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'profile' }" @click="handleNavClick('profile')" data-nav="profile">
            <i class="fas fa-user"></i>
            <span>Profile</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'referrals' }" @click="handleNavClick('referrals')" data-nav="referrals">
            <i class="fas fa-users"></i>
            <span>Referrals</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'leaderboard' }" @click="handleNavClick('leaderboard')" data-nav="leaderboard">
            <i class="fas fa-trophy"></i>
            <span>Leaderboard</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'billing' }" @click="handleNavClick('billing')" data-nav="billing">
            <i class="fas fa-wallet"></i>
            <span>Billing</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'api-keys' }" @click="handleNavClick('api-keys')" data-nav="api-keys">
            <i class="fas fa-key"></i>
            <p>API Key <span style="color: var(--color-yellow)">[PRO]</span></p>
          </button>
        </div>
      </div>

      <div class="nav-section" data-section="configuration">
        <h4>Configuration</h4>
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'theme' }" @click="handleNavClick('theme')" data-nav="theme">
            <i class="fas fa-palette"></i>
            <p>Theme <span style="color: var(--color-yellow)">[PRO]</span></p>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'sounds' }" @click="handleNavClick('sounds')" data-nav="sounds">
            <i class="fas fa-volume-up"></i>
            <span>Sounds</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'tours' }" @click="handleNavClick('tours')" data-nav="tours">
            <i class="fas fa-route"></i>
            <span>Tours</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'general' }" @click="handleNavClick('general')" data-nav="general">
            <i class="fas fa-cog"></i>
            <span>Logout</span>
          </button>
        </div>
      </div>

      <!-- <div class="nav-section" data-section="system">
        <h4>System</h4>
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'backup' }" @click="handleNavClick('backup')" data-nav="backup">
            <i class="fas fa-download"></i>
            <span>Backup & Export</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'reset' }" @click="handleNavClick('reset')" data-nav="reset">
            <i class="fas fa-trash"></i>
            <span>Reset Settings</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'about' }" @click="handleNavClick('about')" data-nav="about">
            <i class="fas fa-info-circle"></i>
            <span>About</span>
          </button>
        </div>
      </div> -->
    </div>
  </div>
</template>

<script>
import { ref, computed, toRefs } from 'vue';

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
    const totalTools = ref(42); // Placeholder - could be computed from store

    const handleNavClick = (section) => {
      emit('panel-action', 'settings-nav', section);
    };

    return {
      activeSection,
      totalTools,
      handleNavClick,
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

/* .panel-header {
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
  padding-bottom: 16px;
} */

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
  font-family: 'League Spartan', sans-serif;
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.panel-title {
  color: var(--color-primary);
  font-size: 1.2em;
  font-weight: 600;
  margin: 0 0 4px 0;
  text-shadow: 0 0 5px rgba(25, 239, 131, 0.3);
}

.panel-subtitle {
  color: var(--color-text);
  font-size: 0.85em;
  margin: 0;
  opacity: 0.8;
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
  color: var(--color-green);
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
  color: var(--color-text-dull);
  font-size: 0.9em;
  /* Button reset styles */
  background: none;
  border: none;
  font-family: inherit;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-green);
  transform: translateX(4px);
}

.nav-item.active {
  background: rgba(25, 239, 131, 0.15);
  color: var(--color-text);
  border-left: 3px solid var(--color-green);
  padding-left: 9px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  opacity: 0.8;
}

.nav-item i {
  width: 16px;
  text-align: center;
  opacity: 0.8;
}

.nav-item.active i {
  opacity: 1;
  text-shadow: 0 0 3px rgba(25, 239, 131, 0.4);
}

.nav-item span,
.nav-item p {
  font-weight: 400;
  flex: 1;
}
</style>
