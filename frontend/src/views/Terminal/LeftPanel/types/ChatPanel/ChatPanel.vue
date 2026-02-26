<template>
  <div class="automation-dashboard">
    <!-- Performance Overview -->
    <!-- <PerformanceOverview /> -->

    <!-- Workflow Templates -->
    <!-- <ActiveWorkflows @edit-workflow="handleEditWorkflow" /> -->

    <!-- Items for Review -->
    <!-- <ItemsForReview @review-item="handleReviewItem" /> -->

    <!-- Integration Health -->
    <!-- <IntegrationHealth /> -->

    <!-- Active Tasks -->
    <!-- <ActiveTasks /> -->

    <!-- System Resources -->
    <!-- <SystemResources /> -->

    <!-- Output List -->
    <OutputList />
  </div>
</template>

<script>
import { onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import ActiveWorkflows from './components/ActiveWorkflows.vue';
import IntegrationHealth from './components/IntegrationHealth.vue';
import ItemsForReview from './components/ItemsForReview.vue';
import PerformanceOverview from './components/PerformanceOverview.vue';
import ActiveTasks from './components/ActiveTasks.vue';
import SystemResources from './components/SystemResources.vue';
import OutputList from './components/OutputList.vue';

export default {
  name: 'ChatPanel',
  components: {
    ActiveWorkflows,
    IntegrationHealth,
    ItemsForReview,
    PerformanceOverview,
    ActiveTasks,
    SystemResources,
    OutputList,
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    const handleEditWorkflow = (data) => {
      emit('panel-action', 'edit-workflow', data.workflowId);
    };

    const handleReviewItem = (data) => {
      emit('panel-action', 'review-item', data);
    };

    onMounted(() => {
      // Data is pre-loaded by initializeStore in main.js - no redundant fetches needed
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
}

.automation-dashboard::-webkit-scrollbar {
  display: none;
}
</style>
