<template>
  <!-- Plain, on purpose. Not wrapped in the shared right-panel shell
       (views/_components/one): that shell adds a caption, a stats block and
       a click-to-examine section, and a dashboard has nothing to examine.
       Guarded by __guards__/screenRegistry.spec.js. This is the same block
       main's Chat panel shows on the right: what is running, what is
       connected. -->
  <div class="dashboard-panel">
    <ActiveWorkflows
      @edit-workflow="(payload) => $emit('panel-action', 'edit-workflow', payload.workflowId)"
      @panel-action="(action, ...args) => $emit('panel-action', action, ...args)"
    />
    <IntegrationHealth />
  </div>
</template>

<script>
import ActiveWorkflows from '@/views/Terminal/RightPanel/types/ChatPanel/components/ActiveWorkflows.vue';
import IntegrationHealth from '@/views/Terminal/RightPanel/types/ChatPanel/components/IntegrationHealth.vue';

export default {
  name: 'DashboardPanel',
  components: { ActiveWorkflows, IntegrationHealth },
  emits: ['panel-action'],
};
</script>

<style scoped>
.dashboard-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
