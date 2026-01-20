<template>
  <div class="secrets-panel">
    <div class="panel-header">
      <h2 class="title">/ Connect</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-shield-alt"></i>
          {{ totalSecrets }}
        </span>
      </div>
    </div>

    <div class="secrets-nav">
      <div class="nav-section">
        <!-- <h4>Connections</h4> -->
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'plugins' }" @click="handleNavClick('plugins')">
            <i class="fas fa-puzzle-piece"></i>
            <p>My Plugins</p>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'oauth' }" @click="handleNavClick('oauth')">
            <i class="fas fa-plug"></i>
            <p>Auth Connections</p>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'providers' }" @click="handleNavClick('providers')" data-nav="providers">
            <i class="fas fa-robot"></i>
            <p>Default AI Provider</p>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'mcp-servers' }" @click="handleNavClick('mcp-servers')">
            <i class="fas fa-server"></i>
            <p>MCP / NPM Library</p>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'webhooks' }" @click="handleNavClick('webhooks')">
            <i class="fas fa-link"></i>
            <p>Webhooks <span style="color: var(--color-yellow)">[PRO]</span></p>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'email-server' }" @click="handleNavClick('email-server')">
            <i class="fas fa-envelope"></i>
            <p>Email Server <span style="color: var(--color-yellow)">[PRO]</span></p>
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
import { ref, computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'SecretsPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const activeSection = ref('plugins');

    const totalSecrets = computed(() => {
      const secrets = store.getters['secrets/allSecrets'] || [];
      const allProviders = store.state.appAuth?.allProviders || [];
      return secrets.length + allProviders.length;
    });

    const handleNavClick = (section) => {
      activeSection.value = section;
      emit('panel-action', 'secrets-nav', section);
    };

    return {
      activeSection,
      handleNavClick,
      totalSecrets,
    };
  },
};
</script>

<style scoped>
.secrets-panel {
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
  color: var(--color-green);
  font-family: 'League Spartan', sans-serif;
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

.secrets-nav {
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
  color: var(--color-light-green);
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
  color: var(--color-light-green);
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
  background: rgba(25, 239, 131, 0.15);
  color: var(--color-text);
  border-left: 3px solid var(--color-green);
  padding-left: 9px;
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
