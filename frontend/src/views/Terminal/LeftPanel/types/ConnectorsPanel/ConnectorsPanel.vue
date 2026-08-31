<template>
  <div class="connectors-panel">
    <div class="panel-header">
      <h2 class="title">/ Connectors</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-shield-alt"></i>
          {{ totalSecrets }}
        </span>
      </div>
    </div>

    <div class="connectors-nav">
      <div class="nav-section">
        <div class="nav-items">
          <button
            v-for="item in CONNECT_ITEMS"
            :key="item.id"
            class="nav-item"
            :class="{ active: activeSection === item.id }"
            :data-nav="item.id"
            @click="handleNavClick(item.id)"
          >
            <i :class="item.icon"></i>
            <span>
              {{ item.label }}
              <span v-if="item.pro" style="color: var(--color-yellow)">[PRO]</span>
            </span>
          </button>
        </div>
      </div>

      <!-- <div class="nav-section">
        <h4>Environment</h4>
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'env-vars' }" @click="handleNavClick('env-vars')">
            <i class="fas fa-leaf"></i>
            <span>Environment Variables</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'database' }" @click="handleNavClick('database')">
            <i class="fas fa-database"></i>
            <span>Database Configs</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'certificates' }" @click="handleNavClick('certificates')">
            <i class="fas fa-certificate"></i>
            <span>Certificates</span>
          </button>
        </div>
      </div> -->

      <!-- <div class="nav-section">
        <h4>Management</h4>
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'add-provider' }" @click="handleNavClick('add-provider')">
            <i class="fas fa-plus-circle"></i>
            <span>Add New Integration</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'backup' }" @click="handleNavClick('backup')">
            <i class="fas fa-download"></i>
            <span>Backup & Export</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'audit' }" @click="handleNavClick('audit')">
            <i class="fas fa-history"></i>
            <span>Audit Log</span>
          </button>
        </div>
      </div> -->
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import { activeInnerSection, setInnerSection } from '@/canvas/innerSection.js';

// Everything this screen can show, in order — the nav for the single Connect
// row in the sidebar. Both this panel and the screen read and write ONE shared
// value, so they cannot disagree about which view is showing.
//
// Two things are deliberately absent. "Default AI Provider" is a system
// setting and lives under SYSTEM → AI Provider. "Plugins" is an installable
// asset, not something AGNT reaches out to, and now has its own BUILD row.
const CONNECT_ITEMS = Object.freeze([
  { id: 'oauth', icon: 'fas fa-plug', label: 'API / OAuth' },
  { id: 'email-server', icon: 'fas fa-envelope', label: 'Emails', pro: true },
  { id: 'mcp-servers', icon: 'fas fa-server', label: 'MCP' },
  { id: 'api-keys', icon: 'fas fa-key', label: 'Vault' },
  { id: 'webhooks', icon: 'fas fa-link', label: 'Webhooks', pro: true },
]);

export default {
  name: 'ConnectorsPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    // Not local state: reading the shared value is what keeps this panel in
    // step with the sidebar when navigation starts from the rail.
    const activeSection = computed(() => activeInnerSection.value || 'oauth');

    const totalSecrets = computed(() => {
      const secrets = store.getters['connectors/allSecrets'] || [];
      const allProviders = store.state.appAuth?.allProviders || [];
      return secrets.length + allProviders.length;
    });

    const handleNavClick = (section) => {
      setInnerSection(section);
      emit('panel-action', 'connectors-nav', section);
    };

    return {
      activeSection,
      handleNavClick,
      totalSecrets,
      CONNECT_ITEMS,
    };
  },
};
</script>

<style scoped>
.connectors-panel {
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

.panel-stats {
  display: flex;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  opacity: 0.8;
}

.stat-item i {
  width: 14px;
  text-align: center;
}

.connectors-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
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

.nav-item.disabled {
  user-select: none;
  cursor: not-allowed !important;
  background: transparent;
  color: var(--color-text-muted);
  transform: none;
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
