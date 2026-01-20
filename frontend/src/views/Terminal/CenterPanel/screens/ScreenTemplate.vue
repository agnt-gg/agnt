<template>
    <!-- TODO: Change to the desired default panel for this screen -->
    <!-- TODO: Change to a unique ID for this screen -->
    <!-- Set to false if this screen doesn't need user input -->
    <!-- Optional: Remove or replace with actual tutorial -->
    <!-- Optional: Only if displaying dynamic lines -->
    <BaseScreen
      ref="baseScreenRef"
      activeRightPanel="DefaultPanel"
      screenId="ScreenTemplate"
      :showInput="true"
      :useTutorialHook="useTutorial"
      :terminalLines="terminalLines"
      @submit-input="handleUserInputSubmit"
      @panel-action="handlePanelAction"
      @screen-change="(screenName) => emit('screen-change', screenName)"
      @base-mounted="initializeScreen"
    >
      <!-- Default slot content: Main content for this screen -->
      <template #default>
        <!-- Static content or v-for loop for dynamic lines -->
        <div
          v-for="(line, index) in terminalLines"
          :key="index"
          class="terminal-line"
        >
          <span v-html="line"></span>
        </div>
        <!-- Add your screen-specific static or dynamic content here -->
        <div class="terminal-line">Screen Template Initialized. Ready for content.</div>
  
      </template>
    </BaseScreen>
  </template>
  
  <script>
  import { ref, onMounted, onUnmounted, nextTick } from "vue";
  // import { useStore } from "vuex"; // Uncomment if Vuex is needed
  import BaseScreen from "../../components/LeftPanel/BaseScreen.vue";
  import { useTutorial } from "./useTutorial.js"; // Import popup-tutorial hook
  
  // --- Optional: Define a dummy tutorial hook if not using a real one ---
  // const useTutorial = () => ({
  //   tutorialConfig: ref([]),
  //   startTutorial: ref(false),
  //   onTutorialClose: () => {},
  // });
  // --- End Optional ---
  
  export default {
    name: "ScreenTemplate", // TODO: Change to the actual screen name
    components: { BaseScreen },
    emits: ["screen-change"],
    setup(props, { emit }) {
      // const store = useStore(); // Uncomment if Vuex is needed
      const baseScreenRef = ref(null);
  
      // --- Screen-Specific State ---
      const terminalLines = ref([]); // Example state for dynamic lines
  
      // --- BaseScreen Methods Access ---
      const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();
      const focusInput = () => baseScreenRef.value?.focusInput();
      const setInputDisabled = (disabled) => baseScreenRef.value?.setInputDisabled(disabled);
      const clearInput = () => baseScreenRef.value?.clearInput();
  
      // --- Input Handling ---
      const handleUserInputSubmit = (input) => {
        terminalLines.value.push(`> ${input}`); // Echo input
        clearInput();
        scrollToBottom();
  
        // TODO: Add command processing logic for this screen
        setInputDisabled(true); // Disable input during processing
        setTimeout(() => { // Simulate async operation
          terminalLines.value.push(`[Processing command: ${input}]`);
          scrollToBottom();
          setInputDisabled(false); // Re-enable input
          focusInput();
        }, 500);
      };
  
      // --- Panel Interaction ---
      const handlePanelAction = (action, payload) => {
        terminalLines.value.push(`[Panel Action Received: ${action} with payload: ${JSON.stringify(payload)}]`);
        scrollToBottom();
        // BaseScreen handles focus by default after panel action
        // Add specific logic here if needed
      };
  
      // --- Initialization ---
      const initializeScreen = async () => {
        terminalLines.value.push("Initializing Screen Template...");
        // TODO: Add screen-specific initialization logic (e.g., fetch data)
        await nextTick(); // Wait for DOM updates
        scrollToBottom();
        focusInput(); // Focus input after initialization
        terminalLines.value.push("Screen Template Ready.");
      };
  
      // --- Lifecycle Hooks ---
      onMounted(() => {
        // BaseScreen will emit 'base-mounted' which triggers initializeScreen
        console.log("ScreenTemplate Mounted");
      });
  
      onUnmounted(() => {
        console.log("ScreenTemplate Unmounted");
        // TODO: Add cleanup logic if needed (e.g., clear intervals, abort fetches)
      });
  
      // --- Return reactive state and methods ---
      return {
        baseScreenRef,
        terminalLines, // Expose state needed in the template
        handleUserInputSubmit,
        handlePanelAction,
        emit,
        useTutorial, // Provide the tutorial hook to BaseScreen
        initializeScreen, // Although called via event, good practice to return
      };
    },
  };
  </script>
  
  <style scoped>
  /* Add screen-specific styles here */
  .terminal-line {
    /* Example style */
    line-height: 1.3;
  }
  
  /* Add specific styles for content within the #default slot */
  
  </style>