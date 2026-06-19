<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="AutonomyScreen"
    activeLeftPanel="AutonomyPanel"
    :leftPanelProps="{ activeSection }"
    :activeRightPanel="null"
    :showInput="false"
    @panel-action="handlePanelAction"
    @screen-change="(s) => emit('screen-change', s)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="autonomy-screen">
        <div class="screen-header">
          <h2 class="screen-title">{{ activeTab.title }}</h2>
          <p class="screen-subtitle">{{ activeTab.subtitle }}</p>
        </div>

        <!-- Inline tab strip — visible regardless of left panel state -->
        <div class="tab-strip">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="tab"
            :class="{ active: activeSection === tab.id }"
            @click="setSection(tab.id)"
          >
            <i :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
            <span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
          </button>
        </div>

        <div class="screen-body">
          <AutonomyManager v-if="activeSection === 'autonomy'" />
          <SchedulesManager v-else-if="activeSection === 'schedules'" />
          <WalletManager v-else-if="activeSection === 'wallets'" />
          <ContractsManager v-else-if="activeSection === 'contracts'" />
          <MutationsViewer v-else-if="activeSection === 'mutations'" />
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import AutonomyManager from './components/AutonomyManager/AutonomyManager.vue';
import SchedulesManager from './components/SchedulesManager/SchedulesManager.vue';
import WalletManager from './components/WalletManager/WalletManager.vue';
import ContractsManager from './components/ContractsManager/ContractsManager.vue';
import MutationsViewer from './components/MutationsViewer/MutationsViewer.vue';

const TABS = [
  { id: 'autonomy', label: 'Autonomy & Inbox', icon: 'fas fa-robot',
    title: 'Autonomy & Escalation Inbox', subtitle: 'Configure the policy that decides which insights auto-apply, and review escalations' },
  { id: 'schedules', label: 'Schedules', icon: 'fas fa-clock',
    title: 'Schedules', subtitle: 'Cron-driven goals — set once, run forever' },
  { id: 'contracts', label: 'Contracts', icon: 'fas fa-file-contract',
    title: 'Runtime Contracts', subtitle: 'Refinement-type invariants mined from real executions' },
  { id: 'mutations', label: 'Mutations', icon: 'fas fa-code-branch',
    title: 'Mutation History', subtitle: 'Every router-applied change with snapshot + auto-revert' },
  { id: 'wallets', label: 'Wallets', icon: 'fas fa-coins',
    title: 'Capability Wallets', subtitle: 'Linear capability budgets — runaways cannot drain unlimited tokens' },
];

export default {
  name: 'AutonomyScreen',
  components: {
    BaseScreen,
    AutonomyManager,
    SchedulesManager,
    WalletManager,
    ContractsManager,
    MutationsViewer,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const baseScreenRef = ref(null);
    const activeSection = ref('autonomy');

    const escalatedCount = computed(() => (store.getters['insights/escalatedInsights'] || []).length);

    const tabs = computed(() => TABS.map((t) => ({
      ...t,
      badge: t.id === 'autonomy' && escalatedCount.value > 0 ? escalatedCount.value : null,
    })));

    const activeTab = computed(() => tabs.value.find((t) => t.id === activeSection.value) || TABS[0]);

    const setSection = (id) => { activeSection.value = id; };

    const handlePanelAction = (action, payload) => {
      if (action === 'autonomy-nav') {
        setSection(payload);
      }
    };

    const initializeScreen = () => {
      // Restore a requested sub-section if navigated here from elsewhere.
      const requested = localStorage.getItem('autonomy-initial-section');
      if (requested) {
        activeSection.value = requested;
        localStorage.removeItem('autonomy-initial-section');
      }
      // Prefetch what the inbox + sweeping needs.
      store.dispatch('insights/fetchEvolutionSettings').catch(() => {});
      store.dispatch('insights/fetchInsights', { status: 'pending', limit: 200 }).catch(() => {});
    };

    onMounted(() => {});

    return {
      baseScreenRef,
      activeSection,
      activeTab,
      tabs,
      setSection,
      handlePanelAction,
      initializeScreen,
      emit,
    };
  },
};
</script>

<style scoped>
.autonomy-screen {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 8px;
}

.screen-header {
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 12px;
}
.screen-title {
  font-size: 1.6em;
  font-weight: 600;
  margin: 0 0 4px 0;
}
.screen-subtitle {
  color: var(--color-light-med-navy);
  font-size: 0.95em;
  margin: 0;
  opacity: 0.8;
}

.tab-strip {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--terminal-border-color);
  overflow-x: auto;
  scrollbar-width: thin;
}
.tab {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  padding: 8px 14px;
  font-size: 0.9em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.tab:hover { color: var(--color-text); }
.tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}
.tab i { opacity: 0.85; }
.tab-badge {
  background: rgba(var(--orange-rgb), 0.18);
  color: var(--color-orange);
  font-size: 0.75em;
  padding: 1px 7px;
  border-radius: 10px;
  font-family: var(--font-family-mono);
  font-weight: 600;
}

.screen-body {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
}
</style>
