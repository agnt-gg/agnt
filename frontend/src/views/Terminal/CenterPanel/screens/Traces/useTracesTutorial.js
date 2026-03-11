import { ref } from 'vue';

export function useTracesTutorial() {
  const tutorialConfig = ref([
    {
      target: '.traces-panel',
      position: 'center',
      title: '📊 Execution Traces',
      content: 'This is your trace history page. Here you can see all your workflow and goal traces, track their status, and review detailed logs.',
      buttonText: 'Show Me Around',
      hideArrow: true,
    },
    {
      target: '.sticky-header',
      position: 'bottom',
      title: '🔍 Filter & Search',
      content:
        'Use these tabs to filter by status (All, Running, Completed, Failed, Stopped) and the type buttons to filter between Goals and Workflows.',
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.type-filter-bar',
      position: 'bottom',
      title: '🎯 Type Filters',
      content: 'Switch between viewing all traces, just Goals, or just Workflows. This helps you focus on what matters most.',
      buttonText: 'Got It',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.executions-grid',
      position: 'center',
      title: '📋 Trace Cards',
      content:
        'Each card shows a trace with its status, start time, duration, and credits used. Click any card to see detailed logs and node execution data.',
      buttonText: 'Next',
      highlightTarget: true,
      hideArrow: true,
      enforceStep: false,
    },
    {
      target: '.execution-card',
      position: 'right',
      title: '🔄 Trace Details',
      content: 'Click a trace to view full details in the right panel. Double-click to see an expanded view with node-by-node execution data.',
      buttonText: 'Makes Sense',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.traces-panel',
      position: 'center',
      title: "✅ You're All Set!",
      content: 'Now you can track all your workflow and goal traces, monitor their progress, and debug any issues. Happy automating!',
      buttonText: "Let's Go!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
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

  const initializeTracesTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeTracesTutorial,
  };
}
