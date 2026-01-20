import { ref } from 'vue';

export function useToolsTutorial() {
  const tutorialConfig = ref([
    {
      target: '.tools-panel',
      position: 'center',
      title: '🛠️ Welcome to Tools!',
      content:
        "This is your tools library! Here I'll show you all the tools available - both system tools I provide and custom tools you can create. Think of these as the building blocks for your workflows and agents.",
      buttonText: 'Show Me Around',
      hideArrow: true,
    },
    {
      target: '.sticky-header',
      position: 'bottom',
      title: '📊 Tool Tabs & Search',
      content:
        "I've organized tools into tabs - All, System, and Custom. Use the search bar to quickly find specific tools, and toggle between grid and table views to see them however you prefer.",
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.category-cards-container',
      position: 'center',
      title: '🗂️ Tool Categories',
      content:
        "Tools are grouped by category - triggers, actions, utilities, and more. You can collapse categories you don't need right now, and even drag tools between categories to reorganize them.",
      buttonText: 'Got It',
      highlightTarget: true,
      hideArrow: true,
      enforceStep: false,
    },
    {
      target: '.tool-card',
      position: 'right',
      title: '🎯 Tool Cards',
      content:
        'Each tool card shows its name, description, and source (system or custom). Click any tool to see detailed information in the right panel, including how to use it.',
      buttonText: 'Makes Sense',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.tools-panel',
      position: 'center',
      title: "✅ You're Ready!",
      content:
        "Now you can explore all available tools, create custom ones, and use them in your workflows and agents. I'm here to help you automate anything you can imagine!",
      buttonText: "Let's Go!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-ToolsScreen-completed', 'true');
  };

  const nextStep = () => {
    const currentStepConfig = tutorialConfig.value[currentStep.value];
    if (currentStepConfig && typeof currentStepConfig.action === 'function') {
      currentStepConfig.action();
    }

    if (currentStep.value < tutorialConfig.value.length - 1) {
      currentStep.value++;
    } else {
      onTutorialClose();
    }
  };

  const initializeToolsTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeToolsTutorial,
  };
}
