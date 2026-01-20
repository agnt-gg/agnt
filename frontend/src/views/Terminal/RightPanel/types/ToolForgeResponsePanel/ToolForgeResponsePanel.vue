<template>
  <div class="response-panel-container">
    <div class="response-area-container">
      <ResponseArea @content-loaded="onResponseAreaLoaded" @reset-content="clearOutput" :content="toolOutput" />
    </div>

    <div class="content-actions-container">
      <ContentActions />
    </div>
  </div>
</template>

<script>
import { ref, inject } from 'vue';
import ResponseArea from '@/views/Terminal/CenterPanel/screens/ToolForge/components/ResponseArea/ResponseArea.vue';
import ContentActions from '@/views/Terminal/CenterPanel/screens/ToolForge/components/ContentActions/ContentActions.vue';

export default {
  name: 'ToolForgeResponsePanel',
  components: {
    ResponseArea,
    ContentActions,
  },
  setup() {
    const toolOutput = ref('');

    const onResponseAreaLoaded = () => {
      console.log('Response area loaded in right panel');
    };

    const clearOutput = () => {
      toolOutput.value = '';
      console.log('Tool output cleared');
    };

    return {
      toolOutput,
      onResponseAreaLoaded,
      clearOutput,
    };
  },
};
</script>

<style scoped>
.response-panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  gap: 16px;
}

.response-area-container {
  flex: 1;
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-actions-container {
  flex-shrink: 0;
}
</style>
