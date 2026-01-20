<template>
  <div class="automation-dashboard">
    <!-- Agent Utilization -->
    <!-- <AgentUtilization /> -->

    <!-- Performance Overview -->
    <!-- <PerformanceOverview /> -->

    <!-- Workflow Templates -->
    <ActiveWorkflows @edit-workflow="handleEditWorkflow" />

    <!-- Items for Review -->
    <!-- <ItemsForReview @review-item="handleReviewItem" /> -->

    <!-- Integration Health -->
    <IntegrationHealth />

    <!-- Active Tasks -->
    <!-- <ActiveTasks /> -->

    <!-- System Resources -->
    <!-- <SystemResources /> -->

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import AgentUtilization from './components/AgentUtilization.vue';
import ActiveWorkflows from './components/ActiveWorkflows.vue';
import IntegrationHealth from './components/IntegrationHealth.vue';
import ItemsForReview from './components/ItemsForReview.vue';
import PerformanceOverview from './components/PerformanceOverview.vue';
import ActiveTasks from './components/ActiveTasks.vue';
import SystemResources from './components/SystemResources.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'ChatPanel',
  components: {
    AgentUtilization,
    ActiveWorkflows,
    IntegrationHealth,
    ItemsForReview,
    PerformanceOverview,
    ActiveTasks,
    SystemResources,
    ResourcesSection,
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    const handleEditWorkflow = (data) => {
      console.log('ChatPanel: Handling edit workflow:', data);
      emit('panel-action', 'edit-workflow', data.workflowId);
    };

    const handleReviewItem = (data) => {
      emit('panel-action', 'review-item', data);
    };

    onMounted(async () => {
      // Fetch initial data needed for the panel
      await store.dispatch('userStats/fetchStats');
      await store.dispatch('workflows/fetchWorkflows', { activeOnly: true });
      await store.dispatch('goals/fetchGoals');
      await store.dispatch('appAuth/fetchConnectedApps');

      // Only check health if we need to
      if (store.getters['appAuth/needsHealthCheck']) {
        try {
          await store.dispatch('appAuth/checkConnectionHealthStream');
        } catch (error) {
          console.error('Error with initial health check stream:', error);
        }
      }
    });

    return {
      handleEditWorkflow,
      handleReviewItem,
    };
  },
};
</script>

<style scoped>
.automation-dashboard {
  height: 100%;
  overflow-y: auto;
  /* Padding is handled by the parent RightPanel to avoid layout issues. */
  scrollbar-width: none;
  padding: 0;
  background: transparent;
  border: none;
  display: flex;
  flex-direction: column;
}

.automation-dashboard::-webkit-scrollbar {
  display: none;
}
</style>
