<template>
  <!--
    ScreenTemplate — copy this to start a new screen.

    LAYOUT IS DECLARED IN THE REGISTRY, NOT HERE.
    Add an entry for your screenId to CenterPanel/screenRegistry.js:

      MyNewScreen: { leftPanel: 'MyNewPanel', rightPanel: 'MyNewPanel', input: false },

    That single entry controls which panels render and whether the input
    line shows. Only pass a panel prop here if the panel genuinely CHANGES
    at runtime (see Workflows.vue) — an explicitly passed prop wins over
    the registry.
  -->
  <!-- Optional: add a sibling useTutorial.js (see Chat/ or Settings/) and
       pass it as :useTutorialHook="useTutorial" for a first-run tour. -->
  <BaseScreen
    ref="baseScreenRef"
    screenId="ScreenTemplate"
    :terminalLines="terminalLines"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="terminal-line">Screen Template Initialized. Ready for content.</div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref } from 'vue';
import BaseScreen from '../BaseScreen.vue';

export default {
  name: 'ScreenTemplate',
  components: { BaseScreen },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);

    const initializeScreen = () => {
      // Runs once BaseScreen has mounted.
    };

    const handleUserInputSubmit = (input) => {
      // Only fires if this screen's registry entry sets input: true.
      console.log('User input:', input);
    };

    const handlePanelAction = (action) => {
      console.log('Panel action:', action);
    };

    return {
      baseScreenRef,
      terminalLines,
      emit,
      initializeScreen,
      handleUserInputSubmit,
      handlePanelAction,
    };
  },
};
</script>

<style scoped>
/* Screen-specific styles only. Shared look belongs to the design system. */
</style>
