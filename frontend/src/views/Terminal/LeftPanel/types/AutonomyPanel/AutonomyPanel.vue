<template>
  <div class="autonomy-panel">
    <div class="panel-header">
      <h2 class="title">/ Autonomy</h2>
      <div class="panel-stats">
        <span v-if="escalatedCount > 0" class="stat-item warn" :title="escalatedCount + ' insights escalated to you'">
          <i class="fas fa-exclamation-circle"></i>
          {{ escalatedCount }}
        </span>
        <span v-if="scheduleCount > 0" class="stat-item" :title="scheduleCount + ' active schedules'">
          <i class="fas fa-clock"></i>
          {{ scheduleCount }}
        </span>
      </div>
    </div>

    <div class="autonomy-nav">
      <div class="nav-section">
        <h4>Policy</h4>
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'autonomy' }" @click="handleNavClick('autonomy')" data-nav="autonomy">
            <i class="fas fa-robot"></i>
            <span>Router &amp; Inbox</span>
            <span v-if="escalatedCount > 0" class="nav-badge">{{ escalatedCount }}</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'schedules' }" @click="handleNavClick('schedules')" data-nav="schedules">
            <i class="fas fa-clock"></i>
            <span>Schedules</span>
            <span v-if="scheduleCount > 0" class="nav-count">{{ scheduleCount }}</span>
          </button>
          <button class="nav-item" :class="{ active: activeSection === 'contracts' }" @click="handleNavClick('contracts')" data-nav="contracts">
            <i class="fas fa-file-contract"></i>
            <span>Contracts</span>
            <span v-if="contractCount > 0" class="nav-count">{{ contractCount }}</span>
          </button>
        </div>
      </div>

      <div class="nav-section">
        <h4>Provenance</h4>
        <div class="nav-items">
          <button class="nav-item" :class="{ active: activeSection === 'mutations' }" @click="handleNavClick('mutations')" data-nav="mutations">
            <i class="fas fa-code-branch"></i>
            <span>Mutations</span>
            <span v-if="mutationCount > 0" class="nav-count">{{ mutationCount }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, onMounted, toRefs } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'AutonomyPanel',
  props: {
    activeSection: { type: String, default: 'autonomy' },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const { activeSection } = toRefs(props);
    const store = useStore();

    const escalatedCount = computed(() => (store.getters['insights/escalatedInsights'] || []).length);
    const scheduleCount = computed(() => (store.getters['schedules/enabledSchedules'] || []).length);
    const contractCount = computed(() => (store.getters['contracts/activeContracts'] || []).length);
    const mutationCount = computed(() => (store.getters['mutations/allMutations'] || []).length);

    const handleNavClick = (section) => emit('panel-action', 'autonomy-nav', section);

    onMounted(() => {
      // Lightweight prefetch so the badges populate on first render.
      store.dispatch('insights/fetchInsights', { status: 'pending', limit: 200 }).catch(() => {});
      store.dispatch('schedules/fetchSchedules').catch(() => {});
      store.dispatch('contracts/fetchContracts', { status: 'active' }).catch(() => {});
      store.dispatch('mutations/fetchHistory').catch(() => {});
    });

    return {
      activeSection,
      escalatedCount, scheduleCount, contractCount, mutationCount,
      handleNavClick,
    };
  },
};
</script>

<style scoped>
.autonomy-panel { flex: 1; display: flex; flex-direction: column; gap: 20px; }

.panel-header {
  display: flex; flex-direction: row; justify-content: space-between; align-items: center;
  padding: 0 0 12px 0; border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}
.panel-header .title {
  color: var(--color-primary); font-family: var(--font-family-primary);
  font-size: 16px; font-weight: 400; letter-spacing: 0.48px; margin: 0;
}
.panel-stats { display: flex; gap: 10px; }
.stat-item {
  display: flex; align-items: center; gap: 6px;
  color: var(--color-light-med-navy); font-size: 0.85em; opacity: 0.85;
}
.stat-item.warn { color: var(--color-orange); opacity: 1; }

.autonomy-nav { flex: 1; display: flex; flex-direction: column; gap: 16px; }
.nav-section { display: flex; flex-direction: column; gap: 12px; }
.nav-section h4 {
  color: var(--color-primary); font-size: 0.9em; font-weight: 500; margin: 0;
  text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;
}
.nav-items { display: flex; flex-direction: column; gap: 4px; }

.nav-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border-radius: 6px; cursor: pointer; transition: all 0.2s ease;
  color: var(--color-text-muted); font-size: 0.9em;
  background: none; border: none; font-family: inherit; text-align: left; width: 100%;
}
.nav-item:hover {
  background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); transform: translateX(4px);
}
.nav-item.active {
  background: rgba(var(--primary-rgb), 0.15); color: var(--color-text);
  border-left: 3px solid var(--color-primary); padding-left: 9px;
}
.nav-item i { width: 16px; text-align: center; opacity: 0.8; }
.nav-item.active i { opacity: 1; text-shadow: 0 0 3px rgba(var(--primary-rgb), 0.4); }
.nav-item span { font-weight: 400; flex: 1; }

.nav-badge {
  background: rgba(var(--orange-rgb), 0.18); color: var(--color-orange);
  font-size: 0.75em; padding: 1px 7px; border-radius: 10px;
  font-family: var(--font-family-mono); font-weight: 600; flex: none !important;
}
.nav-count {
  background: rgba(var(--primary-rgb), 0.15); color: var(--color-primary);
  font-size: 0.75em; padding: 1px 7px; border-radius: 10px;
  font-family: var(--font-family-mono); flex: none !important;
}
</style>
